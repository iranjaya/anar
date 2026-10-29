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
      await frontDoor();
      return;
    } catch (error) {
      if (Date.now() >= deadline) throw error;
      await setTimeout(500);
    }
  }
}

async function frontDoor(): Promise<void> {
  const login = await request("/login");
  assert.match(await login.text(), /Sign in to Anar/);
  const companies = await fetch(`${origin}/companies`, {
    headers: { cookie },
    signal: AbortSignal.timeout(10000),
  });
  await companies.body?.cancel();
  assert.equal(companies.status, 404);
}

function running(id: string): boolean {
  return (
    execFileSync("docker", ["inspect", "--format", "{{.State.Running}}", id], {
      encoding: "utf8",
      timeout: 10_000,
    }).trim() === "true"
  );
}

for (const service of ["api", "worker", "web"]) {
  const id = compose("ps", "-q", service);
  assert.ok(id, `${service} container is missing`);
  const [container] = JSON.parse(
    execFileSync("docker", ["inspect", id], { encoding: "utf8" }),
  );
  assert.equal(container.Config.Image, `anar-${service}:runtime`);
  assert.deepEqual(
    container.Mounts,
    [],
    `${service} runtime must run without source mounts`,
  );
  if (service === "web") {
    for (const variable of container.Config.Env)
      assert.doesNotMatch(
        variable,
        /^(DATABASE_URL|MIGRATION_DATABASE_URL|POSTGRES_|APP_DATABASE_|MIGRATION_DATABASE_)/,
      );
    compose(
      "exec",
      "-T",
      "web",
      "node",
      "-e",
      "for (const name of ['@anar/db', 'pg', 'drizzle-orm']) { try { require.resolve(name); throw new Error(name + ' found in web runtime'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; } }",
    );
  }
}
await waitForStack();
const upload = await fetch(`${origin}/api/imports`, {
  method: "POST",
  headers: { cookie, "content-type": "application/json" },
  body: JSON.stringify({}),
  signal: AbortSignal.timeout(10000),
});
const result = await upload.json();
assert.equal(upload.status, 403);
assert.equal(result.ok, false);
assert.equal(result.error, "forbidden");

const workerId = compose("ps", "-q", "worker");
assert.ok(workerId, "Worker container is missing");
assert.equal(running(workerId), true);
try {
  compose("stop", "api");
  const unavailable = await fetch(`${origin}/api/health`, {
    signal: AbortSignal.timeout(10_000),
  });
  assert.equal(unavailable.status, 502);
  await frontDoor();
  assert.equal(running(workerId), true);
} finally {
  compose("start", "api");
}
await waitForStack();

try {
  compose("stop", "worker");
  assert.equal(running(workerId), false);
  await health();
  await frontDoor();
} finally {
  compose("start", "worker");
}
assert.equal(running(workerId), true);
console.log(
  "Compose smoke passed: health, real front door, mock refusal, independent API/worker stops.",
);
