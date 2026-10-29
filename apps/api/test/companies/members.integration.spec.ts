import {
  companies,
  invites,
  withPlatformAgency,
  withPlatformIdentity,
  withPlatformTenant,
} from "@anar/db/platform";
import { companyMembers } from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import members from "../../src/modules/members/service.js";
import { type CompanyFixture, startCompanyFixture } from "./fixture.js";

describe("company membership boundaries", () => {
  let fixture: CompanyFixture;
  beforeAll(async () => {
    fixture = await startCompanyFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  it("discovers only own memberships and companies with an active own membership", async () => {
    const { a, b } = await fixture.setup();
    const own = await fixture.seedUser();
    const other = await fixture.seedUser();
    const active = await fixture.seedMember(a, own.id);
    const inactive = await fixture.seedMember(b, own.id, "deactivated");
    await fixture.seedMember(a, other.id);
    expect(
      await fixture.db.transaction((tx) => tx.select().from(companyMembers)),
    ).toEqual([]);
    expect(
      await fixture.db.transaction((tx) =>
        withPlatformAgency(
          tx,
          { agencyId: a.agencyId, userId: own.id },
          (scoped) => scoped.select().from(companyMembers),
        ),
      ),
    ).toEqual([]);
    await fixture.db.transaction((tx) =>
      withPlatformIdentity(tx, own.id, async (scoped) => {
        const rows = await scoped.select().from(companyMembers);
        expect(rows.map((row) => row.id).sort()).toEqual(
          [active.id, inactive.id].sort(),
        );
        expect(
          await scoped.select({ id: companies.id }).from(companies),
        ).toEqual([{ id: a.companyId }]);
        expect(await members.hasMembership(scoped, own.id)).toBe(true);
        expect(await members.hasMembership(scoped, other.id)).toBe(false);
      }),
    );
    expect(
      await fixture.db.transaction((tx) => tx.select().from(companyMembers)),
    ).toEqual([]);
  });

  it("restricts member reads and updates to both scoped IDs", async () => {
    const { a, b } = await fixture.setup();
    const user = await fixture.seedUser();
    const first = await fixture.seedMember(a, user.id);
    const second = await fixture.seedMember(b, user.id);
    for (const [agencyId, companyId, ids] of [
      [a.agencyId, a.companyId, [first.id]],
      [a.agencyId, b.companyId, []],
      [b.agencyId, a.companyId, []],
    ] as const) {
      const rows = await fixture.db.transaction((tx) =>
        withPlatformTenant(
          tx,
          { agencyId, companyId, userId: user.id },
          (scoped) =>
            scoped.select({ id: companyMembers.id }).from(companyMembers),
        ),
      );
      expect(rows.map((row) => row.id)).toEqual(ids);
    }
    await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId: a.agencyId, companyId: a.companyId, userId: user.id },
        async (scoped) => {
          expect(
            await scoped
              .update(companyMembers)
              .set({ name: "Foreign change" })
              .where(eq(companyMembers.id, second.id))
              .returning(),
          ).toEqual([]);
          const [changed] = await scoped
            .update(companyMembers)
            .set({ name: "Own change" })
            .where(eq(companyMembers.id, first.id))
            .returning();
          expect(changed.name).toBe("Own change");
          await expect(
            members.requireActiveMember(scoped, b.companyId, second.id),
          ).rejects.toMatchObject({ code: "not_found" });
        },
      ),
    );
  });

  it("denies identity writes and cross-company inserts", async () => {
    const { a, b } = await fixture.setup();
    const user = await fixture.seedUser();
    const member = await fixture.seedMember(a, user.id);
    const input = {
      id: v7(),
      agencyId: b.agencyId,
      companyId: b.companyId,
      userId: user.id,
      name: "Denied",
      role: "admin" as const,
      status: "active" as const,
    };
    await expect(
      fixture.db.transaction((tx) =>
        withPlatformIdentity(tx, user.id, (scoped) =>
          scoped.insert(companyMembers).values(input),
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await fixture.db.transaction((tx) =>
      withPlatformIdentity(tx, user.id, async (scoped) => {
        expect(
          await scoped
            .update(companyMembers)
            .set({ role: "admin" })
            .where(eq(companyMembers.id, member.id))
            .returning(),
        ).toEqual([]);
        expect(
          await scoped
            .update(companies)
            .set({ name: "Denied" })
            .where(eq(companies.id, a.companyId))
            .returning(),
        ).toEqual([]);
      }),
    );
    await expect(
      fixture.db.transaction((tx) =>
        withPlatformTenant(
          tx,
          { agencyId: a.agencyId, companyId: a.companyId, userId: user.id },
          (scoped) => scoped.insert(companyMembers).values(input),
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
  });

  it("enforces member and invite composite foreign keys and the invite target check", async () => {
    const { a, b } = await fixture.setup();
    const user = await fixture.seedUser();
    const mismatched = {
      agencyId: a.agencyId,
      companyId: b.companyId,
      userId: user.id,
    };
    await expect(
      fixture.db.transaction((tx) =>
        withPlatformTenant(tx, mismatched, (scoped) =>
          scoped.insert(companyMembers).values({
            id: v7(),
            ...mismatched,
            name: "Wrong pair",
            role: "admin",
            status: "active",
          }),
        ),
      ),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    const invitation = {
      id: v7(),
      agencyId: a.agencyId,
      companyId: b.companyId,
      email: user.email,
      name: user.name,
      role: "super_admin" as const,
      tokenHash: v7(),
      expiresAt: new Date(fixture.now().getTime() + 86400000),
      createdBy: a.user.id,
    };
    await expect(
      fixture.db.transaction((tx) => tx.insert(invites).values(invitation)),
    ).rejects.toMatchObject({ cause: { code: "23503" } });
    for (const overrides of [
      { companyId: null },
      { companyId: a.companyId, role: "agency_staff" as const },
    ]) {
      await expect(
        fixture.db.transaction((tx) =>
          tx.insert(invites).values({ ...invitation, ...overrides }),
        ),
      ).rejects.toMatchObject({ cause: { code: "23514" } });
    }
  });

  it("activates one member and refuses duplicate or deactivated membership revival", async () => {
    const { a } = await fixture.setup();
    const user = await fixture.seedUser();
    const scope = {
      agencyId: a.agencyId,
      companyId: a.companyId,
      userId: user.id,
    };
    const input = {
      ...scope,
      name: "Invited member",
      role: "super_admin" as const,
      at: fixture.now(),
    };
    const member = await fixture.db.transaction((tx) =>
      withPlatformTenant(tx, scope, (scoped) =>
        members.activateInvitedMember(scoped, input),
      ),
    );
    expect(member).toMatchObject({
      ...scope,
      name: input.name,
      role: "super_admin",
      status: "active",
      deactivatedAt: null,
      createdAt: fixture.now(),
      updatedAt: fixture.now(),
    });
    expect(
      await fixture.db.transaction((tx) =>
        withPlatformTenant(tx, scope, (scoped) =>
          members.requireActiveMember(scoped, a.companyId, member.id),
        ),
      ),
    ).toEqual(member);
    await expect(
      fixture.db.transaction((tx) =>
        withPlatformTenant(tx, scope, (scoped) =>
          members.activateInvitedMember(scoped, input),
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await fixture.db.transaction((tx) =>
      withPlatformTenant(tx, scope, (scoped) =>
        scoped
          .update(companyMembers)
          .set({ status: "deactivated", deactivatedAt: fixture.now() })
          .where(eq(companyMembers.id, member.id)),
      ),
    );
    await expect(
      fixture.db.transaction((tx) =>
        withPlatformTenant(tx, scope, (scoped) =>
          members.activateInvitedMember(scoped, input),
        ),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    await expect(
      fixture.db.transaction((tx) =>
        withPlatformTenant(tx, scope, (scoped) =>
          members.requireActiveMember(scoped, a.companyId, member.id),
        ),
      ),
    ).rejects.toMatchObject({ code: "not_found" });
    const rows = await fixture.db.transaction((tx) =>
      withPlatformTenant(tx, scope, (scoped) =>
        scoped.select().from(companyMembers),
      ),
    );
    expect(rows).toEqual([
      { ...member, status: "deactivated", deactivatedAt: fixture.now() },
    ]);
  });

  it("rolls back member activation with its caller transaction", async () => {
    const { a } = await fixture.setup();
    const user = await fixture.seedUser();
    const scope = {
      agencyId: a.agencyId,
      companyId: a.companyId,
      userId: user.id,
    };
    await expect(
      fixture.db.transaction((tx) =>
        withPlatformTenant(tx, scope, async (scoped) => {
          await members.activateInvitedMember(scoped, {
            ...scope,
            name: "Rollback",
            role: "admin",
            at: fixture.now(),
          });
          throw new Error("Caller rolled back");
        }),
      ),
    ).rejects.toThrow("Caller rolled back");
    expect(
      await fixture.db.transaction((tx) =>
        withPlatformTenant(tx, scope, (scoped) =>
          scoped.select().from(companyMembers),
        ),
      ),
    ).toEqual([]);
  });

  it.each(["active", "deactivated"] as const)(
    "refuses initial staff acceptance by a user with a %s company membership",
    async (status) => {
      const { owner, a } = await fixture.setup();
      const user = await fixture.seedUser();
      await fixture.seedMember(a, user.id, status);
      const invitation = await fixture.invite(owner.cookie, {
        email: user.email,
      });
      const response = await fixture.post(
        "acceptInvite",
        { token: invitation.token, name: "Cannot become staff" },
        { ip: "198.51.100.90" },
      );
      expect(response.statusCode).toBe(409);
      const [row] = await fixture.db.transaction((tx) =>
        tx.select().from(invites).where(eq(invites.id, invitation.inviteId)),
      );
      expect(row.acceptedAt).toBeNull();
      expect(
        await fixture.rows(
          sql`select status from agencies where id=${invitation.agencyId}`,
        ),
      ).toEqual([{ status: "pending" }]);
    },
  );

  it("counts active members per company without counting pending invitations", async () => {
    const { a, b } = await fixture.setup();
    const other = await fixture.createCompany(a.cookie);
    const user = await fixture.seedUser();
    await fixture.seedMember(a, user.id);
    await fixture.seedMember(
      a,
      (await fixture.seedUser()).id,
      "active",
      "admin",
    );
    await fixture.seedMember(a, (await fixture.seedUser()).id, "deactivated");
    await fixture.seedMember(a, (await fixture.seedUser()).id, "invited");
    await fixture.seedMember(
      { agencyId: a.agencyId, companyId: other.id },
      user.id,
    );
    await fixture.seedMember(b, user.id);
    await fixture.companyInvite(a);
    const response = await fixture.companyRequest(
      "GET",
      "listCompanies",
      a.cookie,
    );
    expect(response.statusCode).toBe(200);
    const items = response.json().data.items as {
      id: string;
      memberCount: number;
    }[];
    expect(items.map((row) => [row.id, row.memberCount]).sort()).toEqual(
      [
        [a.companyId, 2],
        [other.id, 1],
      ].sort(),
    );
    await fixture.owner("REVOKE SELECT ON company_members FROM anar_app");
    try {
      expect(
        (await fixture.companyRequest("GET", "listCompanies", a.cookie))
          .statusCode,
      ).toBe(500);
    } finally {
      await fixture.owner("GRANT SELECT ON company_members TO anar_app");
    }
  });
});
