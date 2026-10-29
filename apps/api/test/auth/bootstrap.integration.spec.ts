import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import {
  createPlatformDb,
  type PlatformDb,
  users,
  withPlatformTenant,
} from "@anar/db/platform";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import bootstrap from "../../src/modules/auth/bootstrap.js";

const run = promisify(execFile);
const input = { environment: "proof", name: "Proof DNA" };
const scope = {
  companyId: "aaaaaaaa-aaaa-aaaa-aaaa-aaaaaaaaaaaa",
  userId: "11111111-1111-1111-1111-111111111111",
};

describe("DNA bootstrap on disposable Postgres", () => {
  let db: PlatformDb;
  let appUrl: string;

  beforeAll(async () => {
    if (process.env.ANAR_BOOTSTRAP_PROOF !== "disposable") {
      throw new Error("Run through the disposable bootstrap proof harness");
    }
    appUrl = process.env.ANAR_TEST_DATABASE_URL ?? "";
    const url = new URL(appUrl);
    expect(url.hostname).toBe("127.0.0.1");
    expect(url.pathname).toBe("/anar_s04");
    expect(Number(url.port)).not.toBeOneOf([3000, 3001, 3100]);
    db = await createPlatformDb(appUrl);
  });

  afterAll(async () => {
    await db?.close();
  });

  async function counts(email: string) {
    return db.transaction(
      async (tx) =>
        (
          await tx.execute<{ users: number; audits: number }>(sql`
      select (select count(*)::int from users where email = ${email}) as users,
      (select count(*)::int from audit_log a join users u on u.id = a.actor_user_id
       where u.email = ${email}) as audits`)
        ).rows[0],
    );
  }

  function cli(args: string[], env: NodeJS.ProcessEnv = {}) {
    return run(
      process.execPath,
      [
        fileURLToPath(
          new URL("../../dist/modules/auth/bootstrap.js", import.meta.url),
        ),
        ...args,
      ],
      {
        env: {
          ...process.env,
          NODE_OPTIONS: "",
          ANAR_ENV: "proof",
          DATABASE_URL: appUrl,
          ...env,
        },
        timeout: 8000,
      },
    );
  }

  it("creates one DNA identity and audit on repeated normalized email", async () => {
    const first = await bootstrap.bootstrapDna(db, {
      ...input,
      email: " Repeat@Example.Test ",
    });
    const again = await bootstrap.bootstrapDna(db, {
      ...input,
      email: "repeat@example.test",
      name: "Changed name",
    });
    expect(again).toEqual(first);
    expect(first).toMatchObject({
      email: "repeat@example.test",
      name: input.name,
      platformRole: "dna",
      deactivatedAt: null,
    });
    expect(first.id).toMatch(
      /^[0-9a-f]{8}-[0-9a-f]{4}-7[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/,
    );
    expect(await counts(first.email)).toEqual({ users: 1, audits: 1 });
    const rows = await db.transaction(
      async (tx) =>
        (
          await tx.execute(sql`
      select actor_user_id, actor_role, company_id, action, target_type, target_id, data, ip
      from audit_log where actor_user_id = ${first.id}`)
        ).rows,
    );
    expect(rows).toEqual([
      {
        actor_user_id: first.id,
        actor_role: "dna",
        company_id: null,
        action: "auth.bootstrap_dna",
        target_type: "user",
        target_id: first.id,
        data: { environment: "proof" },
        ip: null,
      },
    ]);
  });

  it("creates one identity and audit across concurrent bootstraps", async () => {
    const results = await Promise.all(
      Array.from({ length: 8 }, () =>
        bootstrap.bootstrapDna(db, {
          ...input,
          email: "parallel@example.test",
        }),
      ),
    );
    expect(new Set(results.map((user) => user.id)).size).toBe(1);
    expect(await counts("parallel@example.test")).toEqual({
      users: 1,
      audits: 1,
    });
  });

  it("keeps an existing DNA name and deactivation state", async () => {
    const user = await bootstrap.bootstrapDna(db, {
      ...input,
      email: "retained@example.test",
    });
    expect(user).toMatchObject({
      name: "Existing DNA",
      deactivatedAt: new Date("2026-01-01T00:00:00Z"),
    });
    expect(await counts(user.email)).toEqual({ users: 1, audits: 0 });
  });

  it("refuses promoting a non-DNA identity without changing it", async () => {
    await expect(
      bootstrap.bootstrapDna(db, { ...input, email: "existing@example.test" }),
    ).rejects.toMatchObject({ code: "conflict" });
    const rows = await db.transaction(
      async (tx) =>
        (
          await tx.execute(
            sql`select name, platform_role from users where email = 'existing@example.test'`,
          )
        ).rows,
    );
    expect(rows).toEqual([{ name: "Existing member", platform_role: null }]);
    expect(await counts("existing@example.test")).toEqual({
      users: 1,
      audits: 0,
    });
  });

  it("rolls back the identity when audit insertion fails", async () => {
    await expect(
      bootstrap.bootstrapDna(db, { ...input, email: "rollback@example.test" }),
    ).rejects.toMatchObject({
      cause: { code: "P0001", message: "Reject fixture audit" },
    });
    expect(await counts("rollback@example.test")).toEqual({
      users: 0,
      audits: 0,
    });
  });

  it.each([
    "update audit_log set data = '{}'",
    "delete from audit_log",
    "truncate audit_log",
    "create schema forbidden_bootstrap",
  ])("denies runtime %s", async (query) => {
    await expect(
      db.transaction((tx) => tx.execute(sql.raw(query))),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("refuses privileged platform connections and exposes no pool", async () => {
    expect(Object.keys(db).sort()).toEqual(["close", "transaction"]);
    for (const key of ["ANAR_TEST_ADMIN_URL", "ANAR_TEST_MIGRATION_URL"]) {
      const url = process.env[key];
      if (!url) throw new Error("Disposable role URL is required");
      await expect(createPlatformDb(url)).rejects.toThrow(
        "Database connection requires anar_app",
      );
    }
  });

  it.each([false, true])(
    "keeps platform and tenant writes together with rollback=%s",
    async (rollback) => {
      const isolated = await createPlatformDb(appUrl);
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
              sql`insert into bootstrap_scope_fixture (company_id, value) values (${scope.companyId}, ${email})`,
            );
            expect(
              (
                await scoped.execute(
                  sql`select value from bootstrap_scope_fixture where company_id = ${scope.companyId} and value = ${email}`,
                )
              ).rows,
            ).toEqual([{ value: email }]);
          });
          if (rollback) throw new Error("Rollback both writes");
        });
        if (rollback)
          await expect(result).rejects.toThrow("Rollback both writes");
        else await result;
        const settings = await isolated.transaction(
          async (tx) =>
            (
              await tx.execute(sql`
        select pg_backend_pid() as pid,
        nullif(current_setting('app.company_id', true), '') as company,
        nullif(current_setting('app.user_id', true), '') as usr`)
            ).rows,
        );
        expect(settings).toEqual([{ pid, company: null, usr: null }]);
        expect(await counts(email)).toEqual({
          users: rollback ? 0 : 1,
          audits: 0,
        });
        const scopedRows = await isolated.transaction((tx) =>
          withPlatformTenant(
            tx,
            scope,
            async (scoped) =>
              (
                await scoped.execute(
                  sql`select value from bootstrap_scope_fixture where company_id = ${scope.companyId} and value = ${email}`,
                )
              ).rows,
          ),
        );
        expect(scopedRows).toEqual(rollback ? [] : [{ value: email }]);
      } finally {
        await isolated.close();
      }
    },
  );

  it("prints only completion when the compiled operator command repeats", async () => {
    const args = [
      "--environment",
      "proof",
      "--email",
      "cli@example.test",
      "--name",
      "CLI identity",
    ];
    for (let i = 0; i < 2; i++) {
      expect(await cli(args)).toMatchObject({
        stdout: "DNA bootstrap complete\n",
        stderr: "",
      });
    }
    expect(await counts("cli@example.test")).toEqual({ users: 1, audits: 1 });
  });

  it.each([
    { args: [], env: {}, message: "Use --environment, --email and --name" },
    {
      args: [
        "--environment",
        "production",
        "--email",
        "invalid-cli@example.test",
        "--name",
        "CLI identity",
      ],
      env: {},
      message: "--environment must match ANAR_ENV",
    },
    {
      args: [
        "--environment",
        "proof",
        "--email",
        "invalid-cli@example.test",
        "--name",
        "CLI identity",
      ],
      env: { ANAR_ENV: "" },
      message: "--environment must match ANAR_ENV",
    },
    {
      args: [
        "--environment",
        "proof",
        "--email",
        "invalid-cli@example.test",
        "--name",
        "CLI identity",
      ],
      env: { DATABASE_URL: "" },
      message: "DATABASE_URL is required",
    },
    {
      args: [
        "--environment",
        "proof",
        "--email",
        "existing@example.test",
        "--name",
        "CLI identity",
      ],
      env: {},
      message: "Bootstrap cannot promote an existing user",
    },
  ])(
    "rejects invalid operator input with $message",
    async ({ args, env, message }) => {
      await expect(cli(args, env)).rejects.toMatchObject({
        code: 1,
        stdout: "",
        stderr: `${message}\n`,
      });
      expect(await counts("invalid-cli@example.test")).toEqual({
        users: 0,
        audits: 0,
      });
    },
  );
});
