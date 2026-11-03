import { dataMode } from "@/lib/api/mode";
import { LeadQueuePage, UnassignedPage } from "@/modules/leads/pages";

export default function Page(props: {
  params: Promise<{ slug: string }>;
  searchParams: Promise<Record<string, string | string[] | undefined>>;
}) {
  return dataMode() === "demo" ? (
    <UnassignedPage {...props} />
  ) : (
    <LeadQueuePage {...props} />
  );
}
