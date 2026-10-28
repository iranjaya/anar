import { afterEach, beforeEach, describe, expect, it } from "vitest";
import { resetDemoStore, setDemoFailure, store } from "@/mock/access";
import { resolveContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { addImportedLeads } from "../server";
import type { Lead } from "../types";

const now = new Date("2026-10-28T12:00:00+05:45");

describe("addImportedLeads", () => {
  let ctx: Ctx;
  let data: Awaited<ReturnType<typeof store>>;
  let lead: Lead;

  beforeEach(async () => {
    await resetDemoStore(now);
    ctx = await resolveContext(
      { userId: "rohan", actingCompanyId: "sundar-heights" },
      "sundar-heights",
    );
    data = await store();
    lead = { ...structuredClone(data.leads[0]), id: "import-one" };
  });
  afterEach(async () => {
    await setDemoFailure(false);
  });

  it("adds unassigned leads with one imported event each", async () => {
    const leads = [lead, { ...lead, id: "import-two" }];
    const leadCount = data.leads.length;
    const eventCount = data.events.length;
    await expect(addImportedLeads(ctx, leads)).resolves.toEqual({ added: 2 });
    expect(data.leads).toHaveLength(leadCount + 2);
    expect(data.events).toHaveLength(eventCount + 2);
    for (const input of leads) {
      expect(data.leads.find((item) => item.id === input.id)).toEqual({
        ...input,
        assignedTo: null,
      });
      const events = data.events.filter((event) => event.leadId === input.id);
      expect(events).toHaveLength(1);
      expect(events[0]).toMatchObject({
        id: expect.any(String),
        type: "imported",
        companyId: ctx.companyId,
        actorMemberId: null,
        actorUserId: ctx.user.id,
        createdAt: expect.any(Date),
      });
    }
    expect(lead.assignedTo).toBe("sundar-heights-sunaina");
    expect(data.events[eventCount].id).not.toBe(data.events[eventCount + 1].id);
  });

  it("keeps an existing lead and its events when its id is imported again", async () => {
    const existing = structuredClone(data.leads[0]);
    const events = structuredClone(data.events);
    await expect(
      addImportedLeads(ctx, [{ ...existing, fullName: "Changed name" }]),
    ).resolves.toEqual({ added: 0 });
    expect(data.leads.find((item) => item.id === existing.id)).toEqual(
      existing,
    );
    expect(data.events).toEqual(events);
  });

  it("adds each id once within a batch and across repeated batches", async () => {
    const leadCount = data.leads.length;
    const eventCount = data.events.length;
    await expect(addImportedLeads(ctx, [lead, lead])).resolves.toEqual({
      added: 1,
    });
    await expect(addImportedLeads(ctx, [lead])).resolves.toEqual({ added: 0 });
    expect(data.leads).toHaveLength(leadCount + 1);
    expect(data.events).toHaveLength(eventCount + 1);
    expect(
      data.events.filter((event) => event.leadId === lead.id),
    ).toHaveLength(1);
  });

  it.each(["sunaina", "prakash"])(
    "refuses imports from %s without writing",
    async (userId) => {
      const memberCtx = await resolveContext(
        { userId, actingCompanyId: ctx.companyId },
        "sundar-heights",
      );
      const before = structuredClone(data);
      await expect(addImportedLeads(memberCtx, [lead])).rejects.toMatchObject({
        name: "AppError",
        code: "forbidden",
      });
      expect(data).toEqual(before);
    },
  );

  it.each([null, "pahad-view"])(
    "refuses DNA acting in %s without writing",
    async (actingCompanyId) => {
      const before = structuredClone(data);
      await expect(
        addImportedLeads(
          { ...ctx, session: { ...ctx.session, actingCompanyId } },
          [lead],
        ),
      ).rejects.toMatchObject({
        name: "AppError",
        code: "forbidden",
      });
      expect(data).toEqual(before);
    },
  );

  it("rejects a foreign lead before adding any lead in the batch", async () => {
    const before = structuredClone(data);
    await expect(
      addImportedLeads(ctx, [
        lead,
        { ...lead, id: "foreign-lead", companyId: "pahad-view" },
      ]),
    ).rejects.toMatchObject({ name: "AppError", code: "validation" });
    expect(data).toEqual(before);
  });

  it("propagates a store failure without writing", async () => {
    const before = structuredClone(data);
    await setDemoFailure(true);
    await expect(addImportedLeads(ctx, [lead])).rejects.toMatchObject({
      name: "AppError",
      code: "unavailable",
    });
    expect(data).toEqual(before);
  });
});
