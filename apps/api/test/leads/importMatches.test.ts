import { findImportMatchesInputSchema } from "@anar/domain/leads";
import { describe, expect, it } from "vitest";

const phone = (n: number) => `+9779800${String(n).padStart(6, "0")}`;

describe("import phone lookup input", () => {
  it("keeps each phone once", () => {
    const parsed = findImportMatchesInputSchema.parse({
      phones: [phone(1), phone(2), phone(1)],
    });
    expect(parsed.phones).toEqual([phone(1), phone(2)]);
  });

  it("takes 500 distinct phones but not 501", () => {
    const phones = Array.from({ length: 501 }, (_, n) => phone(n));
    expect(
      findImportMatchesInputSchema.safeParse({ phones: phones.slice(0, 500) })
        .success,
    ).toBe(true);
    expect(findImportMatchesInputSchema.safeParse({ phones }).success).toBe(
      false,
    );
  });

  it("counts repeated phones once against the limit", () => {
    const phones = [
      ...Array.from({ length: 500 }, (_, n) => phone(n)),
      phone(0),
    ];
    expect(findImportMatchesInputSchema.safeParse({ phones }).success).toBe(
      true,
    );
  });

  it.each(["9779800000001", "+0123456789", "+97798", "+977 9800000001", ""])(
    "refuses %j as a phone",
    (bad) => {
      expect(
        findImportMatchesInputSchema.safeParse({ phones: [bad] }).success,
      ).toBe(false);
    },
  );

  it("refuses extra keys", () => {
    expect(
      findImportMatchesInputSchema.safeParse({ phones: [], companyId: "x" })
        .success,
    ).toBe(false);
  });
});
