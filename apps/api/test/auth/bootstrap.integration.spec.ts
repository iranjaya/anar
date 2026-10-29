import { readFile } from "node:fs/promises";
import { createPlatformDb, users, withPlatformTenant } from "@anar/db/platform";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import bootstrap from "../../src/modules/auth/bootstrap.js";
import {
  type BootstrapFixture,
  startBootstrapFixture,
} from "./bootstrapFixture.js";

const input = { environment: "proof", name: "Proof owner" };
const scope = {
  companyId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  userId: "11111111-1111-1111-1111-111111111111",
};
const args = (email: string, environment = "proof") => [
  "--environment",
  environment,
  "--email",
  email,
  "--name",
  input.name,
];

describe("single owner bootstrap on disposable Postgres", () => {
  let fixture: BootstrapFixture;
  beforeAll(async () => {
    fixture = await startBootstrapFixture();
    expect(fixture.postgres.port).not.toBeOneOf([3000, 3001, 3100]);
    await fixture.owner(`CREATE TABLE bootstrap_scope_fixture (company_id uuid NOT NULL, value text NOT NULL, PRIMARY KEY (company_id,value));
      ALTER TABLE bootstrap_scope_fixture ENABLE ROW LEVEL SECURITY;
      ALTER TABLE bootstrap_scope_fixture FORCE ROW LEVEL SECURITY;
      CREATE POLICY bootstrap_scope ON bootstrap_scope_fixture
      USING (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)
      WITH CHECK (company_id = NULLIF(current_setting('app.company_id', true), '')::uuid)`);
  });
  beforeEach(async () => {
    await fixture.owner(
      "TRUNCATE public.audit_log, public.otp_codes, public.sessions, public.users CASCADE; TRUNCATE bootstrap_scope_fixture",
    );
    await fixture.db.transaction((tx) =>
      tx.insert(users).values({
        id: v7(),
        email: "existing@example.test",
        name: "Existing ordinary user",
      }),
    );
  });
  afterAll(async () => {
    await fixture?.close();
  });

  const counts = () =>
    fixture.rows<{ owners: number; audits: number; sessions: number }>(sql`
    select (select count(*)::int from users where platform_role = 'owner') as owners,
    (select count(*)::int from audit_log where action = 'auth.bootstrap_owner') as audits,
    (select count(*)::int from sessions) as sessions`);

  it("creates one owner and audit and preserves the first fields on normalized repeat", async () => {
    const first = await bootstrap.bootstrapOwner(fixture.db, {
      ...input,
      email: " Owner@Example.Test ",
    });
    expect(
      await bootstrap.bootstrapOwner(fixture.db, {
        ...input,
        email: "owner@example.test",
        name: "Changed name",
      }),
    ).toEqual(first);
    expect(first).toMatchObject({
      email: "owner@example.test",
      name: input.name,
      platformRole: "owner",
      deactivatedAt: null,
    });
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await counts()).toEqual([{ owners: 1, audits: 1, sessions: 0 }]);
    expect(
      await fixture.rows(
        sql`select actor_user_id, actor_role, agency_id, company_id, action, target_type, target_id, data, ip from audit_log`,
      ),
    ).toEqual([
      {
        actor_user_id: first.id,
        actor_role: "owner",
        agency_id: null,
        company_id: null,
        action: "auth.bootstrap_owner",
        target_type: "user",
        target_id: first.id,
        data: { environment: "proof" },
        ip: null,
      },
    ]);
  });

  it("creates one owner and audit across concurrent same-email requests", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        bootstrap.bootstrapOwner(fixture.db, {
          ...input,
          email: "parallel@example.test",
        }),
      ),
    );
    expect(new Set(results.map((user) => user.id)).size).toBe(1);
    expect(await counts()).toEqual([{ owners: 1, audits: 1, sessions: 0 }]);
  });

  it("refuses a second email and ordinary-user promotion without changing either identity", async () => {
    const first = await bootstrap.bootstrapOwner(fixture.db, {
      ...input,
      email: "owner@example.test",
    });
    await expect(
      bootstrap.bootstrapOwner(fixture.db, {
        ...input,
        email: "second@example.test",
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "An owner already exists",
    });
    await expect(
      bootstrap.bootstrapOwner(fixture.db, {
        ...input,
        email: "existing@example.test",
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "Bootstrap cannot promote an existing user",
    });
    expect(
      await fixture.rows(
        sql`select email, name, platform_role from users order by email`,
      ),
    ).toEqual([
      {
        email: "existing@example.test",
        name: "Existing ordinary user",
        platform_role: null,
      },
      { email: first.email, name: input.name, platform_role: "owner" },
    ]);
    expect(await counts()).toEqual([{ owners: 1, audits: 1, sessions: 0 }]);
  });

  it("refuses ordinary-user promotion even before any owner exists", async () => {
    await expect(
      bootstrap.bootstrapOwner(fixture.db, {
        ...input,
        email: "existing@example.test",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await counts()).toEqual([{ owners: 0, audits: 0, sessions: 0 }]);
  });

  it("admits exactly one competing owner email", async () => {
    const results = await Promise.allSettled(
      Array.from({ length: 8 }, (_, index) =>
        bootstrap.bootstrapOwner(fixture.db, {
          ...input,
          email: `competing-${index}@example.test`,
        }),
      ),
    );
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const refused = results.filter((result) => result.status === "rejected");
    expect(refused).toHaveLength(7);
    for (const result of refused)
      expect(result.reason).toMatchObject({ code: "conflict" });
    expect(await counts()).toEqual([{ owners: 1, audits: 1, sessions: 0 }]);
  });

  it("enforces the singleton below the bootstrap service", async () => {
    await bootstrap.bootstrapOwner(fixture.db, {
      ...input,
      email: "owner@example.test",
    });
    await expect(
      fixture.db.transaction((tx) =>
        tx.insert(users).values({
          id: v7(),
          email: "bypass@example.test",
          name: "Second owner",
          platformRole: "owner",
        }),
      ),
    ).rejects.toMatchObject({
      cause: { code: "23505", constraint: "users_single_owner_idx" },
    });
    expect(await counts()).toEqual([{ owners: 1, audits: 1, sessions: 0 }]);
  });

  it.each(["dna", "agency_staff", "arbitrary"])(
    "refuses current global role %s at the database boundary",
    async (role) => {
      await expect(
        fixture.rows(
          sql`insert into users (id,email,name,platform_role) values (${v7()},'invalid-role@example.test','Invalid role',${role})`,
        ),
      ).rejects.toMatchObject({
        cause: { code: "23514", constraint: "users_platform_role_check" },
      });
      expect(
        await fixture.rows(sql`select count(*)::int as count from users`),
      ).toEqual([{ count: 1 }]);
      expect(await counts()).toEqual([{ owners: 0, audits: 0, sessions: 0 }]);
    },
  );

  it("never revives an inactive owner or creates a replacement", async () => {
    const first = await bootstrap.bootstrapOwner(fixture.db, {
      ...input,
      email: "owner@example.test",
    });
    const deactivatedAt = new Date("2026-01-01T00:00:00Z");
    await fixture.db.transaction((tx) =>
      tx.update(users).set({ deactivatedAt }).where(eq(users.id, first.id)),
    );
    await expect(
      bootstrap.bootstrapOwner(fixture.db, {
        ...input,
        email: first.email,
        name: "Changed name",
      }),
    ).rejects.toMatchObject({
      code: "conflict",
      message: "Bootstrap cannot revive an inactive owner",
    });
    await expect(
      bootstrap.bootstrapOwner(fixture.db, {
        ...input,
        email: "replacement@example.test",
      }),
    ).rejects.toMatchObject({ code: "conflict" });
    const [stored] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, first.id)),
    );
    expect(stored).toEqual({ ...first, deactivatedAt });
    expect(await counts()).toEqual([{ owners: 1, audits: 1, sessions: 0 }]);
  });

  it("rolls back the owner when audit insertion fails and releases the singleton slot", async () => {
    await fixture.owner("REVOKE INSERT ON public.audit_log FROM anar_app");
    try {
      await expect(
        bootstrap.bootstrapOwner(fixture.db, {
          ...input,
          email: "rollback@example.test",
        }),
      ).rejects.toMatchObject({ cause: { code: "42501" } });
      expect(await counts()).toEqual([{ owners: 0, audits: 0, sessions: 0 }]);
      await expect(
        fixture.cli(args("rollback@example.test")),
      ).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: "Owner bootstrap failed\n",
      });
    } finally {
      await fixture.owner("GRANT INSERT ON public.audit_log TO anar_app");
    }
    await bootstrap.bootstrapOwner(fixture.db, {
      ...input,
      email: "retry@example.test",
    });
    expect(await counts()).toEqual([{ owners: 1, audits: 1, sessions: 0 }]);
  });

  it("keeps owner and audit intact through repeated roles and migration setup", async () => {
    const owner = await bootstrap.bootstrapOwner(fixture.db, {
      ...input,
      email: "owner@example.test",
    });
    const history = await fixture.rows(sql`select * from audit_log`);
    await fixture.postgres.bootstrap();
    await fixture.postgres.migrate();
    expect(
      await bootstrap.bootstrapOwner(fixture.db, {
        ...input,
        email: owner.email,
      }),
    ).toEqual(owner);
    expect(await fixture.rows(sql`select * from audit_log`)).toEqual(history);
    expect(await counts()).toEqual([{ owners: 1, audits: 1, sessions: 0 }]);
  });

  it.each([
    "update audit_log set data = '{}'",
    "delete from audit_log",
    "truncate audit_log",
    "create schema forbidden_bootstrap",
  ])("denies runtime %s", async (query) => {
    await expect(
      fixture.db.transaction((tx) => tx.execute(sql.raw(query))),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("refuses privileged connections and exposes no pool", async () => {
    expect(Object.keys(fixture.db).sort()).toEqual(["close", "transaction"]);
    for (const url of [
      fixture.postgres.adminUrl,
      fixture.postgres.migrationUrl,
    ])
      await expect(createPlatformDb(url)).rejects.toThrow(
        "Database connection requires anar_app",
      );
  });

  it.each([false, true])(
    "keeps scope and platform writes together with rollback=%s",
    async (rollback) => {
      const isolated = await createPlatformDb(fixture.postgres.appUrl);
      const email = `bridge-${rollback}@example.test`;
      let pid: number | undefined;
      try {
        const result = isolated.transaction(async (tx) => {
          pid = (
            await tx.execute<{ pid: number }>(
              sql`select pg_backend_pid() as pid`,
            )
          ).rows[0].pid;
          await tx
            .insert(users)
            .values({ id: v7(), email, name: "Bridge fixture" });
          await withPlatformTenant(tx, scope, async (scoped) => {
            expect(scoped).toBe(tx);
            await scoped.execute(
              sql`insert into bootstrap_scope_fixture values (${scope.companyId}, ${email})`,
            );
          });
          if (rollback) throw new Error("Rollback both writes");
        });
        if (rollback)
          await expect(result).rejects.toThrow("Rollback both writes");
        else await result;
        expect(
          await isolated.transaction(
            async (tx) =>
              (
                await tx.execute(
                  sql`select pg_backend_pid() as pid, nullif(current_setting('app.company_id', true), '') as company, nullif(current_setting('app.user_id', true), '') as usr`,
                )
              ).rows,
          ),
        ).toEqual([{ pid, company: null, usr: null }]);
        expect(
          await fixture.rows(
            sql`select email from users where email = ${email}`,
          ),
        ).toEqual(rollback ? [] : [{ email }]);
        expect(
          await isolated.transaction((tx) =>
            withPlatformTenant(
              tx,
              scope,
              async (scoped) =>
                (
                  await scoped.execute(
                    sql`select value from bootstrap_scope_fixture where company_id = ${scope.companyId}`,
                  )
                ).rows,
            ),
          ),
        ).toEqual(rollback ? [] : [{ value: email }]);
      } finally {
        await isolated.close();
      }
    },
  );

  it("prints only completion on CLI repeat and registers only bootstrap:owner", async () => {
    for (let i = 0; i < 2; i++)
      expect(await fixture.cli(args("cli@example.test"))).toMatchObject({
        stdout: "Owner bootstrap complete\n",
        stderr: "",
      });
    const manifest = JSON.parse(
      await readFile(new URL("../../package.json", import.meta.url), "utf8"),
    );
    expect(manifest.scripts["bootstrap:owner"]).toBe(
      "node dist/modules/auth/bootstrap.js",
    );
    expect(manifest.scripts).not.toHaveProperty("bootstrap:dna");
    expect(await counts()).toEqual([{ owners: 1, audits: 1, sessions: 0 }]);
  });

  it("allows one owner across competing CLI processes", async () => {
    const results = await Promise.allSettled([
      fixture.cli(args("cli-a@example.test")),
      fixture.cli(args("cli-b@example.test")),
    ]);
    expect(
      results.filter((result) => result.status === "fulfilled"),
    ).toHaveLength(1);
    const refused = results.find((result) => result.status === "rejected");
    expect(refused?.status === "rejected" && refused.reason).toMatchObject({
      code: 1,
      stdout: "",
      stderr: "An owner already exists\n",
    });
    expect(await counts()).toEqual([{ owners: 1, audits: 1, sessions: 0 }]);
  });

  it.each([
    { args: [], env: {}, message: "Use --environment, --email and --name" },
    {
      args: args("invalid@example.test", "production"),
      env: {},
      message: "--environment must match ANAR_ENV",
    },
    {
      args: args("invalid@example.test"),
      env: { ANAR_ENV: "" },
      message: "--environment must match ANAR_ENV",
    },
    {
      args: args("invalid@example.test"),
      env: { DATABASE_URL: "" },
      message: "DATABASE_URL is required",
    },
    {
      args: args("existing@example.test"),
      env: {},
      message: "Bootstrap cannot promote an existing user",
    },
  ])(
    "rejects invalid CLI input with $message",
    async ({ args, env, message }) => {
      await expect(fixture.cli(args, env)).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: `${message}\n`,
      });
      expect(await counts()).toEqual([{ owners: 0, audits: 0, sessions: 0 }]);
    },
  );

  it("upgrades ordinary identities and historical audit without rewriting them", async () => {
    const previous = await startBootstrapFixture(true);
    try {
      const actorId = v7();
      const auditId = v7();
      await previous.rows(
        sql`insert into users (id,email,name) values (${actorId},'historical@example.test','Historical user')`,
      );
      await previous.rows(
        sql`insert into audit_log (id,actor_user_id,actor_role,action,target_type,target_id,data) values (${auditId},${actorId},'dna','auth.bootstrap_dna','user',${actorId},'{}'::jsonb)`,
      );
      const identities = await previous.rows(sql`select * from users`);
      const history = await previous.rows(
        sql`select id,actor_user_id,actor_role,action,target_type,target_id,data,created_at from audit_log`,
      );
      await previous.postgres.migrate();
      expect(await previous.rows(sql`select * from users`)).toEqual(identities);
      expect(
        await previous.rows(
          sql`select id,actor_user_id,actor_role,action,target_type,target_id,data,created_at from audit_log`,
        ),
      ).toEqual(history);
      expect(
        await previous.rows(sql`select agency_id,company_id from audit_log`),
      ).toEqual([{ agency_id: null, company_id: null }]);
      await bootstrap.bootstrapOwner(previous.db, {
        ...input,
        email: "new-owner@example.test",
      });
      await previous.postgres.bootstrap();
      await previous.postgres.migrate();
      expect(
        await previous.rows(
          sql`select count(*)::int as count from users where platform_role = 'owner'`,
        ),
      ).toEqual([{ count: 1 }]);
      expect(
        await previous.rows(
          sql`select actor_role,action from audit_log where id = ${auditId}`,
        ),
      ).toEqual([{ actor_role: "dna", action: "auth.bootstrap_dna" }]);
    } finally {
      await previous.close();
    }
  });

  it.each(["legacy-role", "multiple-owners"])(
    "refuses an unreviewed %s upgrade atomically",
    async (kind) => {
      const previous = await startBootstrapFixture(true);
      try {
        if (kind === "legacy-role")
          await previous.owner(
            `INSERT INTO users (id,email,name,platform_role) VALUES ('${v7()}','legacy@example.test','Legacy','dna')`,
          );
        else
          await previous.owner(
            `ALTER TABLE users DROP CONSTRAINT users_platform_role_check; INSERT INTO users (id,email,name,platform_role) VALUES ('${v7()}','one@example.test','One','owner'), ('${v7()}','two@example.test','Two','owner')`,
          );
        const before = await previous.rows(
          sql`select * from users order by email`,
        );
        const message =
          kind === "legacy-role"
            ? "Owner migration refused: unreviewed privileged roles"
            : "Owner migration refused: multiple existing owners";
        await expect(previous.postgres.migrate()).rejects.toMatchObject({
          code: 1,
          stderr: expect.stringContaining(message),
        });
        expect(
          await previous.rows(sql`select * from users order by email`),
        ).toEqual(before);
        expect(
          await previous.rows(
            sql`select column_name from information_schema.columns where table_schema = 'public' and table_name = 'audit_log' and column_name = 'agency_id'`,
          ),
        ).toEqual([]);
        expect(
          await previous.rows(
            sql`select indexname from pg_indexes where schemaname = 'public' and indexname = 'users_single_owner_idx'`,
          ),
        ).toEqual([]);
      } finally {
        await previous.close();
      }
    },
  );
});
