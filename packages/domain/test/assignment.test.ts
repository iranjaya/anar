import {
  assignLeadsInputSchema,
  assignLeadsResultSchema,
} from "@anar/domain/assignment";
import { describe, expect, it } from "vitest";

const id = (n: number) =>
  `01900000-0000-7000-8000-${String(n).padStart(12, "0")}`;
const ids = (count: number) => Array.from({ length: count }, (_, n) => id(n));

describe("assignment input", () => {
  it("takes 1 to 500 different leads", () => {
    for (const count of [1, 500])
      expect(
        assignLeadsInputSchema.safeParse({
          leadIds: ids(count),
          memberId: id(999),
        }).success,
      ).toBe(true);
  });

  it.each([
    ["no leads", []],
    ["501 leads", ids(501)],
    ["a lead twice", [id(1), id(1)]],
    ["a made-up id", ["nope"]],
  ])("refuses %s", (_name, leadIds) => {
    expect(
      assignLeadsInputSchema.safeParse({ leadIds, memberId: id(999) }).success,
    ).toBe(false);
  });

  it("takes null to unassign, but needs the member key", () => {
    expect(
      assignLeadsInputSchema.safeParse({ leadIds: [id(1)], memberId: null })
        .success,
    ).toBe(true);
    expect(assignLeadsInputSchema.safeParse({ leadIds: [id(1)] }).success).toBe(
      false,
    );
  });

  it("reads the count back and refuses anything else", () => {
    expect(assignLeadsResultSchema.parse({ updated: 3 })).toEqual({
      updated: 3,
    });
    expect(assignLeadsResultSchema.safeParse({ updated: -1 }).success).toBe(
      false,
    );
    expect(
      assignLeadsResultSchema.safeParse({ updated: 1, extra: true }).success,
    ).toBe(false);
  });
});
