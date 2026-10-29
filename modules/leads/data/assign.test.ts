import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDemoStore, setDemoFailure, store } from "@/mock/access";
import { resolveContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { assignLeads, getMyToday } from "../server";

const now = new Date("2026-10-28T12:00:00+05:45");
const leadIds = ["sundar-lead-376", "sundar-lead-377", "sundar-lead-378"];
const memberId = "sundar-heights-sunaina";

describe("assign leads", () => {
  let ctx: Ctx;
  let data: Awaited<ReturnType<typeof store>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await resetDemoStore(now);
    ctx = await resolveContext(
      { userId: "prakash", actingCompanyId: null },
      "sundar-heights",
    );
    data = await store();
  });
  afterEach(async () => {
    await setDemoFailure(false);
    vi.useRealTimers();
  });

  it.each(["prakash", "rohan"])(
    "lets %s assign three leads with three events and adds them to New",
    async (userId) => {
      const actor = await resolveContext(
        {
          userId,
          actingCompanyId: userId === "rohan" ? "sundar-heights" : null,
        },
        "sundar-heights",
      );
      const count = data.events.length;
      await expect(assignLeads(actor, { leadIds, memberId })).resolves.toEqual({
        updated: 3,
      });
      const events = data.events.slice(count);
      expect(events).toHaveLength(3);
      expect(new Set(events.map((event) => event.id)).size).toBe(3);
      for (const leadId of leadIds) {
        expect(data.leads.find((lead) => lead.id === leadId)?.assignedTo).toBe(
          memberId,
        );
        expect(events.find((event) => event.leadId === leadId)).toMatchObject({
          companyId: ctx.companyId,
          type: "assigned",
          actorMemberId: actor.member?.id ?? null,
          actorUserId: userId,
          data: { from: null, to: memberId },
          createdAt: now,
        });
      }
      const admin = await resolveContext(
        { userId: "sunaina", actingCompanyId: null },
        "sundar-heights",
      );
      const today = await getMyToday(admin);
      expect(today.newLeads).toHaveLength(7);
      expect(today.newLeads.map((lead) => lead.id)).toEqual(
        expect.arrayContaining(leadIds),
      );
    },
  );

  it.each(["pahad-view-dipen", "missing", "inactive"])(
    "rejects assignee %s without writing",
    async (assignee) => {
      if (assignee === "inactive")
        data.members.push({
          ...data.members[0],
          id: assignee,
          companyId: ctx.companyId,
          status: "deactivated",
        });
      const before = structuredClone(data);
      await expect(
        assignLeads(ctx, { leadIds, memberId: assignee }),
      ).rejects.toMatchObject({ code: "validation" });
      expect(data).toEqual(before);
    },
  );

  it("refuses an Admin even with a forged manager role", async () => {
    const admin = await resolveContext(
      { userId: "sunaina", actingCompanyId: null },
      "sundar-heights",
    );
    const before = structuredClone(data);
    await expect(
      assignLeads(
        { ...admin, role: "super_admin", member: ctx.member },
        { leadIds, memberId },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(data).toEqual(before);
  });

  it("requires DNA to enter the company", async () => {
    const dna = await resolveContext(
      { userId: "rohan", actingCompanyId: ctx.companyId },
      "sundar-heights",
    );
    const before = structuredClone(data);
    await expect(
      assignLeads(
        { ...dna, session: { ...dna.session, actingCompanyId: null } },
        { leadIds, memberId },
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    expect(data).toEqual(before);
  });

  it.each(["foreign", "deleted", "merged", "missing"])(
    "rejects a batch containing a %s lead before writing",
    async (kind) => {
      const lead = { ...data.leads[0], id: "invalid-lead", assignedTo: null };
      if (kind === "foreign") lead.companyId = "pahad-view";
      if (kind === "deleted") lead.deletedAt = now;
      if (kind === "merged") lead.mergedIntoId = leadIds[0];
      if (kind !== "missing") data.leads.push(lead);
      const before = structuredClone(data);
      await expect(
        assignLeads(ctx, { leadIds: [...leadIds, lead.id], memberId }),
      ).rejects.toMatchObject({ code: "not_found" });
      expect(data).toEqual(before);
    },
  );

  it.each([
    { ids: [] },
    { ids: Array.from({ length: 501 }, () => leadIds[0]) },
  ])("rejects a batch outside 1 to 500 leads", async ({ ids }) => {
    const before = structuredClone(data);
    await expect(
      assignLeads(ctx, { leadIds: ids, memberId }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(data).toEqual(before);
  });

  it("writes each lead once and leaves a retry unchanged", async () => {
    const count = data.events.length;
    await expect(
      assignLeads(ctx, { leadIds: [...leadIds, leadIds[0]], memberId }),
    ).resolves.toEqual({ updated: 3 });
    expect(data.events).toHaveLength(count + 3);
    const before = structuredClone(data);
    await expect(assignLeads(ctx, { leadIds, memberId })).resolves.toEqual({
      updated: 0,
    });
    expect(data).toEqual(before);
  });

  it("keeps every lead and event after a store failure", async () => {
    const before = structuredClone(data);
    await setDemoFailure(true);
    await expect(assignLeads(ctx, { leadIds, memberId })).rejects.toMatchObject(
      { code: "unavailable" },
    );
    expect(data).toEqual(before);
  });
});
