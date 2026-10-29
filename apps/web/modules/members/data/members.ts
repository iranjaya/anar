import { AppError } from "@/lib/errors";
import { store } from "@/mock/access";
import { can, verifyContext } from "@/modules/tenant/server";
import type { Ctx, Member } from "@/modules/tenant/types";

export async function listMembers(ctx: Ctx): Promise<Member[]> {
  const current = await verifyContext(ctx);
  if (!can(current, "members.list"))
    throw new AppError("forbidden", "You cannot view this team.");
  const data = await store();
  return data.members.filter(
    (member) => member.companyId === current.companyId,
  );
}
