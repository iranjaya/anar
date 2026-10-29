import { createHash } from "node:crypto";
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

describe("owner agency onboarding", () => {
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

  it("creates only a pending agency and a hashed seven-day invite", async () => {
    const owner = await fixture.login({ owner: true });
    const issued = await fixture.invite(owner.cookie, {
      email: " Staff@Example.test ",
    });
    expect(await fixture.counts()).toEqual([
      { agencies: 1, invites: 1, audits: 1, jobs: 1 },
    ]);
    const [row] = await fixture.rows(
      sql`select a.status, i.* from agencies a join invites i on a.id = i.agency_id`,
    );
    expect(row).toMatchObject({
      status: "pending",
      role: "agency_staff",
      company_id: null,
      email: "staff@example.test",
      accepted_at: null,
      token_hash: createHash("sha256").update(issued.token).digest("hex"),
    });
    expect(new Date(row.expires_at as string).getTime()).toBe(
      fixture.now().getTime() + 7 * 86400000,
    );
    expect(
      await fixture.rows(
        sql`select id from users where email = 'staff@example.test'`,
      ),
    ).toEqual([]);
    const audit = await fixture.rows(
      sql`select actor_role,agency_id,company_id,data from audit_log where action='agency.created'`,
    );
    expect(audit).toEqual([
      {
        actor_role: "owner",
        agency_id: issued.agencyId,
        company_id: null,
        data: { inviteId: issued.inviteId },
      },
    ]);
    expect(JSON.stringify([row, audit, issued.job])).not.toContain(
      issued.token,
    );
  });

  it("denies anonymous and ordinary users before registry access", async () => {
    const user = await fixture.login();
    for (const cookie of [undefined, user.cookie]) {
      const expected = cookie ? 403 : 401;
      expect(
        (await fixture.request("POST", "createAgency", cookie, fixture.input()))
          .statusCode,
      ).toBe(expected);
      expect(
        (await fixture.request("GET", "listAgencies", cookie)).statusCode,
      ).toBe(expected);
    }
    expect(await fixture.counts()).toEqual([
      { agencies: 0, invites: 0, audits: 0, jobs: 0 },
    ]);
  });

  it("requires Origin before creating an agency", async () => {
    const owner = await fixture.login({ owner: true });
    for (const origin of [undefined, "https://hostile.example"]) {
      const response = await fixture.apps[0].app.inject({
        method: "POST",
        url: "/api/agencies/createAgency",
        payload: fixture.input(),
        headers: { cookie: owner.cookie, ...(origin ? { origin } : {}) },
      });
      expect(response.statusCode).toBe(403);
    }
    expect((await fixture.counts())[0].agencies).toBe(0);
  });

  it("requires fresh OTP for create while still allowing registry reads", async () => {
    const owner = await fixture.login({ owner: true });
    fixture.advance(15 * 60000 + 1);
    const response = await fixture.request(
      "POST",
      "createAgency",
      owner.cookie,
      fixture.input(),
    );
    expect(response.json()).toMatchObject({
      ok: false,
      error: "step_up_required",
    });
    expect(
      (await fixture.request("GET", "listAgencies", owner.cookie)).statusCode,
    ).toBe(200);
    expect((await fixture.counts())[0].agencies).toBe(0);
  });

  it.each([
    { slug: "owner" },
    { slug: "Bad Slug" },
    { name: " " },
    { email: "invalid" },
    { staffName: " " },
    { agencyId: "forged" },
  ])("rejects invalid create input %j", async (invalid) => {
    const owner = await fixture.login({ owner: true });
    const response = await fixture.request(
      "POST",
      "createAgency",
      owner.cookie,
      fixture.input(invalid),
    );
    expect(response.statusCode).toBe(400);
    expect((await fixture.counts())[0].agencies).toBe(0);
  });

  it("keeps duplicate slugs atomic", async () => {
    const owner = await fixture.login({ owner: true });
    const requests = await Promise.all(
      [0, 1].map((index) =>
        fixture.request(
          "POST",
          "createAgency",
          owner.cookie,
          fixture.input({ slug: "same-agency" }),
          index,
        ),
      ),
    );
    expect(requests.map((r) => r.statusCode).sort()).toEqual([200, 409]);
    expect(await fixture.counts()).toEqual([
      { agencies: 1, invites: 1, audits: 1, jobs: 1 },
    ]);
  });

  it.each(["audit_log", "pgboss.job, pgboss.job_common"])(
    "rolls back creation if %s rejects the write",
    async (table) => {
      const owner = await fixture.login({ owner: true });
      await fixture.owner(`REVOKE INSERT ON ${table} FROM anar_app`);
      try {
        expect(
          (
            await fixture.request(
              "POST",
              "createAgency",
              owner.cookie,
              fixture.input(),
            )
          ).statusCode,
        ).toBe(500);
        expect(await fixture.counts()).toEqual([
          { agencies: 0, invites: 0, audits: 0, jobs: 0 },
        ]);
      } finally {
        await fixture.owner(`GRANT INSERT ON ${table} TO anar_app`);
      }
    },
  );

  it.each(["deactivated", "revoked"])(
    "rechecks a paused owner after %s commits",
    async (kind) => {
      const owner = await fixture.login({ owner: true });
      const hold = await fixture.holdUser(owner.user.id, async (tx) => {
        if (kind === "deactivated")
          await tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, owner.user.id));
        else
          await tx
            .update(sessions)
            .set({ revokedAt: fixture.now() })
            .where(eq(sessions.userId, owner.user.id));
      });
      const response = fixture.request(
        "POST",
        "createAgency",
        owner.cookie,
        fixture.input(),
      );
      try {
        await fixture.waitForLock();
      } finally {
        hold.release();
        await hold.done;
      }
      expect((await response).statusCode).toBe(401);
      expect((await fixture.counts())[0].agencies).toBe(0);
    },
  );

  it("pages equal timestamps without leaking invite or company data", async () => {
    const owner = await fixture.login({ owner: true });
    for (let i = 0; i < 51; i++) await fixture.invite(owner.cookie);
    const first = await fixture.request("GET", "listAgencies", owner.cookie);
    expect(first.headers["cache-control"]).toBe("private, no-store");
    const page = first.json().data;
    expect(page.items).toHaveLength(50);
    for (const row of page.items)
      expect(Object.keys(row).sort()).toEqual([
        "createdAt",
        "id",
        "name",
        "slug",
        "status",
      ]);
    const next = (
      await fixture.request(
        "GET",
        `listAgencies?cursor=${page.nextCursor}`,
        owner.cookie,
      )
    ).json().data;
    expect(next.items).toHaveLength(1);
    expect(next.nextCursor).toBeNull();
    expect(
      new Set([...page.items, ...next.items].map((row) => row.id)).size,
    ).toBe(51);
    expect(
      (
        await fixture.request(
          "GET",
          "listAgencies?cursor=garbage",
          owner.cookie,
        )
      ).statusCode,
    ).toBe(400);
  });

  it("delivers the first staff invitation through the compiled API and worker", async () => {
    const owner = await fixture.login({ owner: true });
    const api = await fixture.startApi();
    const response = await fetch(`${api.url}/api/agencies/createAgency`, {
      method: "POST",
      headers: {
        origin: publicOrigin,
        cookie: owner.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(fixture.input()),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { inviteId: string } };
    const job = (await fixture.jobs()).find(
      (row) => row.data.referenceId === body.data.inviteId,
    );
    if (!job) throw new Error("Expected compiled API job");
    const expected = fixture.codec.decryptMessage(
      job.data.encryptedMessage,
      job.key,
    );
    await fixture.startWorker();
    await expect
      .poll(async () => (await fixture.mailpit.messages()).length, {
        timeout: 20000,
      })
      .toBe(1);
    const [summary] = await fixture.mailpit.messages();
    const message = await fixture.mailpit.message(summary.ID);
    expect(message.Text).toBe(expected.text);
    expect((message as typeof message & { HTML: string }).HTML).toBe(
      expected.html,
    );
    expect(message.To.map((to) => to.Address)).toEqual([expected.to]);
    const token = message.Text.match(/\/invite#token=([A-Za-z0-9_-]{43})/)?.[1];
    expect(token).toBeDefined();
    for (const [path, payload] of [
      ["inspectInvite", { token }],
      ["acceptInvite", { token, name: "Accepted staff" }],
    ] as const) {
      const result = await fetch(`${api.url}/api/auth/${path}`, {
        method: "POST",
        headers: { origin: publicOrigin, "content-type": "application/json" },
        body: JSON.stringify(payload),
      });
      expect(result.status).toBe(200);
      expect(result.headers.get("set-cookie")).toBeNull();
      await result.body?.cancel();
    }
    expect(await fixture.rows(sql`select status from agencies`)).toEqual([
      { status: "active" },
    ]);
    await fixture.stopProcesses();
    expect(fixture.processLogs.join("")).not.toContain(token);
    expect(fixture.processLogs.join("")).not.toContain(expected.to);
  });

  it("skips unusable invite email jobs", async () => {
    const owner = await fixture.login({ owner: true });
    const states = [
      "revoked",
      "accepted",
      "expired",
      "replaced",
      "active",
    ] as const;
    for (const state of states) {
      const issued = await fixture.invite(owner.cookie);
      await fixture.db.transaction(async (tx) => {
        if (state === "active")
          await tx
            .update(agencies)
            .set({ status: "active" })
            .where(eq(agencies.id, issued.agencyId));
        else
          await tx
            .update(invites)
            .set({
              ...(state === "revoked" ? { revokedAt: fixture.now() } : {}),
              ...(state === "accepted" ? { acceptedAt: fixture.now() } : {}),
              ...(state === "expired"
                ? { expiresAt: new Date(Date.now() - 1000) }
                : {}),
              ...(state === "replaced" ? { tokenHash: "f".repeat(64) } : {}),
            })
            .where(eq(invites.id, issued.inviteId));
      });
    }
    await fixture.startWorker();
    await expect
      .poll(
        async () =>
          (await fixture.jobs()).every((job) => job.state === "completed"),
        { timeout: 20000 },
      )
      .toBe(true);
    expect(await fixture.mailpit.messages()).toEqual([]);
  });

  it("skips invite email when its owner is inactive", async () => {
    const owner = await fixture.login({ owner: true });
    await fixture.invite(owner.cookie);
    await fixture.db.transaction((tx) =>
      tx
        .update(users)
        .set({ deactivatedAt: fixture.now() })
        .where(eq(users.id, owner.user.id)),
    );
    await fixture.startWorker();
    await expect
      .poll(
        async () =>
          (await fixture.jobs()).every((job) => job.state === "completed"),
        { timeout: 20000 },
      )
      .toBe(true);
    expect(await fixture.mailpit.messages()).toEqual([]);
  });
});
