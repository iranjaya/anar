import { parseArgs } from "node:util";
import { createPlatformDb, type PlatformDb } from "@anar/db/platform";
import {
  type AuthUser,
  type BootstrapOwnerInput,
  bootstrapOwnerSchema,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { v7 } from "uuid";
import audit from "../tenant/audit.js";
import repository from "./repository.js";

const bootstrap = {
  async bootstrapOwner(
    db: PlatformDb,
    input: BootstrapOwnerInput,
  ): Promise<AuthUser> {
    const parsed = bootstrapOwnerSchema.safeParse(input);
    if (!parsed.success)
      throw new AppError(
        "validation",
        "Environment, email and name are required",
      );
    return db.transaction(async (tx) => {
      const result = await repository.bootstrapOwner(tx, {
        id: v7(),
        email: parsed.data.email,
        name: parsed.data.name,
      });
      if (result.created) {
        await audit.audit(
          tx,
          {
            user: result.user,
            role: "owner",
            agencyId: null,
            companyId: null,
            ip: null,
          },
          "auth.bootstrap_owner",
          { type: "user", id: result.user.id },
          { environment: parsed.data.environment },
        );
      }
      return result.user;
    });
  },

  async _main(): Promise<void> {
    const { values } = parseArgs({
      options: {
        environment: { type: "string" },
        email: { type: "string" },
        name: { type: "string" },
      },
    });
    const input = bootstrapOwnerSchema.safeParse(values);
    if (!input.success)
      throw new AppError("validation", "Use --environment, --email and --name");
    if (input.data.environment !== process.env.ANAR_ENV) {
      throw new AppError("validation", "--environment must match ANAR_ENV");
    }
    const url = process.env.DATABASE_URL;
    if (!url) throw new AppError("validation", "DATABASE_URL is required");
    const db = await createPlatformDb(url);
    try {
      await bootstrap.bootstrapOwner(db, input.data);
      console.log("Owner bootstrap complete");
    } finally {
      await db.close();
    }
  },
};

export default bootstrap;

if (import.meta.main) {
  await bootstrap._main().catch((error: unknown) => {
    console.error(
      error instanceof AppError ? error.message : "Owner bootstrap failed",
    );
    process.exitCode = 1;
  });
}
