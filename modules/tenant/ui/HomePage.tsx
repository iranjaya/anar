import { redirect } from "next/navigation";
import { homeFor, requireDemoContext } from "../server";

export async function HomePage() {
  redirect(homeFor(await requireDemoContext()));
}
