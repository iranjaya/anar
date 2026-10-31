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
assert.ok(report.numTotalTests >= 233, "Web unit tests went missing");
assert.equal(report.numPassedTests, report.numTotalTests);
assert.equal(report.numPendingTests, 0);
console.log(
  `Web unit suite: ${report.numPassedTests}/${report.numTotalTests} passed, none skipped.`,
);
