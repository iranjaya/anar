import assert from "node:assert/strict";
import {
  mkdirSync,
  mkdtempSync,
  rmSync,
  symlinkSync,
  writeFileSync,
} from "node:fs";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { checkBoundaries } from "./check-boundaries.ts";

function fixture(source: string, change?: (root: string) => void): string[] {
  const root = mkdtempSync(path.join(tmpdir(), "anar-boundaries-"));
  const write = (file: string, value: unknown) => {
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(
      path.join(root, file),
      typeof value === "string" ? value : JSON.stringify(value),
    );
  };
  try {
    for (const [name, group] of [
      ["web", "apps"],
      ["api", "apps"],
      ["worker", "apps"],
      ["db", "packages"],
      ["domain", "packages"],
    ]) {
      write(`${group}/${name}/package.json`, {
        name: `@anar/${name}`,
        dependencies: name === "web" ? { "@anar/domain": "workspace:*" } : {},
        exports: {
          "./tenant": "./src/tenant.ts",
          "./health": "./src/health.ts",
        },
      });
      write(`${group}/${name}/tsconfig.json`, {
        compilerOptions: {
          module: "esnext",
          moduleResolution: "bundler",
          paths: { "@/*": ["./*"], "@escape/*": ["../../packages/db/src/*"] },
        },
        include: ["**/*.ts"],
      });
      write(`${group}/${name}/src/tenant.ts`, "export type Tenant = string;\n");
      write(`${group}/${name}/src/health.ts`, "export type Health = string;\n");
    }
    mkdirSync(path.join(root, "apps/web/node_modules/@anar"), {
      recursive: true,
    });
    symlinkSync(
      path.join(root, "packages/domain"),
      path.join(root, "apps/web/node_modules/@anar/domain"),
    );
    write("apps/web/probe.ts", source);
    change?.(root);
    return checkBoundaries(root);
  } finally {
    rmSync(root, { recursive: true, force: true });
  }
}

for (const [name, source] of [
  ["direct import", 'import type { Tenant } from "@anar/db/tenant";'],
  [
    "relative escape",
    'import type { Tenant } from "../../packages/db/src/tenant";',
  ],
  ["alias escape", 'import type { Tenant } from "@escape/tenant";'],
  ["re-export", 'export type { Tenant } from "@anar/db/tenant";'],
  ["require", 'const db = require("../../packages/db/src/tenant");'],
  ["alias require", 'const db = require("@escape/tenant");'],
  ["dynamic import", 'void import("../../packages/db/src/tenant");'],
  ["computed import", 'const target = "@anar/db/tenant"; void import(target);'],
  [
    "import type expression",
    'type Db = import("../../packages/db/src/tenant").Tenant;',
  ],
  [
    "private domain entry",
    'import type { Health } from "@anar/domain/src/health";',
  ],
  ["backend library", 'import pg from "pg";'],
  ["backend credentials", 'const url = process.env["DATABASE_URL"];'],
] as const) {
  test(`rejects a ${name}`, () => {
    const errors = fixture(source);
    assert.ok(
      errors.some((error) => error.startsWith("apps/web/probe.ts:")),
      errors.join("\n"),
    );
  });
}

test("allows web to import a public domain entry", () => {
  assert.deepEqual(
    fixture('import type { Health } from "@anar/domain/health";'),
    [],
  );
});
test("allows imports within the same module", () => {
  assert.deepEqual(
    fixture("", (root) => {
      mkdirSync(path.join(root, "apps/web/modules/leads/data"), {
        recursive: true,
      });
      writeFileSync(
        path.join(root, "apps/web/modules/leads/data/read.ts"),
        "export const value = 1;",
      );
      writeFileSync(
        path.join(root, "apps/web/modules/leads/server.ts"),
        'export { value } from "./data/read";',
      );
    }),
    [],
  );
});
test("rejects a forbidden dependency", () => {
  assert.ok(
    fixture("", (root) =>
      writeFileSync(
        path.join(root, "apps/web/package.json"),
        JSON.stringify({
          name: "@anar/web",
          devDependencies: { "@anar/db": "workspace:*" },
        }),
      ),
    ).some((error) => error.includes("Forbidden dependency @anar/db")),
  );
});
test("rejects wildcard exports", () => {
  assert.ok(
    fixture("", (root) =>
      writeFileSync(
        path.join(root, "packages/domain/package.json"),
        JSON.stringify({
          name: "@anar/domain",
          exports: { "./*": "./src/*.ts" },
        }),
      ),
    ).some((error) => error.includes("Wildcard export")),
  );
});
test("rejects package cycles", () => {
  assert.ok(
    fixture("", (root) =>
      writeFileSync(
        path.join(root, "packages/domain/package.json"),
        JSON.stringify({
          name: "@anar/domain",
          dependencies: { "@anar/web": "workspace:*" },
        }),
      ),
    ).some((error) => error.includes("Package cycle")),
  );
});
test("rejects Node and environment access in domain", () => {
  const errors = fixture("", (root) =>
    writeFileSync(
      path.join(root, "packages/domain/src/health.ts"),
      'import fs from "node:fs"; export const secret = process.env.SECRET;',
    ),
  );
  assert.ok(errors.some((error) => error.includes("Node built-ins")));
  assert.ok(errors.some((error) => error.includes("access the environment")));
});

test("rejects an alias hiding behind a legal workspace name", () => {
  assert.ok(
    fixture('import type { Tenant } from "@anar/domain/health";', (root) => {
      writeFileSync(
        path.join(root, "apps/web/tsconfig.json"),
        JSON.stringify({
          compilerOptions: {
            moduleResolution: "bundler",
            module: "esnext",
            paths: {
              "@anar/domain/health": ["../../packages/db/src/tenant.ts"],
            },
          },
          include: ["**/*.ts"],
        }),
      );
    }).some((error) => error.includes("outside its public export")),
  );
});

