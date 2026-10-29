import { LogCallSheet } from "@/modules/followups/pages";
import { LeadDetailPage } from "@/modules/leads/pages";

export default async function Page({
  params,
}: {
  params: Promise<{ slug: string; id: string }>;
}) {
  const { id } = await params;
  return (
    <LeadDetailPage params={params} callSheet={<LogCallSheet leadId={id} />} />
  );
}
