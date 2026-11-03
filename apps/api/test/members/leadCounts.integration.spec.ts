import { createTenantDb, leads, stages, type TenantDb } from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
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

describe("the team shows real lead counts and keeps open work assigned", () => {
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

  const hour = 60 * 60 * 1000;
  const scoped = <T>(
    target: Company,
    fn: Parameters<TenantDb["withTenant"]>[1],
  ) =>
    tenantDb.withTenant(
      { agencyId: target.agencyId, companyId: target.companyId, userId: v7() },
      fn,
    ) as Promise<T>;
  async function stageIds(target: Company) {
    const rows = await scoped<
      { id: string; kind: string; isDefault: boolean }[]
    >(target, (tx) => tx.select().from(stages));
    const open = rows.find((row) => row.isDefault);
    const won = rows.find((row) => row.kind === "won");
    if (!open || !won) throw new Error("Expected seeded stages");
    return { open: open.id, won: won.id };
  }
  async function seedLead(
    target: Company,
    input: {
      assignedTo: string;
      stageId: string;
      nextActionAt?: Date;
      deletedAt?: Date;
      mergedIntoId?: string;
    },
  ) {
    const id = v7();
    const at = new Date(fixture.now());
    await scoped(target, (tx) =>
      tx.insert(leads).values({
        id,
        companyId: target.companyId,
        phoneValid: false,
        sourceKind: "manual",
        leadDate: at,
        custom: {},
        score: 1,
        priority: "cold",
        scoreBreakdown: { base: 1 },
        scoredAt: at,
        ...input,
      }),
    );
    return id;
  }
  async function companyUser(
    target: Company,
    role: "super_admin" | "admin",
    ip: string,
  ) {
    const user = await fixture.seedUser();
    const member = await fixture.seedMember(target, user.id, "active", role);
    return { ...(await fixture.loginAs(user, { ip })), member };
  }
  async function setup() {
    const { a } = await fixture.setup();
    const manager = await companyUser(a, "super_admin", "198.51.100.101");
    const seller = await companyUser(a, "admin", "198.51.100.102");
    return { a, manager, seller, ...(await stageIds(a)) };
  }
  const team = async (target: Company, cookie: string) => {
    const response = await fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${target.company.slug}/members/listMembers`,
      headers: { cookie },
    });
    expect(response.statusCode).toBe(200);
    return response.json().data as {
      id: string;
      status: string;
      openLeads: number;
      overdue: number;
    }[];
  };
  const remove = (
    target: Company,
    cookie: string,
    memberId: string,
    reassignTo?: string | null,
  ) =>
    fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${target.company.slug}/members/deactivateMember`,
      payload: { memberId, reassignTo },
      headers: { origin: publicOrigin, cookie },
    });

  it("counts open and overdue leads, not closed, merged or deleted ones", async () => {
    const { a, manager, seller, open, won } = await setup();
    const past = new Date(fixture.now().getTime() - hour);
    const future = new Date(fixture.now().getTime() + hour);
    const kept = await seedLead(a, {
      assignedTo: seller.member.id,
      stageId: open,
      nextActionAt: past,
    });
    await seedLead(a, {
      assignedTo: seller.member.id,
      stageId: open,
      nextActionAt: future,
    });
    await seedLead(a, { assignedTo: seller.member.id, stageId: won });
    await seedLead(a, {
      assignedTo: seller.member.id,
      stageId: open,
      deletedAt: past,
    });
    await seedLead(a, {
      assignedTo: seller.member.id,
      stageId: open,
      mergedIntoId: kept,
    });
    await seedLead(a, { assignedTo: manager.member.id, stageId: open });
    const rows = await team(a, manager.cookie);
    expect(rows.find((row) => row.id === seller.member.id)).toMatchObject({
      openLeads: 2,
      overdue: 1,
    });
    expect(rows.find((row) => row.id === manager.member.id)).toMatchObject({
      openLeads: 1,
      overdue: 0,
    });
  });

  it("leaves open leads unassigned when no destination is chosen", async () => {
    const { a, manager, seller, open } = await setup();
    const leadId = await seedLead(a, {
      assignedTo: seller.member.id,
      stageId: open,
    });
    const audits = () =>
      fixture.rows(
        sql`select id from audit_log where action = 'company.member_deactivated'`,
      );
    const response = await remove(a, manager.cookie, seller.member.id);
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ reassigned: 1 });
    expect(
      (await team(a, manager.cookie)).find((row) => row.id === seller.member.id)
        ?.status,
    ).toBe("deactivated");
    expect(
      await scoped(a, (tx) =>
        tx
          .select({ assignedTo: leads.assignedTo })
          .from(leads)
          .where(eq(leads.id, leadId)),
      ),
    ).toEqual([{ assignedTo: null }]);
    expect(
      (
        await fixture.apps[0].app.inject({
          method: "GET",
          url: "/api/auth/getSession",
          headers: { cookie: seller.cookie },
        })
      ).statusCode,
    ).toBe(401);
    expect(await audits()).toHaveLength(1);
  });

  it("keeps closed leads with the removed member", async () => {
    const { a, manager, seller, open, won } = await setup();
    const openId = await seedLead(a, {
      assignedTo: seller.member.id,
      stageId: open,
    });
    const closedId = await seedLead(a, {
      assignedTo: seller.member.id,
      stageId: won,
    });
    const response = await remove(
      a,
      manager.cookie,
      seller.member.id,
      manager.member.id,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ reassigned: 1 });
    expect(
      await scoped(a, (tx) =>
        tx
          .select({ id: leads.id, assignedTo: leads.assignedTo })
          .from(leads)
          .where(sql`${leads.id} in (${openId}::uuid, ${closedId}::uuid)`)
          .orderBy(leads.id),
      ),
    ).toEqual(
      [
        { id: openId, assignedTo: manager.member.id },
        { id: closedId, assignedTo: seller.member.id },
      ].sort((left, right) => left.id.localeCompare(right.id)),
    );
  });

  it("moves more than 500 open leads with one assignment audit", async () => {
    const { a, manager, seller, open, won } = await setup();
    await scoped(a, (tx) =>
      tx.execute(sql`
      insert into leads (id, company_id, phone_valid, source_kind, lead_date,
        stage_id, custom, score, priority, score_breakdown, scored_at, assigned_to)
      select gen_random_uuid(), ${a.companyId}, false, 'import', now(),
        case when n <= 501 then ${open}::uuid else ${won}::uuid end,
        '{}', 0, 'cold', '{}', now(), ${seller.member.id}
      from generate_series(1, 503) as n`),
    );
    const response = await remove(
      a,
      manager.cookie,
      seller.member.id,
      manager.member.id,
    );
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ reassigned: 501 });
    const rows = await scoped<{ assigned_to: string; n: number }[]>(
      a,
      async (tx) =>
        (
          await tx.execute<{ assigned_to: string; n: number }>(sql`
        select assigned_to, count(*)::int as n from leads
        group by assigned_to order by n desc`)
        ).rows,
    );
    expect(rows).toEqual([
      { assigned_to: manager.member.id, n: 501 },
      { assigned_to: seller.member.id, n: 2 },
    ]);
    const audits = await fixture.rows<{ data: { count: string } }>(
      sql`select data from audit_log where action = 'leads.assign'`,
    );
    expect(audits).toHaveLength(1);
    expect(audits[0].data.count).toBe("501");
  });

  it("moves 10k open leads within the browser request deadline", async () => {
    const { a, manager, seller, open } = await setup();
    await scoped(a, (tx) =>
      tx.execute(sql`
        insert into leads (id, company_id, phone_valid, source_kind, lead_date,
          stage_id, custom, score, priority, score_breakdown, scored_at, assigned_to)
        select gen_random_uuid(), ${a.companyId}, false, 'import', now(),
          ${open}::uuid, '{}', 0, 'cold', '{}', now(), ${seller.member.id}
        from generate_series(1, 10000)`),
    );
    const started = performance.now();
    const response = await remove(
      a,
      manager.cookie,
      seller.member.id,
      manager.member.id,
    );
    const elapsed = performance.now() - started;
    expect(response.statusCode).toBe(200);
    expect(response.json().data).toEqual({ reassigned: 10000 });
    expect(elapsed).toBeLessThan(10000);
  }, 30000);
});
