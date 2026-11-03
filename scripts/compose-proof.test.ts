import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { copyFile, mkdtemp, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
const repository = fileURLToPath(new URL("../", import.meta.url));

test("proof Compose uses only generated runtime values and isolated ports", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "anar-proof-compose-"));
  for (const file of [
    "compose.yml",
    "compose.restore.yml",
    "compose.proof.yml",
  ])
    await copyFile(path.join(repository, file), path.join(directory, file));
  const runtime = path.join(directory, "proof-runtime");
  await writeFile(
    runtime,
    [
      "POSTGRES_DB=anar",
      "POSTGRES_USER=postgres",
      "POSTGRES_PASSWORD=synthetic-postgres",
      "APP_DATABASE_PASSWORD=synthetic-app",
      "MIGRATION_DATABASE_PASSWORD=synthetic-migrate",
      "DATABASE_URL=postgresql://anar_app:synthetic-app@db:5432/anar",
      "MIGRATION_DATABASE_URL=postgresql://anar_migrate:synthetic-migrate@db:5432/anar",
      "OTP_PEPPER=synthetic-otp",
      "MAIL_ENCRYPTION_KEY=synthetic-mail",
      "ANAR_PROOF_IMAGE_PREFIX=anar-proof-test",
      "EMAIL_FROM=restore@example.test",
    ].join("\n"),
    { mode: 0o600 },
  );
  const { stdout } = await run(
    "docker",
    [
      "compose",
      "--project-name",
      "anar-proof-test",
      "--env-file",
      runtime,
      ...["compose.yml", "compose.restore.yml", "compose.proof.yml"].flatMap(
        (file) => ["--file", path.join(directory, file)],
      ),
      "config",
      "--format",
      "json",
    ],
    {
      cwd: directory,
      env: { PATH: process.env.PATH, HOME: process.env.HOME },
      maxBuffer: 1024 * 1024,
    },
  );
  const config = JSON.parse(stdout) as {
    services: Record<
      string,
      {
        image?: string;
        env_file?: unknown[];
        environment?: Record<string, string>;
        ports?: { host_ip?: string; published?: string; target: number }[];
        networks?: Record<string, unknown> | string[];
      }
    >;
    networks: Record<string, { internal?: boolean }>;
  };
  for (const service of ["api", "worker"])
    assert.deepEqual(config.services[service].env_file ?? [], []);
  for (const [service, tag] of [
    ["migrate", "migrate"],
    ["api", "api"],
    ["worker", "worker"],
    ["web", "web"],
  ])
    assert.equal(config.services[service].image, `anar-proof-test:${tag}`);
  assert.equal(config.services.api.environment?.OTP_PEPPER, "synthetic-otp");
  assert.equal(config.services.worker.environment?.EMAIL_TRANSPORT, "mailpit");
  assert.equal(config.services.worker.environment?.RESEND_API_KEY, "");
  for (const service of ["api", "worker", "web"])
    assert.equal(
      config.services[service].environment?.ANAR_PUSH_ENABLED,
      "false",
    );
  for (const [service, target] of [
    ["proxy", 80],
    ["mailpit", 8025],
  ] as const) {
    const ports = config.services[service].ports ?? [];
    assert.equal(ports.length, 1);
    assert.equal(ports[0].host_ip, "127.0.0.1");
    assert.equal(ports[0].target, target);
    assert.ok(!ports[0].published || ports[0].published === "0");
  }
  const serviceNetworks = (service: string) => {
    const value = config.services[service].networks ?? {};
    return (Array.isArray(value) ? value : Object.keys(value)).sort();
  };
  for (const service of ["db", "migrate", "api", "worker", "web"])
    assert.deepEqual(serviceNetworks(service), ["default"]);
  for (const service of ["proxy", "mailpit"])
    assert.deepEqual(serviceNetworks(service), ["default", "proof_edge"]);
  assert.equal(config.networks.default.internal, true);
  assert.notEqual(config.networks.proof_edge.internal, true);
});
