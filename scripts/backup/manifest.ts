import { createHash } from "node:crypto";
import { createReadStream } from "node:fs";
import { lstat, readFile } from "node:fs/promises";
import path from "node:path";

export type BackupManifest = {
  format: 1;
  createdAt: string;
  sourceRevision: string;
  schemaVersion: string;
  databaseSha256: string;
  uploadsSha256: string;
  rowCounts: Record<string, number>;
};
const keys = [
  "format",
  "createdAt",
  "sourceRevision",
  "schemaVersion",
  "databaseSha256",
  "uploadsSha256",
  "rowCounts",
];

export function parseManifest(value: unknown): BackupManifest {
  if (!value || typeof value !== "object" || Array.isArray(value))
    throw new Error("Invalid backup manifest");
  const row = value as Record<string, unknown>;
  const digest = (value: unknown) =>
    typeof value === "string" && /^[a-f0-9]{64}$/.test(value);
  if (
    Object.keys(row).length !== keys.length ||
    keys.some((key) => !Object.hasOwn(row, key)) ||
    row.format !== 1 ||
    typeof row.createdAt !== "string" ||
    !Number.isFinite(Date.parse(row.createdAt)) ||
    typeof row.sourceRevision !== "string" ||
    !/^[a-f0-9]{40,64}$/.test(row.sourceRevision) ||
    typeof row.schemaVersion !== "string" ||
    !/^[a-zA-Z0-9_.-]{1,128}$/.test(row.schemaVersion) ||
    !digest(row.databaseSha256) ||
    !digest(row.uploadsSha256) ||
    !row.rowCounts ||
    typeof row.rowCounts !== "object" ||
    Array.isArray(row.rowCounts) ||
    !Object.entries(row.rowCounts).every(
      ([key, count]) =>
        /^[a-z_][a-z0-9_]*$/.test(key) &&
        Number.isSafeInteger(count) &&
        Number(count) >= 0,
    )
  )
    throw new Error("Invalid backup manifest");
  return row as BackupManifest;
}

export async function checksum(file: string): Promise<string> {
  const info = await lstat(file);
  if (!info.isFile() || info.isSymbolicLink())
    throw new Error("Invalid backup artifact");
  const hash = createHash("sha256");
  for await (const chunk of createReadStream(file)) hash.update(chunk);
  return hash.digest("hex");
}

export async function verifyBackup(directory: string): Promise<BackupManifest> {
  const manifestPath = path.join(directory, "manifest.json");
  const info = await lstat(manifestPath);
  if (!info.isFile() || info.size > 64 * 1024)
    throw new Error("Invalid backup manifest");
  const manifest = parseManifest(
    JSON.parse(await readFile(manifestPath, "utf8")),
  );
  await verifyArtifacts(directory, manifest);
  return manifest;
}

export async function verifyArtifacts(
  directory: string,
  manifest: BackupManifest,
): Promise<void> {
  if (
    (await checksum(path.join(directory, "database.dump"))) !==
      manifest.databaseSha256 ||
    (await checksum(path.join(directory, "uploads.tar"))) !==
      manifest.uploadsSha256
  )
    throw new Error("Backup checksum mismatch");
}
