import assert from "node:assert/strict";
import { mkdtemp, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { localCompose, missingEnvNames } from "./local-compose.ts";

const required = [
  "POSTGRES_PASSWORD",
  "APP_DATABASE_PASSWORD",
  "MIGRATION_DATABASE_PASSWORD",
  "DATABASE_URL",
  "MIGRATION_DATABASE_URL",
  "ANAR_LAN_BIND_ADDRESS",
  "ANAR_SITE_ADDRESS",
  "PUBLIC_ORIGIN",
  "EMAIL_TRANSPORT",
  "EMAIL_FROM",
  "RESEND_API_KEY",
  "MAIL_ENCRYPTION_KEY",
  "OTP_PEPPER",
  "ANAR_PUSH_ENABLED",
  "VAPID_PUBLIC_KEY",
  "VAPID_PRIVATE_KEY",
  "VAPID_SUBJECT",
];

test("presence check reports names only and never returns values", () => {
  const missing = missingEnvNames(
    'RESEND_API_KEY=synthetic-secret-canary\nOTP_PEPPER=\nPUBLIC_ORIGIN=""\n',
  );
  assert.equal(missing.includes("RESEND_API_KEY"), false);
  assert.equal(missing.includes("OTP_PEPPER"), true);
  assert.equal(missing.includes("PUBLIC_ORIGIN"), true);
  assert.equal(
    missingEnvNames("OTP_PEPPER=first\nOTP_PEPPER=\n").includes("OTP_PEPPER"),
    true,
  );
  assert.equal(
    JSON.stringify(missing).includes("synthetic-secret-canary"),
    false,
  );
});

test("local up checks required names and starts only the named stack", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "anar-local-compose-"));
  const calls: string[][] = [];
  try {
    await writeFile(
      path.join(dir, ".env"),
      "RESEND_API_KEY=synthetic-secret-canary\n",
    );
    const missing = await localCompose(
      "up",
      dir,
      "anar-proof",
      async (args) => {
        calls.push(args);
      },
    );
    assert.ok(missing.includes("OTP_PEPPER"));
    assert.equal(calls.length, 0);
    await writeFile(
      path.join(dir, ".env"),
      required.map((name) => `${name}=synthetic-secret-canary`).join("\n"),
    );
    assert.deepEqual(
      await localCompose("up", dir, "anar-proof", async (args) => {
        calls.push(args);
      }),
      [],
    );
    assert.deepEqual(
      calls.map((args) => args.slice(-1)[0]),
      ["--quiet", "db", "migrate", "proxy"],
    );
    assert.ok(calls.every((args) => args.includes("anar-proof")));
    assert.equal(
      JSON.stringify(calls).includes("synthetic-secret-canary"),
      false,
    );
    await localCompose("down", dir, "anar-proof", async (args) => {
      calls.push(args);
    });
    assert.deepEqual(calls.at(-1)?.slice(-2), ["down", "--remove-orphans"]);
    assert.equal(calls.at(-1)?.includes("--volumes"), false);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
