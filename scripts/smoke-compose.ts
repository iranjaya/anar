import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { setTimeout } from "node:timers/promises";
import { healthResponseSchema } from "../packages/domain/dist/health.js";

const origin = "http://localhost:8080";
const cookie = `anar_demo=${encodeURIComponent(
  JSON.stringify({ userId: "rohan", actingCompanyId: "sundar-heights" }),
)}`;

function compose(...args: string[]): string {
  return execFileSync("docker", ["compose", ...args], {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

async function request(path: string, init?: RequestInit): Promise<Response> {
  const response = await fetch(`${origin}${path}`, {
    ...init,
    headers: { cookie, ...init?.headers },
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(response.status, 200, `${path}: HTTP ${response.status}`);
  return response;
}

async function health(): Promise<void> {
  const response = await request("/api/health");
  assert.match(response.headers.get("content-type") ?? "", /application\/json/);
  assert.deepEqual(
    await response.json(),
    healthResponseSchema.parse({ status: "ok", service: "api" }),
  );
}

async function waitForStack(): Promise<void> {
  const deadline = Date.now() + 60_000;
  for (;;) {
    try {
      await health();
      await mock();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await setTimeout(500);
    }
  }
}

async function mock(): Promise<void> {
  const companies = await request("/companies");
  assert.match(await companies.text(), /Sundar Heights/);
  const upload = await request("/sundar-heights/imports/new");
  assert.match(await upload.text(), /Import leads/);
}

function running(id: string): boolean {
  return (
    execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", id], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim() === "true"
  );
}

await waitForStack();
const upload = await request("/api/imports", {
  method: "POST",
  headers: { "content-type": "application/json" },
  body: JSON.stringify({
    slug: "sundar-heights",
    fileName: "Sundar Heights 2 3 BHK October_Leads_2026-10-14_2026-10-28.csv",
    fileSize: 19,
  }),
});
const result = await upload.json();
assert.equal(result.ok, true);
assert.equal(typeof result.data.batchId, "string");
assert.equal(result.data.rowCount, 412);
assert.equal(result.data.encoding, "utf-16le");
assert.equal(result.data.delimiter, "\t");

const workerId = compose("ps", "-q", "worker");
assert.ok(workerId, "Worker container is missing");
assert.equal(running(workerId), true);
try {
  compose("stop", "api");
  const unavailable = await fetch(`${origin}/api/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(unavailable.status, 502);
  await mock();
  assert.equal(running(workerId), true);
} finally {
  compose("start", "api");
}
await waitForStack();

try {
  compose("stop", "worker");
  assert.equal(running(workerId), false);
  await health();
  await mock();
} finally {
  compose("start", "worker");
}
assert.equal(running(workerId), true);
console.log(
  "Compose smoke passed: health, mock upload, independent API/worker stops.",
);
