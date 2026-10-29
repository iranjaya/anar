import assert from "node:assert/strict";
import { existsSync, readdirSync, readFileSync } from "node:fs";
import { createRequire } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";

const root = fileURLToPath(new URL("../", import.meta.url));
const packages = ["apps", "packages"].flatMap((group) =>
  readdirSync(path.join(root, group)).map((name) => {
    const dir = path.join(root, group, name);
    const manifest = JSON.parse(
      readFileSync(path.join(dir, "package.json"), "utf8"),
    );
    return { dir, manifest };
  }),
);
const byName = new Map(packages.map((pkg) => [pkg.manifest.name, pkg]));
for (const { dir, manifest } of packages) {
  const require = createRequire(path.join(dir, "package.json"));
  for (const [name, version] of Object.entries(manifest.dependencies ?? {})) {
    if (version !== "workspace:*") continue;
    const target = byName.get(name);
    assert.ok(
      target,
      `Missing runtime package ${name} used by ${manifest.name}`,
    );
    for (const entry of Object.keys(target.manifest.exports ?? {}))
      require.resolve(`${name}${entry.slice(1)}`);
  }
  function checkTargets(value: unknown) {
    if (typeof value === "string")
      assert.ok(
        existsSync(path.resolve(dir, value)),
        `${manifest.name}: missing built export ${value}`,
      );
    else if (value && typeof value === "object")
      for (const child of Object.values(value)) checkTargets(child);
  }
  checkTargets(manifest.exports);
}
console.log("Built workspace exports and runtime dependencies resolved.");
