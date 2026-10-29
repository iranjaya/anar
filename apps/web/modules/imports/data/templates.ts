import { createHash } from "node:crypto";
import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import type { MappingTemplate } from "../types";

export function headerFingerprint(headers: string[]): string {
  const normalised = headers
    .map((header) =>
      header
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase()
        .replace(/[?_]+$/, ""),
    )
    .sort();
  return createHash("sha256").update(normalised.join("\n")).digest("hex");
}

export async function findTemplate(
  ctx: Ctx,
  headers: string[],
): Promise<MappingTemplate | undefined> {
  const current = await verifyContext(ctx);
  if (!can(current, "imports.upload"))
    throw new AppError("forbidden", "You cannot import leads.");
  const data = await store();
  const fingerprint = headerFingerprint(headers);
  return data.mappingTemplates.find(
    (template) =>
      template.companyId === current.companyId &&
      template.headerFingerprint === fingerprint,
  );
}
