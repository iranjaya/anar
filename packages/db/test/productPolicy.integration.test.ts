import { type SQL, sql } from "drizzle-orm";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import type { DbHandle } from "../src/connection.js";
import { createDb } from "../src/connection.js";
import {
  type PlatformTx,
  withPlatformAgency,
  withPlatformTenant,
} from "../src/platform.js";
import type { TenantScope } from "../src/tenant.js";
import { type Postgres, startPostgres } from "./postgres.js";

const owner = "10000000-0000-4000-8000-000000000001";
const userA = "10000000-0000-4000-8000-0000000000a1";
const userB = "10000000-0000-4000-8000-0000000000b1";
const agencyA = "20000000-0000-4000-8000-00000000000a";
const agencyB = "20000000-0000-4000-8000-00000000000b";
const companies = {
  a1: "40000000-0000-4000-8000-0000000000a1",
  a2: "40000000-0000-4000-8000-0000000000a2",
  b1: "40000000-0000-4000-8000-0000000000b1",
  b2: "40000000-0000-4000-8000-0000000000b2",
};
const scope = (company: keyof typeof companies): TenantScope => ({
  agencyId: company.startsWith("a") ? agencyA : agencyB,
  companyId: companies[company],
  userId: company.startsWith("a") ? userA : userB,
});
const platformTables = [
  "agencies",
  "audit_log",
  "auth_rate_limits",
  "invites",
  "otp_codes",
  "push_endpoint_bindings",
  "sessions",
  "users",
  "worker_heartbeats",
];

