import { execFile } from "node:child_process";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";
import { describe, expect, it } from "vitest";
import { startWorker } from "../src/main.js";

describe("worker startup", () => {
  it("returns when the signal is already aborted", async () => {
    await startWorker(AbortSignal.abort());
  });

  it("requires a DB URL before opening a queue", async () => {
    await expect(
      startWorker(new AbortController().signal, { databaseUrl: "" }),
    ).rejects.toThrow("DATABASE_URL is required");
  });

  it("imports the public jobs entry without starting services", async () => {
    const result = await promisify(execFile)(
      process.execPath,
      ["--input-type=module", "-e", 'await import("@anar/api/jobs")'],
      {
        cwd: fileURLToPath(new URL("../", import.meta.url)),
        timeout: 3000,
        env: { ...process.env, DATABASE_URL: "", NODE_OPTIONS: "" },
      },
    );
    expect(result.stdout).toBe("");
    expect(result.stderr).toBe("");
  });
});
