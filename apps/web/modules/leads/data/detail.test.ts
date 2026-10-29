import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDemoStore, setDemoFailure, store } from "@/mock/access";
import { resolveContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { getLead } from "../server";

const now = new Date("2026-10-28T12:00:00+05:45");
const leadId = "sundar-lead-001";

describe("lead detail", () => {
  let ctx: Ctx;
  let data: Awaited<ReturnType<typeof store>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await resetDemoStore(now);
    ctx = await resolveContext(
      { userId: "sunaina", actingCompanyId: null },
      "sundar-heights",
    );
    data = await store();
  });
  afterEach(async () => {
    await setDemoFailure(false);
    vi.useRealTimers();
  });

  it("returns Bikash's score and option labels in form order", async () => {
    const detail = await getLead(ctx, leadId);
    expect(detail.lead).toMatchObject({
      id: leadId,
      fullName: "Bikash Thapa",
      priority: "hot",
      score: 10,
    });
    expect(detail.hotMin).toBe(8);
    expect(detail.fields.filter((field) => field.key !== "job_title")).toEqual([
      {
        key: "purchase_timeline",
        label: "Purchase timeline",
        value: "Within 1 month",
      },
      { key: "decision_maker", label: "Decision maker", value: "Shared" },
      { key: "apartment_type", label: "Apartment type", value: "3 BHK" },
      {
        key: "purchase_purpose",
        label: "Purchase purpose",
        value: "For myself or family",
      },
    ]);
  });

  it.each([null, ""])("leaves a field with value %s out", async (value) => {
    data.leads[0].custom.job_title = value;
    expect(
      (await getLead(ctx, leadId)).fields.some(
        (field) => field.key === "job_title",
      ),
    ).toBe(false);
  });

  it("keeps zero as a field value", async () => {
    data.leads[0].custom.job_title = 0;
    expect((await getLead(ctx, leadId)).fields).toContainEqual({
      key: "job_title",
      label: "Job title",
      value: "0",
    });
  });

  it.each(["missing-lead", "sundar-lead-011"])(
    "hides missing or foreign lead %s from an Admin",
    async (id) => {
      await expect(getLead(ctx, id)).rejects.toMatchObject({
        name: "AppError",
        code: "not_found",
        message: "Lead not found.",
      });
    },
  );

  it("hides another company's lead even with the same assignee", async () => {
    data.leads.push({
      ...data.leads[0],
      id: "foreign-company",
      companyId: "pahad-view",
    });
    await expect(getLead(ctx, "foreign-company")).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it.each(["deleted", "merged"])("hides a %s lead", async (state) => {
    if (state === "deleted") data.leads[0].deletedAt = now;
    else data.leads[0].mergedIntoId = "sundar-lead-002";
    await expect(getLead(ctx, leadId)).rejects.toMatchObject({
      code: "not_found",
    });
  });

  it.each(["prakash", "rohan"])(
    "lets %s view company leads",
    async (userId) => {
      const manager = await resolveContext(
        {
          userId,
          actingCompanyId: userId === "rohan" ? "sundar-heights" : null,
        },
        "sundar-heights",
      );
      await expect(getLead(manager, leadId)).resolves.toMatchObject({
        lead: { id: leadId },
      });
    },
  );

  it("reads the company's active Hot threshold", async () => {
    const config = data.scoringConfigs.find(
      (config) => config.companyId === ctx.companyId && config.active,
    );
    expect(config).toBeDefined();
    if (config) config.hotMin = 11;
    expect((await getLead(ctx, leadId)).hotMin).toBe(11);
  });

  it("returns the newest activity first", async () => {
    const detail = await getLead(ctx, leadId);
    expect(detail.events.map((event) => event.type)).toEqual([
      "follow_up_logged",
      "stage_changed",
      "assigned",
      "imported",
    ]);
    expect(detail.events[0].createdAt).toEqual(
      new Date("2026-10-25T10:00:00+05:45"),
    );
    expect(detail.followUps[0].happenedAt).toEqual(detail.events[0].createdAt);
    expect(detail.followUps[0].notes).toBe("Asked to call again.");
  });

  it("rejects a load failure instead of returning empty detail", async () => {
    await setDemoFailure(true);
    await expect(getLead(ctx, leadId)).rejects.toMatchObject({
      code: "unavailable",
    });
  });
});
