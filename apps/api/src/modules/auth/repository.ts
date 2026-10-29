import { type PlatformTx, users } from "@anar/db/platform";
import type { AuthUser } from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { eq } from "drizzle-orm";

const repository = {
  async bootstrapDna(
    tx: PlatformTx,
    input: { id: string; email: string; name: string },
  ): Promise<{ user: AuthUser; created: boolean }> {
    const [created] = await tx
      .insert(users)
      .values({ ...input, platformRole: "dna" })
      .onConflictDoNothing({ target: users.email })
      .returning();
    if (created) return { user: created, created: true };

    const [existing] = await tx
      .select()
      .from(users)
      .where(eq(users.email, input.email))
      .for("update");
    if (existing?.platformRole !== "dna") {
      throw new AppError(
        "conflict",
        "Bootstrap cannot promote an existing user",
      );
    }
    return { user: existing, created: false };
  },
};

export default repository;
