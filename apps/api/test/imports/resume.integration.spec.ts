import { fields, importBatches, importRuns } from "@anar/db/tenant";
import { asc, eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { importJobs } from "../../src/modules/tenant/index.js";
import { publicOrigin } from "../auth/fixture.js";
import {
  type SettingsFixture,
  startSettingsFixture,
} from "../settings/fixture.js";
import { seedRun } from "./runFixture.js";

type Target = { agencyId: string; companyId: string };

describe("resume starts a new run only for a stopped import", () => {
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

  async function setup(job: "created" | "failed" | null = "failed") {
    const base = await fixture.setup();
    const entered = await fixture.companyRequest(
      "POST",
      "enterCompany",
      base.a.cookie,
      { companyId: base.a.companyId, reason: "Resuming the client import" },
    );
    expect(entered.statusCode).toBe(200);
    const uploader = await fixture.seedUser();
    const payload = await seedRun(fixture, base.a, uploader.id, {
      rowCount: 900,
      lastRowNo: 500,
    });
    const jobId = v7();
    await fixture.scoped(base.a, (tx) =>
      tx
        .update(importRuns)
        .set({ jobId, state: "running" })
        .where(eq(importRuns.id, payload.runId)),
    );
    if (job)
      await fixture.owner(
        `INSERT INTO pgboss.job (id, name, data, state) VALUES ('${jobId}', 'import.commit', '{}', '${job}')`,
      );
    const send = (cookie = base.a.cookie, batchId = payload.batchId) =>
      fixture.apps[0].app.inject({
        method: "POST",
        url: `/api/companies/${base.slug}/imports/resumeImport`,
        payload: { batchId },
        headers: { origin: publicOrigin, cookie },
      });
    return { ...base, payload, jobId, send };
  }
  const saved = (target: Target) =>
    fixture.scoped(target, async (tx) => ({
      batch: (await tx.select().from(importBatches))[0],
      runs: await tx.select().from(importRuns).orderBy(asc(importRuns.runNo)),
    }));
  const resumed = () =>
    fixture.rows<{ target_id: string; actor_user_id: string }>(
      sql`select target_id, actor_user_id from audit_log where action = 'imports.resumed'`,
    );

  it("gives back the live job and writes nothing while it still runs", async () => {
    const { a, jobId, send } = await setup("created");
    const before = await saved(a);
    const response = await send();
    expect(response.json()).toEqual({ ok: true, data: { jobId } });
    expect(await saved(a)).toEqual(before);
    expect(await resumed()).toEqual([]);
  });

  it("stops a dead run and starts run 2 as the person resuming, keeping progress", async () => {
    const { a, payload, jobId, send } = await setup();
    const before = await saved(a);
    const response = await send();
    expect(response.statusCode).toBe(200);
    const { jobId: next } = response.json().data;
    expect(next).not.toBe(jobId);
    const { batch, runs } = await saved(a);
    expect(runs).toEqual([
      expect.objectContaining({
        id: payload.runId,
        state: "stopped",
        stopCode: "processing_failed",
      }),
      expect.objectContaining({
        runNo: 2,
        actorUserId: a.user.id,
        role: "agency_staff",
        state: "queued",
        jobId: next,
      }),
    ]);
    expect(batch).toMatchObject({
      activeRunId: runs[1].id,
      status: "mapped",
      lastRowNo: 500,
      frozen: before.batch.frozen,
    });
    expect(await resumed()).toEqual([
      { target_id: payload.batchId, actor_user_id: a.user.id },
    ]);
    const [job] = await fixture.rows<{ data: object }>(
      sql`select data from pgboss.job where id = ${next}`,
    );
    expect(job.data).toEqual({
      agencyId: a.agencyId,
      companyId: a.companyId,
      actorUserId: a.user.id,
      batchId: payload.batchId,
      runId: runs[1].id,
    });
  });

  it("gives two resumes at once the same new run", async () => {
    const { a, send } = await setup();
    const [first, second] = await Promise.all([send(), send()]);
    expect(second.json()).toEqual(first.json());
    expect((await saved(a)).runs).toHaveLength(2);
  });

  it("treats a job pg-boss lost as dead only after the delivery grace", async () => {
    const { a, jobId, send } = await setup(null);
    expect((await send()).json().data).toEqual({ jobId });
    fixture.advance(21 * 60_000);
    expect((await send()).json().data.jobId).not.toBe(jobId);
    expect((await saved(a)).runs).toHaveLength(2);
  });

  it("keeps the old delivery from writing after a new run starts", async () => {
    const { payload, send } = await setup();
    expect((await send()).statusCode).toBe(200);
    await expect(
      runner.withImportJob(payload, async () => "wrote"),
    ).rejects.toMatchObject({ code: "forbidden" });
  });

  it("explains why it cannot resume after the company fields changed", async () => {
    const { a, send } = await setup();
    await fixture.scoped(a, (tx) =>
      tx.insert(fields).values({
        id: v7(),
        companyId: a.companyId,
        key: "notes",
        label: "Notes",
        type: "text",
        isSystem: false,
        position: 20,
      }),
    );
    const response = await send();
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toContain("cannot resume");
    const { runs } = await saved(a);
    expect(runs.map((run) => run.state)).toEqual(["stopped"]);
  });

  it("refuses a file that changed and an import that is done", async () => {
    const { a, payload, send } = await setup();
    await fixture.scoped(a, (tx) =>
      tx
        .update(importRuns)
        .set({ state: "stopped", stopCode: "file_changed" })
        .where(eq(importRuns.id, payload.runId)),
    );
    expect((await send()).statusCode).toBe(409);
    await fixture.scoped(a, (tx) =>
      tx
        .update(importBatches)
        .set({ status: "done" })
        .where(eq(importBatches.id, payload.batchId)),
    );
    const done = await send();
    expect(done.statusCode).toBe(409);
    expect(done.json().message).toContain("already done");
    expect((await saved(a)).runs).toHaveLength(1);
  });

  it("refuses an Admin, someone who left the company, and a batch from elsewhere", async () => {
    const { a, b, seller, send } = await setup();
    expect((await send(seller.cookie)).statusCode).toBe(403);
    const other = await seedRun(fixture, b, a.user.id);
    expect((await send(a.cookie, other.batchId)).statusCode).toBe(404);
    await fixture.companyRequest("POST", "leaveCompany", a.cookie, {});
    expect([403, 404]).toContain((await send()).statusCode);
    expect((await saved(a)).runs).toHaveLength(1);
  });
});
