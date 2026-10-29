import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { resetDemoStore, setDemoFailure, store } from "@/mock/access";
import { resolveContext } from "@/modules/tenant/server";
import type { Ctx } from "@/modules/tenant/types";
import { listLeads } from "../server";

const now = new Date("2026-10-28T12:00:00+05:45");

describe("lead list", () => {
  let manager: Ctx;
  let data: Awaited<ReturnType<typeof store>>;

  beforeEach(async () => {
    vi.useFakeTimers();
    vi.setSystemTime(now);
    await resetDemoStore(now);
    manager = await resolveContext(
      { userId: "prakash", actingCompanyId: null },
      "sundar-heights",
    );
    data = await store();
  });
  afterEach(async () => {
    await setDemoFailure(false);
    vi.useRealTimers();
  });

  it.each(["sundar-heights-aakash", "unassigned"])(
    "keeps an Admin on own leads when assignedTo is %s",
    async (assignedTo) => {
      const admin = await resolveContext(
        { userId: "sunaina", actingCompanyId: null },
        "sundar-heights",
      );
      const result = await listLeads(admin, { assignedTo });
      expect(result.total).toBe(10);
      expect(result.items).toHaveLength(10);
      expect(
        result.items.every(
          (lead) => lead.assignee?.memberId === "sundar-heights-sunaina",
        ),
      ).toBe(true);
      expect(new Set(result.items.map((lead) => lead.id))).toEqual(
        new Set(
          Array.from(
            { length: 10 },
            (_, index) => `sundar-lead-${String(index + 1).padStart(3, "0")}`,
          ),
        ),
      );
    },
  );

  it("rechecks a forged manager role", async () => {
    const admin = await resolveContext(
      { userId: "sunaina", actingCompanyId: null },
      "sundar-heights",
    );
    const result = await listLeads(
      { ...admin, role: "super_admin", member: manager.member },
      { assignedTo: "unassigned" },
    );
    expect(result.total).toBe(10);
    expect(
      result.items.every(
        (lead) => lead.assignee?.memberId === "sundar-heights-sunaina",
      ),
    ).toBe(true);
  });

  it("lists the company queue without deleted, merged or foreign leads", async () => {
    const first = data.leads.find((lead) => lead.id === "sundar-lead-376");
    const second = data.leads.find((lead) => lead.id === "sundar-lead-377");
    if (!first || !second) throw new Error("Queue leads missing");
    first.deletedAt = now;
    second.mergedIntoId = "sundar-lead-378";
    data.leads.push({
      ...first,
      id: "foreign",
      companyId: "pahad-view",
      deletedAt: null,
    });
    const result = await listLeads(manager, { assignedTo: "unassigned" });
    expect(result.total).toBe(43);
    expect(result.nextCursor).toBeNull();
    expect(result.items.every((lead) => lead.assignee === null)).toBe(true);
    for (const id of [first.id, second.id, "foreign"])
      expect(result.items.map((lead) => lead.id)).not.toContain(id);
    expect(result.items[0].id).toBe("sundar-lead-378");
  });

  it("searches names and phones with the score filter", async () => {
    const lead = data.leads.find((lead) => lead.id === "sundar-lead-376");
    if (!lead) throw new Error("Queue lead missing");
    lead.fullName = "Queue Search Person";
    lead.priority = "hot";
    const byName = await listLeads(manager, {
      assignedTo: "unassigned",
      q: "  QUEUE SEARCH  ",
      priority: "hot",
    });
    expect(byName.items.map((row) => row.id)).toEqual([lead.id]);
    expect(byName.total).toBe(1);
    expect(
      (
        await listLeads(manager, {
          assignedTo: "unassigned",
          q: lead.phoneE164 ?? "",
          priority: "hot",
        })
      ).items.map((row) => row.id),
    ).toEqual([lead.id]);
    await expect(
      listLeads(manager, {
        assignedTo: "unassigned",
        q: "Queue Search",
        priority: "cold",
      }),
    ).resolves.toEqual({ items: [], total: 0, nextCursor: null });
  });

  it("pages through every lead once, 50 at a time", async () => {
    const ids: string[] = [];
    let cursor: string | undefined;
    for (let index = 0; index < 9; index++) {
      const page = await listLeads(manager, { cursor });
      expect(page.total).toBe(420);
      expect(page.items).toHaveLength(index === 8 ? 20 : 50);
      ids.push(...page.items.map((lead) => lead.id));
      if (index === 8) expect(page.nextCursor).toBeNull();
      else expect(page.nextCursor).toBe(page.items.at(-1)?.id);
      cursor = page.nextCursor ?? undefined;
    }
    expect(new Set(ids).size).toBe(420);
    expect(ids[0]).toBe("sundar-lead-007");
  });

  it("rejects an unknown cursor", async () => {
    await expect(
      listLeads(manager, { cursor: "missing" }),
    ).rejects.toMatchObject({ code: "validation" });
  });

  it("returns an empty queue for Pahad", async () => {
    const ctx = await resolveContext(
      { userId: "mina", actingCompanyId: null },
      "pahad-view",
    );
    await expect(listLeads(ctx, { assignedTo: "unassigned" })).resolves.toEqual(
      { items: [], total: 0, nextCursor: null },
    );
  });

  it("propagates a failed load instead of an empty list", async () => {
    await setDemoFailure(true);
    await expect(
      listLeads(manager, { assignedTo: "unassigned" }),
    ).rejects.toMatchObject({ code: "unavailable" });
  });
});
