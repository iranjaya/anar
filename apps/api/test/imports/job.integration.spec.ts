import { createHash } from "node:crypto";
import { mkdir, rm, writeFile } from "node:fs/promises";
import { join } from "node:path";
import {
  importBatches,
  importRows,
  importRuns,
  leadEvents,
  leads,
  notifications,
} from "@anar/db/tenant";
import type { Mapping } from "@anar/domain/imports";
import type { ImportCommitJob } from "@anar/domain/jobs";
import { sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type ImportRunnerDeps,
  runImport,
} from "../../src/modules/imports/index.js";
import mapping from "../../src/modules/imports/mapping.js";
import { addImportedLeads } from "../../src/modules/leads/index.js";
import members from "../../src/modules/members/service.js";
import notificationService from "../../src/modules/notifications/service.js";
import {
  loadActiveConfig,
  scoreLead,
} from "../../src/modules/scoring/index.js";
import { loadSchema } from "../../src/modules/settings/index.js";
import { importJobs } from "../../src/modules/tenant/index.js";
import recipients from "../../src/modules/tenant/recipients.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";
import { seedRun } from "./runFixture.js";

type Target = { agencyId: string; companyId: string };
const headers = ["full_name", "phone", "created_time", "campaign_name"];
const map: Mapping = [
  { header: "full_name", target: "system:full_name" },
  { header: "phone", target: "system:phone" },
  { header: "created_time", target: "system:lead_date" },
  { header: "campaign_name", target: "system:campaign_name" },
];
const phone = (n: number) => `+97798410${String(n).padStart(5, "0")}`;
const csv = (count: number) =>
  Buffer.from(
    [
      headers.join(","),
      ...Array.from(
        { length: count },
        (_, n) => `Lead ${n},${phone(n)},2026-09-12T10:11:12+05:45,Spring`,
      ),
    ].join("\n"),
  );

