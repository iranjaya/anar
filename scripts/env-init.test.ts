import assert from "node:assert/strict";
import { createECDH } from "node:crypto";
import {
  chmod,
  copyFile,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { initEnv } from "./env-init.ts";

const example = fileURLToPath(new URL("../.env.example", import.meta.url));
async function fixture() {
  const dir = await mkdtemp(path.join(tmpdir(), "anar-env-init-"));
  await copyFile(example, path.join(dir, ".env.example"));
  return dir;
}
const read = async (dir: string) =>
  Object.fromEntries(
    (await readFile(path.join(dir, ".env"), "utf8"))
      .split("\n")
      .filter((line) => /^[A-Z][A-Z0-9_]*=/.test(line))
      .map((line) => {
        const at = line.indexOf("=");
        return [line.slice(0, at), line.slice(at + 1)];
      }),
  );

test("fills empty names, generates a matching VAPID pair, and writes mode 600", async () => {
  const dir = await fixture();
  try {
    const result = await initEnv(dir, async () => "synthetic-resend-canary");
    const env = await read(dir);
    assert.equal(result.RESEND_API_KEY, "filled from keychain");
    assert.equal(result.POSTGRES_PASSWORD, "still missing");
    assert.equal(env.RESEND_API_KEY, "synthetic-resend-canary");
    assert.equal(env.PUBLIC_ORIGIN, "https://anar.visitshankhuwasabha.com");
    assert.equal(env.EMAIL_TRANSPORT, "resend");
    assert.equal(env.EMAIL_FROM, "info@visitshankhuwasabha.com");
    assert.equal(env.EMAIL_REPLY_TO, "info@visitshankhuwasabha.com");
    assert.equal(env.VAPID_SUBJECT, "mailto:info@visitshankhuwasabha.com");
    assert.equal(env.ANAR_PUSH_ENABLED, "false");
    assert.equal(Buffer.from(env.MAIL_ENCRYPTION_KEY, "base64").length, 32);
    assert.equal(Buffer.from(env.OTP_PEPPER, "base64").length, 32);
    assert.notEqual(env.MAIL_ENCRYPTION_KEY, env.OTP_PEPPER);
    const vapid = createECDH("prime256v1");
    vapid.setPrivateKey(Buffer.from(env.VAPID_PRIVATE_KEY, "base64url"));
    assert.equal(
      vapid.getPublicKey().toString("base64url"),
      env.VAPID_PUBLIC_KEY,
    );
    assert.equal((await stat(path.join(dir, ".env"))).mode & 0o777, 0o600);
    assert.equal(
      JSON.stringify(result).includes("synthetic-resend-canary"),
      false,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("keeps every set value and does not consult Keychain again", async () => {
  const dir = await fixture();
  try {
    await writeFile(
      path.join(dir, ".env"),
      [
        "RESEND_API_KEY=already-set-canary",
        "EMAIL_FROM=other@example.test",
        "POSTGRES_PASSWORD=database-canary",
        "CUSTOM_NAME=preserve-canary",
      ].join("\n"),
    );
    await chmod(path.join(dir, ".env"), 0o644);
    const result = await initEnv(dir, async () => {
      throw new Error("Keychain should not be read");
    });
    const first = await read(dir);
    assert.equal(first.RESEND_API_KEY, "already-set-canary");
    assert.equal(first.EMAIL_FROM, "other@example.test");
    assert.equal(first.POSTGRES_PASSWORD, "database-canary");
    assert.equal(first.CUSTOM_NAME, "preserve-canary");
    assert.equal(result.RESEND_API_KEY, "kept");
    assert.equal((await stat(path.join(dir, ".env"))).mode & 0o777, 0o600);
    await initEnv(dir, async () => "wrong-canary");
    assert.deepEqual(await read(dir), first);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("reports a missing Resend key and preserves a lone public VAPID key", async () => {
  const dir = await fixture();
  try {
    await writeFile(
      path.join(dir, ".env"),
      "VAPID_PUBLIC_KEY=existing-public-canary\n",
    );
    const result = await initEnv(dir, async () => "");
    const env = await read(dir);
    assert.equal(result.RESEND_API_KEY, "still missing");
    assert.equal(result.VAPID_PRIVATE_KEY, "still missing");
    assert.equal(env.VAPID_PUBLIC_KEY, "existing-public-canary");
    assert.equal(env.VAPID_PRIVATE_KEY, "");
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
