import { fields, leads, stages } from "@anar/db/tenant";
import type { LeadFilters } from "@anar/domain/leads";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import list from "../../src/modules/leads/list.js";
import { loadSchema } from "../../src/modules/settings/index.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type Target = { agencyId: string; companyId: string };
type Lead = Partial<typeof leads.$inferInsert>;
const day = (n: number) => new Date(Date.UTC(2026, 9, n, 6, 0, 0, 0));

describe("lead queue lists live leads of the company by date", () => {
  let fixture: SettingsFixture;
  beforeAll(async () => {
    fixture = await startSettingsFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  const service = () =>
    list.create({ context: fixture.apps[0].tenant, loadSchema });

  async function setup() {
    const base = await fixture.setup();
    const login = async (target: Target, role: "super_admin" | "admin") => {
      const user = await fixture.seedUser();
      const member = await fixture.seedMember(target, user.id, "active", role);
      const { cookie } = await fixture.loginAs(user);
      return { cookie, member };
    };
    const manager = await login(base.a, "super_admin");
    const seller = await login(base.a, "admin");
    const other = await login(base.a, "admin");
    const foreign = await login(base.b, "super_admin");
    const [stage] = await fixture.scoped(base.a, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    const [foreignStage] = await fixture.scoped(base.b, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    return { ...base, manager, seller, other, foreign, stage, foreignStage };
  }

  const add = async (target: Target, stageId: string, rows: Lead[]) => {
    const ids = rows.map((row) => row.id ?? v7());
    for (const [n, row] of rows.entries())
      await fixture.addLead(target, stageId, {
        leadDate: day(1),
        ...row,
        id: ids[n],
      });
    return ids;
  };
  async function read(
    who: { cookie: string },
    slug: string,
    filters: LeadFilters = {},
  ) {
    const leadsList = service();
    const actor = await leadsList.requireContext(
      { headers: { cookie: who.cookie } },
      slug,
    );
    return leadsList.listLeads(actor, filters);
  }

  it("pages 50 at a time by newest date, then id, across equal dates", async () => {
    const { a, manager, stage } = await setup();
    const ids = await add(
      a,
      stage.id,
      Array.from({ length: 70 }, (_, n) => ({
        leadDate: n < 40 ? day(10) : day(n - 30),
      })),
    );
    const first = await read(manager, a.company.slug);
    const second = await read(manager, a.company.slug, {
      cursor: first.nextCursor ?? "",
    });
    expect(first.total).toBe(70);
    expect(second.total).toBe(70);
    expect(first.items).toHaveLength(50);
    expect(second.items).toHaveLength(20);
    expect(second.nextCursor).toBe(null);
    const order = [...first.items, ...second.items].map((row) => [
      row.leadDate.getTime(),
      row.id,
    ]);
    const expected = ids
      .map((id, n) => [(n < 40 ? day(10) : day(n - 30)).getTime(), id] as const)
      .sort((x, y) => y[0] - x[0] || (x[1] < y[1] ? -1 : 1));
    expect(order).toEqual(expected);
  });

  it("keeps paging after the last row of a page is deleted", async () => {
    const { a, manager, stage } = await setup();
    await add(
      a,
      stage.id,
      Array.from({ length: 55 }, (_, n) => ({ leadDate: day(1 + (n % 20)) })),
    );
    const first = await read(manager, a.company.slug);
    const last = first.items.at(-1)?.id ?? "";
    await fixture.scoped(a, (tx) =>
      tx
        .update(leads)
        .set({ deletedAt: day(30) })
        .where(eq(leads.id, last)),
    );
    const second = await read(manager, a.company.slug, {
      cursor: first.nextCursor ?? "",
    });
    expect(second.items).toHaveLength(5);
    expect(second.total).toBe(54);
    expect(
      second.items.some((row) =>
        first.items.some((seen) => seen.id === row.id),
      ),
    ).toBe(false);
  });

  it("refuses a cursor used with other filters", async () => {
    const { a, manager, stage } = await setup();
    await add(
      a,
      stage.id,
      Array.from({ length: 51 }, () => ({})),
    );
    const first = await read(manager, a.company.slug);
    await expect(
      read(manager, a.company.slug, {
        cursor: first.nextCursor ?? "",
        priority: "hot",
      }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("hides deleted, merged and other companies' leads from rows and total", async () => {
    const { a, b, manager, stage, foreignStage } = await setup();
    const [live, target] = await add(a, stage.id, [{}, {}]);
    await add(a, stage.id, [
      { deletedAt: day(2) },
      { mergedIntoId: target, leadDate: day(3) },
    ]);
    await add(b, foreignStage.id, [{}]);
    const page = await read(manager, a.company.slug);
    expect(page.items.map((row) => row.id).sort()).toEqual(
      [live, target].sort(),
    );
    expect(page.total).toBe(2);
  });

  it("shows managers the unassigned queue unless they pick a person", async () => {
    const { a, manager, seller, stage } = await setup();
    const [open] = await add(a, stage.id, [{}]);
    const [owned] = await add(a, stage.id, [{ assignedTo: seller.member.id }]);
    const queue = await read(manager, a.company.slug);
    const picked = await read(manager, a.company.slug, {
      assignedTo: seller.member.id,
    });
    expect(queue.items.map((row) => row.id)).toEqual([open]);
    expect(picked.items.map((row) => [row.id, row.assignee])).toEqual([
      [owned, { memberId: seller.member.id, name: "Company member" }],
    ]);
  });

  it("gives an Admin only their own leads, in rows and total", async () => {
    const { a, seller, other, stage } = await setup();
    const mine = await add(a, stage.id, [
      { assignedTo: seller.member.id },
      { assignedTo: seller.member.id, priority: "hot" },
    ]);
    await add(a, stage.id, [{}, { assignedTo: other.member.id }]);
    const page = await read(seller, a.company.slug);
    const hot = await read(seller, a.company.slug, { priority: "hot" });
    expect(page.items.map((row) => row.id).sort()).toEqual([...mine].sort());
    expect(page.total).toBe(2);
    expect(hot.items.map((row) => row.id)).toEqual([mine[1]]);
    expect(hot.total).toBe(1);
  });

  it.each(["unassigned", "other"] as const)(
    "refuses an Admin asking for %s leads",
    async (which) => {
      const { a, seller, other } = await setup();
      const assignedTo = which === "other" ? other.member.id : which;
      await expect(
        read(seller, a.company.slug, { assignedTo }),
      ).rejects.toMatchObject({ code: "forbidden" });
    },
  );

  it("refuses a manager of another company", async () => {
    const { a, foreign } = await setup();
    await expect(read(foreign, a.company.slug)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it("finds a name by any part, ignoring case, and a phone by its start", async () => {
    const { a, manager, stage } = await setup();
    const [sita, ram, percent] = await add(a, stage.id, [
      { fullName: "Sita Sharma", phoneE164: "+9779841000001" },
      { fullName: "Ram Thapa", phoneE164: "+9779801000002" },
      { fullName: "100% Sure" },
      { fullName: "Hari", phoneE164: "+9779751000003" },
    ]);
    const ids = async (q: string) =>
      (await read(manager, a.company.slug, { q })).items.map((row) => row.id);
    expect(await ids("SHARM")).toEqual([sita]);
    expect(await ids("9841")).toEqual([sita]);
    expect(await ids("+977980")).toEqual([ram]);
    expect(await ids("%")).toEqual([percent]);
    expect(await ids("1000002")).toEqual([]);
    expect((await read(manager, a.company.slug, { q: "a_" })).total).toBe(0);
  });

  it("filters by stage and priority with a matching total", async () => {
    const { a, manager, stage } = await setup();
    const won = await fixture.scoped(a, (tx) =>
      tx
        .select()
        .from(stages)
        .where(eq(stages.kind, "won"))
        .then((rows) => rows[0]),
    );
    const [hotWon] = await add(a, won.id, [{ priority: "hot" }]);
    await add(a, won.id, [{ priority: "cold" }]);
    await add(a, stage.id, [{ priority: "hot" }]);
    const page = await read(manager, a.company.slug, {
      stageId: won.id,
      priority: "hot",
    });
    expect(page.items.map((row) => [row.id, row.stage])).toEqual([
      [hotWon, { id: won.id, name: won.name, kind: "won" }],
    ]);
    expect(page.total).toBe(1);
  });

  it("labels dropdown answers from the company's fields", async () => {
    const { a, manager, stage } = await setup();
    await fixture.scoped(a, (tx) =>
      tx.insert(fields).values({
        id: v7(),
        companyId: a.companyId,
        key: "unit_type",
        label: "Unit",
        type: "dropdown",
        options: [{ value: "2bhk", label: "2 BHK" }],
        isSystem: false,
        position: 90,
      }),
    );
    await add(a, stage.id, [{ custom: { unit_type: "2bhk" } }]);
    const [row] = (await read(manager, a.company.slug)).items;
    expect(row.answers).toContainEqual({ key: "unit_type", label: "2 BHK" });
    expect(row.assignedAt).toBe(null);
    expect(row.bucket).toBe(null);
  });
});
