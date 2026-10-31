import assert from "node:assert/strict";
import { execFileSync, spawn } from "node:child_process";
import { request as httpsRequest } from "node:https";
import { createInterface } from "node:readline";
import { setTimeout } from "node:timers/promises";
import { healthResponseSchema } from "../packages/domain/dist/health.js";
import { foundation, seedFoundation } from "../test/support/foundation-seed.ts";

type Stack = {
  baseURL: string;
  mailURL: string;
  httpsPort: string;
  project: string;
};

const otpEmail = "manager@browser.example.test";
const cookie = `anar_demo=${encodeURIComponent(
  JSON.stringify({ userId: "rohan", actingCompanyId: "sundar-heights" }),
)}`;

function step(message: string) {
  console.log(`smoke: ${message}`);
}

function docker(...args: string[]): string {
  return execFileSync("docker", args, {
    encoding: "utf8",
    timeout: 60_000,
  }).trim();
}

const child = spawn(
  process.execPath,
  [new URL("../test/support/auth-browser-stack.ts", import.meta.url).pathname],
  { stdio: ["pipe", "pipe", "inherit"] },
);
const exited = new Promise<number | null>((resolve) =>
  child.once("exit", resolve),
);
step("building and starting a disposable stack");
const stack = await new Promise<Stack>((resolve, reject) => {
  const lines = createInterface({ input: child.stdout });
  lines.once("line", (line) => {
    lines.close();
    resolve(JSON.parse(line) as Stack);
  });
  child.once("exit", () => reject(new Error("Stack stopped before ready")));
});

function container(service: string): string {
  const id = docker(
    "ps",
    "-aq",
    "--filter",
    `label=com.docker.compose.project=${stack.project}`,
    "--filter",
    `label=com.docker.compose.service=${service}`,
  );
  assert.ok(id, `${service} container is missing`);
  return id;
}

function running(service: string): boolean {
  return (
    docker("inspect", "--format", "{{.State.Running}}", container(service)) ===
    "true"
  );
}

async function get(path: string, init?: RequestInit) {
  return fetch(`${stack.baseURL}${path}`, {
    ...init,
    headers: { cookie, ...init?.headers },
    signal: AbortSignal.timeout(10_000),
  });
}

async function health() {
  const response = await get("/api/health");
  if (response.status === 502) {
    await response.body?.cancel();
    return { status: 502, body: null };
  }
  return {
    status: response.status,
    body: healthResponseSchema.parse(await response.json()),
  };
}

async function until<T>(
  label: string,
  read: () => Promise<T>,
  done: (value: T) => boolean,
  timeout = 60_000,
): Promise<T> {
  const deadline = Date.now() + timeout;
  let last: T | undefined;
  for (;;) {
    try {
      last = await read();
      if (done(last)) return last;
    } catch {}
    if (Date.now() >= deadline)
      throw new Error(`${label}: last value ${JSON.stringify(last)}`);
    await setTimeout(500);
  }
}

const healthy = () =>
  until(
    "health ok",
    health,
    (value) => value.status === 200 && value.body?.status === "ok",
  );

async function frontDoor() {
  const login = await get("/login");
  assert.equal(login.status, 200);
  assert.match(await login.text(), /Sign in to Anar/);
  const companies = await get("/companies");
  await companies.body?.cancel();
  assert.equal(companies.status, 404);
}

function https(path: string) {
  return new Promise<{ status: number; hsts: string | undefined }>(
    (resolve, reject) => {
      const request = httpsRequest(
        {
          host: "127.0.0.1",
          port: Number(stack.httpsPort),
          path,
          servername: "localhost",
          headers: { host: "localhost" },
          rejectUnauthorized: false,
          timeout: 10_000,
        },
        (response) => {
          response.resume();
          resolve({
            status: response.statusCode ?? 0,
            hsts: response.headers["strict-transport-security"] as
              | string
              | undefined,
          });
        },
      );
      request.on("error", reject);
      request.end();
    },
  );
}

async function mailsTo(email: string): Promise<number> {
  const response = await fetch(`${stack.mailURL}/api/v1/messages`, {
    signal: AbortSignal.timeout(5000),
  });
  const body = (await response.json()) as {
    messages: { To: { Address: string }[] }[];
  };
  return body.messages.filter((message) =>
    message.To.some((to) => to.Address === email),
  ).length;
}

function psql(query: string) {
  return docker(
    "exec",
    container("db"),
    "psql",
    "-U",
    "postgres",
    "-d",
    "anar",
    "-v",
    "ON_ERROR_STOP=1",
    "-Atc",
    query,
  );
}

