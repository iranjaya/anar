import { mkdtemp, readFile, rename, rm, writeFile } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import {
  type Command,
  repository,
  runCommand,
  type ServerRelease,
  validateRelease,
} from "./server-release.ts";

export async function buildServerRelease(
  root = repository,
  run: Command = runCommand,
): Promise<ServerRelease> {
  const revision = (await run("git", ["rev-parse", "HEAD"], root)).trim();
  if (!/^[a-f0-9]{40}$/.test(revision))
    throw new Error("Invalid source revision");
  if ((await run("git", ["status", "--porcelain"], root)).trim())
    throw new Error("Commit the release source before building");
  const directory = await mkdtemp(path.join(tmpdir(), "anar-server-build-"));
  try {
    const images = {} as ServerRelease["images"];
    for (const name of ["web", "api", "worker", "migrate"] as const) {
      const image = `ghcr.io/sabinpokhrel76/anar-${name}`;
      const metadata = path.join(directory, `${name}.json`);
      await run(
        "docker",
        [
          "buildx",
          "build",
          "--platform",
          "linux/amd64",
          "--provenance=false",
          "--sbom=false",
          "--push",
          "--file",
          `apps/${name === "migrate" ? "api" : name}/Dockerfile`,
          "--target",
          name === "migrate" ? "migrate" : "runtime",
          "--tag",
          `${image}:${revision}`,
          "--metadata-file",
          metadata,
          ".",
        ],
        root,
      );
      const result = JSON.parse(await readFile(metadata, "utf8")) as Record<
        string,
        string
      >;
      const digest = result["containerimage.digest"];
      if (!/^sha256:[a-f0-9]{64}$/.test(digest ?? ""))
        throw new Error(`Missing build digest: ${name}`);
      images[name] = `${image}@${digest}`;
    }
    const index = JSON.parse(
      await run(
        "docker",
        [
          "buildx",
          "imagetools",
          "inspect",
          "docker.io/library/postgres:17",
          "--raw",
        ],
        root,
      ),
    ) as {
      manifests: {
        digest: string;
        platform: { os: string; architecture: string };
      }[];
    };
    const postgres = index.manifests.find(
      ({ platform }) =>
        platform.os === "linux" && platform.architecture === "amd64",
    );
    if (!postgres || !/^sha256:[a-f0-9]{64}$/.test(postgres.digest))
      throw new Error("Postgres 17 linux/amd64 digest is required");
    images.postgres = `docker.io/library/postgres:17@${postgres.digest}`;
    images.recovery = images.postgres;
    for (const image of new Set(Object.values(images))) {
      const config = JSON.parse(
        await run(
          "docker",
          [
            "buildx",
            "imagetools",
            "inspect",
            image,
            "--format",
            "{{json .Image}}",
          ],
          root,
        ),
      ) as { os: string; architecture: string };
      if (config.os !== "linux" || config.architecture !== "amd64")
        throw new Error("Registry image is not linux/amd64");
    }
    if (
      (await run("git", ["status", "--porcelain"], root)).trim() ||
      (await run("git", ["rev-parse", "HEAD"], root)).trim() !== revision
    )
      throw new Error("Source changed during the release build");
    const release = validateRelease({
      version: 1,
      revision,
      platform: "linux/amd64",
      images,
    });
    const pending = path.join(root, "ops/release.json.pending");
    await writeFile(pending, `${JSON.stringify(release, null, 2)}\n`, {
      flag: "wx",
    });
    await rename(pending, path.join(root, "ops/release.json"));
    return release;
  } finally {
    await rm(directory, { recursive: true, force: true });
  }
}

if (import.meta.main) {
  try {
    if (process.platform !== "darwin")
      throw new Error("Build releases on the Mac");
    await buildServerRelease();
    console.log("ops/release.json: recorded verified linux/amd64 digests");
  } catch {
    console.error("Server build failed; release manifest was not replaced");
    process.exitCode = 1;
  }
}
