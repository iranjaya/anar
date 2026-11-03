import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { randomUUID } from "node:crypto";
import { mkdir, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { setTimeout } from "node:timers/promises";
import { promisify } from "node:util";
import { createRestoreRunner } from "./local-restore-runner.ts";

const exec = promisify(execFile);
const docker = async (args: string[]) =>
  (await exec("docker", args, { timeout: 30_000 })).stdout;

test("API node user can upload into restored directories", async () => {
  const project = `anar-restore-${randomUUID()}`;
  const volume = `${project}_uploads_data`;
  await docker([
    "volume",
    "create",
    "--label",
    "anar.proof.regression=true",
    volume,
  ]);
  const root = await mkdtemp(path.join(tmpdir(), "anar-upload-owner-proof-"));
  const uploads = path.join(root, "uploads");
  await mkdir(path.join(uploads, "imports", "synthetic-company"), {
    recursive: true,
  });
  await writeFile(
    path.join(uploads, "imports", "synthetic-company", "old.csv"),
    "synthetic\n",
  );
  const archive = path.join(root, "uploads.tar");
  await exec("tar", ["--format=ustar", "-cf", archive, "-C", uploads, "."]);
  const image = "node:24.22.1-bookworm-slim";
  const ids = (
    await docker([
      "run",
      "--rm",
      "--network",
      "none",
      "--entrypoint",
      "sh",
      image,
      "-c",
      "id -u node; id -g node",
    ])
  )
    .trim()
    .split(/\s+/);
  const runner = createRestoreRunner("/synthetic/repo", {
    async docker(args) {
      if (args[0] === "compose") return `${ids[0]}:${ids[1]}\n`;
      return docker(args);
    },
    async dockerFromFile() {
      throw new Error("Unexpected stream");
    },
  });
  await runner.extractUploads(project, archive);
  await docker([
    "run",
    "--rm",
    "--network",
    "none",
    "--user",
    `${ids[0]}:${ids[1]}`,
    "--mount",
    `type=volume,source=${volume},target=/uploads`,
    "--entrypoint",
    "sh",
    image,
    "-eu",
    "-c",
    "mkdir -p /uploads/imports/synthetic-company/new; printf synthetic > /uploads/imports/synthetic-company/new/upload.csv",
  ]);
});

test("restore accepts an unsent email fallback before its envelope is built", async () => {
  const name = `anar-proof-email-${randomUUID()}`;
  await docker([
    "run",
    "--detach",
    "--name",
    name,
    "--network",
    "none",
    "--tmpfs",
    "/var/lib/postgresql/data",
    "--env",
    "POSTGRES_HOST_AUTH_METHOD=trust",
    "postgres:17",
  ]);
  const query = (sql: string) =>
    docker([
      "exec",
      name,
      "psql",
      "-h",
      "127.0.0.1",
      "-X",
      "-A",
      "-t",
      "-v",
      "ON_ERROR_STOP=1",
      "-U",
      "postgres",
      "-c",
      sql,
    ]);
  try {
    let ready = false;
    for (let attempt = 0; attempt < 100; attempt++) {
      try {
        await query("SELECT 1");
        ready = true;
        break;
      } catch {
        await setTimeout(100);
      }
    }
    assert.ok(ready, "Disposable Postgres ready");
    await query(`CREATE TABLE leads(company_id uuid,id uuid); CREATE TABLE lead_events(company_id uuid,lead_id uuid); CREATE TABLE follow_ups(company_id uuid,lead_id uuid); CREATE TABLE sessions(token_hash text);
      CREATE TABLE notification_deliveries(channel text,state text,encrypted_message text,attempts int,first_attempt_at timestamptz,lease_until timestamptz,message_hash text);
      INSERT INTO notification_deliveries VALUES ('email','pending',NULL,0,NULL,NULL,NULL);`);
    const runner = createRestoreRunner("/synthetic/repo", {
      async docker(args) {
        return query(args.at(-1) ?? "");
      },
      async dockerFromFile() {},
    });
    await runner.verifyRelationshipsAndStoredState("anar-restore-email");
    await query(
      "UPDATE notification_deliveries SET state='sending',attempts=1,first_attempt_at=now()",
    );
    await assert.rejects(
      runner.verifyRelationshipsAndStoredState("anar-restore-email"),
    );
    await query(
      "UPDATE notification_deliveries SET encrypted_message='synthetic encrypted envelope'",
    );
    await runner.verifyRelationshipsAndStoredState("anar-restore-email");
  } finally {
    await docker(["rm", "--force", name]);
  }
});
