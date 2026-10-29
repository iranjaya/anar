import type { ReactNode } from "react";
import { dataMode } from "@/lib/api/mode";
import type { ActionResult } from "@/lib/errors";
import { CompanyAccessFrame } from "@/modules/auth/pages";

export async function CompanyShell(props: {
  children: ReactNode;
  params: Promise<{ slug: string }>;
  onLeaveAction: () => Promise<ActionResult<{ redirectTo: string }>>;
}) {
  if (dataMode() === "demo") {
    const { DemoCompanyShell } = await import("./DemoCompanyShell");
    return <DemoCompanyShell {...props} />;
  }
  return (
    <CompanyAccessFrame params={props.params}>
      {props.children}
    </CompanyAccessFrame>
  );
}
