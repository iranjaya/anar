import assert from "node:assert/strict";

type SourceState = { databaseSha256: string; uploadsSha256: string };
export type RecoveryDrillRunner = {
  assertDisposable(project: string): Promise<void>;
  // Prepare synthetic rows with the source worker stopped at the chunk boundary.
  preparePausedImport(
    project: string,
  ): Promise<{ processed: 500; totalRows: number }>;
  sourceState(project: string): Promise<SourceState>;
  backup(project: string, output: string): Promise<{ directory: string }>;
  restore(directory: string, targetProject: string): Promise<void>;
  resumeImport(targetProject: string): Promise<{
    ledgerRows: number;
    distinctRowNumbers: number;
    importedEvents: number;
  }>;
  checkBrowser(
    targetProject: string,
    width: "phone" | "desktop",
    output: string,
  ): Promise<void>;
  stopDisposableContainers(project: string): Promise<void>;
};

export async function runRecoveryDrill(input: {
  sourceProject: string;
  targetProject: string;
  backupOutput: string;
  browserOutput: string;
  runner: RecoveryDrillRunner;
  monotonicMs(): number;
}): Promise<{
  restoreMs: number;
  browserWidths: ["phone", "desktop"];
  totalRows: number;
}> {
  if (
    !/^anar-proof-[a-z0-9-]+$/.test(input.sourceProject) ||
    !/^anar-restore-[a-z0-9-]+$/.test(input.targetProject)
  )
    throw new Error("Recovery drill requires disposable projects");
  const runner = input.runner;
  await runner.assertDisposable(input.sourceProject);
  await runner.assertDisposable(input.targetProject);
  let step = "prepare paused import";
  let failure: Error | undefined;
  let result:
    | {
        restoreMs: number;
        browserWidths: ["phone", "desktop"];
        totalRows: number;
      }
    | undefined;
  try {
    const pending = await runner.preparePausedImport(input.sourceProject);
    assert.equal(pending.processed, 500);
    assert.ok(pending.totalRows > 500);
    const before = await runner.sourceState(input.sourceProject);
    step = "backup";
    const saved = await runner.backup(input.sourceProject, input.backupOutput);
    step = "restore";
    const started = input.monotonicMs();
    await runner.restore(saved.directory, input.targetProject);
    step = "resume pending import";
    const resumed = await runner.resumeImport(input.targetProject);
    assert.deepEqual(resumed, {
      ledgerRows: pending.totalRows,
      distinctRowNumbers: pending.totalRows,
      importedEvents: pending.totalRows,
    });
    const restoreMs = input.monotonicMs() - started;
    assert.ok(
      restoreMs >= 0 && restoreMs <= 3_600_000,
      "Recovery exceeded 60 minutes",
    );
    step = "restored browser checks";
    await runner.checkBrowser(
      input.targetProject,
      "phone",
      input.browserOutput,
    );
    await runner.checkBrowser(
      input.targetProject,
      "desktop",
      input.browserOutput,
    );
    step = "source unchanged";
    assert.deepEqual(await runner.sourceState(input.sourceProject), before);
    result = {
      restoreMs,
      browserWidths: ["phone", "desktop"],
      totalRows: pending.totalRows,
    };
  } catch (cause) {
    failure = new Error(`Recovery drill failed at ${step}`, { cause });
  } finally {
    for (const project of [input.targetProject, input.sourceProject]) {
      try {
        await runner.stopDisposableContainers(project);
      } catch (cause) {
        failure = new Error("Recovery drill container cleanup failed", {
          cause: new AggregateError([failure, cause].filter(Boolean)),
        });
      }
    }
  }
  if (failure) throw failure;
  if (!result) throw new Error("Recovery drill result missing");
  return result;
}
