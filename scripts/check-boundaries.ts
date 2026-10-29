import { existsSync, readdirSync, readFileSync, realpathSync } from "node:fs";
import { isBuiltin } from "node:module";
import path from "node:path";
import { fileURLToPath } from "node:url";
import * as ast from "typescript/unstable/ast";
import { API } from "typescript/unstable/sync";

type Manifest = {
  name: string;
  exports?: Record<string, unknown>;
  dependencies?: Record<string, string>;
  devDependencies?: Record<string, string>;
  peerDependencies?: Record<string, string>;
  optionalDependencies?: Record<string, string>;
};
const allowed: Record<string, string[]> = {
  "@anar/web": ["@anar/domain"],
  "@anar/api": ["@anar/domain", "@anar/db"],
  "@anar/worker": ["@anar/domain", "@anar/db", "@anar/api"],
  "@anar/db": ["@anar/domain"],
  "@anar/domain": [],
};
const ignored = new Set([
  "node_modules",
  ".next",
  ".cache",
  "dist",
  "out",
  "coverage",
  "test-results",
  "playwright-report",
  "blob-report",
]);
const backend = /^(pg|drizzle-orm|drizzle-kit|pg-boss)(\/|$)/;
const credentials =
  /^(DATABASE_URL|MIGRATION_DATABASE_URL|POSTGRES_\w+|APP_DATABASE_\w+|MIGRATION_DATABASE_\w+|MAIL_ENCRYPTION_KEY|RESEND_API_KEY|OTP_PEPPER)$/;

function files(dir: string): string[] {
  return readdirSync(dir, { withFileTypes: true }).flatMap((entry) => {
    if (ignored.has(entry.name)) return [];
    const file = path.join(dir, entry.name);
    if (entry.isDirectory()) return files(file);
    return /\.(?:[cm]?[jt]sx?)$/.test(file) && entry.name !== "next-env.d.ts"
      ? [file]
      : [];
  });
}

