import { importBatches, importRuns } from "@anar/db/tenant";
import { eq } from "drizzle-orm";
import { v7 } from "uuid";
import commitSnapshot from "../../src/modules/imports/commitSnapshot.js";
import type { FrozenImport } from "../../src/modules/imports/types.js";
import { loadSchema } from "../../src/modules/settings/index.js";
import type { SettingsFixture } from "../settings/fixture.js";

type Target = { agencyId: string; companyId: string };
export const company = { defaultCountry: "NP", timezone: "Asia/Kathmandu" };

// A batch already committed by S5.4, with its first run queued and active.
export async function seedRun(
  fixture: SettingsFixture,
  target: Target,
  actorUserId: string,
  batch: Partial<typeof importBatches.$inferInsert> = {},
  frozen: Partial<FrozenImport> = {},
  role: "agency_staff" | "super_admin" = "agency_staff",
) {
  const batchId = batch.id ?? v7();
  const runId = v7();
  await fixture.scoped(target, async (tx) => {
    const schema = await loadSchema(tx);
    await tx.insert(importBatches).values({
      id: batchId,
      companyId: target.companyId,
      uploadedBy: actorUserId,
      sourceKind: "csv",
      fileName: "leads.csv",
      filePath: `imports/${target.companyId}/${batchId}.csv`,
      fileSize: 10,
      encoding: "utf-8",
      delimiter: ",",
      rowCount: 0,
      status: "running",
      profile: {},
      ...batch,
      frozen: {
        schemaFingerprint: commitSnapshot.schemaFingerprint(
          schema.fields,
          company,
        ),
        defaultStageId: schema.stages.find((stage) => stage.isDefault)?.id,
        fields: schema.fields,
        ...company,
        mappingRevision: 1,
        newOptionsAdded: 0,
        ...frozen,
      },
    });
    await tx.insert(importRuns).values({
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
    await tx
      .update(importBatches)
      .set({ activeRunId: runId })
      .where(eq(importBatches.id, batchId));
  });
  return { ...target, actorUserId, batchId, runId };
}
