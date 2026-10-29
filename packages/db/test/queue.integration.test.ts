import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { sql } from "drizzle-orm";
import { PgBoss } from "pg-boss";
import { afterAll, beforeAll, describe, expect, it } from "vitest";
import { createDb, type DbHandle } from "../src/connection.js";
import { createPlatformDb, type PlatformDb } from "../src/platform.js";
import { publish } from "../src/queue.js";
import { type Postgres, startPostgres } from "./postgres.js";

const run = promisify(execFile);
const packageDir = fileURLToPath(new URL("../", import.meta.url));
const committedId = "019ad167-0000-7000-8000-000000000001";
const rolledBackId = "019ad167-0000-7000-8000-000000000002";
const duplicateId = "019ad167-0000-7000-8000-000000000003";

describe("transactional queue under real roles", () => {
  let postgres: Postgres;
  let runtime: DbHandle;
  let platform: PlatformDb;
  let boss: PgBoss;
  let owner: PgBoss;

  const migrate = () =>
    run(process.execPath, ["dist/migrate.js"], {
      cwd: packageDir,
      env: { ...process.env, MIGRATION_DATABASE_URL: postgres.migrationUrl },
      timeout: 15000,
    });
  const payload = (referenceId: string) => ({
    kind: "otp",
    referenceId,
    expiresAt: new Date(Date.now() + 600000).toISOString(),
    encryptedMessage: "synthetic-ciphertext",
  });

  beforeAll(async () => {
    postgres = await startPostgres();
    await postgres.bootstrap();
    await migrate();
    runtime = createDb(postgres.appUrl);
    platform = await createPlatformDb(postgres.appUrl);
    const options = {
      migrate: false,
      createSchema: false,
      supervise: false,
      schedule: false,
      reindex: false,
      persistQueueStats: false,
    };
    owner = new PgBoss({ ...options, connectionString: postgres.migrationUrl });
    boss = new PgBoss({ ...options, connectionString: postgres.appUrl });
    await owner.start();
    await boss.start();
  });

  afterAll(async () => {
    try {
      await Promise.all([
        boss?.stop({ timeout: 2000 }),
        owner?.stop({ timeout: 2000 }),
        platform?.close(),
        runtime?.close(),
      ]);
    } finally {
      if (postgres) await postgres.stop();
    }
  });

  it("uses Postgres 17 and anar_app on an isolated port", async () => {
    await runtime.requireRole("anar_app");
    const result = await runtime.pool.query("show server_version_num");
    expect(result.rows[0].server_version_num).toMatch(/^17\d{4}$/);
    expect(postgres.port).not.toBeOneOf([3000, 3001, 3100, 5432]);
    expect(await boss.getQueue("notify.email")).toMatchObject({
      policy: "short",
      retryLimit: 3,
    });
  });

  it("commits the user and job in one platform transaction", async () => {
    const message = payload(committedId);
    const jobId = await platform.transaction(async (tx) => {
      await tx.execute(sql`insert into public.users (id, email, name)
        values (${committedId}, 'committed@example.test', 'Committed')`);
      const id = await publish(tx, "notify.email", message, committedId);
      expect((await boss.findJobs("notify.email", { id })).length).toBe(0);
      expect(
        (
          await runtime.pool.query(
            "select id from public.users where id = $1",
            [committedId],
          )
        ).rows,
      ).toEqual([]);
      return id;
    });
    expect(
      (await boss.findJobs("notify.email", { id: jobId }))[0],
    ).toMatchObject({
      data: message,
      singletonKey: committedId,
      state: "created",
    });
    expect(
      (
        await runtime.pool.query(
          "select id from public.users where email = 'COMMITTED@EXAMPLE.TEST'",
        )
      ).rows,
    ).toEqual([{ id: committedId }]);
  });

  it("rolls back both the user and the published job", async () => {
    const failure = new Error("rollback the fixture");
    let jobId = "";
    await expect(
      platform.transaction(async (tx) => {
        await tx.execute(sql`insert into public.users (id, email, name)
        values (${rolledBackId}, 'rollback@example.test', 'Rollback')`);
        jobId = await publish(
          tx,
          "notify.email",
          payload(rolledBackId),
          rolledBackId,
        );
        expect(
          (await tx.execute(sql`select id from pgboss.job where id = ${jobId}`))
            .rows,
        ).toEqual([{ id: jobId }]);
        throw failure;
      }),
    ).rejects.toBe(failure);
    expect(await boss.findJobs("notify.email", { id: jobId })).toEqual([]);
    expect(
      (
        await runtime.pool.query("select id from public.users where id = $1", [
          rolledBackId,
        ])
      ).rows,
    ).toEqual([]);
  });

  it("rolls back the caller mutation when a duplicate key is refused", async () => {
    await platform.transaction(async (tx) => {
      await tx.execute(sql`insert into public.users (id, email, name)
        values (${duplicateId}, 'duplicate@example.test', 'Original')`);
      await publish(tx, "notify.email", payload(duplicateId), duplicateId);
    });
    await expect(
      platform.transaction(async (tx) => {
        await tx.execute(
          sql`update public.users set name = 'Changed' where id = ${duplicateId}`,
        );
        await publish(tx, "notify.email", payload(duplicateId), duplicateId);
      }),
    ).rejects.toThrow("Queue refused the job");
    expect(
      (
        await runtime.pool.query(
          "select name from public.users where id = $1",
          [duplicateId],
        )
      ).rows,
    ).toEqual([{ name: "Original" }]);
    expect(
      await boss.findJobs("notify.email", { key: duplicateId }),
    ).toHaveLength(1);
  });

  it("repeats migration and role bootstrap without widening grants", async () => {
    const id = "019ad167-0000-7000-8000-000000000004";
    await platform.transaction((tx) =>
      tx.execute(sql`insert into public.users (id, email, name)
      values (${id}, 'migration@example.test', 'Migration')`),
    );
    for (let i = 0; i < 2; i++) {
      await migrate();
      await postgres.bootstrap();
      const grants = await runtime.pool.query(`select
        (has_table_privilege(current_user, 'public.users', 'SELECT')
          and has_table_privilege(current_user, 'public.users', 'INSERT')
          and has_table_privilege(current_user, 'public.users', 'UPDATE')) as users_write,
        has_table_privilege(current_user, 'public.users', 'DELETE') as users_delete,
        (has_table_privilege(current_user, 'public.audit_log', 'SELECT')
          and has_table_privilege(current_user, 'public.audit_log', 'INSERT')) as audit_append,
        has_table_privilege(current_user, 'public.audit_log', 'UPDATE') as audit_update,
        has_table_privilege(current_user, 'public.audit_log', 'DELETE') as audit_delete,
        has_table_privilege(current_user, 'public.audit_log', 'TRUNCATE') as audit_truncate`);
      expect(grants.rows).toEqual([
        {
          users_write: true,
          users_delete: false,
          audit_append: true,
          audit_update: false,
          audit_delete: false,
          audit_truncate: false,
        },
      ]);
    }
    expect(
      (
        await runtime.pool.query(
          "select count(*)::int as count from public.users where id = $1",
          [id],
        )
      ).rows,
    ).toEqual([{ count: 1 }]);
    const owners =
      await runtime.pool.query(`select distinct pg_get_userbyid(c.relowner) as owner
      from pg_class c join pg_namespace n on n.oid = c.relnamespace
      where (n.nspname = 'pgboss' or c.oid in ('public.users'::regclass, 'public.audit_log'::regclass))
      and c.relkind in ('r', 'p')`);
    expect(owners.rows).toEqual([{ owner: "anar_migrate" }]);
  });

  it.each([
    "CREATE SCHEMA forbidden_queue",
    "CREATE TABLE pgboss.forbidden (id integer)",
    "SELECT pgboss.create_queue('forbidden', '{}'::jsonb)",
    "INSERT INTO pgboss.queue (name, policy) VALUES ('forbidden', 'standard')",
    "UPDATE pgboss.version SET version = 9999",
    "UPDATE public.audit_log SET action = 'changed'",
    "DELETE FROM public.audit_log",
    "TRUNCATE public.audit_log",
    "DELETE FROM public.users",
    "TRUNCATE public.users",
  ])("denies runtime %s", async (query) => {
    await expect(runtime.pool.query(query)).rejects.toMatchObject({
      code: "42501",
    });
  });

  it("claims, retries and completes with the same delivery key", async () => {
    const name = "s12a-maintenance";
    await owner.createQueue(name, { retryLimit: 1, retryDelay: 0 });
    const id = await platform.transaction((tx) =>
      publish(tx, name, { fixture: true }, "same-delivery"),
    );
    const [first] = await boss.fetch(name, { includeMetadata: true });
    expect(first).toMatchObject({
      id,
      singletonKey: "same-delivery",
      retryCount: 0,
    });
    await boss.fail(name, first);
    const [retry] = await boss.fetch(name, { includeMetadata: true });
    expect(retry).toMatchObject({
      id,
      singletonKey: "same-delivery",
      retryCount: 1,
    });
    await boss.complete(name, retry);
    await boss.supervise();
    expect((await boss.findJobs(name, { id }))[0]).toMatchObject({
      state: "completed",
    });
  });
});