describe("product tables follow the agency and company policy", () => {
  let postgres: Postgres;
  let runtime: DbHandle;
  let migration: DbHandle;

  const tx = <T>(fn: (tx: PlatformTx) => Promise<T>) =>
    runtime.withConnection((connection) => connection.transaction(fn));
  const rows = async (scoped: PlatformTx, query: SQL) =>
    (await scoped.execute(query)).rows;
  const inCompany = <T>(
    company: keyof typeof companies,
    fn: (tx: PlatformTx) => Promise<T>,
  ) => tx((outer) => withPlatformTenant(outer, scope(company), fn));
  const inAgency = <T>(
    agencyId: string,
    userId: string,
    fn: (tx: PlatformTx) => Promise<T>,
  ) => tx((outer) => withPlatformAgency(outer, { agencyId, userId }, fn));

  async function unprotected(): Promise<string[]> {
    const result = await migration.pool.query<{ table_name: string }>(
      `SELECT c.relname AS table_name FROM pg_class c
       JOIN pg_namespace n ON n.oid = c.relnamespace
       WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
         AND NOT (c.relname = ANY($1::text[]))
         AND NOT (c.relrowsecurity AND c.relforcerowsecurity
           AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd IN ('r', '*')
             AND pg_get_expr(p.polqual, p.polrelid) LIKE '%app.agency_id%')
           AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd IN ('a', '*')
             AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%app.agency_id%')
           AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd IN ('w', '*')
             AND pg_get_expr(p.polqual, p.polrelid) LIKE '%app.agency_id%'
             AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%app.agency_id%')
           AND NOT has_table_privilege('anar_app', c.oid, 'DELETE')
           AND NOT has_table_privilege('anar_app', c.oid, 'TRUNCATE')
           AND (NOT EXISTS (SELECT 1 FROM pg_attribute a WHERE a.attrelid = c.oid
                 AND a.attname = 'company_id' AND NOT a.attisdropped)
             OR (EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd IN ('r', '*')
                   AND pg_get_expr(p.polqual, p.polrelid) LIKE '%app.company_id%')
                 AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd IN ('a', '*')
                   AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%app.company_id%')
                 AND EXISTS (SELECT 1 FROM pg_policy p WHERE p.polrelid = c.oid AND p.polcmd IN ('w', '*')
                   AND pg_get_expr(p.polqual, p.polrelid) LIKE '%app.company_id%'
                   AND pg_get_expr(p.polwithcheck, p.polrelid) LIKE '%app.company_id%'))))
       ORDER BY c.relname`,
      [platformTables],
    );
    return result.rows.map((row) => row.table_name);
  }

  beforeAll(async () => {
    postgres = await startPostgres();
    await postgres.bootstrap();
    await postgres.migrate();
    runtime = createDb(postgres.appUrl);
    runtime.pool.options.max = 1;
    migration = createDb(postgres.migrationUrl);
    await tx(async (outer) => {
      await outer.execute(sql`insert into users (id, email, name, platform_role) values
        (${owner}, 'owner@policy.example.test', 'Policy owner', 'owner'),
        (${userA}, 'a@policy.example.test', 'Staff A', null),
        (${userB}, 'b@policy.example.test', 'Staff B', null)`);
      await outer.execute(sql`insert into agencies (id, name, slug, status, created_by) values
        (${agencyA}, 'Agency A', 'policy-a', 'active', ${owner}),
        (${agencyB}, 'Agency B', 'policy-b', 'active', ${owner})`);
    });
    for (const [agencyId, userId, keys] of [
      [agencyA, userA, ["a1", "a2"]],
      [agencyB, userB, ["b1", "b2"]],
    ] as const) {
      await inAgency(agencyId, userId, async (scoped) => {
        await scoped.execute(sql`insert into agency_members (id, agency_id, user_id, status, invited_by)
          values (gen_random_uuid(), ${agencyId}, ${userId}, 'active', ${owner})`);
        for (const key of keys)
          await scoped.execute(sql`insert into companies (id, agency_id, name, slug, status, default_country, timezone)
            values (${companies[key]}, ${agencyId}, ${key}, ${`policy-${key}`}, 'active', 'NP', 'Asia/Kathmandu')`);
      });
      for (const key of keys)
        await inCompany(key, (scoped) =>
          scoped.execute(sql`insert into company_members (id, agency_id, company_id, user_id, name, role, status)
            values (gen_random_uuid(), ${agencyId}, ${companies[key]}, ${userId}, ${`member ${key}`}, 'super_admin', 'active')`),
        );
    }
  });

  afterAll(async () => {
    await Promise.allSettled([runtime?.close(), migration?.close()]);
    if (postgres) await postgres.stop();
  });

  it("protects every product table and fails the gate for a new unprotected one", async () => {
    expect(await unprotected()).toEqual([]);
    await migration.pool.query(
      "CREATE TABLE public.policy_gate_fixture (company_id uuid PRIMARY KEY)",
    );
    try {
      expect(await unprotected()).toEqual(["policy_gate_fixture"]);
      await migration.pool.query(
        "ALTER TABLE public.policy_gate_fixture ENABLE ROW LEVEL SECURITY",
      );
      expect(await unprotected()).toEqual(["policy_gate_fixture"]);
    } finally {
      await migration.pool.query("DROP TABLE public.policy_gate_fixture");
    }
  });

  it("fails the gate for a company table whose policies only check the agency", async () => {
    const agencyOnly =
      "current_setting('app.agency_id', true) <> '' AND agency_id = current_setting('app.agency_id', true)::uuid";
    await migration.pool.query(`CREATE TABLE public.policy_weak_fixture (
        id uuid PRIMARY KEY, agency_id uuid NOT NULL, company_id uuid NOT NULL);
      ALTER TABLE public.policy_weak_fixture ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.policy_weak_fixture FORCE ROW LEVEL SECURITY;
      CREATE POLICY weak_select ON public.policy_weak_fixture FOR SELECT TO anar_app USING (${agencyOnly});
      CREATE POLICY weak_insert ON public.policy_weak_fixture FOR INSERT TO anar_app WITH CHECK (${agencyOnly});
      CREATE POLICY weak_update ON public.policy_weak_fixture FOR UPDATE TO anar_app USING (${agencyOnly}) WITH CHECK (${agencyOnly});
      REVOKE ALL ON public.policy_weak_fixture FROM anar_app;
      GRANT SELECT, INSERT, UPDATE ON public.policy_weak_fixture TO anar_app`);
    try {
      expect(await unprotected()).toEqual(["policy_weak_fixture"]);
    } finally {
      await migration.pool.query("DROP TABLE public.policy_weak_fixture");
    }
    expect(await unprotected()).toEqual([]);
  });

  it("reads no product rows without a scope, as runtime or as table owner", async () => {
    for (const table of ["agency_members", "companies", "company_members"]) {
      expect(
        (await runtime.pool.query(`SELECT * FROM public.${table}`)).rows,
      ).toEqual([]);
      expect(
        (await migration.pool.query(`SELECT * FROM public.${table}`)).rows,
      ).toEqual([]);
    }
  });

  it("shows each company scope only its own rows across two agencies", async () => {
    for (const key of Object.keys(companies) as (keyof typeof companies)[]) {
      const seen = await inCompany(key, async (scoped) => ({
        companies: await rows(scoped, sql`select id from companies`),
        members: await rows(
          scoped,
          sql`select company_id from company_members`,
        ),
      }));
      expect(seen).toEqual({
        companies: [{ id: companies[key] }],
        members: [{ company_id: companies[key] }],
      });
    }
    const agency = await inAgency(agencyA, userA, (scoped) =>
      rows(scoped, sql`select id from companies order by id`),
    );
    expect(agency).toEqual([{ id: companies.a1 }, { id: companies.a2 }]);
  });

  it("sees and writes nothing through a mismatched agency and company pair", async () => {
    const mismatched = {
      agencyId: agencyA,
      companyId: companies.b1,
      userId: userA,
    };
    const seen = await tx((outer) =>
      withPlatformTenant(outer, mismatched, async (scoped) => ({
        companies: await rows(scoped, sql`select id from companies`),
        members: await rows(scoped, sql`select id from company_members`),
      })),
    );
    expect(seen).toEqual({ companies: [], members: [] });
    await expect(
      tx((outer) =>
        withPlatformTenant(outer, mismatched, (scoped) =>
          scoped.execute(sql`insert into company_members (id, agency_id, company_id, user_id, name, role, status)
            values (gen_random_uuid(), ${agencyA}, ${companies.b1}, ${userA}, 'forged', 'admin', 'active')`),
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
  });

  it.each([
    [
      "insert a member into another company",
      sql`insert into company_members (id, agency_id, company_id, user_id, name, role, status)
        values (gen_random_uuid(), ${agencyA}, ${companies.a2}, ${userA}, 'forged', 'admin', 'active')`,
    ],
    [
      "insert a member into another agency",
      sql`insert into company_members (id, agency_id, company_id, user_id, name, role, status)
        values (gen_random_uuid(), ${agencyB}, ${companies.b1}, ${userA}, 'forged', 'admin', 'active')`,
    ],
    [
      "move a member to another company",
      sql`update company_members set company_id = ${companies.a2}`,
    ],
    [
      "move the company to another agency",
      sql`update companies set agency_id = ${agencyB}`,
    ],
    ["delete members", sql`delete from company_members`],
    ["delete companies", sql`delete from companies`],
  ])("refuses to %s from a company scope", async (_name, query) => {
    await expect(
      inCompany("a1", (scoped) => scoped.execute(query)),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it.each([
    [
      "create a company in another agency",
      sql`insert into companies (id, agency_id, name, slug, status, default_country, timezone)
        values (gen_random_uuid(), ${agencyB}, 'forged', 'policy-forged', 'active', 'NP', 'Asia/Kathmandu')`,
    ],
    [
      "add staff to another agency",
      sql`insert into agency_members (id, agency_id, user_id, status, invited_by)
        values (gen_random_uuid(), ${agencyB}, ${owner}, 'active', ${owner})`,
    ],
    [
      "move staff to another agency",
      sql`update agency_members set agency_id = ${agencyB}`,
    ],
    ["delete staff", sql`delete from agency_members`],
  ])("refuses to %s from an agency scope", async (_name, query) => {
    await expect(
      inAgency(agencyA, userA, (scoped) => scoped.execute(query)),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("changes no foreign rows when updating from another scope", async () => {
    const touched = await inCompany("a1", async (scoped) => ({
      members: await rows(
        scoped,
        sql`update company_members set name = 'hijacked' where company_id = ${companies.b1} returning id`,
      ),
      companies: await rows(
        scoped,
        sql`update companies set name = 'hijacked' where id in (${companies.a2}, ${companies.b1}) returning id`,
      ),
    }));
    expect(touched).toEqual({ members: [], companies: [] });
    const staff = await inAgency(agencyA, userA, (scoped) =>
      rows(
        scoped,
        sql`update agency_members set status = 'deactivated' where agency_id = ${agencyB} returning id`,
      ),
    );
    expect(staff).toEqual([]);
  });

  it("rolls back a failed write and keeps no scope on the reused connection", async () => {
    const pid = async (scoped: PlatformTx) =>
      (await rows(scoped, sql`select pg_backend_pid() as pid`))[0];
    const before = await tx(pid);
    const failure = new Error("write failed");
    await expect(
      inCompany("a1", async (scoped) => {
        expect(await pid(scoped)).toEqual(before);
        await scoped.execute(sql`update company_members set name = 'changed'`);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(
      await inCompany("a1", (scoped) =>
        rows(scoped, sql`select name from company_members`),
      ),
    ).toEqual([{ name: "member a1" }]);
    expect(
      await tx(async (scoped) => ({
        pid: await pid(scoped),
        members: await rows(scoped, sql`select id from company_members`),
        scope: await rows(
          scoped,
          sql`select nullif(current_setting('app.company_id', true), '') as company`,
        ),
      })),
    ).toEqual({ pid: before, members: [], scope: [{ company: null }] });
    expect(
      await inCompany("b1", (scoped) =>
        rows(scoped, sql`select name from company_members`),
      ),
    ).toEqual([{ name: "member b1" }]);
    expect(runtime.pool.totalCount).toBe(1);
  });
});
