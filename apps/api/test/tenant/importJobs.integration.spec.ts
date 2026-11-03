import {
  agencyMembers,
  companies,
  withPlatformAgency,
  withPlatformTenant,
} from "@anar/db/platform";
import { companyMembers, importBatches, importRuns } from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { importJobs } from "../../src/modules/tenant/index.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

type Company = { agencyId: string; companyId: string };

describe("import jobs act on the run's recorded authority", () => {
  let fixture: CompanyFixture;
  let runner: Awaited<ReturnType<typeof importJobs.start>>;
  beforeAll(async () => {
    fixture = await startCompanyFixture();
    runner = await importJobs.start(fixture.postgres.appUrl);
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await runner?.close();
    await fixture?.close();
  });

  async function seedRun(
    target: Company,
    actorUserId: string,
    role: "agency_staff" | "super_admin",
  ) {
    const batchId = v7();
    const runId = v7();
    await fixture.db.transaction((tx) =>
      withPlatformTenant(tx, { ...target, userId: actorUserId }, async (s) => {
        await s.insert(importBatches).values({
          id: batchId,
          companyId: target.companyId,
          uploadedBy: actorUserId,
          sourceKind: "csv",
          fileName: "leads.csv",
          filePath: `/uploads/${batchId}.csv`,
          fileSize: 10,
          encoding: "utf-8",
          delimiter: ",",
          rowCount: 1,
          status: "uploaded",
          profile: {},
        });
        await s.insert(importRuns).values({
          id: runId,
          companyId: target.companyId,
          batchId,
          runNo: 1,
          actorUserId,
          role,
          authorizedAt: fixture.now(),
          mappingRevision: 1,
          state: "queued",
        });
        await s
          .update(importBatches)
          .set({ activeRunId: runId })
          .where(eq(importBatches.id, batchId));
      }),
    );
    return {
      agencyId: target.agencyId,
      companyId: target.companyId,
      actorUserId,
      batchId,
      runId,
    };
  }
  const run = (payload: Awaited<ReturnType<typeof seedRun>>) =>
    runner.withImportJob(payload, async (_tx, current) => current);
  const refused = { code: "forbidden" };

  it("gives the job its actor, run and company settings", async () => {
    const { a } = await fixture.setup();
    const payload = await seedRun(a, a.user.id, "agency_staff");
    expect(await run(payload)).toMatchObject({
      ...payload,
      actorMemberId: null,
      role: "agency_staff",
      company: { defaultCountry: "NP", timezone: "Asia/Kathmandu" },
    });
  });

  it("refuses a mismatched agency and company pair", async () => {
    const { a, b } = await fixture.setup();
    const payload = await seedRun(a, a.user.id, "agency_staff");
    await expect(
      run({ ...payload, agencyId: b.agencyId }),
    ).rejects.toMatchObject(refused);
  });

  it("refuses a run that is no longer the batch's active run", async () => {
    const { a } = await fixture.setup();
    const payload = await seedRun(a, a.user.id, "agency_staff");
    await expect(run({ ...payload, runId: v7() })).rejects.toMatchObject(
      refused,
    );
  });

  it("refuses staff who were deactivated", async () => {
    const { a } = await fixture.setup();
    const payload = await seedRun(a, a.user.id, "agency_staff");
    await fixture.db.transaction((tx) =>
      withPlatformAgency(tx, { agencyId: a.agencyId, userId: a.user.id }, (s) =>
        s
          .update(agencyMembers)
          .set({ status: "deactivated" })
          .where(eq(agencyMembers.userId, a.user.id)),
      ),
    );
    await expect(run(payload)).rejects.toMatchObject(refused);
  });

  it("needs an active Super Admin and the company import flag", async () => {
    const { a } = await fixture.setup();
    const manager = await fixture.seedUser();
    const member = await fixture.seedMember(a, manager.id);
    const payload = await seedRun(a, manager.id, "super_admin");
    await expect(run(payload)).rejects.toMatchObject(refused);
    await fixture.db.transaction((tx) =>
      withPlatformTenant(tx, { ...a, userId: manager.id }, (s) =>
        s
          .update(companies)
          .set({ settings: { super_admin_can_import: true } })
          .where(eq(companies.id, a.companyId)),
      ),
    );
    expect(await run(payload)).toMatchObject({
      role: "super_admin",
      actorMemberId: member.id,
    });
    await fixture.db.transaction((tx) =>
      withPlatformTenant(tx, { ...a, userId: manager.id }, (s) =>
        s
          .update(companyMembers)
          .set({ status: "deactivated", deactivatedAt: fixture.now() })
          .where(eq(companyMembers.id, member.id)),
      ),
    );
    await expect(run(payload)).rejects.toMatchObject(refused);
  });

  it("records for a run whose actor lost access, but only in its own company", async () => {
    const { a, b } = await fixture.setup();
    const payload = await seedRun(a, a.user.id, "agency_staff");
    await fixture.db.transaction((tx) =>
      withPlatformAgency(tx, { agencyId: a.agencyId, userId: a.user.id }, (s) =>
        s
          .update(agencyMembers)
          .set({ status: "deactivated" })
          .where(eq(agencyMembers.userId, a.user.id)),
      ),
    );
    await expect(run(payload)).rejects.toMatchObject(refused);
    const seen = await runner.withImportRecord(payload, (tx) =>
      tx.select({ id: importRuns.id }).from(importRuns),
    );
    expect(seen).toEqual([{ id: payload.runId }]);
    await expect(
      runner.withImportRecord(
        { ...payload, agencyId: b.agencyId },
        async () => "ran",
      ),
    ).rejects.toMatchObject({ code: "not_found" });
  });

  it("does not record for a suspended company", async () => {
    const { a } = await fixture.setup();
    const payload = await seedRun(a, a.user.id, "agency_staff");
    await fixture.db.transaction((tx) =>
      withPlatformTenant(tx, { ...a, userId: a.user.id }, (s) =>
        s
          .update(companies)
          .set({ status: "suspended" })
          .where(eq(companies.id, a.companyId)),
      ),
    );
    await expect(
      runner.withImportRecord(payload, async () => "ran"),
    ).rejects.toMatchObject({ code: "not_found" });
  });
});
