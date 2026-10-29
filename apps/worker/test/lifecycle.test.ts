import { spawn } from "node:child_process";
import { once } from "node:events";
import { setTimeout as delay } from "node:timers/promises";
import { fileURLToPath } from "node:url";
import { describe, expect, it } from "vitest";
import { startWorker } from "../src/main.js";

describe("worker lifecycle", () => {
  it("returns when the signal is already aborted", async () => {
    await startWorker(AbortSignal.abort());
  });

  it("stays running until aborted", async () => {
    const controller = new AbortController();
    let stopped = false;
    const running = startWorker(controller.signal).then(() => {
      stopped = true;
    });
    try {
      await delay(50);
      expect(stopped).toBe(false);
    } finally {
      controller.abort();
      await running;
    }
    expect(stopped).toBe(true);
  });

  it.each(["SIGTERM", "SIGINT"] as const)(
    "keeps the compiled worker alive and exits 0 on %s",
    async (signal) => {
      const env = { ...process.env };
      delete env.NODE_OPTIONS;
      delete env.DATABASE_URL;
      const child = spawn(
        process.execPath,
        [fileURLToPath(new URL("../dist/main.js", import.meta.url))],
        { env, stdio: ["ignore", "pipe", "pipe"] },
      );
      let stderr = "";
      child.stderr.on("data", (chunk: Buffer) => {
        stderr += chunk.toString();
      });
      const closed = once(child, "close");
      try {
        await delay(500);
        expect(child.exitCode).toBeNull();
        expect(child.signalCode).toBeNull();
        expect(child.kill(signal)).toBe(true);
        await expect
          .poll(() => child.exitCode ?? child.signalCode, {
            timeout: 3000,
          })
          .not.toBeNull();
        expect(await closed).toEqual([0, null]);
        expect(stderr).toBe("");
      } finally {
        if (child.exitCode === null && child.signalCode === null) {
          child.kill("SIGKILL");
        }
        await closed;
      }
    },
  );
});
