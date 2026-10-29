import { createHash, randomBytes } from "node:crypto";
import type { PlatformTx } from "@anar/db/platform";
import type { Agency } from "@anar/domain/agencies";
import type { AuthUser } from "@anar/domain/auth";
import { v7 } from "uuid";
import type { createMailCodec } from "../../lib/email/crypto.js";
import inviteEmail from "../../lib/email/templates/invite.js";
import { enqueue } from "../../lib/jobs/index.js";
import repository from "./inviteRepository.js";

export type ReadInitialInviteAgency = (
  tx: PlatformTx,
  agencyId: string,
  ownerId: string,
) => Promise<{ name: string } | undefined>;
export type InviteDeps = {
  publicOrigin: string;
  mailCodec: Pick<ReturnType<typeof createMailCodec>, "encryptMessage">;
  now(): Date;
};
export type InviteService = {
  createInitialInvite(
    tx: PlatformTx,
    actor: { user: AuthUser },
    agency: Agency,
    input: { email: string; name: string },
  ): Promise<{ inviteId: string }>;
};

const invites = {
  create(deps: InviteDeps): InviteService {
    const origin = new URL(deps.publicOrigin);
    if (
      !["http:", "https:"].includes(origin.protocol) ||
      origin.origin !== deps.publicOrigin
    ) {
      throw new Error("Invites require a configured HTTP or HTTPS origin");
    }
    return {
      async createInitialInvite(tx, actor, agency, input) {
        const id = v7();
        const token = randomBytes(32).toString("base64url");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const expiresAt = new Date(deps.now().getTime() + 7 * 86400000);
        await repository.insert(tx, {
          id,
          agencyId: agency.id,
          companyId: null,
          email: input.email,
          name: input.name,
          role: "agency_staff",
          tokenHash,
          expiresAt,
          createdBy: actor.user.id,
        });
        const key = invites.deliveryKey(id, tokenHash);
        const message = inviteEmail.render({
          name: input.name,
          role: "agency_staff",
          agency: agency.name,
          company: null,
          inviter: { name: actor.user.name, role: "owner" },
          url: `${origin.origin}/invite#token=${token}`,
          expiresAt,
          timeZone: "Asia/Kathmandu",
          resent: false,
        });
        await enqueue(
          tx,
          "notify.email",
          {
            kind: "invite",
            referenceId: id,
            expiresAt: expiresAt.toISOString(),
            encryptedMessage: deps.mailCodec.encryptMessage(
              { to: input.email, ...message },
              key,
            ),
          },
          key,
        );
        return { inviteId: id };
      },
    };
  },

  async findDeliverable(
    tx: PlatformTx,
    id: string,
    at: Date,
    readAgency: ReadInitialInviteAgency,
  ) {
    const row = await repository.findDeliverable(tx, id, at);
    if (!row || !(await readAgency(tx, row.agencyId, row.createdBy)))
      return undefined;
    return {
      email: row.email,
      expiresAt: row.expiresAt,
      key: invites.deliveryKey(row.id, row.tokenHash),
    };
  },

  deliveryKey(id: string, tokenHash: string): string {
    return `invite:${id}:${tokenHash}`;
  },
};

export default invites;
