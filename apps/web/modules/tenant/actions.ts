"use server";

import { revalidatePath } from "next/cache";
import { cookies } from "next/headers";
import { z } from "zod";
import { type ActionResult, actionFailure } from "@/lib/errors";
import { resetDemo, setDemoFailure, switchDemoUser } from "./server";

export async function switchDemoUserAction(input: {
  userId: string;
}): Promise<ActionResult<{ redirectTo: string }>> {
  const parsed = z.object({ userId: z.string().min(1) }).safeParse(input);
  if (!parsed.success)
    return { ok: false, error: "validation", message: "Choose a demo user." };
  try {
    const { demo, redirectTo } = await switchDemoUser(parsed.data.userId);
    (await cookies()).set("anar_demo", JSON.stringify(demo), {
      httpOnly: true,
      sameSite: "lax",
      path: "/",
    });
    return { ok: true, data: { redirectTo } };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function resetDemoAction(): Promise<ActionResult<void>> {
  try {
    await resetDemo();
    (await cookies()).delete("anar_demo");
    revalidatePath("/", "layout");
    return { ok: true, data: undefined };
  } catch (error) {
    return actionFailure(error);
  }
}

export async function setDemoFailureAction(input: {
  on: boolean;
}): Promise<ActionResult<void>> {
  const parsed = z.object({ on: z.boolean() }).safeParse(input);
  if (!parsed.success)
    return {
      ok: false,
      error: "validation",
      message: "Choose whether to simulate failure.",
    };
  try {
    await setDemoFailure(parsed.data.on);
    return { ok: true, data: undefined };
  } catch (error) {
    return actionFailure(error);
  }
}
