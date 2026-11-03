import { readCompanyScope, type TenantTx } from "@anar/db/tenant";
import { AppError } from "@anar/domain/errors";
import { type ScoringConfig, scoringConfigSchema } from "@anar/domain/scoring";
import type { FastifyRequest } from "fastify";
import type tenant from "../tenant/index.js";
import type { Ctx } from "../tenant/index.js";
import permissions from "../tenant/permissions.js";
import repository from "./repository.js";

export type ScoringDeps = {
  context: Pick<
    ReturnType<typeof tenant.create>,
    "requireContext" | "withContext"
  >;
};

const config = {
  create(deps: ScoringDeps) {
    return {
      requireContext(
        request: Pick<FastifyRequest, "headers">,
        slug: string,
      ): Promise<Ctx> {
        return deps.context.requireContext(request, slug);
      },
      getScoringDefaults(actor: Ctx): Promise<ScoringConfig> {
        return deps.context.withContext(actor, (tx, current) => {
          permissions.require(current, "settings.manage");
          return config.loadActiveConfig(tx);
        });
      },
    };
  },
  async loadActiveConfig(tx: TenantTx): Promise<ScoringConfig> {
    const { companyId } = await readCompanyScope(tx);
    const row = await repository.readActive(tx, companyId);
    const parsed = scoringConfigSchema.safeParse({
      id: row?.id,
      companyId: row?.companyId,
      version: row?.version,
      basePoints: row?.basePoints,
      hotMin: row?.hotMin,
      warmMin: row?.warmMin,
      rules: row?.rules,
      active: row?.active,
    });
    if (!parsed.success)
      throw new AppError("unavailable", "Scoring is not set up");
    return parsed.data;
  },
};
export type ScoringService = ReturnType<typeof config.create>;
export default config;
