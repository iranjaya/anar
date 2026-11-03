import { createTenantDb, notifications, type TenantDb } from "@anar/db/tenant";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

type Company = {
  agencyId: string;
  companyId: string;
  company: { slug: string };
};
type Item = {
  id: string;
  userId: string;
  companyId: string;
  readAt: string | null;
};

describe("people read and mark only their own notifications", () => {
  let fixture: CompanyFixture;
  let tenantDb: TenantDb;
  beforeAll(async () => {
    fixture = await startCompanyFixture();
    tenantDb = await createTenantDb(fixture.postgres.appUrl);
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await tenantDb?.close();
    await fixture?.close();
  });

  const minute = 60 * 1000;
  async function seed(
    target: Company,
    userId: string,
    count: number,
    createdAt?: Date,
  ) {
    const rows = Array.from({ length: count }, (_, i) => {
      const leadId = v7();
      return {
        id: v7(),
        companyId: target.companyId,
        userId,
        type: "overdue" as const,
        title: `Overdue ${i}`,
        body: "A lead is overdue.",
        url: `/${target.company.slug}`,
        data: { type: "overdue" as const, leadId, localDate: "2026-10-31" },
        dedupeKey: `overdue:${target.companyId}:${leadId}:2026-10-31`,
        ...(createdAt ? { createdAt } : {}),
      };
    });
    await tenantDb.withTenant(
      { agencyId: target.agencyId, companyId: target.companyId, userId },
      (tx) => tx.insert(notifications).values(rows),
    );
    return rows.map((row) => row.id);
  }
  const list = (slug: string, cookie: string, cursor?: string) =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/notifications/listNotifications`,
      query: cursor ? { cursor } : {},
      headers: { cookie },
    });
  const items = async (slug: string, cookie: string) => {
    const response = await list(slug, cookie);
    expect(response.statusCode).toBe(200);
    return response.json().data.items as Item[];
  };
  const markRead = (
    slug: string,
    cookie: string,
    ids: unknown,
    origin: string | null = publicOrigin,
  ) =>
    fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${slug}/notifications/markRead`,
      payload: { ids },
      headers: { cookie, ...(origin ? { origin } : {}) },
    });
  const audits = () =>
    fixture.rows<{ actor_user_id: string; data: object }>(
      sql`select actor_user_id, data from audit_log where action = 'notifications.read' order by id`,
    );
  async function companyUser(
    target: Company,
    role: "super_admin" | "admin",
    ip: string,
  ) {
    const user = await fixture.seedUser();
    await fixture.seedMember(target, user.id, "active", role);
    return fixture.loginAs(user, { ip });
  }
  async function setup() {
    const base = await fixture.setup();
    const manager = await companyUser(base.a, "super_admin", "198.51.100.71");
    const seller = await companyUser(base.a, "admin", "198.51.100.72");
    return { ...base, manager, seller, slug: base.a.company.slug };
  }

  it("pages newest first, 50 at a time, through rows with the same time", async () => {
    const { a, manager, slug } = await setup();
    await seed(a, manager.user.id, 30, new Date("2026-10-31T08:00:00.000Z"));
    await seed(a, manager.user.id, 25, new Date("2026-10-31T09:00:00.000Z"));
    const first = (await list(slug, manager.cookie)).json().data;
    expect(first.items).toHaveLength(50);
    expect(first.unreadCount).toBe(55);
    expect(first.nextCursor).toEqual(expect.any(String));
    const second = (await list(slug, manager.cookie, first.nextCursor)).json()
      .data;
    expect(second.items).toHaveLength(5);
    expect(second.nextCursor).toBeNull();
    expect(second.unreadCount).toBe(55);
    const all = [...first.items, ...second.items] as (Item & {
      createdAt: string;
    })[];
    expect(new Set(all.map((item) => item.id)).size).toBe(55);
    const sorted = [...all].sort(
      (x, y) =>
        y.createdAt.localeCompare(x.createdAt) || y.id.localeCompare(x.id),
    );
    expect(all.map((item) => item.id)).toEqual(sorted.map((item) => item.id));
  });

  it("shows each person only their own rows, staff and managers too", async () => {
    const { a, manager, seller, slug } = await setup();
    await seed(a, manager.user.id, 2);
    await seed(a, seller.user.id, 1);
    await seed(a, a.user.id, 3);
    expect(
      (
        await fixture.companyRequest("POST", "enterCompany", a.cookie, {
          companyId: a.companyId,
          reason: "Checking the import for the client",
        })
      ).statusCode,
    ).toBe(200);
    for (const [cookie, userId, count] of [
      [manager.cookie, manager.user.id, 2],
      [seller.cookie, seller.user.id, 1],
      [a.cookie, a.user.id, 3],
    ] as const) {
      const own = await items(slug, cookie);
      expect(own).toHaveLength(count);
      expect(own.every((item) => item.userId === userId)).toBe(true);
    }
  });

  it("keeps one person's rows apart in two companies", async () => {
    const { a, b, manager } = await setup();
    await fixture.seedMember(b, manager.user.id);
    await seed(a, manager.user.id, 2);
    await seed(b, manager.user.id, 1);
    const inA = await items(a.company.slug, manager.cookie);
    const inB = await items(b.company.slug, manager.cookie);
    expect(inA.map((item) => item.companyId)).toEqual([
      a.companyId,
      a.companyId,
    ]);
    expect(inB.map((item) => item.companyId)).toEqual([b.companyId]);
  });

  it("marks own rows read once and leaves them read on repeat", async () => {
    const { a, manager, slug } = await setup();
    const ids = await seed(a, manager.user.id, 2);
    expect((await markRead(slug, manager.cookie, ids)).statusCode).toBe(200);
    const first = await items(slug, manager.cookie);
    expect(first.every((item) => item.readAt !== null)).toBe(true);
    fixture.advance(minute);
    expect((await markRead(slug, manager.cookie, ids)).statusCode).toBe(200);
    expect(await items(slug, manager.cookie)).toEqual(first);
    expect((await list(slug, manager.cookie)).json().data.unreadCount).toBe(0);
  });

  it("changes nothing when one ID belongs to someone else", async () => {
    const { a, manager, seller, slug } = await setup();
    const [own] = await seed(a, manager.user.id, 1);
    const [other] = await seed(a, seller.user.id, 1);
    for (const ids of [
      [own, other],
      [own, v7()],
    ]) {
      const response = await markRead(slug, manager.cookie, ids);
      expect(response.statusCode).toBe(404);
      expect(response.json().error).toBe("not_found");
    }
    expect((await items(slug, manager.cookie))[0].readAt).toBeNull();
    expect((await items(slug, seller.cookie))[0].readAt).toBeNull();
  });

  it("does not need a fresh code to mark read", async () => {
    const { a, manager, slug } = await setup();
    const ids = await seed(a, manager.user.id, 1);
    fixture.advance(16 * minute);
    expect((await markRead(slug, manager.cookie, ids)).statusCode).toBe(200);
  });

  it("audits staff mark-read, but not a member's", async () => {
    const { a, manager, slug } = await setup();
    const staffIds = await seed(a, a.user.id, 2);
    const managerIds = await seed(a, manager.user.id, 1);
    await fixture.companyRequest("POST", "enterCompany", a.cookie, {
      companyId: a.companyId,
      reason: "Checking the import for the client",
    });
    expect((await markRead(slug, a.cookie, staffIds)).statusCode).toBe(200);
    expect((await markRead(slug, a.cookie, staffIds)).statusCode).toBe(200);
    expect((await markRead(slug, manager.cookie, managerIds)).statusCode).toBe(
      200,
    );
    expect(await audits()).toEqual([
      { actor_user_id: a.user.id, data: { count: "2" } },
    ]);
  });

  it("refuses staff after the entry ends and people outside the company", async () => {
    const { a, b, manager, slug } = await setup();
    await fixture.companyRequest("POST", "enterCompany", a.cookie, {
      companyId: a.companyId,
      reason: "Checking the import for the client",
    });
    expect((await list(slug, a.cookie)).statusCode).toBe(200);
    fixture.advance(8 * 60 * minute);
    expect((await list(slug, a.cookie)).statusCode).toBe(403);
    expect((await list(slug, b.cookie)).statusCode).toBe(404);
    expect((await list(b.company.slug, manager.cookie)).statusCode).toBe(404);
    expect(
      (
        await fixture.apps[0].app.inject({
          method: "GET",
          url: `/api/companies/${slug}/notifications/listNotifications`,
        })
      ).statusCode,
    ).toBe(401);
  });

  it.each([
    ["no Origin", null],
    ["a hostile Origin", "https://hostile.example"],
  ])("refuses mark-read with %s", async (_name, origin) => {
    const { a, manager, slug } = await setup();
    const ids = await seed(a, manager.user.id, 1);
    expect((await markRead(slug, manager.cookie, ids, origin)).statusCode).toBe(
      403,
    );
    expect((await items(slug, manager.cookie))[0].readAt).toBeNull();
  });

  it.each<[string, unknown]>([
    ["no IDs", []],
    ["the same ID twice", ["DUP", "DUP"]],
    ["more than 100 IDs", Array.from({ length: 101 }, () => v7())],
    ["a value that is not an ID", ["abc"]],
  ])("rejects mark-read with %s", async (_name, ids) => {
    const { manager, slug } = await setup();
    const same = v7();
    const payload = Array.isArray(ids)
      ? ids.map((id) => (id === "DUP" ? same : id))
      : ids;
    expect((await markRead(slug, manager.cookie, payload)).statusCode).toBe(
      400,
    );
  });

  it("rejects a cursor that was not made by the list", async () => {
    const { manager, slug } = await setup();
    expect((await list(slug, manager.cookie, "not-a-cursor")).statusCode).toBe(
      400,
    );
  });
});
