import { leadEvents, type TenantTx } from "@anar/db/tenant";
import { v7 } from "uuid";

type EventRow = typeof leadEvents.$inferInsert;
export type EventActor = { actorUserId: string; actorMemberId: string | null };

const events = {
  async insert(
    tx: TenantTx,
    companyId: string,
    actor: EventActor,
    rows: (Pick<EventRow, "leadId" | "type" | "data"> & { id?: string })[],
  ): Promise<void> {
    if (rows.length === 0) return;
    await tx.insert(leadEvents).values(
      rows.map((row) => ({
        ...row,
        id: row.id ?? v7(),
        companyId,
        actorUserId: actor.actorUserId,
        actorMemberId: actor.actorMemberId,
      })),
    );
  },
};
export default events;
