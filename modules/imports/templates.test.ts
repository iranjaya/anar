import { describe, expect, it } from "vitest";
import { templateNameFromFile } from "./templates";

describe("templateNameFromFile", () => {
  it("removes the Meta export dates", () => {
    expect(
      templateNameFromFile(
        "Sundar Heights 2 3 BHK October_Leads_2026-10-14_2026-10-28.csv",
      ),
    ).toBe("Sundar Heights 2 3 BHK October");
  });

  it("keeps a name without the Meta export tail", () => {
    expect(templateNameFromFile("Pahad View October.csv")).toBe(
      "Pahad View October.csv",
    );
  });
});
