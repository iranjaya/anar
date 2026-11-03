import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { test } from "node:test";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

const run = promisify(execFile);
type Route = { match?: { path_regexp?: { name: string } }[] };

for (const name of ["Caddyfile", "Caddyfile.local"]) {
  test(`${name} adapts with a separate fallback route`, async () => {
    const file = fileURLToPath(new URL(`../ops/${name}`, import.meta.url));
    const { stdout } = await run("docker", [
      "run",
      "--rm",
      "--network",
      "none",
      "--read-only",
      "--env",
      "ANAR_SITE_ADDRESS=anar.test",
      "--mount",
      `type=bind,source=${file},target=/config/Caddyfile,readonly`,
      "caddy:2-alpine",
      "caddy",
      "adapt",
      "--config",
      "/config/Caddyfile",
      "--adapter",
      "caddyfile",
    ]);
    let checked = false;
    const visit = (value: unknown) => {
      if (Array.isArray(value)) {
        const index = value.findIndex(
          (route: Route) =>
            Array.isArray(route?.match) &&
            route.match.some(
              (match) => match.path_regexp?.name === "importCheck",
            ),
        );
        if (index >= 0) {
          assert.ok(value[index + 1], "Missing fallback after import check");
          assert.equal(value[index + 1].match, undefined);
          checked = true;
        }
        value.forEach(visit);
      } else if (value && typeof value === "object") {
        Object.values(value).forEach(visit);
      }
    };
    visit(JSON.parse(stdout));
    assert.ok(checked, "Missing import-check route");
  });
}
