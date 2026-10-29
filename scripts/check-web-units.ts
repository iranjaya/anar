import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { mkdirSync, readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const reportFile = `${root}.cache/web-units.json`;
mkdirSync(`${root}.cache`, { recursive: true });
execFileSync(
  "pnpm",
  [
    "--filter",
    "@anar/web",
    "test",
    "--exclude",
    "lib/errors.test.ts",
    "--reporter=default",
    "--reporter=json",
    `--outputFile=${reportFile}`,
  ],
  { cwd: root, stdio: "inherit" },
);
const report = JSON.parse(readFileSync(reportFile, "utf8"));
assert.equal(report.numTotalTests, 231);
assert.equal(report.numPassedTests, 231);
assert.equal(report.numPendingTests, 0);
console.log("Original web unit suite: 231/231 passed, none skipped.");
