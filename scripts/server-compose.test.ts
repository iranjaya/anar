import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import {
  copyFile,
  mkdir,
  mkdtemp,
  readFile,
  rm,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { serverCompose } from "./server-compose.ts";
import { createServerEnv } from "./server-env.ts";
import {
  imageNames,
  releaseEnvironment,
  repository,
  type ServerRelease,
} from "./server-release.ts";

const run = promisify(execFile);
const release: ServerRelease = {
  version: 1,
  revision: "b".repeat(40),
  platform: "linux/amd64",
  images: Object.fromEntries(
    imageNames.map((name) => [
      name,
      `${name === "postgres" || name === "recovery" ? "docker.io/library/postgres:17" : `ghcr.io/sabinpokhrel76/anar-${name}`}@sha256:${"a".repeat(64)}`,
    ]),
  ) as ServerRelease["images"],
};

test("server Compose quietly validates synthetic env and enforces production limits", async () => {
  const directory = await mkdtemp(path.join(tmpdir(), "anar-server-compose-"));
  try {
    for (const file of ["compose.yml", "compose.server.yml"])
      await copyFile(path.join(repository, file), path.join(directory, file));
    await writeFile(
      path.join(directory, ".env"),
      "POSTGRES_PASSWORD=must-not-read-local\nANAR_IMAGE_API=wrong:mutable\n",
    );
    const runtime = path.join(directory, "shared/production.env");
    await createServerEnv(runtime);
    const synthetic = (await readFile(runtime, "utf8"))
      .replace("RESEND_API_KEY=\n", "RESEND_API_KEY=synthetic-resend\n")
      .replace("TRUSTED_PROXY_CIDRS=\n", "TRUSTED_PROXY_CIDRS=172.18.0.4/32\n");
    await writeFile(runtime, synthetic);
    const args = [
      "compose",
      "--project-name",
      "anar-server-config-test",
      "--env-file",
      runtime,
      "--file",
      path.join(directory, "compose.yml"),
      "--file",
      path.join(directory, "compose.server.yml"),
      "config",
    ];
    const options = {
      cwd: directory,
      env: {
        PATH: process.env.PATH,
        HOME: process.env.HOME,
        ...releaseEnvironment(release),
      },
      maxBuffer: 1024 * 1024,
    };
    const quiet = await run("docker", [...args, "--quiet"], options);
    assert.equal(quiet.stdout, "");
    assert.equal(quiet.stderr, "");
    const { stdout } = await run(
      "docker",
      [...args, "--format", "json"],
      options,
    );
    const config = JSON.parse(stdout) as {
      services: Record<
        string,
        {
          image: string;
          build?: unknown;
          ports?: unknown[];
          env_file?: unknown[];
          mem_limit: string;
          memswap_limit: string;
          restart: string;
          stop_grace_period: string;
          environment: Record<string, string>;
          networks: Record<string, { aliases?: string[] }>;
          healthcheck?: { test: string[] };
          depends_on?: Record<string, { condition: string }>;
          volumes?: { target: string; read_only?: boolean }[];
          command?: string[];
          logging: { options: Record<string, string> };
        }
      >;
      networks: Record<
        string,
        { name: string; external?: boolean; internal?: boolean }
      >;
      volumes: Record<string, unknown>;
    };
    assert.deepEqual(Object.keys(config.services).sort(), [
      "api",
      "db",
      "migrate",
      "web",
      "worker",
    ]);
    for (const [name, service] of Object.entries(config.services)) {
      assert.equal(service.build, undefined);
      assert.deepEqual(service.ports ?? [], []);
      assert.deepEqual(service.env_file ?? [], []);
      assert.equal(service.mem_limit, service.memswap_limit);
      assert.equal(service.stop_grace_period, "2m30s");
      assert.equal(
        service.restart,
        name === "migrate" ? "no" : "unless-stopped",
      );
      assert.deepEqual(service.logging.options, {
        "max-file": "3",
        "max-size": "10m",
      });
      assert.equal(
        service.image,
        release.images[
          name === "db"
            ? "postgres"
            : (name as "api" | "worker" | "web" | "migrate")
        ],
      );
      assert.equal(service.environment.GHCR_PUSH_TOKEN, undefined);
      assert.equal(service.environment.GHCR_PULL_TOKEN, undefined);
      if (name !== "worker")
        assert.equal(service.environment.VAPID_PRIVATE_KEY, undefined);
      if (name !== "db")
        assert.equal(service.environment.POSTGRES_PASSWORD, undefined);
      if (name !== "migrate")
        assert.equal(service.environment.MIGRATION_DATABASE_URL, undefined);
      if (name !== "migrate") assert.ok(service.healthcheck?.test.length);
    }
    for (const [name, mb] of [
      ["db", 512],
      ["api", 384],
      ["web", 256],
      ["worker", 256],
      ["migrate", 256],
    ] as const)
      assert.equal(Number(config.services[name].mem_limit), mb * 1024 * 1024);
    for (const name of ["db", "migrate", "worker"])
      assert.deepEqual(Object.keys(config.services[name].networks), [
        "default",
      ]);
    for (const name of ["api", "web"]) {
      assert.deepEqual(Object.keys(config.services[name].networks).sort(), [
        "default",
        "ingress",
      ]);
      assert.deepEqual(config.services[name].networks.ingress.aliases, [
        `anar-${name}`,
      ]);
    }
    assert.equal(config.networks.ingress.name, "docker_investment-network");
    assert.equal(config.networks.ingress.external, true);
    assert.notEqual(config.networks.default.internal, true);
    const api = config.services.api;
    const worker = config.services.worker;
    const web = config.services.web;
    assert.equal(api.environment.TRUSTED_PROXY_CIDRS, "172.18.0.4/32");
    assert.equal(api.environment.ANAR_LOCAL_HTTP, "false");
    assert.equal(api.environment.NODE_OPTIONS, "--max-old-space-size=256");
    for (const name of ["api", "web", "worker"]) {
      assert.equal(config.services[name].environment.ANAR_ENV, "production");
      assert.equal(
        config.services[name].environment.ANAR_PUSH_ENABLED,
        "false",
      );
    }
    assert.equal(web.environment.API_INTERNAL_URL, "http://anar-api:3001");
    assert.equal(web.environment.ANAR_AUTH_ENABLED, "true");
    assert.equal(web.environment.ANAR_DATA_MODE, "real");
    assert.equal(worker.environment.EMAIL_TRANSPORT, "resend");
    assert.equal(
      worker.volumes?.find(
        (volume) => volume.target === "/var/lib/anar/uploads",
      )?.read_only,
      true,
    );
    assert.equal(
      config.services.db.environment.POSTGRES_PASSWORD.includes(
        "must-not-read-local",
      ),
      false,
    );
    assert.ok(config.services.db.command?.includes("shared_buffers=128MB"));
    assert.ok(config.services.db.command?.includes("work_mem=2MB"));
    assert.deepEqual(Object.keys(config.volumes).sort(), [
      "postgres_data",
      "uploads_data",
    ]);
    assert.equal(
      api.depends_on?.migrate.condition,
      "service_completed_successfully",
    );
    assert.equal(
      worker.depends_on?.migrate.condition,
      "service_completed_successfully",
    );
    assert.equal(web.depends_on?.api.condition, "service_healthy");
    assert.ok(api.healthcheck?.test.join(" ").includes("/api/health"));
    assert.ok(worker.healthcheck?.test.join(" ").includes("workerHealthy"));
    for (const name of [
      "POSTGRES_PASSWORD",
      "APP_DATABASE_PASSWORD",
      "MIGRATION_DATABASE_PASSWORD",
      "DATABASE_URL",
      "MIGRATION_DATABASE_URL",
      "OTP_PEPPER",
      "MAIL_ENCRYPTION_KEY",
      "VAPID_PUBLIC_KEY",
      "VAPID_PRIVATE_KEY",
      "RESEND_API_KEY",
      "TRUSTED_PROXY_CIDRS",
    ]) {
      await writeFile(
        runtime,
        synthetic
          .split("\n")
          .filter((line) => !line.startsWith(`${name}=`))
          .join("\n"),
      );
      await assert.rejects(run("docker", [...args, "--quiet"], options));
    }
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
});

test("Compose runner uses manifest digests and drops inherited app credentials", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "anar-server-runner-"));
  const saved = {
    PATH: process.env.PATH,
    HOME: process.env.HOME,
    DATABASE_URL: process.env.DATABASE_URL,
  };
  try {
    await mkdir(path.join(dir, "ops"));
    await mkdir(path.join(dir, "bin"));
    await writeFile(
      path.join(dir, "ops/release.json"),
      JSON.stringify(release),
    );
    await writeFile(
      path.join(dir, "bin/docker"),
      '#!/bin/sh\nprintf "%s\\n" "$@" > "$HOME/captured-args"\n/usr/bin/env > "$HOME/captured-env"\n',
      { mode: 0o755 },
    );
    process.env.PATH = `${path.join(dir, "bin")}:${saved.PATH}`;
    process.env.HOME = dir;
    process.env.DATABASE_URL = "must-not-use-inherited";
    await assert.rejects(
      serverCompose(dir, "/synthetic/production.env", ["config"]),
    );
    for (const args of [
      ["--ansi", "never", "config"],
      ["convert"],
      ["config", "--quiet", "--output", "/synthetic/rendered.yml"],
    ])
      await assert.rejects(
        serverCompose(dir, "/synthetic/production.env", args),
      );
    await assert.rejects(
      serverCompose(dir, "relative.env", ["config", "--quiet"]),
    );
    assert.equal(
      await serverCompose(dir, "/synthetic/production.env", [
        "config",
        "--quiet",
      ]),
      0,
    );
    const captured = {
      args: (await readFile(path.join(dir, "captured-args"), "utf8"))
        .trimEnd()
        .split("\n"),
      env: Object.fromEntries(
        (await readFile(path.join(dir, "captured-env"), "utf8"))
          .trimEnd()
          .split("\n")
          .map((line) => {
            const at = line.indexOf("=");
            return [line.slice(0, at), line.slice(at + 1)];
          }),
      ),
    };
    assert.deepEqual(captured.args, [
      "compose",
      "--project-name",
      "anar-server",
      "--env-file",
      "/synthetic/production.env",
      "--file",
      path.join(dir, "compose.yml"),
      "--file",
      path.join(dir, "compose.server.yml"),
      "config",
      "--quiet",
    ]);
    assert.equal(captured.env.DATABASE_URL, undefined);
    assert.equal(captured.env.ANAR_IMAGE_API, release.images.api);
  } finally {
    for (const [name, value] of Object.entries(saved)) {
      if (value === undefined) delete process.env[name];
      else process.env[name] = value;
    }
    await rm(dir, { recursive: true, force: true });
  }
});
