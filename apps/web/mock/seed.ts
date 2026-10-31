import { createHash } from "node:crypto";
import { TZDate } from "@date-fns/tz";
import { format, startOfDay } from "date-fns";
import type { Mapping } from "@/modules/imports/types";
import type { Lead, LeadEventType, Priority } from "@/modules/leads/types";
import type { Target } from "@/modules/reports/types";
import type { ScoringRule } from "@/modules/scoring/types";
import type { Stage } from "@/modules/settings/types";
import type { Role } from "@/modules/tenant/types";
import {
  companyNames,
  familyNames,
  givenNames,
  people,
  storyNames,
} from "./names";
import type { MockStore } from "./store";

export function buildSeed(now: Date): MockStore {
  const hour = 3_600_000;
  const day = 24 * hour;
  const localNow = new TZDate(now, "Asia/Kathmandu");
  const today = startOfDay(localNow).getTime();
  const at = (days: number, hours = 10) =>
    new Date(today + days * day + hours * hour);
  const step = Math.min(hour, (now.getTime() - today) / 4);
  const ago = (hours: number) => new Date(now.getTime() - hours * step);
  const morning = new Date(Math.min(today + 8 * hour, now.getTime()));
  let randomState = 20261028;
  const random = () => {
    randomState = (Math.imul(randomState, 1664525) + 1013904223) >>> 0;
    return randomState / 2 ** 32;
  };
  const store: MockStore = {
    companies: [
      {
        id: "sundar-heights",
        name: companyNames.sundar,
        slug: "sundar-heights",
        status: "active",
        defaultCountry: "NP",
        timezone: "Asia/Kathmandu",
      },
      {
        id: "pahad-view",
        name: companyNames.pahad,
        slug: "pahad-view",
        status: "active",
        defaultCountry: "NP",
        timezone: "Asia/Kathmandu",
      },
    ],
    users: [
      {
        id: "rohan",
        name: people.rohan,
        email: "rohan@example.test",
        platformRole: "dna",
      },
    ],
    members: [],
    fields: [],
    stages: [],
    outcomes: [],
    lostReasons: [],
    scoringConfigs: [],
    mappingTemplates: [],
    importBatches: [],
    importRows: [],
    leads: [],
    followUps: [],
    events: [],
    targets: [],
  };
  const memberInfo: [keyof typeof people, string, Role][] = [
    ["prakash", "sundar-heights", "super_admin"],
    ["sunaina", "sundar-heights", "admin"],
    ["aakash", "sundar-heights", "admin"],
    ["rojina", "sundar-heights", "admin"],
    ["sujan", "sundar-heights", "admin"],
    ["prerana", "sundar-heights", "admin"],
    ["mina", "pahad-view", "super_admin"],
    ["dipen", "pahad-view", "admin"],
    ["ritu", "pahad-view", "admin"],
  ];
  const targetValues: [Target["metric"], Target["period"], number][] = [
    ["calls", "day", 30],
    ["calls", "week", 150],
    ["calls", "month", 600],
    ["site_visits", "week", 3],
    ["bookings", "month", 2],
  ];
  for (const [id, companyId, role] of memberInfo) {
    store.users.push({
      id,
      name: people[id],
      email: `${id}@example.test`,
      platformRole: null,
    });
    store.members.push({
      id: `${companyId}-${id}`,
      companyId,
      userId: id,
      name: people[id],
      role,
      status: "active",
    });
    if (role === "admin") {
      for (const [metric, period, value] of targetValues) {
        store.targets.push({
          id: `${id}-${metric}-${period}`,
          companyId,
          memberId: `${companyId}-${id}`,
          metric,
          period,
          value,
          startsOn: at(-90, 0),
          endsOn: null,
        });
      }
    }
  }

  const stageNames: [string, Stage["kind"]][] = [
    ["New Lead", "open"],
    ["Contacted", "open"],
    ["Qualified", "open"],
    ["Follow-up", "open"],
    ["Site Visit", "open"],
    ["Negotiation", "open"],
    ["Booked", "won"],
    ["Lost", "lost"],
  ];
  const outcomeNames = [
    "Connected - High Interest",
    "Connected - Low Interest",
    "Not Interested",
    "No Answer",
    "Callback Requested",
    "Budget Discussion",
    "Site Visit Scheduled",
    "Site Visit Done",
    "Negotiation Started",
    "Document Submitted",
  ];
  const lostReasonNames = [
    "Too Expensive",
    "Wrong Location",
    "Bought from Competitor",
    "Not Responding",
    "Not Genuine Lead",
    "Changed Mind",
    "Other",
  ];
  const timelinePoints = {
    "<15 days": 4,
    "15-30 days": 3,
    "1-3 months": 2,
    "3+ months": 1,
    within_1_month: 4,
    within_2_months: 3,
    within_3_months: 2,
    just_exploring: 1,
  };
  const apartmentPoints = {
    "1_bhk": 2,
    "2_bhk": 2,
    "3_bhk": 2,
    not_sure_yet: 0,
  };
  const purposePoints = {
    "for_myself/family": 2,
    both: 2,
    investment: 1,
    just_exploring: 0,
  };
  const baseFields: [string, string, [string, string][] | null][] = [
    [
      "purchase_timeline",
      "Purchase timeline",
      [
        ["<15 days", "Under 15 days"],
        ["15-30 days", "15 to 30 days"],
        ["1-3 months", "1 to 3 months"],
        ["3+ months", "Over 3 months"],
        ["within_1_month", "Within 1 month"],
        ["within_2_months", "Within 2 months"],
        ["within_3_months", "Within 3 months"],
        ["just_exploring", "Just exploring"],
      ],
    ],
    [
      "budget_fit",
      "Budget fit",
      [
        ["Yes", "Yes"],
        ["Maybe", "Maybe"],
      ],
    ],
    [
      "decision_maker",
      "Decision maker",
      [
        ["Yes", "Yes"],
        ["Shared", "Shared"],
      ],
    ],
  ];
  const sundarFields: typeof baseFields = [
    [
      "apartment_type",
      "Apartment type",
      [
        ["1_bhk", "1 BHK"],
        ["2_bhk", "2 BHK"],
        ["3_bhk", "3 BHK"],
        ["not_sure_yet", "Not sure yet"],
      ],
    ],
    [
      "purchase_purpose",
      "Purchase purpose",
      [
        ["for_myself/family", "For myself or family"],
        ["both", "Both"],
        ["investment", "Investment"],
        ["just_exploring", "Just exploring"],
      ],
    ],
    ["job_title", "Job title", null],
  ];
  for (const company of store.companies) {
    const companyId = company.id;
    stageNames.forEach(([name, kind], position) => {
      store.stages.push({
        id: `${companyId}-stage-${position}`,
        companyId,
        name,
        position,
        kind,
        isDefault: position === 0,
      });
    });
    outcomeNames.forEach((name, position) => {
      store.outcomes.push({
        id: `${companyId}-outcome-${position}`,
        companyId,
        name,
        position,
        countsAsFailed: [
          "No Answer",
          "Not Interested",
          "Callback Requested",
        ].includes(name),
      });
    });
    lostReasonNames.forEach((name, position) => {
      store.lostReasons.push({
        id: `${companyId}-reason-${position}`,
        companyId,
        name,
        position,
      });
    });
    let fields = baseFields;
    if (companyId === "sundar-heights")
      fields = [...baseFields, ...sundarFields];
    fields.forEach(([key, label, options], position) => {
      store.fields.push({
        id: `${companyId}-${key}`,
        companyId,
        key,
        label,
        type: options ? "dropdown" : "text",
        options: options?.map(([value, label]) => ({ value, label })) ?? null,
        isSystem: false,
        position,
        archivedAt: null,
      });
    });
    const rules: ScoringRule[] = [
      {
        fieldKey: "purchase_timeline",
        kind: "options",
        points: { ...timelinePoints },
      },
      { fieldKey: "budget_fit", kind: "options", points: { Yes: 3, Maybe: 2 } },
      {
        fieldKey: "decision_maker",
        kind: "options",
        points: { Yes: 2, Shared: 1 },
      },
    ];
    if (companyId === "sundar-heights") {
      rules.push(
        {
          fieldKey: "apartment_type",
          kind: "options",
          points: { ...apartmentPoints },
        },
        {
          fieldKey: "purchase_purpose",
          kind: "options",
          points: { ...purposePoints },
        },
      );
    }
    store.scoringConfigs.push({
      id: `${companyId}-scoring-1`,
      companyId,
      version: 1,
      basePoints: 1,
      hotMin: 8,
      warmMin: 5,
      rules,
      active: true,
    });
  }

  const campaignName = `${companyNames.sundar} | Lead | ${format(localNow, "MMMM yyyy")}`;
  const mapping: Mapping = [
    { header: "created_time", target: "system:lead_date" },
    { header: "campaign_name", target: "system:campaign_name" },
    { header: "platform", target: "system:source" },
    {
      header: "which_apartment_are_you_planning_to_purchase?",
      target: "field:apartment_type",
    },
    {
      header: "when_are_you_planning_to_purchase?_",
      target: "field:purchase_timeline",
    },
    {
      header: "what_is_your_primary_purpose?",
      target: "field:purchase_purpose",
    },
    { header: "full_name", target: "system:full_name" },
    { header: "phone", target: "system:phone" },
    { header: "job_title", target: "field:job_title" },
    { header: "email", target: "system:email" },
  ];
  const headers = mapping.map(({ header }) => header);
  const normalisedHeaders = headers
    .map((header) =>
      header
        .trim()
        .replace(/\s+/g, " ")
        .toLowerCase()
        .replace(/[?_]+$/, ""),
    )
    .sort();
  store.mappingTemplates.push({
    id: "sundar-meta",
    companyId: "sundar-heights",
    name: `${companyNames.sundar} 2 3 BHK October`,
    headers,
    mapping,
    headerFingerprint: createHash("sha256")
      .update(normalisedHeaders.join("\n"))
      .digest("hex"),
    formName: null,
    campaignName,
    createdBy: "rohan",
    lastUsedAt: morning,
  });

  const scorePresets: {
    score: number;
    priority: Priority;
    custom: Lead["custom"];
    breakdown: Record<string, number>;
  }[] = [
    {
      score: 10,
      priority: "hot",
      custom: {
        purchase_timeline: "within_1_month",
        apartment_type: "3_bhk",
        purchase_purpose: "for_myself/family",
        decision_maker: "Shared",
      },
      breakdown: {
        base: 1,
        purchase_timeline: 4,
        apartment_type: 2,
        purchase_purpose: 2,
        decision_maker: 1,
      },
    },
    {
      score: 6,
      priority: "warm",
      custom: {
        purchase_timeline: "within_3_months",
        apartment_type: "2_bhk",
        purchase_purpose: "investment",
      },
      breakdown: {
        base: 1,
        purchase_timeline: 2,
        apartment_type: 2,
        purchase_purpose: 1,
      },
    },
    {
      score: 3,
      priority: "cold",
      custom: {
        purchase_timeline: "just_exploring",
        apartment_type: "not_sure_yet",
        purchase_purpose: "investment",
      },
      breakdown: {
        base: 1,
        purchase_timeline: 1,
        apartment_type: 0,
        purchase_purpose: 1,
      },
    },
  ];
  const admins = store.members.filter(
    (member) =>
      member.companyId === "sundar-heights" && member.role === "admin",
  );
  const stages = store.stages.filter(
    (stage) => stage.companyId === "sundar-heights",
  );
  const outcomes = store.outcomes.filter(
    (outcome) => outcome.companyId === "sundar-heights",
  );
  for (let index = 0; index < 420; index++) {
    const story = index < 10;
    const unassigned = index >= 375;
    const fresh = story && index >= 6;
    let member = admins[1 + (index % 4)];
    if (story) member = admins[0];
    let stage = stages[Math.floor(random() * stages.length)];
    if (unassigned || fresh) stage = stages[0];
    if (story && !fresh) stage = stages[3];
    let leadDate = at(-8 - Math.floor(random() * 20), 9);
    if (story) leadDate = at(-12, 9);
    if (fresh) leadDate = ago(3);
    if (unassigned) leadDate = new Date(morning);
    let assignedAt = new Date(leadDate.getTime() + hour);
    if (fresh) assignedAt = ago(2);
    let nextActionAt: Date | null = null;
    if (!unassigned && stage.kind === "open" && !fresh) {
      nextActionAt = at(1);
      if (member.userId === "rojina" || index % 5 === 0)
        nextActionAt = at(-1 - (index % 4));
      if (story && index < 3) nextActionAt = at(-[2, 3, 1][index]);
      if (story && index >= 3)
        nextActionAt = new Date(
          now.getTime() + ((today + day - now.getTime()) * (index - 2)) / 4,
        );
    }
    let contactCount = 1 + (index % 3);
    if (stage.isDefault || unassigned || fresh) contactCount = 0;
    if (index === 3) contactCount = 5;
    let lastCallAt = at(-1 - (index % 6));
    if (index % 3 === 0 || (story && index >= 3)) lastCallAt = ago(1);
    if (index === 0) lastCallAt = at(-3);
    const lastContactedAt = contactCount > 0 ? lastCallAt : null;
    let outcome = outcomes[0];
    if (index % 3 === 0) outcome = outcomes[3];
    if (stage.position === 4) outcome = outcomes[7];
    if (stage.kind === "won") outcome = outcomes[9];
    if (stage.kind === "lost") outcome = outcomes[2];
    let preset = scorePresets[Math.floor(random() * scorePresets.length)];
    if (index === 0) preset = scorePresets[0];
    let phone = `+97798${10000000 + index}`;
    if (!story && index % 53 === 0) phone = `+9198${10000000 + index}`;
    if (!story && index % 79 === 0) phone = `+9715${10000000 + index}`;
    const phoneValid = index !== 8;
    let fullName = `${givenNames[Math.floor(random() * givenNames.length)]} ${familyNames[Math.floor(random() * familyNames.length)]}`;
    if (story) fullName = storyNames[index];
    const lead: Lead = {
      id: `sundar-lead-${String(index + 1).padStart(3, "0")}`,
      companyId: "sundar-heights",
      fullName,
      phoneE164: phoneValid ? phone : null,
      phoneRaw: phoneValid ? `p:${phone}` : "p:+97798123",
      phoneValid,
      email: index === 9 ? null : `lead-${index + 1}@example.test`,
      source: index % 4 === 0 ? "instagram" : "facebook",
      sourceKind: "import",
      externalId: null,
      leadDate,
      campaignName,
      formName: null,
      assignedTo: unassigned ? null : member.id,
      stageId: stage.id,
      lostReasonId:
        stage.kind === "lost" ? `sundar-heights-reason-${index % 7}` : null,
      custom: {
        ...preset.custom,
        job_title: ["Architect", "Teacher", "Engineer"][index % 3],
      },
      score: preset.score,
      priority: preset.priority,
      scoreBreakdown: { ...preset.breakdown },
      scoredAt: new Date(leadDate),
      nextActionAt,
      lastContactedAt,
      failedAttempts: outcome.countsAsFailed ? contactCount : 0,
      lostSuggestedAt: index === 3 ? lastContactedAt : null,
      importBatchId: null,
      mergedIntoId: null,
      deletedAt: null,
      createdAt: new Date(leadDate),
    };
    store.leads.push(lead);
    const event = (
      type: LeadEventType,
      createdAt: Date,
      actorMemberId: string | null,
      actorUserId: string,
      data: Record<string, unknown>,
    ) => {
      store.events.push({
        id: `${lead.id}-event-${store.events.length + 1}`,
        companyId: lead.companyId,
        leadId: lead.id,
        type,
        actorMemberId,
        actorUserId,
        data,
        createdAt: new Date(createdAt),
      });
    };
    event("imported", leadDate, null, "rohan", {});
    if (unassigned) continue;
    event("assigned", assignedAt, "sundar-heights-prakash", "prakash", {
      from: null,
      to: member.id,
    });
    for (let call = 0; call < contactCount; call++) {
      const happenedAt = new Date(
        lastCallAt.getTime() - (contactCount - call - 1) * day,
      );
      const previousStage = call === 0 ? stages[0].id : stage.id;
      const followUpId = `${lead.id}-call-${call + 1}`;
      store.followUps.push({
        id: followUpId,
        companyId: lead.companyId,
        leadId: lead.id,
        byMemberId: member.id,
        outcomeId: outcome.id,
        notes: "Asked to call again.",
        happenedAt,
        nextActionAt: lead.nextActionAt,
        stageBeforeId: previousStage,
        stageAfterId: stage.id,
      });
      event("follow_up_logged", happenedAt, member.id, member.userId, {
        followUpId,
        outcomeId: outcome.id,
      });
      if (previousStage !== stage.id)
        event("stage_changed", happenedAt, member.id, member.userId, {
          from: previousStage,
          to: stage.id,
        });
    }
    if (lead.lostSuggestedAt)
      event("lost_suggested", lead.lostSuggestedAt, member.id, member.userId, {
        failedAttempts: 5,
      });
  }
  return store;
}
