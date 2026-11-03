"use server";

import type { BucketPage, BucketQuery } from "@anar/domain/leads";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { listRealTodayBucket } from "./data/today";

export async function listTodayBucketAction(
  input: BucketQuery & { slug: string },
): Promise<ActionResult<BucketPage>> {
  try {
    const { slug, ...query } = input;
    return { ok: true, data: await listRealTodayBucket(slug, query) };
  } catch (error) {
    return actionFailure(error);
  }
}
