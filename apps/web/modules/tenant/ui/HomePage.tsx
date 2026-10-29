import { dataMode } from "@/lib/api/mode";
import { SessionHomePage } from "@/modules/auth/pages";

export async function HomePage() {
  if (dataMode() === "demo") {
    const { DemoHomePage } = await import("./DemoHomePage");
    return <DemoHomePage />;
  }
  return <SessionHomePage />;
}