let failed = false;
try {
  assert.ok(
    !["3000", "3001", "3100", "8080"].includes(new URL(stack.baseURL).port),
  );
  for (const service of ["api", "worker", "web"]) {
    const [inspected] = JSON.parse(docker("inspect", container(service)));
    assert.equal(inspected.Config.Image, `${stack.project}-${service}`);
    assert.deepEqual(
      inspected.Mounts,
      [],
      `${service} must run without mounts`,
    );
    if (service === "web") {
      for (const variable of inspected.Config.Env)
        assert.doesNotMatch(
          variable,
          /^(DATABASE_URL|MIGRATION_DATABASE_URL|POSTGRES_|APP_DATABASE_|MIGRATION_DATABASE_)/,
        );
      docker(
        "exec",
        container("web"),
        "node",
        "-e",
        "for (const name of ['@anar/db', 'pg', 'drizzle-orm']) { try { require.resolve(name); throw new Error(name + ' found in web runtime'); } catch (error) { if (error.code !== 'MODULE_NOT_FOUND') throw error; } }",
      );
    }
  }
  step("built images run without mounts and web has no database access");

  const first = await healthy();
  assert.equal(first.body?.db, "ok");
  assert.equal(first.body?.worker.healthy, true);
  assert.ok(first.body?.queue);
  await frontDoor();
  const upload = await get("/api/imports", {
    method: "POST",
    headers: { "content-type": "application/json" },
    body: JSON.stringify({}),
  });
  assert.equal(upload.status, 403);
  assert.equal((await upload.json()).error, "forbidden");
  step("health ok, real front door, demo imports refused");

  const nonces: string[] = [];
  for (let page = 0; page < 2; page++) {
    const login = await get("/login");
    const policy = login.headers.get("content-security-policy") ?? "";
    assert.match(policy, /frame-ancestors 'none'/);
    assert.equal(login.headers.get("x-frame-options"), "DENY");
    assert.equal(login.headers.get("strict-transport-security"), null);
    const nonce = policy.match(/'nonce-([^']+)'/)?.[1];
    assert.ok(nonce, "login policy has a nonce");
    const scripts = (await login.text()).match(/<script\b[^>]*>/g) ?? [];
    assert.ok(scripts.length > 0);
    for (const script of scripts)
      assert.ok(script.includes(`nonce="${nonce}"`));
    nonces.push(nonce);
  }
  assert.notEqual(nonces[0], nonces[1]);
  step(
    "nonce changes per page, scripts carry it, frames refused, no HSTS on HTTP",
  );

  const secure = await https("/login");
  assert.equal(secure.status, 200);
  assert.match(secure.hsts ?? "", /max-age=\d+/);
  step("HTTPS sends HSTS");

  const requestCode = async () => {
    const response = await get("/api/auth/requestOtp", {
      method: "POST",
      headers: { "content-type": "application/json", origin: stack.baseURL },
      body: JSON.stringify({ email: otpEmail }),
    });
    return { status: response.status, body: await response.json() };
  };
  const accepted = await requestCode();
  assert.equal(accepted.status, 200);
  for (let code = 1; code <= 3; code++) {
    if (code > 1) assert.deepEqual(await requestCode(), accepted);
    await until(
      `sign-in code ${code}`,
      () => mailsTo(otpEmail),
      (count) => count === code,
    );
  }
  assert.deepEqual(await requestCode(), accepted);
  await setTimeout(5000);
  assert.equal(await mailsTo(otpEmail), 3);
  step("worker delivers sign-in codes to Mailpit, the fourth sends nothing");

  await seedFoundation({ ...stack, apiContainer: container("api") });
  for (const agency of foundation.agencies) {
    assert.equal(
      psql(`select a.status || ' ' || count(distinct c.id) || ' ' ||
        count(m.id) filter (where m.role = 'super_admin' and m.status = 'active')
        from agencies a join companies c on c.agency_id = a.id
        left join company_members m on m.company_id = c.id
        where a.slug = '${agency.slug}' group by a.status`),
      "active 2 2",
    );
  }
  assert.equal(
    psql("select count(*) from users where platform_role = 'owner'"),
    "1",
  );
  step(
    "foundation seed: one owner, DNA and a second agency, two companies each with a Super Admin",
  );

  docker("stop", container("api"));
  assert.equal((await health()).status, 502);
  await frontDoor();
  assert.equal(running("worker"), true);
  docker("start", container("api"));
  await healthy();
  step("API stop gives 502 at the proxy, front door and worker keep running");

  docker("stop", container("worker"));
  assert.equal((await health()).status, 200);
  psql(
    "update worker_heartbeats set last_seen_at = now() - interval '6 minutes'",
  );
  const stale = await health();
  assert.equal(stale.status, 503);
  assert.equal(stale.body?.worker.healthy, false);
  docker("start", container("worker"));
  await healthy();
  step(
    "stopped worker plus old heartbeat gives 503, restarted worker recovers",
  );

  docker("stop", container("db"));
  const down = await until(
    "db down",
    health,
    (value) => value.body?.db === "down",
  );
  assert.equal(down.status, 503);
  assert.equal(running("api"), true);
  docker("start", container("db"));
  await until(
    "worker running again",
    async () => running("worker"),
    (value) => value,
  );
  await healthy();
  assert.equal(running("api"), true);
  step("database down gives 503, worker restarts itself and health recovers");
  step("passed");
} catch (error) {
  failed = true;
  console.error(error instanceof Error ? error.message : error);
  step("stack logs (redacted):");
  try {
    process.stderr.write(
      execFileSync(
        process.execPath,
        [new URL("./compose-logs.ts", import.meta.url).pathname, stack.project],
        { encoding: "utf8", maxBuffer: 64 * 1024 * 1024 },
      ),
    );
  } catch {
    step("could not read the stack logs");
  }
} finally {
  child.stdin.end();
  const code = await exited;
  step(`disposable stack removed (exit ${code})`);
  if (failed || code !== 0) process.exitCode = 1;
}
