import { AppError } from "@anar/domain/errors";
import { leadFiltersSchema } from "@anar/domain/leads";
import { describe, expect, it } from "vitest";
import cursor from "../../src/modules/leads/cursor.js";
import list from "../../src/modules/leads/list.js";
import repository from "../../src/modules/leads/repository.js";
import type { Ctx } from "../../src/modules/tenant/index.js";

const memberId = "01900000-0000-7000-8000-000000000001";
const otherId = "01900000-0000-7000-8000-000000000002";
const leadId = "01900000-0000-7000-8000-000000000003";
const admin = { role: "admin", member: { id: memberId } } as Ctx;
const manager = { role: "super_admin", member: { id: otherId } } as Ctx;
const staff = { role: "agency_staff", member: null } as Ctx;
const filter = {
  assignedTo: "unassigned",
  priority: null,
  stageId: null,
  q: null,
} as const;
const leadDate = new Date("2026-10-31T08:15:30.123Z");

describe("lead queue filters", () => {
  it("shows managers and entered staff the unassigned queue by default", () => {
    expect(list._filter(manager, {}).assignedTo).toBe("unassigned");
    expect(list._filter(staff, {}).assignedTo).toBe("unassigned");
    expect(list._filter(manager, { assignedTo: memberId }).assignedTo).toBe(
      memberId,
    );
  });

  it("keeps an Admin on their own leads", () => {
    expect(list._filter(admin, {}).assignedTo).toBe(memberId);
    expect(list._filter(admin, { assignedTo: memberId }).assignedTo).toBe(
      memberId,
    );
  });

  it.each(["unassigned", otherId])(
    "refuses an Admin asking for %s",
    (assignedTo) => {
      expect(() => list._filter(admin, { assignedTo })).toThrow(
        new AppError("forbidden", "This action is not allowed"),
      );
    },
  );

  it("trims the search and takes up to 120 characters", () => {
    expect(leadFiltersSchema.parse({ q: "  Sita  " }).q).toBe("Sita");
    expect(leadFiltersSchema.safeParse({ q: "a".repeat(120) }).success).toBe(
      true,
    );
    expect(leadFiltersSchema.safeParse({ q: "a".repeat(121) }).success).toBe(
      false,
    );
  });

  it("treats a blank search as no search", () => {
    expect(list._filter(manager, leadFiltersSchema.parse({ q: "   " })).q).toBe(
      null,
    );
  });

  it.each([
    { assignedTo: "someone" },
    { priority: "boiling" },
    { stageId: "not-a-uuid" },
    { companyId: memberId },
  ])("refuses filters %j", (bad) => {
    expect(leadFiltersSchema.safeParse(bad).success).toBe(false);
  });
});

describe("lead queue phone search", () => {
  it.each([
    ["9841", "+9779841"],
    ["984-12", "+97798412"],
    ["01-4412", "+97714412"],
    ["+977 9841", "+9779841"],
    ["00977 98", "+97798"],
  ])("reads %j as the number prefix %s", (q, prefix) => {
    expect(list._phonePrefix(q, "NP")).toBe(prefix);
  });

  it.each(["Sita", "98", "98a41", "Ram 9841"])(
    "does not search phones for %j",
    (q) => {
      expect(list._phonePrefix(q, "NP")).toBe(null);
    },
  );

  it("matches name wildcards as plain characters", () => {
    expect(repository._escape("50%_off\\")).toBe("50\\%\\_off\\\\");
  });

  it("searches phones only for a number and names only for words", () => {
    expect(list._query({ ...filter, q: "9841" }, "NP")).toMatchObject({
      name: null,
      phonePrefix: "+9779841",
    });
    expect(list._query({ ...filter, q: "Sita" }, "NP")).toMatchObject({
      name: "Sita",
      phonePrefix: null,
    });
  });

  it("ends a phone prefix range just past its last digit", () => {
    expect(repository._prefixEnd("+9779841")).toBe("+9779842");
    expect(repository._prefixEnd("+9779849")).toBe("+977984:");
  });
});

describe("lead queue cursor", () => {
  const fingerprint = list._fingerprint(filter);

  it("reads back the date and id it was made from", () => {
    const value = cursor.encode({ at: leadDate, id: leadId }, fingerprint);
    expect(cursor.decode(value, fingerprint, "bad")).toEqual({
      at: leadDate,
      id: leadId,
    });
  });

  it("refuses a cursor made for other filters", () => {
    const value = cursor.encode({ at: leadDate, id: leadId }, fingerprint);
    const hot = list._fingerprint({ ...filter, priority: "hot" });
    expect(() => cursor.decode(value, hot, "bad page")).toThrow(
      new AppError("validation", "bad page"),
    );
  });

  it("gives each filter its own fingerprint", () => {
    const prints = [
      filter,
      { ...filter, assignedTo: memberId },
      { ...filter, priority: "hot" as const },
      { ...filter, stageId: otherId },
      { ...filter, q: "Sita" },
    ].map((value) => list._fingerprint(value));
    expect(new Set(prints).size).toBe(prints.length);
  });

  it.each([
    ["junk", "junk"],
    ["a date without ms", `2026-10-31T08:15:30Z|${leadId}|${fingerprint}`],
    ["a bad id", `${leadDate.toISOString()}|nope|${fingerprint}`],
    ["an extra part", `${leadDate.toISOString()}|${leadId}|${fingerprint}|x`],
    ["an impossible date", `2026-02-30T08:15:30.123Z|${leadId}|${fingerprint}`],
  ])("refuses %s", (_name, raw) => {
    expect(() =>
      cursor.decode(Buffer.from(raw).toString("base64url"), fingerprint, "bad"),
    ).toThrow(AppError);
  });
});
