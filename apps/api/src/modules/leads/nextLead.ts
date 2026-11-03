import type { TenantTx } from "@anar/db/tenant";
import type { Bucket } from "@anar/domain/leads";
import type { Ctx } from "../tenant/index.js";
import buckets from "./buckets.js";

type NextInput = {
  originalBucket: Bucket | null;
  excludeLeadId: string;
  at: Date;
};

const nextLead = {
  async readOriginalBucket(
    tx: TenantTx,
    current: Ctx,
    leadId: string,
    at: Date,
  ): Promise<Bucket | null> {
    if (!current.member) return null;
    return buckets.bucketForLead(
      tx,
      current.member.id,
      buckets.day(at, current.company.timezone),
      leadId,
    );
  },

  async nextLeadId(
    tx: TenantTx,
    current: Ctx,
    input: NextInput,
  ): Promise<string | null> {
    if (!current.member || !input.originalBucket) return null;
    const rows = await buckets.page(
      tx,
      current.member.id,
      buckets.day(input.at, current.company.timezone),
      input.originalBucket,
      null,
      2,
    );
    return rows.find((row) => row.id !== input.excludeLeadId)?.id ?? null;
  },
};
export default nextLead;
