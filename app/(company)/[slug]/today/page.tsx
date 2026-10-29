import { LogCallSheet } from "@/modules/followups/pages";
import { TodayPage } from "@/modules/leads/pages";

export default function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lead?: string | string[] }>;
}) {
  return (
    <TodayPage
      params={params}
      searchParams={searchParams}
      callSheet={(leadId) => <LogCallSheet leadId={leadId} />}
    />
  );
}
