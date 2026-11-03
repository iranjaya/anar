import assert from "node:assert/strict";
import { execFile } from "node:child_process";
import { createECDH, createHash } from "node:crypto";
import {
  mkdir,
  mkdtemp,
  readFile,
  rm,
  stat,
  writeFile,
} from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { test } from "node:test";
import { promisify } from "node:util";
import { buildServerRelease } from "./server-build.ts";
import { bundleFiles, createServerBundle } from "./server-bundle.ts";
import { createServerEnv } from "./server-env.ts";
import {
  type Command,
  imageNames,
  releaseEnvironment,
  repository,
  type ServerRelease,
  validateRelease,
} from "./server-release.ts";

const exec = promisify(execFile);
const revision = "b".repeat(40);
const digest = `sha256:${"a".repeat(64)}`;
const release = (): ServerRelease => ({
  version: 1,
  revision,
  platform: "linux/amd64",
  images: Object.fromEntries(
    imageNames.map((name) => [
      name,
      name === "postgres" || name === "recovery"
        ? `docker.io/library/postgres:17@${digest}`
        : `ghcr.io/sabinpokhrel76/anar-${name}@${digest}`,
    ]),
  ) as ServerRelease["images"],
});

test("release refuses empty, mutable and wrong registry images", () => {
  assert.deepEqual(validateRelease(release()), release());
  for (const invalid of [
    null,
    {},
    { ...release(), revision: "../bad" },
    { ...release(), platform: "linux/arm64" },
  ])
    assert.throws(() => validateRelease(invalid));
  for (const name of imageNames) {
    for (const image of [
      null,
      "postgres:17",
      `ghcr.io/other/anar-${name}@${digest}`,
      `${release().images[name]}x`,
    ]) {
      const value = release();
      assert.throws(() =>
        validateRelease({
          ...value,
          images: { ...value.images, [name]: image },
        }),
      );
    }
  }
  assert.deepEqual(
    Object.keys(releaseEnvironment(release())).sort(),
    imageNames.map((name) => `ANAR_IMAGE_${name.toUpperCase()}`).sort(),
  );
});

