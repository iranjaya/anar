import {
  agencyMembers,
  invites,
  users,
  withPlatformAgency,
} from "@anar/db/platform";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

describe("agency staff remove a colleague or themselves", () => {
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

  type Actor = { cookie: string; user: { id: string } };
  const remove = (actor: Actor, staffId: string) =>
    fixture.request("POST", "deactivateStaff", actor.cookie, { staffId });
  const staffRows = (agencyId: string) =>
    fixture.db.transaction((tx) =>
      withPlatformAgency(tx, { agencyId, userId: v7() }, (scoped) =>
        scoped
          .select({
            id: agencyMembers.id,
            userId: agencyMembers.userId,
            status: agencyMembers.status,
          })
          .from(agencyMembers)
          .where(eq(agencyMembers.agencyId, agencyId)),
      ),
    );
  async function staffId(agencyId: string, userId: string) {
    const row = (await staffRows(agencyId)).find(
      (member) => member.userId === userId,
    );
    if (!row) throw new Error("Expected a staff row");
    return row.id;
  }
  const activeCount = async (agencyId: string) =>
    (await staffRows(agencyId)).filter((member) => member.status === "active")
      .length;
  async function inviteToken(inviteId: string) {
    const [stored] = await fixture.db.transaction((tx) =>
      tx.select().from(invites).where(eq(invites.id, inviteId)),
    );
    const job = (await fixture.jobs()).find(
      (row) => row.key === `invite:${inviteId}:${stored.tokenHash}`,
    );
    if (!job) throw new Error("Expected an invite job");
    const token = fixture.codec
      .decryptMessage(job.data.encryptedMessage, job.key)
      .text.match(/\/invite#token=([A-Za-z0-9_-]{43})/)?.[1];
    if (!token) throw new Error("Expected an invite token");
    return token;
  }
  async function inviteColleague(actor: Actor) {
    const email = `${v7()}@example.test`;
    const response = await fixture.request(
      "POST",
      "inviteStaff",
      actor.cookie,
      {
        email,
        name: "Colleague",
      },
    );
    expect(response.statusCode).toBe(200);
    const inviteId: string = response.json().data.inviteId;
    return { email, inviteId, token: await inviteToken(inviteId) };
  }
  async function join(actor: Actor & { agencyId: string }) {
    const { token } = await inviteColleague(actor);
    const accepted = await fixture.post(
      "acceptInvite",
      { token, name: "Colleague" },
      { ip: "198.51.100.91" },
    );
    expect(accepted.statusCode).toBe(200);
    const [user] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, accepted.json().data.userId)),
    );
    const login = await fixture.loginAs(user, { ip: "198.51.100.92" });
    return { ...login, staffId: await staffId(actor.agencyId, user.id) };
  }
  const audits = () =>
    fixture.rows(
      sql`select actor_user_id, agency_id, target_type, target_id, data from audit_log where action = 'agency.staff_deactivated' order by id`,
    );
  const getAgency = (actor: Actor) =>
    fixture.request("GET", "getAgency", actor.cookie);

  it("removes a colleague, signs them out everywhere and stops their pending invites", async () => {
    const { a } = await fixture.setup();
    const colleague = await join(a);
    const pending = await inviteColleague(colleague);

    const response = await remove(a, colleague.staffId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { ok: true } });
    expect(
      (await staffRows(a.agencyId)).find(
        (member) => member.id === colleague.staffId,
      )?.status,
    ).toBe("deactivated");
    expect((await getAgency(colleague)).statusCode).toBe(401);
    expect(
      (await fixture.post("refresh", {}, { cookie: colleague.cookie }))
        .statusCode,
    ).toBe(401);
    expect(
      (await fixture.companyRequest("GET", "listCompanies", colleague.cookie))
        .statusCode,
    ).toBe(401);
    const [stored] = await fixture.db.transaction((tx) =>
      tx.select().from(invites).where(eq(invites.id, pending.inviteId)),
    );
    expect(stored.revokedAt).not.toBeNull();
    expect(
      (
        await fixture.post("acceptInvite", {
          token: pending.token,
          name: "Too late",
        })
      ).statusCode,
    ).toBe(404);
    expect(await audits()).toEqual([
      {
        actor_user_id: a.user.id,
        agency_id: a.agencyId,
        target_type: "agency_member",
        target_id: colleague.staffId,
        data: { userId: colleague.user.id },
      },
    ]);
    expect((await getAgency(a)).statusCode).toBe(200);
  });

  it("lets staff remove themselves while a colleague stays", async () => {
    const { a } = await fixture.setup();
    await join(a);
    const self = await staffId(a.agencyId, a.user.id);
    expect((await remove(a, self)).statusCode).toBe(200);
    expect((await getAgency(a)).statusCode).toBe(401);
    expect(await activeCount(a.agencyId)).toBe(1);
  });

  it("refuses to remove the last active staff even with pending or inactive colleagues", async () => {
    const { a } = await fixture.setup();
    await inviteColleague(a);
    const inactive = await join(a);
    await fixture.db.transaction((tx) =>
      tx
        .update(users)
        .set({ deactivatedAt: fixture.now() })
        .where(eq(users.id, inactive.user.id)),
    );
    const self = await staffId(a.agencyId, a.user.id);
    const response = await remove(a, self);
    expect(response.statusCode).toBe(409);
    expect(response.json().message).toBe(
      "The last active staff member cannot be removed",
    );
    expect(
      (await staffRows(a.agencyId)).find((member) => member.id === self)
        ?.status,
    ).toBe("active");
    expect((await getAgency(a)).statusCode).toBe(200);
    expect(await audits()).toEqual([]);
  });

  it("hides staff of another agency and unknown IDs", async () => {
    const { a, b } = await fixture.setup();
    const foreign = await staffId(b.agencyId, b.user.id);
    for (const id of [foreign, v7()]) {
      const response = await remove(a, id);
      expect(response.statusCode).toBe(404);
      expect(response.json().message).toBe("Staff member is unavailable");
    }
    expect((await getAgency(b)).statusCode).toBe(200);
    expect((await remove(a, "not-a-uuid")).statusCode).toBe(400);
  });

  it("asks for a fresh code and changes nothing without it", async () => {
    const { a } = await fixture.setup();
    const colleague = await join(a);
    fixture.advance(15 * 60000 + 1000);
    const response = await remove(a, colleague.staffId);
    expect(response.statusCode).toBe(428);
    expect(await activeCount(a.agencyId)).toBe(2);
    expect((await getAgency(colleague)).statusCode).toBe(200);
  });

  it("leaves exactly one active staff when two remove each other at once", async () => {
    const { a } = await fixture.setup();
    const colleague = await join(a);
    const self = await staffId(a.agencyId, a.user.id);
    const results = await Promise.all([
      remove(a, colleague.staffId),
      remove(colleague, self),
    ]);
    expect(results.map((response) => response.statusCode).sort()).toEqual([
      200, 401,
    ]);
    expect(await activeCount(a.agencyId)).toBe(1);
    expect(await audits()).toHaveLength(1);
  });

  it.each([
    {
      name: "the audit write",
      table: "audit_log",
      when: "BEFORE INSERT",
    },
    {
      name: "the session revoke",
      table: "sessions",
      when: "BEFORE UPDATE OF revoked_at",
    },
  ])("rolls everything back when $name fails", async ({ table, when }) => {
    const { a } = await fixture.setup();
    const colleague = await join(a);
    const pending = await inviteColleague(colleague);
    await fixture.owner(`CREATE FUNCTION fail_removal_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Proof removal failure'; END $$;
      CREATE TRIGGER fail_removal_fixture ${when} ON ${table} FOR EACH ROW EXECUTE FUNCTION fail_removal_fixture()`);
    try {
      expect((await remove(a, colleague.staffId)).statusCode).toBe(500);
    } finally {
      await fixture.owner(
        `DROP TRIGGER fail_removal_fixture ON ${table}; DROP FUNCTION fail_removal_fixture()`,
      );
    }
    expect(await activeCount(a.agencyId)).toBe(2);
    expect((await getAgency(colleague)).statusCode).toBe(200);
    const [stored] = await fixture.db.transaction((tx) =>
      tx.select().from(invites).where(eq(invites.id, pending.inviteId)),
    );
    expect(stored.revokedAt).toBeNull();
    expect(await audits()).toEqual([]);
  });

  it("does not add staff when an invite is accepted while its issuer is being removed", async () => {
    const { a } = await fixture.setup();
    const colleague = await join(a);
    const pending = await inviteColleague(colleague);
    const hold = await fixture.holdUser(colleague.user.id, async () => {});
    const removal = remove(a, colleague.staffId);
    await fixture.waitForLock();
    const acceptance = fixture.post("acceptInvite", {
      token: pending.token,
      name: "Raced colleague",
    });
    hold.release();
    await hold.done;
    expect((await removal).statusCode).toBe(200);
    expect((await acceptance).statusCode).toBe(404);
    const joined = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.email, pending.email)),
    );
    for (const user of joined)
      expect(
        (await staffRows(a.agencyId)).some(
          (member) => member.userId === user.id,
        ),
      ).toBe(false);
    expect(await activeCount(a.agencyId)).toBe(1);
  });
});
