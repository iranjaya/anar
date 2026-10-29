import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import config from "../apps/web/playwright.config.ts";

type Suite = {
  suites?: Suite[];
  specs?: { tests: { projectName: string }[] }[];
};
const report = JSON.parse(
  execFileSync(
    "pnpm",
    [
      "--filter",
      "@anar/web",
      "exec",
      "playwright",
      "test",
      "--list",
      "--reporter=json",
    ],
    { encoding: "utf8" },
  ),
);
const counts: Record<string, number> = {};
function count(suite: Suite) {
  for (const spec of suite.specs ?? []) {
    for (const test of spec.tests)
      counts[test.projectName] = (counts[test.projectName] ?? 0) + 1;
  }
  for (const child of suite.suites ?? []) count(child);
}
for (const suite of report.suites) count(suite);
assert.deepEqual(counts, {
  phone: 54,
  desktop: 54,
  "phone-failure": 10,
  "desktop-failure": 10,
});
assert.equal(config.workers, 1);
assert.ok(!Array.isArray(config.webServer));
assert.equal(config.webServer?.reuseExistingServer, false);
assert.deepEqual(
  config.projects?.map(({ name, dependencies }) => ({
    name,
    dependencies: dependencies ?? [],
  })),
  [
    { name: "phone", dependencies: [] },
    { name: "desktop", dependencies: [] },
    { name: "phone-failure", dependencies: ["phone", "desktop"] },
    { name: "desktop-failure", dependencies: ["phone-failure"] },
  ],
);
console.log(
  `Playwright discovered 128 cases: ${JSON.stringify(counts)}; one worker, fresh server, serial failure projects.`,
);
