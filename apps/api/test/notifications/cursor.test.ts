import { describe, expect, it } from "vitest";
import notifications from "../../src/modules/notifications/service.js";

const row = {
  createdAt: new Date("2026-10-31T08:15:30.123Z"),
  id: "01900000-0000-7000-8000-000000000001",
};
const encode = (text: string) => Buffer.from(text).toString("base64url");

describe("notification cursor", () => {
  it("reads back the time and ID it was made from", () => {
    expect(
      notifications._decodeCursor(notifications._encodeCursor(row)),
    ).toEqual(row);
  });

  it.each([
    ["not base64 text", "!!!"],
    ["a missing ID", encode("2026-10-31T08:15:30.123Z")],
    ["a bad ID", encode("2026-10-31T08:15:30.123Z|abc")],
    ["an extra part", encode(`2026-10-31T08:15:30.123Z|${row.id}|x`)],
    ["a time without milliseconds", encode(`2026-10-31T08:15:30Z|${row.id}`)],
    [
      "a time that does not exist",
      encode(`2026-02-30T08:15:30.123Z|${row.id}`),
    ],
    ["a local time", encode(`2026-10-31T08:15:30.123+05:45|${row.id}`)],
  ])("rejects %s", (_name, cursor) => {
    expect(() => notifications._decodeCursor(cursor)).toThrow(
      expect.objectContaining({ code: "validation" }),
    );
  });
});
