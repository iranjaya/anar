import { TZDate } from "@date-fns/tz";
import { format, subDays } from "date-fns";
import type { ImportRow, NewField } from "@/modules/imports/types";
import type { Lead } from "@/modules/leads/types";
import { familyNames, givenNames } from "./names";
import type { MockStore } from "./store";

export const metaHeaders = [
  "created_time",
  "campaign_name",
  "platform",
  "which_apartment_are_you_planning_to_purchase?",
  "when_are_you_planning_to_purchase?_",
  "what_is_your_primary_purpose?",
  "full_name",
  "phone",
  "job_title",
  "email",
];

export const metaFields: NewField[] = [
  {
    header: metaHeaders[3],
    key: "which_apartment_are_you_planning_to_purchase",
    label: "Apartment type",
    type: "dropdown",
    options: [
      { value: "1_bhk", label: "1 BHK" },
      { value: "2_bhk", label: "2 BHK" },
      { value: "3_bhk", label: "3 BHK" },
      { value: "not_sure_yet", label: "Not sure yet" },
    ],
  },
  {
    header: metaHeaders[4],
    key: "when_are_you_planning_to_purchase",
    label: "Purchase timeline",
    type: "dropdown",
    options: [
      { value: "within_1_month", label: "Within 1 month" },
      { value: "within_2_months", label: "Within 2 months" },
      { value: "within_3_months", label: "Within 3 months" },
      { value: "just_exploring", label: "Just exploring" },
    ],
  },
  {
    header: metaHeaders[5],
    key: "what_is_your_primary_purpose",
    label: "Purchase purpose",
    type: "dropdown",
    options: [
      { value: "for_myself/family", label: "For myself or family" },
      { value: "both", label: "Both" },
      { value: "investment", label: "Investment" },
      { value: "just_exploring", label: "Just exploring" },
    ],
  },
  {
    header: metaHeaders[8],
    key: "job_title",
    label: "Job title",
    type: "text",
  },
];

export type MetaRow = {
  lead: Lead;
  raw: Record<string, string>;
  result: ImportRow["result"];
  reason: ImportRow["reason"];
};

export function buildMetaExport(data: MockStore, companyId: string, now: Date) {
  const company = data.companies.find((company) => company.id === companyId);
  if (!company) throw new Error("Demo company not found.");
  const local = new TZDate(now, company.timezone);
  const month = format(local, "MMMM yyyy");
  const campaignName = `${company.name} | Lead | ${month}`;
  const rows: MetaRow[] = [];
  const append = (
    lead: Lead,
    result: MetaRow["result"],
    reason: MetaRow["reason"],
  ) => {
    const values = [
      format(
        new TZDate(lead.leadDate, company.timezone),
        "yyyy-MM-dd'T'HH:mm:ss.SSSXXX",
      ),
      lead.campaignName ?? "",
      lead.source === "instagram" ? "ig" : "fb",
      String(lead.custom.apartment_type ?? ""),
      String(lead.custom.purchase_timeline ?? ""),
      String(lead.custom.purchase_purpose ?? ""),
      lead.fullName ?? "",
      lead.phoneRaw ?? "",
      String(lead.custom.job_title ?? ""),
      lead.email ?? "",
    ];
    rows.push({
      lead,
      raw: Object.fromEntries(
        metaHeaders.map((header, index) => [header, values[index]]),
      ),
      result,
      reason,
    });
  };
  if (company.slug === "sundar-heights") {
    const seeded = data.leads.filter(
      (lead) =>
        lead.companyId === companyId &&
        lead.id.startsWith("sundar-lead-") &&
        lead.phoneValid,
    );
    for (const lead of seeded.slice(0, 371))
      append(structuredClone(lead), "duplicate_db", "same_submission");
    for (const lead of seeded.slice(0, 3))
      append(
        { ...structuredClone(lead), leadDate: new Date(now) },
        "duplicate_db",
        "resubmitted",
      );
  }
  const count = company.slug === "sundar-heights" ? 38 : 64;
  for (let index = 0; index < count; index++) {
    const phoneValid = index < count - 2;
    const phone = `+97798${(company.slug === "sundar-heights" ? 20000000 : 30000000) + index}`;
    let phoneRaw = `p:${phone}`;
    if (index === count - 2) phoneRaw = "p:+97798123";
    if (index === count - 1) phoneRaw = "";
    const leadDate = new Date(now.getTime() - (index + 1) * 60_000);
    const lead: Lead = {
      id: `meta-${companyId}-${index + 1}`,
      companyId,
      fullName: `${givenNames[index % givenNames.length]} ${familyNames[(index * 7) % familyNames.length]}`,
      phoneE164: phoneValid ? phone : null,
      phoneRaw,
      phoneValid,
      email: `meta-${companyId}-${index + 1}@example.test`,
      source: index % 4 === 0 ? "instagram" : "facebook",
      sourceKind: "import",
      externalId: null,
      leadDate,
      campaignName,
      formName: null,
      assignedTo: null,
      stageId: `${companyId}-stage-0`,
      lostReasonId: null,
      custom: {
        apartment_type: "3_bhk",
        purchase_timeline: "within_1_month",
        purchase_purpose: "for_myself/family",
        job_title: "Engineer",
      },
      score: 9,
      priority: "hot",
      scoreBreakdown: {
        base: 1,
        purchase_timeline: 4,
        apartment_type: 2,
        purchase_purpose: 2,
      },
      scoredAt: new Date(leadDate),
      nextActionAt: null,
      lastContactedAt: null,
      failedAttempts: 0,
      lostSuggestedAt: null,
      importBatchId: null,
      mergedIntoId: null,
      deletedAt: null,
      createdAt: new Date(leadDate),
    };
    append(lead, "imported", phoneValid ? null : "invalid_phone");
  }
  const form = `${company.name} 2 3 BHK ${format(local, "MMMM")}`;
  const fileName = `${form}_Leads_${format(subDays(local, 14), "yyyy-MM-dd")}_${format(local, "yyyy-MM-dd")}.csv`;
  const text = [
    metaHeaders.join("\t"),
    ...rows.map((row) =>
      metaHeaders.map((header) => row.raw[header]).join("\t"),
    ),
    "",
  ].join("\r\n");
  return {
    fileName,
    headers: [...metaHeaders],
    rows,
    bytes: Buffer.from(`\uFEFF${text}`, "utf16le"),
  };
}
