import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { checksum } from "./backup/manifest.ts";
import { restoreLocal } from "./local-restore.ts";
import { createRestoreRunner, type RestoreIO } from "./local-restore-runner.ts";

const exec = promisify(execFile);
const project = "anar-restore-proof";

test("restores a verified artifact into a reserved isolated project", async () => {
  const root = await mkdtemp(path.join(tmpdir(), "anar-restore-runner-"));
  const backup = path.join(root, "backup");
  const uploads = path.join(root, "uploads");
  await mkdir(backup);
  await mkdir(uploads);
  await writeFile(path.join(uploads, "synthetic.csv"), "lead\n");
  await writeFile(path.join(backup, "database.dump"), "synthetic dump");
  await exec("tar", [
    "--format=ustar",
    "-cf",
    path.join(backup, "uploads.tar"),
    "-C",
    uploads,
    ".",
  ]);
  const manifest = {
    format: 1,
    createdAt: "2026-11-02T00:00:00.000Z",
    sourceRevision: "a".repeat(40),
    schemaVersion: "schema123",
    databaseSha256: await checksum(path.join(backup, "database.dump")),
    uploadsSha256: await checksum(path.join(backup, "uploads.tar")),
    rowCounts: { leads: 0 },
  };
  await writeFile(path.join(backup, "manifest.json"), JSON.stringify(manifest));
  const calls: {
    args: string[];
    env?: Record<string, string>;
    file?: string;
  }[] = [];
  let token = "";
  const io: RestoreIO = {
    async docker(args, env) {
      calls.push({ args, env });
      if (args.includes("volume") && args.includes("create")) {
        token =
          args
            .find((value) => value.startsWith("anar.restore.token="))
            ?.split("=")[1] ?? "";
      }
      if (args.includes("inspect")) return `${token}\n`;
      if (args.includes("port")) return "127.0.0.1:49152\n";
      if (args.some((arg) => arg.includes("id -u node"))) return "1000:1000\n";
      const query = args.at(-1) ?? "";
      if (query.includes("json_build_object")) return '{"leads":0}\n';
      if (query.includes("SELECT CASE WHEN")) return "ok\n";
      return "";
    },
    async dockerFromFile(args, file) {
      calls.push({ args, file });
    },
  };
  const runner = createRestoreRunner(root, io, root);
  assert.deepEqual(
    await restoreLocal({
      directory: backup,
      project,
      signal: new AbortController().signal,
      runner,
    }),
    manifest,
  );
  assert.ok(
    calls.some(
      ({ args }) => args.includes("pg_restore") && args.includes("--list"),
    ),
  );
  assert.ok(
    calls.some(({ args }) =>
      args.some((arg) => arg.includes("--role=anar_migrate")),
    ),
  );
  assert.ok(calls.some(({ file }) => file?.endsWith("restore-grants.sql")));
  assert.ok(
    calls.some(({ args }) =>
      args.some((arg) => arg.includes("--keep-old-files")),
    ),
  );
  assert.ok(
    calls.some(({ args }) => args.includes(`${project}_restore_verified`)),
  );
  assert.ok(
    calls.some(
      ({ env }) => env?.ANAR_RESTORE_PUBLIC_ORIGIN === "http://127.0.0.1:49152",
    ),
  );
  assert.ok(
    !calls.some(
      ({ args }) =>
        args.includes("migrate") ||
        args.includes("down") ||
        args.includes("--volumes"),
    ),
  );
});

test("refuses an occupied project before creating a reservation", async () => {
  const calls: string[][] = [];
  const io: RestoreIO = {
    async docker(args) {
      calls.push(args);
      if (
        args.includes("ps") &&
        args.some((arg) =>
          arg.includes("com.docker.compose.project=anar-restore-proof"),
        )
      )
        return "existing-api\n";
      return "";
    },
    async dockerFromFile() {},
  };
  const runner = createRestoreRunner("/synthetic/anar", io);
  await assert.rejects(runner.reserveEmptyTarget(project), /occupied/);
  assert.ok(!calls.some((args) => args.includes("create")));
});

test("refuses non-restore names before issuing Docker commands", async () => {
  const calls: string[][] = [];
  const runner = createRestoreRunner("/synthetic/anar", {
    async docker(args) {
      calls.push(args);
      return "";
    },
    async dockerFromFile() {
      throw new Error("Unexpected stream");
    },
  });
  await assert.rejects(runner.reserveEmptyTarget("anar-local"));
  await assert.rejects(runner.withTargetLock("../anar-local", async () => {}));
  assert.equal(calls.length, 0);
});

test("uses explicit proof configuration without the protected root environment", async () => {
  const calls: string[][] = [];
  const runner = createRestoreRunner(
    "/synthetic/anar",
    {
      async docker(args) {
        calls.push(args);
        return "";
      },
      async dockerFromFile() {},
    },
    undefined,
    {
      envFile: "/private/proof-runtime",
      composeFiles: [
        "/synthetic/anar/compose.yml",
        "/synthetic/anar/compose.proof.yml",
      ],
    },
  );
  await runner.bootstrapRoles(project);
  assert.ok(
    calls.every(
      (args) =>
        args.includes("/private/proof-runtime") &&
        args.includes("/synthetic/anar/compose.proof.yml") &&
        !args.includes("/synthetic/anar/.env"),
    ),
  );
});

test("refuses occupied volumes and volume reservation races", async () => {
  for (const occupied of [true, false]) {
    const calls: string[][] = [];
    const runner = createRestoreRunner("/synthetic/anar", {
      async docker(args) {
        calls.push(args);
        if (occupied && args.includes("volume") && args.includes("ls"))
          return `${project}_uploads_data`;
        if (args.includes("inspect")) return "another-token";
        return "";
      },
      async dockerFromFile() {},
    });
    await assert.rejects(runner.reserveEmptyTarget(project), /occupied/);
    if (occupied)
      assert.equal(
        calls.some((args) => args.includes("create")),
        false,
      );
    assert.equal(
      calls.some((args) => args.includes("rm") || args.includes("down")),
      false,
    );
  }
});
