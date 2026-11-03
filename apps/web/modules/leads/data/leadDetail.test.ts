import { describe, expect, it } from "vitest";
import { leadDetailSchema, leadTimelinePageSchema } from "./leadDetail";

const id = (n: number) => `01900000-0000-7000-8000-00000000000${n}`;
const lead = {
  id: id(1),
  companyId: id(2),
  fullName: "Sita Sharma",
  phoneE164: null,
  phoneRaw: "98-bad",
  phoneValid: false,
  email: null,
  source: "facebook",
  sourceKind: "import",
  externalId: null,
  leadDate: "2026-10-31T08:15:30.123Z",
  campaignName: "Spring",
  formName: null,
  assignedTo: null,
  stageId: id(3),
  lostReasonId: null,
  custom: { unit_type: "2bhk" },
  score: 42,
  priority: "warm",
  scoreBreakdown: { base: 10 },
  scoredAt: "2026-10-31T08:15:31.000Z",
  nextActionAt: null,
  lastContactedAt: null,
  failedAttempts: 0,
  lostSuggestedAt: null,
  importBatchId: null,
  mergedIntoId: null,
  deletedAt: null,
  createdAt: "2026-10-31T08:15:32.000Z",
};
const event = {
  id: id(4),
  companyId: id(2),
  leadId: id(1),
  type: "imported",
  actorMemberId: null,
  actorUserId: id(5),
  data: { batchId: id(6), rowNo: 1 },
  createdAt: "2026-10-31T08:16:00.000Z",
};
const history = {
  fields: [
    {
      id: id(7),
      companyId: id(2),
      key: "unit_type",
      label: "Unit",
      type: "dropdown",
      options: [{ value: "2bhk", label: "2 BHK" }],
      isSystem: false,
      position: 1,
      archivedAt: "2026-10-30T00:00:00.000Z",
    },
  ],
  stages: [],
  outcomes: [],
  lostReasons: [],
  actors: [{ userId: id(5), memberId: null, name: "Agency staff" }],
};

describe("lead detail from the API", () => {
  it("turns nested wire dates into dates", () => {
    const detail = leadDetailSchema.parse({
      lead,
      hotMin: 70,
      fields: [{ key: "unit_type", label: "Unit", value: "2 BHK" }],
      followUps: [],
      events: [event],
      duplicates: [],
      history,
      nextEventCursor: null,
      suggestionEventId: null,
    });
    expect(detail.lead.leadDate).toEqual(new Date(lead.leadDate));
    expect(detail.lead.scoredAt).toEqual(new Date(lead.scoredAt));
    expect(detail.lead.createdAt).toEqual(new Date(lead.createdAt));
    expect(detail.events[0].createdAt).toEqual(new Date(event.createdAt));
    expect(detail.history.fields[0].archivedAt).toEqual(
      new Date("2026-10-30T00:00:00.000Z"),
    );
  });

  it("reads a later timeline page the same way", () => {
    const page = leadTimelinePageSchema.parse({
      events: [event],
      followUps: [],
      history,
      nextCursor: "next",
    });
    expect(page.events[0].createdAt).toEqual(new Date(event.createdAt));
  });

  it("refuses a lead with a date that is not ISO", () => {
    expect(
      leadDetailSchema.safeParse({
        lead: { ...lead, leadDate: "31/10/2026" },
        hotMin: 70,
        fields: [],
        followUps: [],
        events: [],
        duplicates: [],
        history,
        nextEventCursor: null,
      }).success,
    ).toBe(false);
  });
});
