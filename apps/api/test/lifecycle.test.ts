import { type ChildProcess, spawn } from "node:child_process";
import { once } from "node:events";
import { type AddressInfo, createServer } from "node:net";
import { fileURLToPath } from "node:url";
import { afterAll, afterEach, beforeAll, describe, expect, it } from "vitest";
import {
  type Postgres,
  startPostgres,
} from "../../../test/support/postgres.js";
import { createTestRuntimeConfig } from "../../../test/support/runtime-config.js";

type RunningProcess = {
  child: ChildProcess;
  closed: Promise<unknown[]>;
  stderr(): string;
};

describe("compiled API", () => {
  let postgres: Postgres;
  let config: ReturnType<typeof createTestRuntimeConfig>;
  const children: RunningProcess[] = [];

  beforeAll(async () => {
    postgres = await startPostgres();
    await postgres.bootstrap();
    await postgres.migrate();
    config = createTestRuntimeConfig(postgres.appUrl);
  }, 60000);
  afterAll(async () => {
    await postgres?.stop();
  });

  async function getFreePort(): Promise<string> {
    const server = createServer();
    server.listen(0, "127.0.0.1");
    await once(server, "listening");
    const port = String((server.address() as AddressInfo).port);
    expect(Number(port)).not.toBeOneOf([3000, 3001, 3100]);
    await new Promise<void>((resolve, reject) => {
      server.close((error) => (error ? reject(error) : resolve()));
    });
    return port;
  }

  function startProcess(
    entry = new URL("../dist/main.js", import.meta.url),
    port?: string,
    overrides: NodeJS.ProcessEnv = {},
  ): RunningProcess {
    const env: NodeJS.ProcessEnv = { ...process.env, ...config };
    delete env.PORT;
    if (port !== undefined) env.PORT = port;
    const child = spawn(process.execPath, [fileURLToPath(entry)], {
      cwd: fileURLToPath(new URL("..", import.meta.url)),
      env: { ...env, ...overrides },
      stdio: ["ignore", "pipe", "pipe"],
    });
    let stderr = "";
    child.stderr.on("data", (chunk: Buffer) => {
      stderr += chunk.toString();
    });
    const running = {
      child,
      closed: once(child, "close"),
      stderr: () => stderr,
    };
    children.push(running);
    return running;
  }

  async function waitForExit(process: ReturnType<typeof startProcess>) {
    await expect
      .poll(() => process.child.exitCode ?? process.child.signalCode, {
        timeout: 5000,
      })
      .not.toBeNull();
    return process.closed;
  }

  async function waitForHealth(
    process: ReturnType<typeof startProcess>,
    port: string,
  ) {
    await expect
      .poll(
        async () => {
          if (
            process.child.exitCode !== null ||
            process.child.signalCode !== null
          ) {
            throw new Error(process.stderr());
          }
          const response = await fetch(`http://127.0.0.1:${port}/api/health`, {
            signal: AbortSignal.timeout(250),
            headers: { connection: "close" },
          });
          return { status: response.status, body: await response.json() };
        },
        { timeout: 5000 },
      )
      .toEqual({
        status: 200,
        body: { status: "ok", service: "api" },
      });
  }

  afterEach(async () => {
    for (const process of children.splice(0)) {
      if (
        process.child.exitCode === null &&
        process.child.signalCode === null
      ) {
        process.child.kill("SIGKILL");
      }
      await process.closed;
    }
  });

  it.each(["SIGTERM", "SIGINT"] as const)(
    "starts with required config and exits 0 on %s",
    async (signal) => {
      const port = await getFreePort();
      const process = startProcess(undefined, port);
      await waitForHealth(process, port);
      expect(process.child.kill(signal)).toBe(true);
      expect(await waitForExit(process)).toEqual([0, null]);
      expect(process.stderr()).toBe("");
    },
  );

  it("fails cleanly when the port is occupied", async () => {
    const occupied = createServer();
    try {
      occupied.listen(0, "127.0.0.1");
      await once(occupied, "listening");
      const port = String((occupied.address() as AddressInfo).port);
      const process = startProcess(undefined, port);
      expect(await waitForExit(process)).toEqual([1, null]);
      expect(process.stderr()).toBe("API startup failed\n");
    } finally {
      await new Promise<void>((resolve, reject) => {
        occupied.close((error) => (error ? reject(error) : resolve()));
      });
    }
  });

  it.each(["", "0", "-1", "65536", "3001.5", "wrong"])(
    "rejects invalid PORT %j",
    async (port) => {
      const process = startProcess(undefined, port);
      expect(await waitForExit(process)).toEqual([1, null]);
      expect(process.stderr()).toBe("API startup failed\n");
    },
  );

  it.each([
    "DATABASE_URL",
    "OTP_PEPPER",
    "MAIL_ENCRYPTION_KEY",
    "PUBLIC_ORIGIN",
    "ANAR_LOCAL_HTTP",
  ])("refuses missing %s with a local HTTP origin", async (name) => {
    const process = startProcess(undefined, await getFreePort(), {
      [name]: "",
    });
    expect(await waitForExit(process)).toEqual([1, null]);
    expect(process.stderr()).toBe("API startup failed\n");
  });

  it("refuses to start the worker without its DB URL", async () => {
    const worker = startProcess(
      new URL("../../worker/dist/main.js", import.meta.url),
      undefined,
      { DATABASE_URL: "" },
    );
    expect(await waitForExit(worker)).toEqual([1, null]);
    expect(worker.stderr()).toBe("Worker stopped after a runtime failure\n");
  });
});