describe("an authorized import runs to the end or stops for review", () => {
  let fixture: SettingsFixture;
  let runner: Awaited<ReturnType<typeof importJobs.start>>;
  beforeAll(async () => {
    fixture = await startSettingsFixture();
    runner = await importJobs.start(fixture.postgres.appUrl);
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await runner?.close();
    await fixture?.close();
  });

  const notify = notificationService.create({
    context: {} as never,
    now: () => fixture.now(),
    ...recipients,
    pushEnabled: false,
    pushHosts: [],
    vapidPublicKey: "",
    bindPushEndpoint: async () => {},
  } as never).notify;
  function depsFor(change: Partial<ImportRunnerDeps> = {}): ImportRunnerDeps {
    return {
      uploadsRoot: fixture.uploadsRoot,
      loadSchema,
      loadActiveConfig,
      scoreLead,
      addImportedLeads,
      notify,
      readScopedCompanySlug: recipients.readScopedCompanySlug,
      canReceiveCompanyNotification: recipients.canReceiveCompanyNotification,
      listSuperAdminUserIds: members.listSuperAdminUserIds,
      withImportJob: runner.withImportJob,
      withImportRecord: runner.withImportRecord,
      ...change,
    };
  }
  async function setup(count = 1001, bytes = csv(count)) {
    const base = await fixture.setup();
    const payload = await seedRun(
      fixture,
      base.a,
      base.a.user.id,
      {
        rowCount: count,
        profile: { columns: mapping.headerColumns(headers) },
      },
      {
        fileSha256: createHash("sha256").update(bytes).digest("hex"),
        mapping: map,
      },
    );
    const dir = join(fixture.uploadsRoot, "imports", base.a.companyId);
    await mkdir(dir, { recursive: true });
    const path = join(dir, `${payload.batchId}.csv`);
    await writeFile(path, bytes);
    return { ...base, payload, path };
  }
  const control = () => ({ signal: new AbortController().signal });
  const state = (target: Target) =>
    fixture.scoped(target, async (tx) => {
      const [batch] = await tx.select().from(importBatches);
      const [run] = await tx.select().from(importRuns);
      const [{ count: rows }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(importRows);
      const [{ count: leadCount }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(leads);
      const [{ count: events }] = await tx
        .select({ count: sql<number>`count(*)::int` })
        .from(leadEvents);
      return {
        status: batch.status,
        lastRowNo: batch.lastRowNo,
        error: batch.error,
        summary: batch.summary,
        run: {
          state: run.state,
          failureCount: run.failureCount,
          stopCode: run.stopCode,
        },
        rows,
        leads: leadCount,
        events,
        notifications: await tx.select().from(notifications),
      };
    });
  // Lets the first n job transactions through, then runs the hook on the next one.
  const afterCalls = (
    n: number,
    hook: (payload: ImportCommitJob) => Promise<void> | void,
  ): ImportRunnerDeps["withImportJob"] => {
    let calls = 0;
    return async (payload, fn) => {
      if (calls++ === n) await hook(payload);
      return runner.withImportJob(payload, fn);
    };
  };

  it("imports the whole file in chunks and tells the uploader and manager once", async () => {
    const { a, manager, payload } = await setup();
    await runImport(depsFor(), payload, control());
    const done = await state(a);
    expect(done).toMatchObject({
      status: "done",
      lastRowNo: 1001,
      error: null,
      summary: {
        imported: 1001,
        needPhoneReview: 0,
        duplicateDb: 0,
        duplicateFile: 0,
        invalid: 0,
        error: 0,
        newOptions: 0,
      },
      run: { state: "done", failureCount: 0, stopCode: null },
      rows: 1001,
      leads: 1001,
      events: 1001,
    });
    const sent = expect.objectContaining({
      type: "import_complete",
      url: `/${a.company.slug}/imports/${payload.batchId}`,
      dedupeKey: `import:${a.companyId}:${payload.batchId}`,
    });
    expect(done.notifications).toEqual([sent, sent]);
    expect(done.notifications.map((row) => row.userId).sort()).toEqual(
      [a.user.id, manager.user.id].sort(),
    );
    await runImport(depsFor(), payload, control());
    expect(await state(a)).toEqual(done);
  });

  it("skips a Super Admin who lost access and still finishes", async () => {
    const { a, manager, payload } = await setup(3);
    const gone = await fixture.seedUser();
    await fixture.seedMember(a, gone.id, "deactivated", "super_admin");
    await runImport(depsFor(), payload, control());
    const done = await state(a);
    expect(done.status).toBe("done");
    expect(done.notifications.map((row) => row.userId).sort()).toEqual(
      [a.user.id, manager.user.id].sort(),
    );
  });

  it("stops without writing when the file changed", async () => {
    const { a, payload, path } = await setup(3);
    await writeFile(path, csv(4));
    await runImport(depsFor(), payload, control());
    expect(await state(a)).toMatchObject({
      status: "failed",
      error: "file_changed",
      run: { state: "stopped", stopCode: "file_changed" },
      rows: 0,
    });
  });

  it("stops without writing when the file is missing", async () => {
    const { a, payload, path } = await setup(3);
    await rm(path);
    await runImport(depsFor(), payload, control());
    expect(await state(a)).toMatchObject({
      status: "failed",
      run: { state: "stopped", stopCode: "file_missing" },
      rows: 0,
    });
  });

  it("keeps committed chunks after a failure and finishes on the retry", async () => {
    const { a, payload } = await setup();
    const failing = afterCalls(2, () => {
      throw new Error("database went away");
    });
    await expect(
      runImport(depsFor({ withImportJob: failing }), payload, control()),
    ).rejects.toThrow("database went away");
    expect(await state(a)).toMatchObject({
      status: "failed",
      lastRowNo: 500,
      run: { state: "retrying", failureCount: 1, stopCode: null },
      rows: 500,
    });
    await runImport(depsFor(), payload, control());
    expect(await state(a)).toMatchObject({
      status: "done",
      run: { state: "done", failureCount: 1 },
      rows: 1001,
      leads: 1001,
      events: 1001,
    });
  });

  it("stops after the third failed try", async () => {
    const { a, payload } = await setup(3);
    const broken = () =>
      depsFor({
        withImportJob: afterCalls(1, () => {
          throw new Error("database went away");
        }),
      });
    for (let attempt = 0; attempt < 3; attempt++)
      await expect(runImport(broken(), payload, control())).rejects.toThrow();
    expect(await state(a)).toMatchObject({
      status: "failed",
      error: "processing_failed",
      run: { state: "stopped", failureCount: 3 },
    });
  });

  it("stops when the uploader is deactivated mid file, keeping the done chunks", async () => {
    const { a, payload } = await setup();
    const removed = afterCalls(2, async () => {
      await fixture.owner(
        `UPDATE users SET deactivated_at = now() WHERE id = '${a.user.id}'`,
      );
    });
    await runImport(depsFor({ withImportJob: removed }), payload, control());
    expect(await state(a)).toMatchObject({
      status: "failed",
      lastRowNo: 500,
      run: { state: "stopped", stopCode: "access_removed" },
      rows: 500,
    });
  });

  it("rolls back the finish when a notification cannot be saved, then finishes once", async () => {
    const { a, payload } = await setup(3);
    const deps = depsFor({
      notify: async () => {
        throw new Error("notification failed");
      },
    });
    await expect(runImport(deps, payload, control())).rejects.toThrow(
      "notification failed",
    );
    expect(await state(a)).toMatchObject({
      status: "failed",
      lastRowNo: 3,
      summary: null,
      notifications: [],
      run: { state: "retrying" },
    });
    await runImport(depsFor(), payload, control());
    const done = await state(a);
    expect(done.status).toBe("done");
    expect(done.notifications).toHaveLength(2);
  });

  it("rolls back only the open chunk when the worker shuts down", async () => {
    const { a, payload } = await setup();
    const abort = new AbortController();
    let calls = 0;
    const stopping: ImportRunnerDeps["withImportJob"] = (job, fn) =>
      runner.withImportJob(job, async (tx, current) => {
        const result = await fn(tx, current);
        if (calls++ === 2) {
          abort.abort();
          abort.signal.throwIfAborted();
        }
        return result;
      });
    await expect(
      runImport(depsFor({ withImportJob: stopping }), payload, abort),
    ).rejects.toThrow();
    expect(await state(a)).toMatchObject({
      lastRowNo: 500,
      run: { failureCount: 0 },
      rows: 500,
    });
  });

  it("writes nothing for a payload that mixes two companies", async () => {
    const { a, b, payload } = await setup(3);
    await runImport(
      depsFor(),
      { ...payload, agencyId: b.agencyId, companyId: b.companyId },
      control(),
    );
    expect(await state(a)).toMatchObject({
      status: "running",
      run: { state: "queued" },
      rows: 0,
    });
  });
});
