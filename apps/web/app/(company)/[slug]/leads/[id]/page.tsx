import { dataMode } from "@/lib/api/mode";
import { LogCallSheet } from "@/modules/followups/pages";
import { LeadDetailPage, LeadRecordPage } from "@/modules/leads/pages";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string; id: string }>;
  searchParams: Promise<{
    events?: string | string[];
    log?: string | string[];
  }>;
}) {
  const { slug, id } = await params;
  const { log } = await searchParams;
  const callSheet =
    log === "1" ? <LogCallSheet slug={slug} leadId={id} /> : undefined;
  if (dataMode() === "real")
    return (
      <LeadRecordPage
        params={params}
        searchParams={searchParams}
        callSheet={callSheet}
      />
    );
  return <LeadDetailPage params={params} callSheet={callSheet} />;
}
