import { constants } from "node:fs";
import { chmod, copyFile, mkdtemp, rm } from "node:fs/promises";
import { tmpdir } from "node:os";
import path from "node:path";
import { type ArchiveEntry, validateArchive } from "./backup/archive.ts";
import {
  type BackupManifest,
  verifyArtifacts,
  verifyBackup,
} from "./backup/manifest.ts";

export type RestoreRunner = {
  withTargetLock<T>(project: string, operation: () => Promise<T>): Promise<T>;
  verifyDump(file: string): Promise<void>;
  listArchive(file: string): Promise<ArchiveEntry[]>;
  // Atomically refuse existing projects/volumes, then create a target marked incomplete.
  reserveEmptyTarget(project: string): Promise<void>;
  bootstrapRoles(project: string): Promise<void>;
  restoreDatabase(
    project: string,
    file: string,
    options: {
      role: "anar_migrate";
      noOwner: true;
      noAcl: true;
    },
  ): Promise<void>;
  applyRuntimeGrants(project: string): Promise<void>;
  extractUploads(project: string, file: string): Promise<void>;
  readRowCounts(
    project: string,
    tables: string[],
  ): Promise<Record<string, number>>;
  verifyRelationshipsAndStoredState(project: string): Promise<void>;
  verifyRestrictedAccess(project: string): Promise<void>;
  startIsolated(
    project: string,
    options: { email: "fake"; push: "disabled" },
  ): Promise<void>;
  markVerified(project: string, manifest: BackupManifest): Promise<void>;
};

class RestoreFailure extends Error {
  constructor(step: string, cause: unknown) {
    super(`Restore failed at ${step}`, { cause });
  }
}

export async function restoreLocal(input: {
  directory: string;
  project: string;
  signal: AbortSignal;
  runner: RestoreRunner;
}): Promise<BackupManifest> {
  if (!/^anar-restore-[a-z0-9][a-z0-9-]{0,49}$/.test(input.project))
    throw new Error("Restore requires a new anar-restore project");
  const runner = input.runner;
  let step = "target lock";
  let snapshot: string | undefined;
  let result: BackupManifest | undefined;
  let failure: Error | undefined;
  try {
    result = await runner.withTargetLock(input.project, async () => {
      input.signal.throwIfAborted();
      step = "backup verification";
      const manifest = await verifyBackup(input.directory);
      step = "private artifact snapshot";
      snapshot = await mkdtemp(path.join(tmpdir(), "anar-restore-artifacts-"));
      const database = path.join(snapshot, "database.dump");
      const uploads = path.join(snapshot, "uploads.tar");
      for (const name of ["database.dump", "uploads.tar"]) {
        const target = path.join(snapshot, name);
        await copyFile(
          path.join(input.directory, name),
          target,
          constants.COPYFILE_EXCL,
        );
        await chmod(target, 0o600);
      }
      await verifyArtifacts(snapshot, manifest);
      step = "dump verification";
      await runner.verifyDump(database);
      step = "archive verification";
      validateArchive(await runner.listArchive(uploads));
      input.signal.throwIfAborted();
      step = "reserve empty target";
      await runner.reserveEmptyTarget(input.project);
      step = "bootstrap roles";
      await runner.bootstrapRoles(input.project);
      input.signal.throwIfAborted();
      step = "database restore";
      await runner.restoreDatabase(input.project, database, {
        role: "anar_migrate",
        noOwner: true,
        noAcl: true,
      });
      step = "runtime grants";
      await runner.applyRuntimeGrants(input.project);
      input.signal.throwIfAborted();
      step = "uploads restore";
      await runner.extractUploads(input.project, uploads);
      step = "row counts";
      const tables = Object.keys(manifest.rowCounts).sort();
      const counts = await runner.readRowCounts(input.project, tables);
      if (
        Object.keys(counts).length !== tables.length ||
        tables.some((table) => counts[table] !== manifest.rowCounts[table])
      )
        throw new Error("Restored row counts differ");
      step = "relationships and stored state";
      await runner.verifyRelationshipsAndStoredState(input.project);
      step = "restricted access";
      await runner.verifyRestrictedAccess(input.project);
      input.signal.throwIfAborted();
      step = "isolated startup";
      await runner.startIsolated(input.project, {
        email: "fake",
        push: "disabled",
      });
      input.signal.throwIfAborted();
      step = "publish verified status";
      await runner.markVerified(input.project, manifest);
      return manifest;
    });
  } catch (cause) {
    failure = new RestoreFailure(step, cause);
  } finally {
    if (snapshot) {
      try {
        await rm(snapshot, { recursive: true, force: true });
      } catch (cause) {
        failure = new RestoreFailure(
          "private snapshot cleanup",
          new AggregateError([failure, cause].filter(Boolean)),
        );
      }
    }
  }
  if (failure) throw failure;
  if (!result) throw new Error("Restore result missing");
  return result;
}