export function checkBoundaries(root: string): string[] {
  root = realpathSync(root);
  const packages = ["apps", "packages"].flatMap((group) =>
    readdirSync(path.join(root, group)).flatMap((name) => {
      const dir = path.join(root, group, name);
      if (!existsSync(path.join(dir, "package.json"))) return [];
      const manifest: Manifest = JSON.parse(
        readFileSync(path.join(dir, "package.json"), "utf8"),
      );
      return [{ dir, manifest, files: files(dir) }];
    }),
  );
  const errors: string[] = [];
  const report = (file: string, message: string) => {
    errors.push(`${path.relative(root, file)}: ${message}`);
  };
  const owner = (file: string) =>
    packages.find(
      (pkg) => file === pkg.dir || file.startsWith(`${pkg.dir}${path.sep}`),
    );
  function exportPaths(value: unknown): string[] {
    if (typeof value === "string") return [value];
    if (value && typeof value === "object")
      return Object.values(value).flatMap(exportPaths);
    return [];
  }
  const graph = new Map<string, string[]>();
  for (const pkg of packages) {
    const { manifest } = pkg;
    const manifestFile = path.join(pkg.dir, "package.json");
    if (!allowed[manifest.name])
      report(manifestFile, `Unknown workspace package ${manifest.name}`);
    for (const [entry, targets] of Object.entries(manifest.exports ?? {})) {
      if (entry.includes("*") || JSON.stringify(targets).includes("*"))
        report(
          manifestFile,
          `Wildcard export ${entry} bypasses public entries`,
        );
      for (const target of exportPaths(targets)) {
        if (
          !target.startsWith("./") ||
          owner(path.resolve(pkg.dir, target)) !== pkg
        )
          report(
            manifestFile,
            `Export ${entry} escapes the package: ${target}`,
          );
      }
    }
    const dependencies = {
      ...manifest.dependencies,
      ...manifest.devDependencies,
      ...manifest.peerDependencies,
      ...manifest.optionalDependencies,
    };
    graph.set(manifest.name, []);
    for (const [name, version] of Object.entries(dependencies)) {
      const dependencyName = version.startsWith("npm:")
        ? version.slice(4).replace(/@[^@/]*$/, "")
        : name;
      const target = packages.find(
        (candidate) => candidate.manifest.name === dependencyName,
      );
      if (
        target ||
        name.startsWith("@anar/") ||
        /^(workspace:|file:|link:)/.test(version)
      ) {
        graph.get(manifest.name)?.push(dependencyName);
        if (
          !target ||
          !allowed[manifest.name]?.includes(name) ||
          version !== "workspace:*"
        )
          report(manifestFile, `Forbidden dependency ${name} (${version})`);
      }
      if (manifest.name === "@anar/web" && backend.test(dependencyName))
        report(manifestFile, `Forbidden backend dependency ${name}`);
      if (
        manifest.name === "@anar/db" &&
        /^(next|react|react-dom|server-only)(\/|$)/.test(dependencyName)
      )
        report(manifestFile, `Forbidden server/UI dependency ${name}`);
    }
    for (const name of Object.keys({
      ...manifest.dependencies,
      ...manifest.optionalDependencies,
      ...manifest.peerDependencies,
    })) {
      if (manifest.name === "@anar/domain" && name !== "zod")
        report(manifestFile, `Domain runtime dependency must be zod: ${name}`);
    }
  }
  function visitPackage(name: string, ancestors: string[]) {
    if (ancestors.includes(name)) {
      errors.push(`Package cycle: ${[...ancestors, name].join(" -> ")}`);
      return;
    }
    for (const target of graph.get(name) ?? [])
      visitPackage(target, [...ancestors, name]);
  }
  for (const name of graph.keys()) visitPackage(name, []);

  const api = new API({ cwd: root });
  try {
    const snapshot = api.updateSnapshot({
      openFiles: packages.flatMap((pkg) => pkg.files),
    });
    for (const pkg of packages) {
      for (const file of pkg.files) {
        const project = snapshot.getDefaultProjectForFile(file);
        const source = project?.program.getSourceFile(file);
        if (!project || !source) {
          report(file, "TypeScript could not load this source");
          continue;
        }
        const local = path.relative(pkg.dir, file).replaceAll(path.sep, "/");
        const domainSource =
          pkg.manifest.name === "@anar/domain" && local.startsWith("src/");
        const fail = (node: ast.Node, message: string) => {
          const line =
            source.getLineAndCharacterOfPosition(node.getStart(source)).line +
            1;
          report(file, `${line}: ${message}`);
        };
        const inspect = (node: ast.Node) => {
          let reference: ast.Node | undefined;
          if (ast.isImportDeclaration(node) || ast.isExportDeclaration(node))
            reference = node.moduleSpecifier;
          if (ast.isExternalModuleReference(node)) reference = node.expression;
          if (
            ast.isImportTypeNode(node) &&
            ast.isLiteralTypeNode(node.argument)
          )
            reference = node.argument.literal;
          if (
            ast.isCallExpression(node) &&
            (node.expression.kind === ast.SyntaxKind.ImportKeyword ||
              (ast.isIdentifier(node.expression) &&
                node.expression.text === "require"))
          )
            reference = node.arguments[0] ?? node;
          if (reference) {
            if (
              !ast.isStringLiteral(reference) &&
              !ast.isNoSubstitutionTemplateLiteral(reference)
            ) {
              fail(
                reference,
                "Use a literal module path; computed loading cannot be checked",
              );
            } else {
              const specifier = reference.text;
              const name = specifier.startsWith("@")
                ? specifier.split("/").slice(0, 2).join("/")
                : specifier.split("/")[0];
              const targetPackage = packages.find(
                (candidate) => candidate.manifest.name === name,
              );
              if (targetPackage) {
                const entry = `.${specifier.slice(name.length)}`;
                if (
                  pkg !== targetPackage &&
                  (!allowed[pkg.manifest.name]?.includes(name) ||
                    !pkg.manifest.dependencies?.[name])
                )
                  fail(reference, `Forbidden workspace import ${specifier}`);
                if (!(entry in (targetPackage.manifest.exports ?? {})))
                  fail(
                    reference,
                    `Use a public export of ${name}: ${specifier}`,
                  );
              } else if (specifier.startsWith("@anar/"))
                fail(reference, `Unknown workspace import ${specifier}`);
              const declaration = project.checker
                .getSymbolAtLocation(reference)
                ?.declarations[0]?.resolve();
              let resolved = declaration?.getSourceFile().fileName;
              if (!resolved) {
                for (const [alias, targets] of Object.entries(
                  project.compilerOptions.paths ?? {},
                )) {
                  const [prefix, suffix = ""] = alias.split("*");
                  if (
                    alias.includes("*")
                      ? !specifier.startsWith(prefix) ||
                        !specifier.endsWith(suffix)
                      : specifier !== alias
                  )
                    continue;
                  const match = specifier.slice(
                    prefix.length,
                    specifier.length - suffix.length,
                  );
                  for (const candidate of targets) {
                    const target = path.resolve(
                      path.dirname(project.configFileName),
                      candidate.replace("*", match),
                    );
                    resolved =
                      [
                        target,
                        `${target}.ts`,
                        `${target}.tsx`,
                        `${target}.d.ts`,
                        path.join(target, "index.ts"),
                      ].find(existsSync) ?? target;
                    if (existsSync(resolved)) break;
                  }
                  break;
                }
              }
              if (
                !resolved &&
                (specifier.startsWith(".") || path.isAbsolute(specifier))
              )
                resolved = path.resolve(path.dirname(file), specifier);
              if (resolved && existsSync(resolved))
                resolved = realpathSync(resolved);
              const target = resolved ? owner(resolved) : undefined;
              const platformEntry =
                specifier === "@anar/db/platform" ||
                (target?.manifest.name === "@anar/db" &&
                  /\/(?:src|dist)\/(?:platform|tenantScope|schema\/(?:agencies|platform|audit|authLimits|index))\.(?:d\.)?[cm]?[jt]s$/.test(
                    resolved?.replaceAll(path.sep, "/") ?? "",
                  ));
              if (
                platformEntry &&
                pkg.manifest.name !== "@anar/db" &&
                !(
                  pkg.manifest.name === "@anar/api" &&
                  /^(?:src\/modules\/(?:agencies|auth|companies|tenant)\/|src\/modules\/notifications\/subscriptions(?:\/|\.ts$)|test\/(?:agencies|auth|companies|tenant)\/)/.test(
                    local,
                  )
                )
              )
                fail(reference, "Platform DB is restricted to platform owners");
              const queueEntry =
                specifier === "@anar/db/queue" ||
                (target?.manifest.name === "@anar/db" &&
                  /\/(?:src|dist)\/queue\.(?:ts|js|d\.ts)$/.test(
                    resolved?.replaceAll(path.sep, "/") ?? "",
                  ));
              if (
                queueEntry &&
                pkg.manifest.name !== "@anar/db" &&
                !(
                  (pkg.manifest.name === "@anar/api" &&
                    /^(src\/lib\/jobs\/|test\/jobs\/)/.test(local)) ||
                  (pkg.manifest.name === "@anar/worker" &&
                    /^(src\/main\.ts$|test\/)/.test(local))
                )
              )
                fail(
                  reference,
                  "Queue DB is restricted to jobs and worker composition",
                );
              const external = resolved
                ?.replaceAll(path.sep, "/")
                .match(/node_modules\/((?:@[^/]+\/)?[^/]+)/g)
                ?.at(-1)
                ?.slice("node_modules/".length);
              if (resolved && targetPackage && pkg !== targetPackage) {
                const entry = `.${specifier.slice(name.length)}`;
                const publicPaths = exportPaths(
                  targetPackage.manifest.exports?.[entry],
                ).map((value) => path.resolve(targetPackage.dir, value));
                if (!publicPaths.includes(resolved))
                  fail(
                    reference,
                    `Workspace import ${specifier} resolves outside its public export: ${path.relative(root, resolved)}`,
                  );
              }
              if (
                resolved &&
                target !== pkg &&
                !targetPackage &&
                !resolved.includes(`${path.sep}node_modules${path.sep}`) &&
                !(
                  local.startsWith("test/") &&
                  ["@anar/api", "@anar/worker", "@anar/db"].includes(
                    pkg.manifest.name,
                  ) &&
                  resolved.startsWith(path.join(root, "test/support/"))
                )
              )
                fail(
                  reference,
                  `Cross-package path ${specifier} -> ${path.relative(root, resolved)}; use a public workspace export`,
                );
              if (pkg.manifest.name === "@anar/web") {
                if (
                  backend.test(specifier) ||
                  (external && backend.test(external))
                )
                  fail(reference, `Forbidden backend import ${specifier}`);
                if (resolved && target === pkg) {
                  const to = path
                    .relative(pkg.dir, resolved)
                    .replaceAll(path.sep, "/");
                  const fromModule = local.match(/^modules\/([^/]+)\//)?.[1];
                  const toModule = to.match(/^modules\/([^/]+)\/(.+)/);
                  if (
                    to.startsWith("mock/") &&
                    !local.startsWith("mock/") &&
                    !/^modules\/[^/]+\/data\//.test(local)
                  )
                    fail(reference, `Only module data files may import ${to}`);
                  if (
                    /^(components|lib)\//.test(local) &&
                    to.startsWith("modules/")
                  )
                    fail(reference, `Shared code must not import ${to}`);
                  if (
                    toModule &&
                    fromModule !== toModule[1] &&
                    !/^(server|actions|components|pages|types)\.[cm]?[jt]sx?$/.test(
                      toModule[2],
                    )
                  )
                    fail(reference, `Use the public module entry for ${to}`);
                }
              }
              if (
                domainSource &&
                ((!targetPackage &&
                  !specifier.startsWith(".") &&
                  name !== "zod") ||
                  (external && external !== "zod"))
              )
                fail(
                  reference,
                  `Domain may only import zod or its own entries: ${specifier}`,
                );
              if (
                pkg.manifest.name === "@anar/db" &&
                /^(next|react|react-dom|server-only)(\/|$)/.test(
                  external ?? specifier,
                )
              )
                fail(reference, `Forbidden server/UI import ${specifier}`);
              if (domainSource && isBuiltin(specifier))
                fail(
                  reference,
                  `Domain cannot import Node built-ins: ${specifier}`,
                );
            }
          }
          if (
            domainSource &&
            ((ast.isIdentifier(node) &&
              ["process", "Deno", "Bun"].includes(node.text)) ||
              (ast.isPropertyAccessExpression(node) &&
                node.name.text === "env") ||
              (ast.isElementAccessExpression(node) &&
                ast.isStringLiteral(node.argumentExpression) &&
                node.argumentExpression.text === "env"))
          )
            fail(node, "Domain cannot access the environment");
          if (
            pkg.manifest.name === "@anar/web" &&
            ((ast.isIdentifier(node) && credentials.test(node.text)) ||
              (ast.isStringLiteral(node) && credentials.test(node.text)))
          )
            fail(node, "Web cannot access backend credentials");
          node.forEachChild(inspect);
        };
        inspect(source);
      }
    }
    snapshot.dispose();
  } finally {
    api.close();
  }
  return errors;
}

if (import.meta.main) {
  const errors = checkBoundaries(
    fileURLToPath(new URL("../", import.meta.url)),
  );
  for (const error of errors) console.error(error);
  if (errors.length) process.exitCode = 1;
  else console.log("Workspace boundaries passed.");
}
