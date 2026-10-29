import { agencies, invites, sessions, users } from "@anar/db/platform";
import { eq, sql } from "drizzle-orm";
import {
  afterAll,
  afterEach,
  beforeAll,
  beforeEach,
  describe,
  expect,
  it,
} from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import { type AgencyFixture, startAgencyFixture } from "./fixture.js";

describe("owner resends the pending first invite", () => {
  let fixture: AgencyFixture;
  beforeAll(async () => {
    fixture = await startAgencyFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterEach(async () => {
    await fixture.stopProcesses();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  async function pending(email?: string) {
    const owner = await fixture.login({ owner: true });
    return {
      owner,
      ...(await fixture.invite(owner.cookie, email ? { email } : {})),
    };
  }
  const resend = (cookie: string, agencyId: string, index = 0) =>
    fixture.request("POST", "resendFirstInvite", cookie, { agencyId }, index);
  const row = (id: string) =>
    fixture.db.transaction(
      async (tx) =>
        (await tx.select().from(invites).where(eq(invites.id, id)))[0],
    );
  async function current(id: string) {
    const invite = await row(id);
    const job = (await fixture.jobs()).find(
      (job) => job.key === `invite:${id}:${invite.tokenHash}`,
    );
    if (!job) throw new Error("Expected current invite job");
    const message = fixture.codec.decryptMessage(
      job.data.encryptedMessage,
      job.key,
    );
    const token = message.text.match(/\/invite#token=([A-Za-z0-9_-]{43})/)?.[1];
    if (!token) throw new Error("Expected current invite token");
    return { invite, job, message, token };
  }
  const audits = () =>
    fixture.rows(
      sql`select actor_role,agency_id,target_type,target_id,data from audit_log where action='agency.first_invite_resent' order by id`,
    );

  it("replaces the token on the same invite and records one audit", async () => {
    const issued = await pending();
    const before = await row(issued.inviteId);
    fixture.advance(1000);
    const response = await resend(issued.owner.cookie, issued.agencyId);
    expect(response.statusCode).toBe(200);
    expect(response.json()).toEqual({ ok: true, data: { ok: true } });
    expect(response.headers["set-cookie"]).toBeUndefined();
    const next = await current(issued.inviteId);
    expect(next.invite).toEqual({
      ...before,
      tokenHash: expect.any(String),
      expiresAt: new Date(fixture.now().getTime() + 7 * 86400000),
    });
    expect(next.token).not.toBe(issued.token);
    expect(next.invite.tokenHash).not.toBe(before.tokenHash);
    expect(next.message.subject).toBe(
      `New invite link for ${issued.details.name} on Anar`,
    );
    expect(next.message.text).toContain(
      "Your earlier invite link no longer works",
    );
    expect(await audits()).toEqual([
      {
        actor_role: "owner",
        agency_id: issued.agencyId,
        target_type: "invite",
        target_id: issued.inviteId,
        data: { inviteId: issued.inviteId },
      },
    ]);
    expect((await fixture.counts())[0]).toMatchObject({
      agencies: 1,
      invites: 1,
      jobs: 2,
    });
    expect(
      JSON.stringify([next.invite, next.job, await audits()]),
    ).not.toContain(next.token);
    expect(
      (await fixture.post("inspectInvite", { token: issued.token })).statusCode,
    ).toBe(404);
    expect(
      (
        await fixture.post("acceptInvite", {
          token: issued.token,
          name: "Staff",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (await fixture.post("acceptInvite", { token: next.token, name: "Staff" }))
        .statusCode,
    ).toBe(200);
    expect(
      (await resend(issued.owner.cookie, issued.agencyId)).statusCode,
    ).toBe(404);
  });

  it("delivers only the new revision through the compiled API and worker", async () => {
    const issued = await pending();
    const api = await fixture.startApi();
    const response = await fetch(`${api.url}/api/agencies/resendFirstInvite`, {
      method: "POST",
      headers: {
        origin: publicOrigin,
        cookie: issued.owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify({ agencyId: issued.agencyId }),
    });
    expect(response.status).toBe(200);
    await response.body?.cancel();
    const next = await current(issued.inviteId);
    await fixture.startWorker();
    await expect
      .poll(
        async () =>
          (await fixture.jobs()).every((job) => job.state === "completed"),
        { timeout: 20000 },
      )
      .toBe(true);
    expect(await fixture.mailpit.messages()).toHaveLength(1);
    const [summary] = await fixture.mailpit.messages();
    const mail = await fixture.mailpit.message(summary.ID);
    expect(mail.Text).toBe(next.message.text);
    expect((mail as typeof mail & { HTML: string }).HTML).toBe(
      next.message.html,
    );
    expect(mail.Text).not.toContain(issued.token);
    expect(mail.To.map((to) => to.Address)).toEqual([issued.details.email]);
    expect(
      (await fixture.mailpit.headers(summary.ID))["X-Anar-Delivery-Key"],
    ).toEqual([next.job.key]);
    const token = mail.Text.match(/\/invite#token=([A-Za-z0-9_-]{43})/)?.[1];
    expect(
      (await fixture.post("acceptInvite", { token, name: "Staff" })).statusCode,
    ).toBe(200);
    await fixture.stopProcesses();
    expect(fixture.processLogs.join("")).not.toContain(next.token);
  });

  it("renews an expired invite without changing its recipient", async () => {
    const issued = await pending();
    await fixture.db.transaction((tx) =>
      tx
        .update(invites)
        .set({ expiresAt: fixture.now() })
        .where(eq(invites.id, issued.inviteId)),
    );
    expect(
      (await resend(issued.owner.cookie, issued.agencyId)).statusCode,
    ).toBe(200);
    const next = await current(issued.inviteId);
    expect(next.invite.email).toBe(issued.details.email);
    expect(next.invite.expiresAt.getTime()).toBe(
      fixture.now().getTime() + 7 * 86400000,
    );
    expect(
      (await fixture.post("inspectInvite", { token: next.token })).statusCode,
    ).toBe(200);
  });

  it("shares three resend slots across instances and expires them after ten minutes", async () => {
    const issued = await pending();
    const responses = await Promise.all(
      Array.from({ length: 5 }, (_, i) =>
        resend(issued.owner.cookie, issued.agencyId, i % 2),
      ),
    );
    expect(responses.map((r) => r.statusCode).sort()).toEqual([
      200, 200, 200, 429, 429,
    ]);
    for (const response of responses.filter((r) => r.statusCode === 429)) {
      expect(response.headers["retry-after"]).toBe("600");
      expect(response.json()).toMatchObject({ ok: false, error: "validation" });
    }
    expect(await audits()).toHaveLength(3);
    expect((await fixture.counts())[0].jobs).toBe(4);
    const before = await row(issued.inviteId);
    expect(
      (await resend(issued.owner.cookie, issued.agencyId)).statusCode,
    ).toBe(429);
    expect(await row(issued.inviteId)).toEqual(before);
    const other = await fixture.invite(issued.owner.cookie);
    expect((await resend(issued.owner.cookie, other.agencyId)).statusCode).toBe(
      200,
    );
    fixture.advance(600000);
    expect(
      (await resend(issued.owner.cookie, issued.agencyId)).statusCode,
    ).toBe(200);
  });

  it.each(["audit_log", "pgboss.job, pgboss.job_common"])(
    "rolls back token, limiter and email if %s fails",
    async (table) => {
      const issued = await pending();
      const before = await row(issued.inviteId);
      await fixture.owner(`REVOKE INSERT ON ${table} FROM anar_app`);
      try {
        expect(
          (await resend(issued.owner.cookie, issued.agencyId)).statusCode,
        ).toBe(500);
        expect(await row(issued.inviteId)).toEqual(before);
        expect((await fixture.counts())[0].jobs).toBe(1);
        expect(await audits()).toEqual([]);
        expect(
          (await fixture.limits()).filter(
            (limit) => limit.scope === "invite.resend",
          ),
        ).toEqual([]);
      } finally {
        await fixture.owner(`GRANT INSERT ON ${table} TO anar_app`);
      }
      expect(
        (await fixture.post("inspectInvite", { token: issued.token }))
          .statusCode,
      ).toBe(200);
      expect(
        (await resend(issued.owner.cookie, issued.agencyId)).statusCode,
      ).toBe(200);
    },
  );

  it.each(["active", "suspended", "closing", "revoked", "accepted"])(
    "refuses %s onboarding without changing the invite",
    async (kind) => {
      const issued = await pending();
      await fixture.db.transaction(async (tx) => {
        if (kind === "revoked" || kind === "accepted")
          await tx
            .update(invites)
            .set(
              kind === "revoked"
                ? { revokedAt: fixture.now() }
                : { acceptedAt: fixture.now() },
            )
            .where(eq(invites.id, issued.inviteId));
        else
          await tx
            .update(agencies)
            .set({ status: kind as "active" | "suspended" | "closing" })
            .where(eq(agencies.id, issued.agencyId));
      });
      const before = await row(issued.inviteId);
      expect(
        (await resend(issued.owner.cookie, issued.agencyId)).statusCode,
      ).toBe(404);
      expect(await row(issued.inviteId)).toEqual(before);
      expect(await audits()).toEqual([]);
    },
  );

  it("denies missing identity, nonowner, stale OTP and forged fields", async () => {
    const issued = await pending();
    const ordinary = await fixture.login({ ip: "198.51.100.90" });
    expect(
      (
        await fixture.request("POST", "resendFirstInvite", undefined, {
          agencyId: issued.agencyId,
        })
      ).statusCode,
    ).toBe(401);
    expect((await resend(ordinary.cookie, issued.agencyId)).statusCode).toBe(
      403,
    );
    expect(
      (
        await fixture.request(
          "POST",
          "resendFirstInvite",
          issued.owner.cookie,
          { agencyId: issued.agencyId, email: "forged@example.test" },
        )
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await fixture.apps[0].app.inject({
          method: "POST",
          url: "/api/agencies/resendFirstInvite",
          headers: {
            cookie: issued.owner.cookie,
            origin: "https://hostile.example",
          },
          payload: { agencyId: issued.agencyId },
        })
      ).statusCode,
    ).toBe(403);
    fixture.advance(15 * 60000 + 1);
    expect(
      (await resend(issued.owner.cookie, issued.agencyId)).statusCode,
    ).toBe(428);
    expect(await audits()).toEqual([]);
    expect((await fixture.counts())[0].jobs).toBe(1);
  });

  it.each(["deactivated", "revoked"])(
    "rechecks owner authority after %s commits",
    async (kind) => {
      const issued = await pending();
      const hold = await fixture.holdUser(issued.owner.user.id, async (tx) => {
        if (kind === "deactivated")
          await tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, issued.owner.user.id));
        else
          await tx
            .update(sessions)
            .set({ revokedAt: fixture.now() })
            .where(eq(sessions.userId, issued.owner.user.id));
      });
      const response = resend(issued.owner.cookie, issued.agencyId);
      try {
        await fixture.waitForLock();
      } finally {
        hold.release();
        await hold.done;
      }
      expect((await response).statusCode).toBe(401);
      expect(await audits()).toEqual([]);
    },
  );

  it("rejects the old token when resend commits while acceptance waits", async () => {
    const recipient = await fixture.seedUser();
    const issued = await pending(recipient.email);
    expect(recipient.id < issued.owner.user.id).toBe(true);
    const hold = await fixture.holdUser(recipient.id, async () => {});
    const acceptance = fixture.post(
      "acceptInvite",
      { token: issued.token, name: "Staff" },
      { index: 1 },
    );
    try {
      await fixture.waitForLock();
      expect(
        (await resend(issued.owner.cookie, issued.agencyId)).statusCode,
      ).toBe(200);
    } finally {
      hold.release();
      await hold.done;
    }
    expect((await acceptance).statusCode).toBe(404);
    const next = await current(issued.inviteId);
    expect(
      (
        await fixture.post("acceptInvite", {
          token: next.token,
          name: "Staff",
        })
      ).statusCode,
    ).toBe(200);
    expect(
      await fixture.rows(
        sql`select count(*)::int as count from audit_log where action='agency.staff_accepted'`,
      ),
    ).toEqual([{ count: 1 }]);
    expect(
      (await resend(issued.owner.cookie, issued.agencyId)).statusCode,
    ).toBe(404);
  });
});
