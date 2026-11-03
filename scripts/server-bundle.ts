import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import path from "node:path";
import {
  type Command,
  readRelease,
  repository,
  runCommand,
} from "./server-release.ts";

export const bundleFiles = [
  "package.json",
  "compose.yml",
  "compose.server.yml",
  "ops/release.json",
  "ops/postgres/bootstrap.sh",
  "ops/postgres/roles.sql",
  "ops/postgres/restore-grants.sql",
  "ops/nginx/anar.conf",
  "ops/nginx/anar-http.conf",
  "ops/certbot/anar.ini",
  "ops/certbot/deploy-hook.sh",
  "ops/systemd/anar-certbot.service",
  "ops/systemd/anar-certbot.timer",
  "scripts/server-release.ts",
  "scripts/server-compose.ts",
  "scripts/server-env.ts",
] as const;

export async function createServerBundle(
  root: string,
  outputRoot: string,
  run: Command = runCommand,
): Promise<string> {
  const release = await readRelease(root);
  const target = path.resolve(outputRoot, release.revision);
  await mkdir(path.dirname(target), { recursive: true, mode: 0o700 });
  await mkdir(target, { mode: 0o700 });
  try {
    const sums: string[] = [];
    for (const file of bundleFiles) {
      const destination = path.join(target, file);
      await mkdir(path.dirname(destination), { recursive: true, mode: 0o700 });
      const content =
        file === "ops/release.json"
          ? `${JSON.stringify(release, null, 2)}\n`
          : await run("git", ["show", `${release.revision}:${file}`], root);
      await writeFile(destination, content, {
        flag: "wx",
        mode: file.endsWith(".sh") ? 0o755 : 0o644,
      });
      const digest = createHash("sha256").update(content).digest("hex");
      sums.push(`${digest}  ${file}`);
    }
    await writeFile(path.join(target, "SHA256SUMS"), `${sums.join("\n")}\n`, {
      flag: "wx",
    });
    return target;
  } catch (error) {
    await rm(target, { recursive: true, force: true });
    throw error;
  }
}

if (import.meta.main) {
  try {
    const outputRoot = process.argv[2];
    if (!outputRoot)
      throw new Error("Local release output directory is required");
    console.log(await createServerBundle(repository, outputRoot));
  } catch {
    console.error(
      "Server bundle failed; check release digests and output directory",
    );
    process.exitCode = 1;
  }
}
