import { redirect } from "next/navigation";
import { homeFor, requireDemoContext } from "../server";

export async function DemoHomePage() {
  return redirect(homeFor(await requireDemoContext()));
}
