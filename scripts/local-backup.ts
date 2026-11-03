import { randomUUID } from "node:crypto";
import { chmod, mkdir, open, realpath, writeFile } from "node:fs/promises";
import path from "node:path";
import { type ArchiveEntry, validateArchive } from "./backup/archive.ts";
import {
  type BackupManifest,
  checksum,
  parseManifest,
  verifyArtifacts,
} from "./backup/manifest.ts";

export type BackupRunner<State> = {
  withSourceLock<T>(project: string, operation: () => Promise<T>): Promise<T>;
  runningState(project: string): Promise<State>;
  quiesce(project: string, signal: AbortSignal): Promise<void>;
  resume(project: string, state: State): Promise<void>;
  metadata(
    project: string,
  ): Promise<
    Pick<BackupManifest, "sourceRevision" | "schemaVersion" | "rowCounts">
  >;
  dump(project: string, output: string, signal: AbortSignal): Promise<void>;
  archiveUploads(
    project: string,
    output: string,
    signal: AbortSignal,
  ): Promise<void>;
  verifyDump(file: string): Promise<void>;
  listArchive(file: string): Promise<ArchiveEntry[]>;
};

function inside(root: string, candidate: string): boolean {
  const relative = path.relative(root, candidate);
  return (
    relative === "" ||
    (!relative.startsWith(`..${path.sep}`) &&
      relative !== ".." &&
      !path.isAbsolute(relative))
  );
}

export type BackupInput<State> = {
  repository: string;
  output: string;
  project: string;
  signal: AbortSignal;
  now(): Date;
  runner: BackupRunner<State>;
};

class BackupFailure extends Error {
  constructor(step: string, cause: unknown) {
    super(`Backup failed at ${step}; incomplete artifacts preserved`, {
      cause,
    });
  }
}

export async function backupLocal<State>(
  input: BackupInput<State>,
): Promise<{ directory: string; manifest: BackupManifest }> {
  if (!/^[a-z][a-z0-9-]{2,63}$/.test(input.project))
    throw new Error("Invalid source project");
  try {
    return await input.runner.withSourceLock(input.project, () =>
      coordinatedBackup(input),
    );
  } catch (cause) {
    if (cause instanceof BackupFailure) throw cause;
    throw new BackupFailure("source lock or preparation", cause);
  }
}

async function coordinatedBackup<State>(
  input: BackupInput<State>,
): Promise<{ directory: string; manifest: BackupManifest }> {
  const repository = await realpath(input.repository);
  const output = await realpath(input.output);
  if (inside(repository, output))
    throw new Error("Backup output must be outside the repository");
  input.signal.throwIfAborted();
  const directory = path.join(
    output,
    `backup-${input.now().toISOString().replace(/[:.]/g, "-")}-${randomUUID()}`,
  );
  await mkdir(directory, { mode: 0o700 });
  await chmod(directory, 0o700);
  const database = path.join(directory, "database.dump");
  const uploads = path.join(directory, "uploads.tar");
  for (const file of [database, uploads]) {
    const handle = await open(file, "wx", 0o600);
    await handle.close();
  }
  const runner = input.runner;
  const state = await runner
    .runningState(input.project)
    .catch((cause: unknown) => {
      throw new BackupFailure("capture running state", cause);
    });
  let manifest: BackupManifest | undefined;
  let failure: Error | undefined;
  let step = "quiesce";
  try {
    await runner.quiesce(input.project, input.signal);
    input.signal.throwIfAborted();
    step = "metadata";
    const metadata = await runner.metadata(input.project);
    step = "database dump";
    await runner.dump(input.project, database, input.signal);
    step = "uploads archive";
    await runner.archiveUploads(input.project, uploads, input.signal);
    input.signal.throwIfAborted();
    step = "verify dump";
    await runner.verifyDump(database);
    step = "verify archive";
    validateArchive(await runner.listArchive(uploads));
    step = "verify artifacts";
    await chmod(database, 0o600);
    await chmod(uploads, 0o600);
    manifest = parseManifest({
      ...metadata,
      format: 1,
      createdAt: input.now().toISOString(),
      databaseSha256: await checksum(database),
      uploadsSha256: await checksum(uploads),
    });
    input.signal.throwIfAborted();
    await verifyArtifacts(directory, manifest);
    step = "publish manifest";
    await writeFile(
      path.join(directory, "manifest.json"),
      JSON.stringify(manifest),
      { flag: "wx", mode: 0o600 },
    );
  } catch (cause) {
    failure = new BackupFailure(step, cause);
  } finally {
    // Recovery must run even after cancellation, without the cancelled signal.
    try {
      await runner.resume(input.project, state);
    } catch (cause) {
      failure = new BackupFailure(
        "source restart; operator recovery required",
        cause,
      );
    }
  }
  if (failure) throw failure;
  if (!manifest) throw new Error("Backup manifest missing");
  return { directory, manifest };
}
