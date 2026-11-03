import { execFile } from "node:child_process";
import { readFile } from "node:fs/promises";
import { fileURLToPath } from "node:url";
import { promisify } from "node:util";

export const repository = fileURLToPath(new URL("../", import.meta.url));
export const imageNames = [
  "web",
  "api",
  "worker",
  "migrate",
  "postgres",
  "recovery",
] as const;
export type ImageName = (typeof imageNames)[number];
export type ServerRelease = {
  version: 1;
  revision: string;
  platform: "linux/amd64";
  images: Record<ImageName, string>;
};
export type Command = (
  command: string,
  args: string[],
  cwd: string,
) => Promise<string>;

const exec = promisify(execFile);
export const runCommand: Command = async (command, args, cwd) => {
  const { stdout } = await exec(command, args, {
    cwd,
    maxBuffer: 16 * 1024 * 1024,
  });
  return stdout;
};

export function validateRelease(value: unknown): ServerRelease {
  const release = value as Partial<ServerRelease> | null;
  if (
    release?.version !== 1 ||
    release.platform !== "linux/amd64" ||
    typeof release.revision !== "string" ||
    !/^[a-f0-9]{40}$/.test(release.revision) ||
    !release.images
  )
    throw new Error("Release revision and linux/amd64 digests are required");
  for (const name of imageNames) {
    const prefix =
      name === "postgres" || name === "recovery"
        ? "docker.io/library/postgres:17"
        : `ghcr.io/sabinpokhrel76/anar-${name}`;
    const image = release.images[name];
    if (
      typeof image !== "string" ||
      !image.startsWith(`${prefix}@sha256:`) ||
      !/^[a-f0-9]{64}$/.test(image.slice(prefix.length + 8))
    )
      throw new Error(`Release digest is required: ${name}`);
  }
  return release as ServerRelease;
}

export async function readRelease(root: string): Promise<ServerRelease> {
  return validateRelease(
    JSON.parse(await readFile(`${root}/ops/release.json`, "utf8")),
  );
}

export function releaseEnvironment(
  release: ServerRelease,
): Record<string, string> {
  validateRelease(release);
  return Object.fromEntries(
    imageNames.map((name) => [
      `ANAR_IMAGE_${name.toUpperCase()}`,
      release.images[name],
    ]),
  );
}
