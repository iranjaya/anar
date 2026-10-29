import { afterEach, assert, beforeEach, describe, expect, it } from "vitest";
import { resetDemoStore, store } from "@/mock/access";
import { resolveContext, setDemoFailure } from "../server";

const now = new Date("2026-10-28T12:00:00+05:45");

describe("context", () => {
  beforeEach(async () => {
    await resetDemoStore(now);
  });
  afterEach(async () => {
    await setDemoFailure(false);
  });

  it.each([
    {
      userId: "sunaina",
      slug: "sundar-heights",
      role: "admin",
      memberId: "sundar-heights-sunaina",
    },
    {
      userId: "prakash",
      slug: "sundar-heights",
      role: "super_admin",
      memberId: "sundar-heights-prakash",
    },
    {
      userId: "mina",
      slug: "pahad-view",
      role: "super_admin",
      memberId: "pahad-view-mina",
    },
    {
      userId: "dipen",
      slug: "pahad-view",
      role: "admin",
      memberId: "pahad-view-dipen",
    },
  ])("resolves $userId in $slug", async ({ userId, slug, role, memberId }) => {
    const ctx = await resolveContext({ userId, actingCompanyId: null }, slug);
    expect(ctx).toMatchObject({
      user: { id: userId },
      companyId: slug,
      role,
      member: { id: memberId },
      session: { actingCompanyId: null },
    });
  });

  it.each(["sundar-heights", "pahad-view"])(
    "resolves DNA after entering %s",
    async (slug) => {
      await expect(
        resolveContext({ userId: "rohan", actingCompanyId: slug }, slug),
      ).resolves.toMatchObject({
        user: { id: "rohan" },
        companyId: slug,
        member: null,
        role: "dna",
        session: { actingCompanyId: slug },
      });
    },
  );

  it.each(["sunaina", "prakash"])(
    "hides the other company from %s",
    async (userId) => {
      await expect(
        resolveContext({ userId, actingCompanyId: "pahad-view" }, "pahad-view"),
      ).rejects.toMatchObject({ name: "AppError", code: "not_found" });
    },
  );

  it.each([null, "pahad-view"])(
    "refuses DNA with acting company %s",
    async (actingCompanyId) => {
      await expect(
        resolveContext({ userId: "rohan", actingCompanyId }, "sundar-heights"),
      ).rejects.toMatchObject({ name: "AppError", code: "forbidden" });
    },
  );

  it("refuses an unknown demo user", async () => {
    await expect(
      resolveContext(
        { userId: "missing-user", actingCompanyId: null },
        "sundar-heights",
      ),
    ).rejects.toMatchObject({ name: "AppError", code: "unauthorized" });
  });

  it("returns not found for a missing company", async () => {
    await expect(
      resolveContext(
        { userId: "sunaina", actingCompanyId: null },
        "missing-company",
      ),
    ).rejects.toMatchObject({ name: "AppError", code: "not_found" });
  });

  it.each(["invited", "deactivated"] as const)(
    "refuses a membership that is %s",
    async (status) => {
      const ctx = await resolveContext(
        { userId: "sunaina", actingCompanyId: null },
        "sundar-heights",
      );
      assert(ctx.member);
      ctx.member.status = status;
      await expect(
        resolveContext(
          { userId: "sunaina", actingCompanyId: null },
          "sundar-heights",
        ),
      ).rejects.toMatchObject({ name: "AppError", code: "unauthorized" });
    },
  );

  it.each(["suspended", "closing"] as const)(
    "hides a company that is %s",
    async (status) => {
      const data = await store();
      const company = data.companies.find(
        (company) => company.slug === "sundar-heights",
      );
      assert(company);
      company.status = status;
      await expect(
        resolveContext(
          { userId: "sunaina", actingCompanyId: null },
          "sundar-heights",
        ),
      ).rejects.toMatchObject({ name: "AppError", code: "not_found" });
    },
  );

  it("propagates a store failure instead of returning a context", async () => {
    await setDemoFailure(true);
    await expect(
      resolveContext(
        { userId: "sunaina", actingCompanyId: null },
        "sundar-heights",
      ),
    ).rejects.toMatchObject({ name: "AppError", code: "unavailable" });
  });
});
