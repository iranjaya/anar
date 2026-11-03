import { stages } from "@anar/db/tenant";
import { type SQL, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import buckets from "../../src/modules/leads/buckets.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type PlanNode = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  Plans?: PlanNode[];
};
const flat = (node: PlanNode): PlanNode[] => [
  node,
  ...(node.Plans ?? []).flatMap(flat),
];

describe("Today reads a large company through its indexes", () => {
  let fixture: SettingsFixture;
  let explain: (query: SQL) => Promise<PlanNode[]>;
  let memberId: string;
  beforeAll(async () => {
    fixture = await startSettingsFixture();
    await fixture.reset();
    const base = await fixture.setup();
    const seller = await fixture.seedUser();
    const member = await fixture.seedMember(
      base.a,
      seller.id,
      "active",
      "admin",
    );
    const manager = await fixture.seedUser();
    const other = await fixture.seedMember(base.a, manager.id);
    memberId = member.id;
    const [stage] = await fixture.scoped(base.a, (tx) =>
      tx.select().from(stages).limit(1),
    );
    // 50,000 leads: one in 250 is the seller's, half go to another member, the rest wait unassigned.
    await fixture.scoped(base.a, async (tx) => {
      await tx.execute(sql`
        INSERT INTO leads (id, company_id, phone_valid, source_kind, lead_date, stage_id, custom,
          score, priority, score_breakdown, scored_at, assigned_to, next_action_at)
        SELECT gen_random_uuid(), ${base.a.companyId}, false, 'import', now(), ${stage.id}, '{}',
          0, (ARRAY['hot','warm','cold'])[g % 3 + 1], '{}', now(),
          CASE WHEN g % 250 = 0 THEN ${member.id}::uuid
            WHEN g % 2 = 0 THEN ${other.id}::uuid END,
          now() + (g % 96 - 48) * interval '1 hour'
        FROM generate_series(1, 50000) g`);
      await tx.execute(sql`
        INSERT INTO lead_events (id, company_id, lead_id, type, actor_user_id, data, created_at)
        SELECT gen_random_uuid(), company_id, id, 'assigned', ${manager.id},
          jsonb_build_object('assignmentId', gen_random_uuid(), 'from', null, 'to', assigned_to),
          now() - interval '2 hours'
        FROM leads WHERE assigned_to IS NOT NULL`);
    });
    await fixture.owner("ANALYZE leads; ANALYZE lead_events;");
    explain = async (query) => {
      const { rows } = await fixture.scoped(base.a, (tx) =>
        tx.execute<{ "QUERY PLAN": { Plan: PlanNode }[] }>(
          sql`EXPLAIN (FORMAT JSON) ${query}`,
        ),
      );
      return flat(rows[0]["QUERY PLAN"][0].Plan);
    };
  }, 120_000);
  afterAll(async () => {
    await fixture?.close();
  });

  const day = () => buckets.day(new Date(), "Asia/Kathmandu");
  const expectIndexed = (nodes: PlanNode[]) => {
    const names = nodes.map((node) => node["Index Name"]);
    expect(names).toContain("leads_assignee_next_action_idx");
    expect(names).toContain("lead_events_lead_idx");
    expect(
      nodes.filter(
        (node) =>
          node["Node Type"] === "Seq Scan" && node["Relation Name"] === "leads",
      ),
    ).toEqual([]);
  };

  it("pages each bucket without scanning every lead", async () => {
    for (const bucket of ["overdue", "due_today", "new"] as const)
      expectIndexed(
        await explain(buckets._pageSql(memberId, day(), bucket, null, 51)),
      );
  });

  it("counts the buckets without scanning every lead", async () => {
    expectIndexed(await explain(buckets._countSql(memberId, day())));
  });
});
