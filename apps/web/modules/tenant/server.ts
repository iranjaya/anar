import "server-only";
import {
  contextViewSchema,
  type ContextView,
  contextQuerySchema,
} from "@anar/domain/context";
import { cache } from "react";
import { apiRequest } from "@/lib/api/client";
import { authEnabled } from "@/lib/api/mode";
import { type ActionResult, AppError, actionFailure } from "@/lib/errors";

const contextSchema = contextViewSchema.transform(
  (view): ContextView => ({
    ...view,
    agency: { ...view.agency, createdAt: new Date(view.agency.createdAt) },
    session: {
      ...view.session,
      actingUntil:
        view.session.actingUntil === null
          ? null
          : new Date(view.session.actingUntil),
    },
  }),
);

export const getCompanyContext = cache(
  async (slug: string): Promise<ActionResult<ContextView> | null> => {
    if (!authEnabled()) return null;
    try {
      const parsed = contextQuerySchema.safeParse({ company: slug });
      if (!parsed.success)
        throw new AppError("not_found", "Company not found.");
      return {
        ok: true,
        data: await apiRequest(
          { path: "/api/context", query: parsed.data },
          contextSchema,
        ),
      };
    } catch (error) {
      return actionFailure(error);
    }
  },
);

export { requireContext } from "./data/context";
export {
  type FeatureContext,
  hasCapability,
  requireFeatureContext,
} from "./data/featureContext";
export { resolveContext } from "./data/context";
export { switchDemoUser } from "./data/context";
export { resetDemo } from "./data/context";
export { setDemoFailure } from "./data/context";
export { can } from "./permissions";
export { homeFor } from "./permissions";
export { readDemoIdentity } from "./data/context";
export { requireDemoContext } from "./data/context";
export { verifyContext } from "./data/context";
export { getCompanyShell } from "./data/context";
export { setActingCompany } from "./data/context";
export { getDemoControls } from "./data/context";
