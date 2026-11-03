import { LogCallSheet } from "@/modules/followups/pages";
import { TodayPage } from "@/modules/leads/pages";

export default async function Page({
  params,
  searchParams,
}: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<{ lead?: string | string[] }>;
}) {
  const { slug } = await params;
  return (
    <TodayPage
      params={params}
      searchParams={searchParams}
      callSheet={(leadId) => <LogCallSheet slug={slug} leadId={leadId} />}
    />
  );
}
