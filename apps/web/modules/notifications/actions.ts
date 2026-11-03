"use server";

import type { SubscribePushInput } from "@anar/domain/notifications";
import { revalidatePath } from "next/cache";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { markRead, subscribePush, unsubscribePush } from "./server";

export async function markReadAction(
  slug: string,
  id: string,
  _previous: ActionResult<{ ok: true }> | null,
  _form: FormData,
): Promise<ActionResult<{ ok: true }>> {
  try {
    const data = await markRead(slug, [id]);
    revalidatePath(`/${slug}`, "layout");
    return { ok: true, data };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function subscribePushAction(
  slug: string,
  input: SubscribePushInput,
): Promise<ActionResult<{ subscriptionId: string }>> {
  try {
    return { ok: true, data: await subscribePush(slug, input) };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function unsubscribePushAction(
  slug: string,
  subscriptionId: string,
): Promise<ActionResult<{ ok: true }>> {
  try {
    return { ok: true, data: await unsubscribePush(slug, subscriptionId) };
  } catch (error) {
    return actionFailure(error);
  }
}
