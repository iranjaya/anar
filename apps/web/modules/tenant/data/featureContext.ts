import "server-only";
import type { ContextView, Permission } from "@anar/domain/context";
import { dataMode } from "@/lib/api/mode";
import { AppError } from "@/lib/errors";
import { can, isDemoPermission } from "../permissions";
import { getCompanyContext } from "../server";
import type { Ctx } from "../types";
import { requireContext } from "./context";

export type FeatureContext = ContextView | Ctx;

export async function requireFeatureContext(
  slug: string,
): Promise<FeatureContext> {
  if (dataMode() === "demo") return requireContext(slug);
  const result = await getCompanyContext(slug);
  if (!result)
    throw new AppError("unavailable", "Sign-in is not available yet.");
  if (!result.ok) throw new AppError(result.error, result.message);
  return result.data;
}

export function hasCapability(
  view: FeatureContext,
  permission: Permission,
): boolean {
  if ("capabilities" in view) return view.capabilities.includes(permission);
  return isDemoPermission(permission) && can(view, permission);
}
