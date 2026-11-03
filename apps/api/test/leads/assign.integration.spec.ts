import { leadEvents, leads, stages, type TenantTx } from "@anar/db/tenant";
import type { AssignLeadsInput } from "@anar/domain/assignment";
import type { NotificationInput } from "@anar/domain/notifications";
import { asc, eq, inArray, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import assign from "../../src/modules/leads/assign.js";
import members from "../../src/modules/members/repository.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type Target = { agencyId: string; companyId: string };

describe("assigning leads", () => {
  let fixture: SettingsFixture;
  let sent: NotificationInput[];
  let failNotify: boolean;
  beforeAll(async () => {
    fixture = await startSettingsFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
    sent = [];
    failNotify = false;
  });
  afterAll(async () => {
    await fixture?.close();
  });

  const deps = () => ({
    context: fixture.apps[0].tenant,
    now: fixture.now,
    readMember: members.read,
    async notify(_tx: TenantTx, input: NotificationInput) {
      if (failNotify) throw new Error("Notification store is down");
      sent.push(input);
      return { id: v7() };
    },
  });

  async function setup() {
    const base = await fixture.setup();
    const login = async (
      role: "super_admin" | "admin",
      status: "active" | "invited" | "deactivated" = "active",
    ) => {
      const user = await fixture.seedUser();
      const member = await fixture.seedMember(base.a, user.id, status, role);
      const { cookie } = await fixture.loginAs(user);
      return { cookie, user, member };
    };
    const manager = await login("super_admin");
    const seller = await login("admin");
    const other = await login("admin");
    const invited = await login("admin", "invited");
    const [stage] = await fixture.scoped(base.a, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    const add = async (target: Target, stageId: string, row = {}) => {
      const id = v7();
      await fixture.addLead(target, stageId, { id, ...row });
      return id;
    };
    const leadIds = [
      await add(base.a, stage.id),
      await add(base.a, stage.id),
      await add(base.a, stage.id),
    ];
    return {
      ...base,
      manager,
      seller,
      other,
      invited,
      stageId: stage.id,
      add,
      leadIds,
    };
  }
  async function run(
    who: { cookie: string },
    slug: string,
    input: AssignLeadsInput,
  ) {
    const service = assign.create(deps());
    const actor = await service.requireContext(
      { headers: { cookie: who.cookie } },
      slug,
    );
    return service.assign(actor, input, { ip: "198.51.100.9" });
  }
  const owners = (target: Target, ids: string[]) =>
    fixture.scoped(target, async (tx) =>
      (
        await tx
          .select({ id: leads.id, assignedTo: leads.assignedTo })
          .from(leads)
          .where(inArray(leads.id, ids))
      ).map((row) => row.assignedTo),
    );
  const history = (target: Target) =>
    fixture.scoped(target, (tx) =>
      tx
        .select({ type: leadEvents.type, data: leadEvents.data })
        .from(leadEvents)
        .orderBy(asc(leadEvents.leadId)),
    );
  const audits = () =>
    fixture.rows<{ data: Record<string, string> }>(
      sql`select data from audit_log where action = 'leads.assign' order by created_at, id`,
    );

  it("hands three leads to one person with one history id and one notification", async () => {
    const { a, manager, seller, leadIds } = await setup();
    expect(
      await run(manager, a.company.slug, {
        leadIds,
        memberId: seller.member.id,
      }),
    ).toEqual({ updated: 3 });
    expect(await owners(a, leadIds)).toEqual(Array(3).fill(seller.member.id));
    const events = await history(a);
    expect(events.map((event) => event.type)).toEqual(
      Array(3).fill("assigned"),
    );
    const assignmentId = (events[0].data as { assignmentId: string })
      .assignmentId;
    expect(events.map((event) => event.data)).toEqual(
      Array(3).fill({ assignmentId, from: null, to: seller.member.id }),
    );
    expect(sent).toEqual([
      {
        companyId: a.companyId,
        userId: seller.user.id,
        title: "New leads assigned",
        body: "3 leads were assigned to you.",
        url: `/${a.company.slug}/today`,
        dedupeKey: `assign:${a.companyId}:${assignmentId}`,
        data: { type: "assigned", assignmentId, count: 3 },
      },
    ]);
    expect(await audits()).toEqual([
      { data: { count: "3", memberId: seller.member.id, assignmentId } },
    ]);
  });

  it("skips leads already with that person, and does nothing when all are", async () => {
    const { a, manager, seller, leadIds } = await setup();
    await run(manager, a.company.slug, {
      leadIds: leadIds.slice(0, 2),
      memberId: seller.member.id,
    });
    expect(
      await run(manager, a.company.slug, {
        leadIds,
        memberId: seller.member.id,
      }),
    ).toEqual({ updated: 1 });
    expect(
      await run(manager, a.company.slug, {
        leadIds,
        memberId: seller.member.id,
      }),
    ).toEqual({ updated: 0 });
    expect(await history(a)).toHaveLength(3);
    expect(sent).toHaveLength(2);
    expect(await audits()).toHaveLength(2);
  });

  it("unassigns with history but no notification", async () => {
    const { a, manager, seller, leadIds } = await setup();
    await run(manager, a.company.slug, { leadIds, memberId: seller.member.id });
    expect(
      await run(manager, a.company.slug, { leadIds, memberId: null }),
    ).toEqual({ updated: 3 });
    expect(await owners(a, leadIds)).toEqual([null, null, null]);
    const unassigned = (await history(a)).filter(
      (event) => event.type === "unassigned",
    );
    expect(unassigned).toHaveLength(3);
    expect(unassigned[0].data).toMatchObject({
      from: seller.member.id,
      to: null,
    });
    expect(sent).toHaveLength(1);
    expect((await audits())[1].data.memberId).toBe("none");
  });

  it("changes nothing when one lead belongs to another company or is gone", async () => {
    const { a, b, manager, seller, leadIds, add, stageId } = await setup();
    const [foreignStage] = await fixture.scoped(b, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    const foreign = await add(b, foreignStage.id);
    const deleted = await add(a, stageId, { deletedAt: fixture.now() });
    for (const extra of [foreign, deleted, v7()])
      await expect(
        run(manager, a.company.slug, {
          leadIds: [...leadIds, extra],
          memberId: seller.member.id,
        }),
      ).rejects.toMatchObject({ code: "not_found" });
    expect(await owners(a, leadIds)).toEqual([null, null, null]);
    expect(await history(a)).toEqual([]);
    expect(sent).toEqual([]);
  });

  it.each(["invited", "deactivated", "foreign"] as const)(
    "refuses a %s member as the new owner",
    async (which) => {
      const context = await setup();
      const { a, b, manager, invited, leadIds } = context;
      let memberId = invited.member.id;
      if (which === "deactivated") {
        const user = await fixture.seedUser();
        memberId = (
          await fixture.seedMember(a, user.id, "deactivated", "admin")
        ).id;
      }
      if (which === "foreign") {
        const user = await fixture.seedUser();
        memberId = (await fixture.seedMember(b, user.id, "active", "admin")).id;
      }
      await expect(
        run(manager, a.company.slug, { leadIds, memberId }),
      ).rejects.toMatchObject({ code: "validation" });
      expect(await owners(a, leadIds)).toEqual([null, null, null]);
    },
  );

  it("rolls back every lead and event when the notification fails", async () => {
    const { a, manager, seller, leadIds } = await setup();
    failNotify = true;
    await expect(
      run(manager, a.company.slug, { leadIds, memberId: seller.member.id }),
    ).rejects.toThrow("Notification store is down");
    expect(await owners(a, leadIds)).toEqual([null, null, null]);
    expect(await history(a)).toEqual([]);
    expect(await audits()).toEqual([]);
  });

  it("refuses an Admin", async () => {
    const { a, seller, other, leadIds } = await setup();
    await expect(
      run(seller, a.company.slug, { leadIds, memberId: other.member.id }),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("moves a removed member's open leads past 500 in one call and keeps closed ones", async () => {
    const { a, manager, seller, other, stageId } = await setup();
    const [won] = await fixture.scoped(a, (tx) =>
      tx.select().from(stages).where(eq(stages.kind, "won")),
    );
    await fixture.scoped(a, (tx) =>
      tx.execute(sql`
        insert into leads (id, company_id, phone_valid, source_kind, lead_date,
          stage_id, custom, score, priority, score_breakdown, scored_at, assigned_to)
        select gen_random_uuid(), ${a.companyId}, false, 'import', now(),
          case when n <= 501 then ${stageId}::uuid else ${won.id}::uuid end,
          '{}', 0, 'cold', '{}', now(), ${seller.member.id}
        from generate_series(1, 503) as n`),
    );
    const service = assign.create(deps());
    const actor = await service.requireContext(
      { headers: { cookie: manager.cookie } },
      a.company.slug,
    );
    const moved = await fixture.apps[0].tenant.withContext(
      actor,
      (tx, current) =>
        assign.reassignOpenLeads(
          tx,
          deps(),
          current,
          seller.member.id,
          other.member.id,
          {
            at: fixture.now(),
            ip: null,
          },
        ),
    );
    expect(moved).toBe(501);
    const counts = await fixture.scoped(a, (tx) =>
      tx.execute<{ assigned_to: string; n: number }>(
        sql`select assigned_to, count(*)::int as n from leads group by assigned_to order by n desc`,
      ),
    );
    expect(counts.rows).toEqual([
      { assigned_to: other.member.id, n: 501 },
      { assigned_to: null, n: 3 },
      { assigned_to: seller.member.id, n: 2 },
    ]);
    expect(sent).toHaveLength(1);
    expect(sent[0].data).toMatchObject({ count: 501 });
    expect(await audits()).toHaveLength(1);
  });
});
