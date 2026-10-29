import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
  vi,
} from "vitest";
import type { DbHandle } from "../src/connection.js";
import * as connection from "../src/connection.js";
import {
  createTenantDb,
  type TenantDb,
  type TenantScope,
} from "../src/tenant.js";
import { type Postgres, startPostgres } from "./postgres.js";

const run = promisify(execFile);
const scopeA = {
  agencyId: "cccccccc-cccc-cccc-cccc-cccccccccccc",
  companyId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  userId: "11111111-1111-1111-1111-111111111111",
};
const scopeB = {
  agencyId: "dddddddd-dddd-dddd-dddd-dddddddddddd",
  companyId: "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb",
  userId: "22222222-2222-2222-2222-222222222222",
};
const packageDir = fileURLToPath(new URL("../", import.meta.url));

describe("database roles and tenant transactions", () => {
  let postgres: Postgres;
  let admin: DbHandle;
  let migration: DbHandle;
  let runtime: DbHandle;
  let tenant: TenantDb;
  const bootstrapResults: string[] = [];
  const migrationResults: string[] = [];
  let productTables: unknown[];

  function readValues(scope: TenantScope) {
    return tenant.withTenant(
      scope,
      async (tx) =>
        (await tx.execute(sql`select value from public.tenant_scope_fixture`))
          .rows,
    );
  }

  beforeEach(() => {
    vi.spyOn(console, "error").mockImplementation(() => {});
  });
  afterEach(() => vi.restoreAllMocks());

  beforeAll(async () => {
    postgres = await startPostgres();
    for (let i = 0; i < 2; i++) {
      bootstrapResults.push((await postgres.bootstrap()).stdout.trim());
      migrationResults.push(
        (
          await run("pnpm", ["--filter", "@anar/db", "migrate"], {
            cwd: packageDir,
            env: {
              ...process.env,
              MIGRATION_DATABASE_URL: postgres.migrationUrl,
              DATABASE_URL: postgres.adminUrl,
            },
            timeout: 10000,
          })
        ).stdout.trim(),
      );
    }
    admin = connection.createDb(postgres.adminUrl);
    migration = connection.createDb(postgres.migrationUrl);
    const createDb = connection.createDb;
    const createSpy = vi
      .spyOn(connection, "createDb")
      .mockImplementationOnce((url) => {
        runtime = createDb(url);
        runtime.pool.options.max = 1;
        return runtime;
      });
    try {
      tenant = await createTenantDb(postgres.appUrl);
    } finally {
      createSpy.mockRestore();
    }
    productTables = (
      await runtime.pool.query(
        "SELECT tablename FROM pg_tables WHERE schemaname = 'public' ORDER BY tablename",
      )
    ).rows;
    await migration.pool.query(`
      CREATE TABLE public.tenant_scope_fixture (company_id uuid PRIMARY KEY, value text NOT NULL);
      ALTER TABLE public.tenant_scope_fixture ENABLE ROW LEVEL SECURITY;
      ALTER TABLE public.tenant_scope_fixture FORCE ROW LEVEL SECURITY;
      CREATE POLICY tenant_scope ON public.tenant_scope_fixture
        USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
        WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid);
    `);
    for (const [scope, value] of [
      [scopeA, "A"],
      [scopeB, "B"],
    ] as const) {
      await migration.withConnection((db) =>
        db.transaction(async (tx) => {
          await tx.execute(
            sql`select set_config('app.company_id', ${scope.companyId}, true)`,
          );
          await tx.execute(
            sql`insert into public.tenant_scope_fixture values (${scope.companyId}, ${value})`,
          );
        }),
      );
    }
  });

  afterAll(async () => {
    try {
      if (migration)
        await migration.pool.query(
          "DROP TABLE IF EXISTS public.tenant_scope_fixture",
        );
    } finally {
      let timer: ReturnType<typeof setTimeout> | undefined;
      try {
        await Promise.race([
          Promise.all([
            tenant?.close() ?? runtime?.close(),
            migration?.close(),
            admin?.close(),
          ]),
          new Promise<never>((_, reject) => {
            timer = setTimeout(
              () => reject(new Error("Database pools did not close")),
              5000,
            );
          }),
        ]);
      } finally {
        clearTimeout(timer);
        if (postgres) await postgres.stop();
      }
    }
  });

  it("runs bootstrap and identity migrations twice", async () => {
    expect(bootstrapResults).toHaveLength(2);
    for (const output of bootstrapResults)
      expect(output.split("\n").at(-1)).toBe("COMMIT");
    expect(migrationResults).toHaveLength(2);
    expect(productTables).toEqual([
      { tablename: "agencies" },
      { tablename: "agency_members" },
      { tablename: "audit_log" },
      { tablename: "auth_rate_limits" },
      { tablename: "companies" },
      { tablename: "company_members" },
      { tablename: "invites" },
      { tablename: "otp_codes" },
      { tablename: "sessions" },
      { tablename: "users" },
      { tablename: "worker_heartbeats" },
    ]);
    expect(
      (await runtime.pool.query("SHOW server_version_num")).rows[0]
        .server_version_num,
    ).toMatch(/^17\d{4}$/);
    expect(postgres.port).not.toBeOneOf([3000, 3001, 3100, 3200, 5432]);
    await expect(
      migration.requireRole("anar_migrate"),
    ).resolves.toBeUndefined();
    await expect(runtime.requireRole("anar_app")).resolves.toBeUndefined();
  });

  it("keeps the runtime role separate from the owner", async () => {
    const roles =
      await runtime.pool.query(`SELECT rolname, rolcanlogin, rolsuper, rolcreatedb,
      rolcreaterole, rolreplication, rolbypassrls, rolinherit FROM pg_roles
      WHERE rolname IN ('anar_app', 'anar_migrate') ORDER BY rolname`);
    expect(roles.rows).toEqual(
      ["anar_app", "anar_migrate"].map((rolname) => ({
        rolname,
        rolcanlogin: true,
        rolsuper: false,
        rolcreatedb: false,
        rolcreaterole: false,
        rolreplication: false,
        rolbypassrls: false,
        rolinherit: false,
      })),
    );
    const memberships =
      await runtime.pool.query(`SELECT count(*)::int AS count FROM pg_auth_members
      WHERE member = (SELECT oid FROM pg_roles WHERE rolname = current_user)`);
    expect(memberships.rows).toEqual([{ count: 0 }]);
    const owner =
      await runtime.pool.query(`SELECT c.relname AS table_name, pg_get_userbyid(c.relowner) AS table_owner,
      pg_get_userbyid(n.nspowner) AS schema_owner, c.relrowsecurity, c.relforcerowsecurity
      FROM pg_class c JOIN pg_namespace n ON n.oid = c.relnamespace
      WHERE n.nspname = 'public' AND c.relkind IN ('r', 'p')
        AND c.relname NOT IN ('agencies', 'audit_log', 'auth_rate_limits', 'invites', 'otp_codes', 'sessions', 'users', 'worker_heartbeats')
      ORDER BY c.relname`);
    expect(owner.rows).toEqual(
      [
        "agency_members",
        "companies",
        "company_members",
        "tenant_scope_fixture",
      ].map((table_name) => ({
        table_name,
        table_owner: "anar_migrate",
        schema_owner: "anar_migrate",
        relrowsecurity: true,
        relforcerowsecurity: true,
      })),
    );
    const companyGrants = await runtime.pool.query(`SELECT
      has_table_privilege(current_user, 'public.companies', 'SELECT') AS select,
      has_table_privilege(current_user, 'public.companies', 'INSERT') AS insert,
      has_table_privilege(current_user, 'public.companies', 'UPDATE') AS update,
      has_table_privilege(current_user, 'public.companies', 'DELETE') AS delete,
      has_table_privilege(current_user, 'public.companies', 'TRUNCATE') AS truncate`);
    expect(companyGrants.rows).toEqual([
      {
        select: true,
        insert: true,
        update: true,
        delete: false,
        truncate: false,
      },
    ]);
    const memberGrants = await runtime.pool.query(`SELECT
      has_table_privilege(current_user, 'public.company_members', 'SELECT') AS select,
      has_table_privilege(current_user, 'public.company_members', 'INSERT') AS insert,
      has_table_privilege(current_user, 'public.company_members', 'UPDATE') AS update,
      has_table_privilege(current_user, 'public.company_members', 'DELETE') AS delete,
      has_table_privilege(current_user, 'public.company_members', 'TRUNCATE') AS truncate`);
    expect(memberGrants.rows).toEqual([
      {
        select: true,
        insert: true,
        update: true,
        delete: false,
        truncate: false,
      },
    ]);
  });

  it.each([
    "CREATE TABLE public.forbidden (id integer)",
    "CREATE SCHEMA forbidden",
    "CREATE TEMP TABLE forbidden (id integer)",
    "CREATE DATABASE forbidden",
    "TRUNCATE public.tenant_scope_fixture",
    "DELETE FROM public.companies",
    "TRUNCATE public.companies",
    "DELETE FROM public.company_members",
    "TRUNCATE public.company_members",
    "SET ROLE anar_migrate",
    "SET ROLE postgres",
    "ALTER TABLE public.tenant_scope_fixture DISABLE ROW LEVEL SECURITY",
    "ALTER TABLE public.companies DISABLE ROW LEVEL SECURITY",
    "ALTER TABLE public.company_members DISABLE ROW LEVEL SECURITY",
  ])("denies runtime %s", async (query) => {
    await expect(runtime.pool.query(query)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("rejects privileged connections at the runtime entry", async () => {
    for (const url of [postgres.adminUrl, postgres.migrationUrl]) {
      await expect(createTenantDb(url)).rejects.toThrow(
        "Database connection requires anar_app",
      );
    }
    expect(Object.keys(tenant).sort()).toEqual(["close", "withTenant"]);
  });

  it("requires the migration URL and migration role", async () => {
    const env: NodeJS.ProcessEnv = {
      ...process.env,
      DATABASE_URL: postgres.adminUrl,
    };
    delete env.MIGRATION_DATABASE_URL;
    const migrate = (childEnv: NodeJS.ProcessEnv) =>
      run(process.execPath, ["dist/migrate.js"], {
        cwd: packageDir,
        env: childEnv,
        timeout: 10000,
      });
    await expect(migrate(env)).rejects.toMatchObject({
      code: 1,
      stderr: expect.stringContaining("MIGRATION_DATABASE_URL is required"),
    });
    for (const url of [postgres.adminUrl, postgres.appUrl]) {
      await expect(
        migrate({ ...env, MIGRATION_DATABASE_URL: url }),
      ).rejects.toMatchObject({
        code: 1,
        stderr: expect.stringContaining(
          "Database connection requires anar_migrate",
        ),
      });
    }
  });

  it.each([
    [scopeA, "A"],
    [scopeB, "B"],
  ] as const)("reads only the scoped company %j", async (scope, value) => {
    const rows = await tenant.withTenant(scope, async (tx) => {
      const identity = await tx.execute(sql`select current_user AS role,
        current_setting('app.company_id') AS company, current_setting('app.user_id') AS usr`);
      expect(identity.rows).toEqual([
        { role: "anar_app", company: scope.companyId, usr: scope.userId },
      ]);
      return (await tx.execute(sql`select * from public.tenant_scope_fixture`))
        .rows;
    });
    expect(rows).toEqual([{ company_id: scope.companyId, value }]);
  });

  it("reads no tenant rows without a scope, including as owner", async () => {
    for (const db of [runtime, migration]) {
      expect(
        (await db.pool.query("SELECT * FROM public.tenant_scope_fixture")).rows,
      ).toEqual([]);
    }
  });

  it("allows scoped DML and rolls it back", async () => {
    const rollback = new Error("rollback fixture changes");
    await expect(
      tenant.withTenant(scopeA, async (tx) => {
        const hidden = await tx.execute(
          sql`update public.tenant_scope_fixture set value = 'hidden' where company_id = ${scopeB.companyId} returning *`,
        );
        expect(hidden.rows).toEqual([]);
        const updated = await tx.execute(
          sql`update public.tenant_scope_fixture set value = 'updated' returning value`,
        );
        expect(updated.rows).toEqual([{ value: "updated" }]);
        expect(
          (
            await tx.execute(
              sql`delete from public.tenant_scope_fixture returning company_id`,
            )
          ).rows,
        ).toEqual([{ company_id: scopeA.companyId }]);
        await tx.execute(
          sql`insert into public.tenant_scope_fixture values (${scopeA.companyId}, 'inserted')`,
        );
        expect(
          (await tx.execute(sql`select value from public.tenant_scope_fixture`))
            .rows,
        ).toEqual([{ value: "inserted" }]);
        throw rollback;
      }),
    ).rejects.toBe(rollback);
    expect(await readValues(scopeA)).toEqual([{ value: "A" }]);
  });

  it.each(["insert", "update"])(
    "denies a cross-company %s",
    async (operation) => {
      const otherCompany = "cccccccc-cccc-cccc-cccc-cccccccccccc";
      const query =
        operation === "insert"
          ? sql`insert into public.tenant_scope_fixture values (${otherCompany}, 'forbidden')`
          : sql`update public.tenant_scope_fixture set company_id = ${otherCompany}`;
      await expect(
        tenant.withTenant(scopeA, (tx) => tx.execute(query)),
      ).rejects.toMatchObject({ cause: { code: "42501" } });
    },
  );

  it.each(["agencyId", "companyId", "userId"] as const)(
    "rejects an invalid %s before the callback",
    async (key) => {
      const callback = vi.fn(async () => {});
      await expect(
        tenant.withTenant({ ...scopeA, [key]: "invalid'" }, callback),
      ).rejects.toThrow("must be UUIDs");
      expect(callback).not.toHaveBeenCalled();
    },
  );

  it.each([false, true])(
    "clears all scope settings after rollback=%s on the same connection",
    async (rollback) => {
      const before = (
        await runtime.pool.query("SELECT pg_backend_pid() AS pid")
      ).rows[0].pid;
      const failure = new Error("callback failed");
      const result = tenant.withTenant(scopeA, async (tx) => {
        expect(
          (await tx.execute(sql`select pg_backend_pid() as pid`)).rows,
        ).toEqual([{ pid: before }]);
        await tx.execute(
          sql`update public.tenant_scope_fixture set value = 'committed'`,
        );
        if (rollback) throw failure;
        return "done";
      });
      if (rollback) await expect(result).rejects.toBe(failure);
      else await expect(result).resolves.toBe("done");
      const settings = await runtime.pool.query(`SELECT pg_backend_pid() AS pid,
      NULLIF(current_setting('app.scope_kind', true), '') AS kind,
      NULLIF(current_setting('app.agency_id', true), '') AS agency,
      NULLIF(current_setting('app.company_id', true), '') AS company,
      NULLIF(current_setting('app.user_id', true), '') AS usr`);
      expect(settings.rows).toEqual([
        { pid: before, kind: null, agency: null, company: null, usr: null },
      ]);
      expect(
        (await runtime.pool.query("SELECT * FROM public.tenant_scope_fixture"))
          .rows,
      ).toEqual([]);
      expect(await readValues(scopeB)).toEqual([{ value: "B" }]);
      expect(await readValues(scopeA)).toEqual([
        { value: rollback ? "A" : "committed" },
      ]);
      await tenant.withTenant(scopeA, (tx) =>
        tx.execute(sql`update public.tenant_scope_fixture set value = 'A'`),
      );
      expect(runtime.pool.totalCount).toBe(1);
    },
  );

  it("releases the connection when BEGIN fails", async () => {
    const client = await runtime.pool.connect();
    const query = vi
      .spyOn(client, "query")
      .mockImplementationOnce(() =>
        Promise.reject(new Error("BEGIN cancelled")),
      );
    client.release();
    const callback = vi.fn(async () => {});
    try {
      await expect(tenant.withTenant(scopeA, callback)).rejects.toMatchObject({
        cause: { message: "BEGIN cancelled" },
      });
      expect(callback).not.toHaveBeenCalled();
    } finally {
      query.mockRestore();
    }
    await expect(readValues(scopeB)).resolves.toEqual([{ value: "B" }]);
  });

  it("recovers after an idle connection is terminated", async () => {
    const pid = (await runtime.pool.query("SELECT pg_backend_pid() AS pid"))
      .rows[0].pid;
    await admin.pool.query("SELECT pg_terminate_backend($1)", [pid]);
    await expect.poll(() => runtime.pool.totalCount).toBe(0);
    const result = await tenant.withTenant(scopeA, (tx) =>
      tx.execute(
        sql`select pg_backend_pid() as pid, value from public.tenant_scope_fixture`,
      ),
    );
    expect(result.rows).toEqual([{ pid: expect.any(Number), value: "A" }]);
    expect(result.rows[0].pid).not.toBe(pid);
  });

  it("releases a checked-out connection after termination", async () => {
    await expect(
      tenant.withTenant(scopeA, async (tx) => {
        const result = await tx.execute<{ pid: number }>(
          sql`select pg_backend_pid() as pid`,
        );
        await admin.pool.query("SELECT pg_terminate_backend($1)", [
          result.rows[0].pid,
        ]);
        await tx.execute(sql`select 1`);
      }),
    ).rejects.toThrow();
    await expect(readValues(scopeB)).resolves.toEqual([{ value: "B" }]);
  });
});
