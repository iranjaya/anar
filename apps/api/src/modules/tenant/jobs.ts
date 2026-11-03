import {
  agencies,
  agencyMembers,
  companies,
  createPlatformDb,
  type PlatformDb,
  type PlatformTx,
  users,
  withPlatformTenant,
} from "@anar/db/platform";
import {
  companyMembers,
  importBatches,
  importRuns,
  type TenantTx,
} from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import type { ImportCommitJob } from "@anar/domain/jobs";
import { and, eq, isNull } from "drizzle-orm";
import system from "./system.js";

export type ImportJobCtx = {
  agencyId: string;
  companyId: string;
  actorUserId: string;
  actorMemberId: string | null;
  role: "agency_staff" | "super_admin";
  batchId: string;
  runId: string;
  authorizedAt: Date;
  company: { defaultCountry: "NP"; timezone: "Asia/Kathmandu" };
};

// The job acts with the authority recorded on its run, not a session. Entry
// expiry or logout do not stop it; lost membership, permission or a newer run do.
const jobs = {
  create(db: PlatformDb) {
    return {
      withImportJob<T>(
        payload: ImportCommitJob,
        fn: (tx: TenantTx, current: ImportJobCtx) => Promise<T>,
      ): Promise<T> {
        return db.transaction(async (tx) => {
          const current = await jobs._authorize(tx, payload);
          return fn(tx, current);
        });
      },
      // Only for recording why a run stopped: no actor rights, but the pair must still be live.
      withImportRecord<T>(
        payload: ImportCommitJob,
        fn: (tx: TenantTx) => Promise<T>,
      ): Promise<T> {
        return db.transaction((tx) =>
          system.withSystemTenant(
            tx,
            {
              agencyId: payload.agencyId,
              companyId: payload.companyId,
              authority: "scheduler",
            },
            fn,
          ),
        );
      },
    };
  },
  async start(connectionString: string) {
    const db = await createPlatformDb(connectionString);
    return { ...jobs.create(db), close: db.close };
  },

  async _authorize(
    tx: PlatformTx,
    payload: ImportCommitJob,
  ): Promise<ImportJobCtx> {
    const refuse = () => {
      throw new AppError("forbidden", "The import is no longer authorized");
    };
    const [user] = await tx
      .select({ id: users.id })
      .from(users)
      .where(
        and(
          eq(users.id, payload.actorUserId),
          isNull(users.deactivatedAt),
          isNull(users.platformRole),
        ),
      )
      .for("update");
    if (!user) refuse();
    return withPlatformTenant(
      tx,
      {
        agencyId: payload.agencyId,
        companyId: payload.companyId,
        userId: payload.actorUserId,
      },
      async (scoped) => {
        const [company] = await scoped
          .select({
            defaultCountry: companies.defaultCountry,
            timezone: companies.timezone,
            settings: companies.settings,
          })
          .from(companies)
          .innerJoin(agencies, eq(agencies.id, companies.agencyId))
          .where(
            and(
              eq(companies.id, payload.companyId),
              eq(companies.agencyId, payload.agencyId),
              eq(companies.status, "active"),
              eq(agencies.status, "active"),
            ),
          )
          .for("update", { of: companies });
        if (!company) refuse();
        const [run] = await scoped
          .select({
            role: importRuns.role,
            authorizedAt: importRuns.authorizedAt,
            activeRunId: importBatches.activeRunId,
          })
          .from(importRuns)
          .innerJoin(
            importBatches,
            and(
              eq(importBatches.companyId, importRuns.companyId),
              eq(importBatches.id, importRuns.batchId),
            ),
          )
          .where(
            and(
              eq(importRuns.companyId, payload.companyId),
              eq(importRuns.id, payload.runId),
              eq(importRuns.batchId, payload.batchId),
              eq(importRuns.actorUserId, payload.actorUserId),
            ),
          )
          .for("update", { of: importBatches });
        if (!run || run.activeRunId !== payload.runId) refuse();
        const actorMemberId =
          run.role === "agency_staff"
            ? await jobs._staff(scoped, payload)
            : await jobs._superAdmin(
                scoped,
                payload,
                company.settings.super_admin_can_import,
              );
        return {
          agencyId: payload.agencyId,
          companyId: payload.companyId,
          actorUserId: payload.actorUserId,
          actorMemberId,
          role: run.role,
          batchId: payload.batchId,
          runId: payload.runId,
          authorizedAt: run.authorizedAt,
          company: {
            defaultCountry: company.defaultCountry,
            timezone: company.timezone,
          },
        };
      },
    );
  },

  async _staff(tx: TenantTx, payload: ImportCommitJob): Promise<null> {
    const [staff] = await tx
      .select({ id: agencyMembers.id })
      .from(agencyMembers)
      .where(
        and(
          eq(agencyMembers.agencyId, payload.agencyId),
          eq(agencyMembers.userId, payload.actorUserId),
          eq(agencyMembers.status, "active"),
        ),
      );
    if (!staff)
      throw new AppError("forbidden", "The import is no longer authorized");
    return null;
  },

  async _superAdmin(
    tx: TenantTx,
    payload: ImportCommitJob,
    canImport: boolean,
  ): Promise<string> {
    const [member] = await tx
      .select({ id: companyMembers.id })
      .from(companyMembers)
      .where(
        and(
          eq(companyMembers.companyId, payload.companyId),
          eq(companyMembers.userId, payload.actorUserId),
          eq(companyMembers.role, "super_admin"),
          eq(companyMembers.status, "active"),
        ),
      );
    if (!member || !canImport)
      throw new AppError("forbidden", "The import is no longer authorized");
    return member.id;
  },
};
export default jobs;