test("rejects exports pointing outside their package", () => {
  assert.ok(
    fixture("", (root) =>
      writeFileSync(
        path.join(root, "packages/domain/package.json"),
        JSON.stringify({
          name: "@anar/domain",
          exports: { "./health": "../db/src/tenant.ts" },
        }),
      ),
    ).some((error) => error.includes("escapes the package")),
  );
});

test("rejects backend dependencies hidden behind npm aliases", () => {
  assert.ok(
    fixture("", (root) =>
      writeFileSync(
        path.join(root, "apps/web/package.json"),
        JSON.stringify({
          name: "@anar/web",
          dependencies: { database: "npm:pg@8.23.1" },
        }),
      ),
    ).some((error) => error.includes("Forbidden backend dependency")),
  );
});

test("rejects aliases pointing at backend libraries", () => {
  const errors = fixture(
    'import { value } from "@/node_modules/pg/index";',
    (root) => {
      mkdirSync(path.join(root, "apps/web/node_modules/pg"), {
        recursive: true,
      });
      writeFileSync(
        path.join(root, "apps/web/node_modules/pg/index.ts"),
        "export const value = 1;",
      );
    },
  );
  assert.ok(errors.some((error) => error.includes("Forbidden backend import")));
});

function restrictedDbFixture(file: string, source: string): string[] {
  return fixture("", (root) => {
    for (const name of ["api", "worker"]) {
      writeFileSync(
        path.join(root, `apps/${name}/package.json`),
        JSON.stringify({
          name: `@anar/${name}`,
          dependencies: { "@anar/db": "workspace:*" },
        }),
      );
      mkdirSync(path.join(root, `apps/${name}/node_modules/@anar`), {
        recursive: true,
      });
      symlinkSync(
        path.join(root, "packages/db"),
        path.join(root, `apps/${name}/node_modules/@anar/db`),
      );
    }
    writeFileSync(
      path.join(root, "packages/db/package.json"),
      JSON.stringify({
        name: "@anar/db",
        exports: {
          "./platform": "./src/platform.ts",
          "./queue": "./src/queue.ts",
        },
      }),
    );
    writeFileSync(
      path.join(root, "packages/db/src/platform.ts"),
      "export type PlatformTx = string;",
    );
    writeFileSync(
      path.join(root, "packages/db/src/queue.ts"),
      "export type QueueTx = string;",
    );
    mkdirSync(path.join(root, "packages/db/src/schema"), { recursive: true });
    writeFileSync(
      path.join(root, "packages/db/src/schema/audit.ts"),
      "export type Audit = string;",
    );
    mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
    writeFileSync(path.join(root, file), source);
  });
}

for (const module of [
  "auth",
  "companies",
  "tenant",
  "notifications/subscriptions",
]) {
  test(`allows ${module} to use the platform entry`, () => {
    assert.deepEqual(
      restrictedDbFixture(
        `apps/api/src/modules/${module}/probe.ts`,
        'import type { PlatformTx } from "@anar/db/platform";',
      ),
      [],
    );
  });
}

for (const source of [
  'import type { PlatformTx } from "@anar/db/platform";',
  'export type { PlatformTx } from "@anar/db/platform";',
  'type Tx = import("@anar/db/platform").PlatformTx;',
  'void import("@anar/db/platform");',
  'const db = require("@anar/db/platform");',
  'import type { PlatformTx } from "../../../../../packages/db/src/platform";',
  'import type { Audit } from "@escape/schema/audit";',
]) {
  test(`denies members platform access: ${source}`, () => {
    assert.ok(
      restrictedDbFixture("apps/api/src/modules/members/probe.ts", source).some(
        (error) => error.includes("Platform DB is restricted"),
      ),
    );
  });
}

test("denies the worker platform access", () => {
  assert.ok(
    restrictedDbFixture(
      "apps/worker/src/main.ts",
      'import type { PlatformTx } from "@anar/db/platform";',
    ).some((error) => error.includes("Platform DB is restricted")),
  );
});

test("denies auth direct queue access", () => {
  assert.ok(
    restrictedDbFixture(
      "apps/api/src/modules/auth/probe.ts",
      'import type { QueueTx } from "@anar/db/queue";',
    ).some((error) => error.includes("Queue DB is restricted")),
  );
});

test("allows jobs to use the queue entry", () => {
  assert.deepEqual(
    restrictedDbFixture(
      "apps/api/src/lib/jobs/probe.ts",
      'import type { QueueTx } from "@anar/db/queue";',
    ),
    [],
  );
});

for (const [file, allowed] of [
  ["apps/api/test/probe.ts", true],
  ["apps/api/src/probe.ts", false],
  ["apps/web/test/probe.ts", false],
] as const) {
  test(`${allowed ? "allows" : "denies"} shared test fixtures from ${file}`, () => {
    const errors = fixture("", (root) => {
      mkdirSync(path.join(root, "test/support"), { recursive: true });
      writeFileSync(
        path.join(root, "test/support/fixture.ts"),
        "export const value = 1;",
      );
      mkdirSync(path.dirname(path.join(root, file)), { recursive: true });
      writeFileSync(
        path.join(root, file),
        'import { value } from "../../../test/support/fixture";',
      );
    });
    if (allowed) assert.deepEqual(errors, []);
    else
      assert.ok(errors.some((error) => error.includes("Cross-package path")));
  });
}
