import { leads, stages, type TenantTx } from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import repository, {
  type QueueFilter,
} from "../../src/modules/leads/repository.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";

type Target = { agencyId: string; companyId: string };
type Plan = {
  "Node Type": string;
  "Relation Name"?: string;
  "Index Name"?: string;
  Plans?: Plan[];
};
const minute = 60 * 1000;

describe("lead queue route", () => {
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

  const list = (slug: string, cookie?: string, query = "") =>
    fixture.apps[0].app.inject({
      method: "GET",
      url: `/api/companies/${slug}/leads/listLeads${query}`,
      headers: cookie ? { cookie } : {},
    });
  const enter = (who: { cookie: string; companyId: string }) =>
    fixture.companyRequest("POST", "enterCompany", who.cookie, {
      companyId: who.companyId,
      reason: "Checking the lead queue for the client",
    });
  async function setup() {
    const base = await fixture.setup();
    const [stage] = await fixture.scoped(base.a, (tx) =>
      tx.select().from(stages).where(eq(stages.isDefault, true)),
    );
    return { ...base, stageId: stage.id };
  }

  it("sends the page with ISO dates", async () => {
    const { a, manager, slug, stageId } = await setup();
    await fixture.addLead(a, stageId, {
      fullName: "Sita Sharma",
      leadDate: new Date("2026-10-31T08:15:30.123Z"),
    });
    const response = await list(slug, manager.cookie);
    expect(response.statusCode).toBe(200);
    const { data } = response.json();
    expect(data.total).toBe(1);
    expect(data.nextCursor).toBe(null);
    expect(data.items[0]).toMatchObject({
      fullName: "Sita Sharma",
      leadDate: "2026-10-31T08:15:30.123Z",
      nextActionAt: null,
      assignedAt: null,
      bucket: null,
    });
  });

  it("lets entered staff read until the entry ends", async () => {
    const { a, slug } = await setup();
    expect((await list(slug, a.cookie)).statusCode).toBe(403);
    expect((await enter(a)).statusCode).toBe(200);
    expect((await list(slug, a.cookie)).statusCode).toBe(200);
    fixture.advance(8 * 60 * minute);
    expect((await list(slug, a.cookie)).statusCode).toBe(403);
  });

  it("refuses the owner, other companies, other agencies and no session", async () => {
    const { owner, b, manager, foreign, slug, foreignSlug } = await setup();
    expect((await enter(b)).statusCode).toBe(200);
    expect((await list(slug, owner.cookie)).statusCode).toBe(403);
    expect((await list(slug, foreign.cookie)).statusCode).toBe(404);
    expect((await list(slug, b.cookie)).statusCode).toBe(404);
    expect((await list(foreignSlug, manager.cookie)).statusCode).toBe(404);
    expect((await list(slug)).statusCode).toBe(401);
  });

  it("refuses a deactivated member", async () => {
    const { a, slug } = await setup();
    const user = await fixture.seedUser();
    await fixture.seedMember(a, user.id, "deactivated", "admin");
    const { cookie } = await fixture.loginAs(user);
    expect((await list(slug, cookie)).statusCode).toBe(404);
  });

  it("refuses an Admin asking for the unassigned queue", async () => {
    const { seller, slug } = await setup();
    expect(
      (await list(slug, seller.cookie, "?assignedTo=unassigned")).statusCode,
    ).toBe(403);
  });

  it.each([
    ["an unknown priority", "?priority=boiling"],
    ["an unknown key", "?companyId=x"],
    ["a long search", `?q=${"a".repeat(121)}`],
    ["a made-up cursor", "?cursor=not-a-cursor"],
  ])("refuses %s", async (_name, query) => {
    const { manager, slug } = await setup();
    expect((await list(slug, manager.cookie, query)).statusCode).toBe(400);
  });
});

describe("lead queue query plans on 50,000 leads", () => {
  let fixture: SettingsFixture;
  let target: Target;
  beforeAll(async () => {
    fixture = await startSettingsFixture();
    const base = await fixture.setup();
    target = base.a;
    await fixture.scoped(target, async (tx) => {
      const [stage] = await tx
        .select()
        .from(stages)
        .where(eq(stages.isDefault, true));
      await tx.execute(sql`
        insert into leads (id, company_id, full_name, phone_e164, phone_valid, source_kind,
          lead_date, stage_id, custom, score, priority, score_breakdown, scored_at)
        select gen_random_uuid(), ${target.companyId}, 'Lead ' || n,
          '+97798' || lpad(n::text, 8, '0'), true, 'import',
          timestamptz '2026-10-31' - (n / 3) * interval '1 minute', ${stage.id}, '{}', 0,
          (array['hot','warm','cold'])[n % 3 + 1], '{}', now()
        from generate_series(1, 50000) as n`);
    });
    await fixture.owner("analyze leads");
  }, 120000);
  afterAll(async () => {
    await fixture?.close();
  });

  const filter: QueueFilter = {
    assignedTo: "unassigned",
    priority: null,
    stageId: null,
    name: null,
    phonePrefix: null,
  };
  async function plan(query: (tx: TenantTx) => { getSQL(): unknown }) {
    const [row] = await fixture.scoped(target, async (tx) => {
      const result = await tx.execute<{ "QUERY PLAN": [{ Plan: Plan }] }>(
        sql`explain (format json) ${query(tx)}`,
      );
      return result.rows;
    });
    const nodes: Plan[] = [];
    const walk = (node: Plan) => {
      nodes.push(node);
      node.Plans?.forEach(walk);
    };
    walk(row["QUERY PLAN"][0].Plan);
    return nodes;
  }
  const indexes = (nodes: Plan[]) => nodes.map((node) => node["Index Name"]);
  const seqScans = (nodes: Plan[]) =>
    nodes.filter(
      (node) =>
        node["Node Type"] === "Seq Scan" && node["Relation Name"] === "leads",
    );

  it("reads the first page in date order from the date index", async () => {
    const nodes = await plan((tx) =>
      repository.listQueue(tx, filter, null, 51),
    );
    expect(indexes(nodes)).toContain("leads_lead_date_idx");
    expect(nodes.some((node) => node["Node Type"] === "Sort")).toBe(false);
  });

  it("reads a later page from the date index", async () => {
    const cursor = { at: new Date("2026-10-20T00:00:00.000Z"), id: v7() };
    const nodes = await plan((tx) =>
      repository.listQueue(tx, filter, cursor, 51),
    );
    expect(indexes(nodes)).toContain("leads_lead_date_idx");
  });

  it("finds a phone start through the prefix index", async () => {
    const nodes = await plan((tx) =>
      repository.listQueue(
        tx,
        { ...filter, phonePrefix: "+9779800004" },
        null,
        51,
      ),
    );
    expect(indexes(nodes)).toContain("leads_phone_prefix_idx");
    expect(seqScans(nodes)).toEqual([]);
  });

  it("counts a phone search without a full scan", async () => {
    const nodes = await plan((tx) =>
      tx
        .select({ total: sql`count(*)` })
        .from(leads)
        .where(repository._where({ ...filter, phonePrefix: "+9779800004" })),
    );
    expect(seqScans(nodes)).toEqual([]);
  });
});