test("env creates fresh secrets, blank operator fields and private files", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "anar-server-env-"));
  try {
    const target = path.join(dir, "shared/production.env");
    const names = await createServerEnv(target);
    const content = await readFile(target, "utf8");
    const values = Object.fromEntries(
      content
        .trimEnd()
        .split("\n")
        .map((line) => {
          const at = line.indexOf("=");
          return [line.slice(0, at), line.slice(at + 1)];
        }),
    );
    assert.deepEqual(names, Object.keys(values));
    const passwords = [
      "POSTGRES_PASSWORD",
      "APP_DATABASE_PASSWORD",
      "MIGRATION_DATABASE_PASSWORD",
    ];
    for (const name of passwords) assert.match(values[name], /^[a-f0-9]{64}$/);
    assert.equal(new Set(passwords.map((name) => values[name])).size, 3);
    assert.equal(
      values.DATABASE_URL,
      `postgresql://anar_app:${values.APP_DATABASE_PASSWORD}@db:5432/anar`,
    );
    assert.equal(
      values.MIGRATION_DATABASE_URL,
      `postgresql://anar_migrate:${values.MIGRATION_DATABASE_PASSWORD}@db:5432/anar`,
    );
    for (const name of ["MAIL_ENCRYPTION_KEY", "OTP_PEPPER"]) {
      assert.equal(Buffer.from(values[name], "base64").length, 32);
      assert.equal(
        Buffer.from(values[name], "base64").toString("base64"),
        values[name],
      );
    }
    assert.notEqual(values.MAIL_ENCRYPTION_KEY, values.OTP_PEPPER);
    const vapid = createECDH("prime256v1");
    vapid.setPrivateKey(Buffer.from(values.VAPID_PRIVATE_KEY, "base64url"));
    assert.equal(
      vapid.getPublicKey().toString("base64url"),
      values.VAPID_PUBLIC_KEY,
    );
    assert.equal(Buffer.from(values.VAPID_PRIVATE_KEY, "base64url").length, 32);
    assert.equal(values.RESEND_API_KEY, "");
    assert.equal(values.TRUSTED_PROXY_CIDRS, "");
    assert.equal(values.ANAR_PUSH_ENABLED, "false");
    assert.equal(values.ANAR_ENV, "production");
    assert.equal(values.EMAIL_FROM, "info@visitshankhuwasabha.com");
    assert.equal(values.ANAR_LOCAL_HTTP, "false");
    assert.equal(values.PUBLIC_ORIGIN, "https://anar.visitshankhuwasabha.com");
    assert.equal(values.GHCR_PUSH_TOKEN, undefined);
    assert.equal(values.GHCR_PULL_TOKEN, undefined);
    assert.equal((await stat(target)).mode & 0o777, 0o600);
    assert.equal((await stat(path.dirname(target))).mode & 0o777, 0o700);
    await assert.rejects(createServerEnv(target));
    assert.equal(await readFile(target, "utf8"), content);
    const other = path.join(dir, "other/shared/production.env");
    await createServerEnv(other);
    assert.notEqual(await readFile(other, "utf8"), content);
    await assert.rejects(createServerEnv("relative/shared/production.env"));
    await assert.rejects(createServerEnv(path.join(dir, "production.env")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("env CLI prints names only and does not read local env or keychain", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "anar-server-env-cli-"));
  try {
    await writeFile(
      path.join(dir, ".env"),
      "RESEND_API_KEY=synthetic-canary\n",
    );
    const { stdout, stderr } = await exec(
      process.execPath,
      [
        path.join(repository, "scripts/server-env.ts"),
        path.join(dir, "shared/production.env"),
      ],
      { cwd: dir },
    );
    assert.equal(stderr, "");
    assert.ok(
      stdout
        .trim()
        .split("\n")
        .every((line) => /^[A-Z_]+$/.test(line)),
    );
    assert.equal(stdout.includes("synthetic-canary"), false);
    const generated = await readFile(
      path.join(dir, "shared/production.env"),
      "utf8",
    );
    assert.equal(generated.includes("synthetic-canary"), false);
    assert.match(generated, /^RESEND_API_KEY=$/m);
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("build records only verified amd64 digests and never logs in", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "anar-server-build-test-"));
  const calls: { command: string; args: string[] }[] = [];
  try {
    await mkdir(path.join(dir, "ops"));
    const result = await buildServerRelease(dir, async (command, args) => {
      calls.push({ command, args });
      if (command === "git") return args[0] === "rev-parse" ? revision : "";
      if (args[1] === "build") {
        await writeFile(
          args[args.indexOf("--metadata-file") + 1],
          JSON.stringify({ "containerimage.digest": digest }),
        );
        return "";
      }
      if (args.includes("--raw"))
        return JSON.stringify({
          manifests: [
            {
              digest: `sha256:${"c".repeat(64)}`,
              platform: { os: "linux", architecture: "arm64" },
            },
            { digest, platform: { os: "linux", architecture: "amd64" } },
          ],
        });
      return JSON.stringify({ os: "linux", architecture: "amd64" });
    });
    assert.deepEqual(result, release());
    assert.deepEqual(
      JSON.parse(await readFile(path.join(dir, "ops/release.json"), "utf8")),
      release(),
    );
    const builds = calls.filter(({ args }) => args[1] === "build");
    assert.equal(builds.length, 4);
    for (const { args } of builds) {
      assert.equal(args[args.indexOf("--platform") + 1], "linux/amd64");
      assert.ok(args.includes("--push"));
      assert.ok(args.includes("--provenance=false"));
      assert.match(
        args[args.indexOf("--tag") + 1],
        /^ghcr.io\/sabinpokhrel76\/anar-(web|api|worker|migrate):[a-f0-9]{40}$/,
      );
    }
    assert.ok(
      calls.every(
        ({ command, args }) =>
          ["git", "docker"].includes(command) && !args.includes("login"),
      ),
    );
    assert.equal(
      calls.filter(({ args }) => args.includes("--format")).length,
      5,
    );
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("failed builds and wrong architecture leave the release untouched", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "anar-server-build-fail-"));
  try {
    await mkdir(path.join(dir, "ops"));
    const manifest = path.join(dir, "ops/release.json");
    await writeFile(manifest, "old release");
    for (const failure of ["dirty", "push", "digest", "platform", "changed"]) {
      let statusReads = 0;
      await assert.rejects(
        buildServerRelease(dir, async (command, args) => {
          if (command === "git") {
            if (args[0] === "rev-parse") return revision;
            statusReads++;
            return failure === "dirty" ||
              (failure === "changed" && statusReads > 1)
              ? " M source.ts"
              : "";
          }
          if (args[1] === "build") {
            if (failure === "push") throw new Error("synthetic push failed");
            await writeFile(
              args[args.indexOf("--metadata-file") + 1],
              JSON.stringify({
                "containerimage.digest": failure === "digest" ? "bad" : digest,
              }),
            );
            return "";
          }
          if (args.includes("--raw"))
            return JSON.stringify({
              manifests: [
                { digest, platform: { os: "linux", architecture: "amd64" } },
              ],
            });
          return JSON.stringify({
            os: "linux",
            architecture: failure === "platform" ? "arm64" : "amd64",
          });
        }),
      );
      assert.equal(await readFile(manifest, "utf8"), "old release");
    }
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});

test("bundle copies the allowlist with checksums and never replaces a release", async () => {
  const dir = await mkdtemp(path.join(tmpdir(), "anar-server-bundle-"));
  try {
    const root = path.join(dir, "source");
    const snapshotFiles = new Map<string, string>();
    for (const file of bundleFiles) {
      await mkdir(path.dirname(path.join(root, file)), { recursive: true });
      await writeFile(
        path.join(root, file),
        file === "ops/release.json"
          ? JSON.stringify(release())
          : `synthetic ${file}`,
      );
      snapshotFiles.set(file, await readFile(path.join(root, file), "utf8"));
    }
    await writeFile(path.join(root, ".env"), "DO_NOT_COPY=synthetic-canary");
    let failSnapshot = false;
    const snapshot: Command = async (command, args) => {
      assert.equal(command, "git");
      assert.equal(args[0], "show");
      assert.ok(args[1].startsWith(`${revision}:`));
      if (failSnapshot) throw new Error("Source revision is unavailable");
      const content = snapshotFiles.get(args[1].slice(revision.length + 1));
      assert.ok(content);
      return content;
    };
    await writeFile(
      path.join(root, "compose.yml"),
      "unreleased working tree change",
    );
    const target = await createServerBundle(
      root,
      path.join(dir, "releases"),
      snapshot,
    );
    assert.equal(target, path.join(dir, "releases", revision));
    const sums = (await readFile(path.join(target, "SHA256SUMS"), "utf8"))
      .trim()
      .split("\n");
    assert.equal(sums.length, bundleFiles.length);
    for (const file of bundleFiles) {
      const hash = createHash("sha256")
        .update(await readFile(path.join(target, file)))
        .digest("hex");
      assert.ok(sums.includes(`${hash}  ${file}`));
    }
    await assert.rejects(stat(path.join(target, ".env")));
    await assert.rejects(
      createServerBundle(root, path.join(dir, "releases"), snapshot),
    );
    assert.equal(
      await readFile(path.join(target, "compose.yml"), "utf8"),
      "synthetic compose.yml",
    );
    failSnapshot = true;
    await assert.rejects(
      createServerBundle(root, path.join(dir, "failed"), snapshot),
    );
    await assert.rejects(stat(path.join(dir, "failed", revision)));
    await writeFile(path.join(root, "ops/release.json"), "{}");
    await assert.rejects(
      createServerBundle(root, path.join(dir, "invalid"), snapshot),
    );
    await assert.rejects(stat(path.join(dir, "invalid")));
  } finally {
    await rm(dir, { recursive: true, force: true });
  }
});
