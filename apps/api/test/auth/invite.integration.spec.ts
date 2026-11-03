import { createHash } from "node:crypto";
import {
  agencies,
  agencyMembers,
  companies,
  invites,
  sessions,
  users,
  withPlatformAgency,
} from "@anar/db/platform";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import context from "../../src/modules/agencies/context.js";
import companyService from "../../src/modules/companies/service.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";
import { publicOrigin } from "./fixture.js";

describe("company Super Admin invitations", () => {
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

  it("stores only a hash and queues the Super Admin template with a seven-day fragment link", async () => {
    const { a } = await fixture.setup();
    const issued = await fixture.companyInvite(a, {
      email: " Sales.Manager@Example.test ",
    });
    const [row] = await fixture.db.transaction((tx) =>
      tx.select().from(invites).where(eq(invites.id, issued.inviteId)),
    );
    expect(row).toMatchObject({
      agencyId: a.agencyId,
      companyId: a.companyId,
      email: "sales.manager@example.test",
      role: "super_admin",
      createdBy: a.user.id,
      acceptedAt: null,
      revokedAt: null,
      tokenHash: createHash("sha256").update(issued.token).digest("hex"),
      expiresAt: new Date(fixture.now().getTime() + 7 * 86400000),
    });
    expect(issued.message.text).toContain(
      `${publicOrigin}/invite#token=${issued.token}`,
    );
    expect(issued.message.text).toContain("Super Admin (sales manager)");
    expect(issued.message.text).toContain(a.company.name);
    expect(issued.message.text).toContain(a.user.name);
    const audits = await fixture.rows(
      sql`select actor_user_id, actor_role, agency_id, company_id, target_type, target_id, data from audit_log where action='company.super_admin_invited'`,
    );
    expect(audits).toEqual([
      {
        actor_user_id: a.user.id,
        actor_role: "agency_staff",
        agency_id: a.agencyId,
        company_id: a.companyId,
        target_type: "invite",
        target_id: issued.inviteId,
        data: { inviteId: issued.inviteId },
      },
    ]);
    expect(JSON.stringify([row, audits, issued.job])).not.toContain(
      issued.token,
    );
    expect(JSON.stringify(issued.job)).not.toContain(issued.message.to);
    expect(await fixture.companyCounts()).toEqual([
      { invites: 1, audits: 1, jobs: 1 },
    ]);
  });

  it("delivers through the compiled API and worker to Mailpit without leaking the token", async () => {
    const { a } = await fixture.setup();
    const api = await fixture.startApi();
    const input = fixture.companyInput(a.companyId);
    const response = await fetch(`${api.url}/api/companies/inviteSuperAdmin`, {
      method: "POST",
      headers: {
        origin: publicOrigin,
        cookie: a.cookie,
        "content-type": "application/json",
      },
      body: JSON.stringify(input),
    });
    expect(response.status).toBe(200);
    const body = (await response.json()) as { data: { inviteId: string } };
    const job = (await fixture.jobs()).find(
      (row) => row.data.referenceId === body.data.inviteId,
    );
    if (!job) throw new Error("Expected compiled company invite job");
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
    expect(message.To.map((to) => to.Address)).toEqual([input.email]);
    expect(message.Text).toContain("Super Admin (sales manager)");
    const token = message.Text.match(/\/invite#token=([A-Za-z0-9_-]{43})/)?.[1];
    expect(token).toBeDefined();
    await fixture.stopProcesses();
    expect(fixture.processLogs.join("")).not.toContain(token);
    expect(fixture.processLogs.join("")).not.toContain(input.email);
  });

  it("skips expired, accepted, revoked and replaced invite jobs", async () => {
    const { a } = await fixture.setup();
    for (const state of [
      "expired",
      "accepted",
      "revoked",
      "replaced",
    ] as const) {
      const issued = await fixture.companyInvite(a);
      await fixture.db.transaction((tx) =>
        tx
          .update(invites)
          .set({
            ...(state === "expired"
              ? { expiresAt: new Date(Date.now() - 1000) }
              : {}),
            ...(state === "accepted" ? { acceptedAt: fixture.now() } : {}),
            ...(state === "revoked" ? { revokedAt: fixture.now() } : {}),
            ...(state === "replaced" ? { tokenHash: `replaced-${v7()}` } : {}),
          })
          .where(eq(invites.id, issued.inviteId)),
      );
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

  it.each(["user", "staff", "agency", "company"])(
    "skips queued email after its %s is deactivated",
    async (kind) => {
      const { a } = await fixture.setup();
      await fixture.companyInvite(a);
      await fixture.db.transaction(async (tx) => {
        if (kind === "user")
          await tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, a.user.id));
        if (kind === "agency")
          await tx
            .update(agencies)
            .set({ status: "suspended" })
            .where(eq(agencies.id, a.agencyId));
        await withPlatformAgency(
          tx,
          { agencyId: a.agencyId, userId: a.user.id },
          async (scoped) => {
            if (kind === "staff")
              await scoped
                .update(agencyMembers)
                .set({ status: "deactivated", deactivatedAt: fixture.now() })
                .where(eq(agencyMembers.userId, a.user.id));
            if (kind === "company")
              await scoped
                .update(companies)
                .set({ status: "suspended" })
                .where(eq(companies.id, a.companyId));
          },
        );
      });
      await fixture.startWorker();
      await expect
        .poll(
          async () =>
            (await fixture.jobs()).every((job) => job.state === "completed"),
          { timeout: 20000 },
        )
        .toBe(true);
      expect(await fixture.mailpit.messages()).toEqual([]);
    },
  );

  it("serializes duplicate pending emails across instances and allows the same email in another company", async () => {
    const { a, b } = await fixture.setup();
    const input = fixture.companyInput(a.companyId);
    const responses = await Promise.all(
      [0, 1].map((index) =>
        fixture.companyRequest(
          "POST",
          "inviteSuperAdmin",
          a.cookie,
          { ...input, email: index ? input.email.toUpperCase() : input.email },
          index,
        ),
      ),
    );
    expect(responses.map((row) => row.statusCode).sort()).toEqual([200, 409]);
    expect(await fixture.companyCounts()).toEqual([
      { invites: 1, audits: 1, jobs: 1 },
    ]);
    await fixture.companyInvite(b, { email: input.email });
    expect(await fixture.companyCounts()).toEqual([
      { invites: 2, audits: 2, jobs: 2 },
    ]);
  });

  it("revokes expired pending rows before reissue and keeps the old job unusable", async () => {
    const { a } = await fixture.setup();
    const old = await fixture.companyInvite(a);
    await fixture.db.transaction((tx) =>
      tx
        .update(invites)
        .set({ expiresAt: fixture.now() })
        .where(eq(invites.id, old.inviteId)),
    );
    const fresh = await fixture.companyInvite(a, { email: old.input.email });
    expect(fresh.inviteId).not.toBe(old.inviteId);
    expect(fresh.token).not.toBe(old.token);
    const [row] = await fixture.db.transaction((tx) =>
      tx.select().from(invites).where(eq(invites.id, old.inviteId)),
    );
    expect(row.revokedAt).toEqual(fixture.now());
    await fixture.startWorker();
    await expect
      .poll(
        async () =>
          (await fixture.jobs()).every((job) => job.state === "completed"),
        { timeout: 20000 },
      )
      .toBe(true);
    const messages = await fixture.mailpit.messages();
    expect(messages).toHaveLength(1);
    expect((await fixture.mailpit.message(messages[0].ID)).Text).toBe(
      fresh.message.text,
    );
  });

  it.each(["audit_log", "pgboss.job, pgboss.job_common"])(
    "rolls back the invite and job if %s rejects insertion",
    async (table) => {
      const { a } = await fixture.setup();
      const jobsBefore = await fixture.jobs();
      await fixture.owner(`REVOKE INSERT ON ${table} FROM anar_app`);
      try {
        expect(
          (
            await fixture.companyRequest(
              "POST",
              "inviteSuperAdmin",
              a.cookie,
              fixture.companyInput(a.companyId),
            )
          ).statusCode,
        ).toBe(500);
        expect(await fixture.companyCounts()).toEqual([
          { invites: 0, audits: 0, jobs: 0 },
        ]);
        expect(await fixture.jobs()).toEqual(jobsBefore);
      } finally {
        await fixture.owner(`GRANT INSERT ON ${table} TO anar_app`);
      }
    },
  );

  it("rejects foreign and inactive companies without revealing another agency", async () => {
    const { a, b } = await fixture.setup();
    const foreign = await fixture.companyRequest(
      "POST",
      "inviteSuperAdmin",
      a.cookie,
      fixture.companyInput(b.companyId),
    );
    for (const status of ["suspended", "closing"] as const) {
      await fixture.db.transaction((tx) =>
        withPlatformAgency(
          tx,
          { agencyId: a.agencyId, userId: a.user.id },
          (scoped) =>
            scoped
              .update(companies)
              .set({ status })
              .where(eq(companies.id, a.companyId)),
        ),
      );
      const own = await fixture.companyRequest(
        "POST",
        "inviteSuperAdmin",
        a.cookie,
        fixture.companyInput(a.companyId),
      );
      expect(own.statusCode).toBe(404);
      expect(own.json()).toEqual(foreign.json());
    }
    expect(foreign.statusCode).toBe(404);
    expect(await fixture.companyCounts()).toEqual([
      { invites: 0, audits: 0, jobs: 0 },
    ]);
  });

  it("restores an expired pending invite when replacement audit fails", async () => {
    const { a } = await fixture.setup();
    const old = await fixture.companyInvite(a);
    await fixture.db.transaction((tx) =>
      tx
        .update(invites)
        .set({ expiresAt: fixture.now() })
        .where(eq(invites.id, old.inviteId)),
    );
    const before = await fixture.db.transaction((tx) =>
      tx.select().from(invites).where(eq(invites.id, old.inviteId)),
    );
    const jobsBefore = await fixture.jobs();
    await fixture.owner("REVOKE INSERT ON audit_log FROM anar_app");
    try {
      const response = await fixture.companyRequest(
        "POST",
        "inviteSuperAdmin",
        a.cookie,
        old.input,
      );
      expect(response.statusCode).toBe(500);
      expect(
        await fixture.db.transaction((tx) =>
          tx.select().from(invites).where(eq(invites.id, old.inviteId)),
        ),
      ).toEqual(before);
      expect(await fixture.companyCounts()).toEqual([
        { invites: 1, audits: 1, jobs: 1 },
      ]);
      expect(await fixture.jobs()).toEqual(jobsBefore);
    } finally {
      await fixture.owner("GRANT INSERT ON audit_log TO anar_app");
    }
  });

  it("denies owners, company members and forged role or agency inputs", async () => {
    const { owner, a, b } = await fixture.setup();
    for (const role of ["super_admin", "admin"] as const) {
      const person = await fixture.seedUser();
      await fixture.seedMember(a, person.id, "active", role);
      const login = await fixture.loginAs(person, { ip: "198.51.100.83" });
      expect(
        (await fixture.companyRequest("GET", "listCompanies", login.cookie))
          .statusCode,
      ).toBe(403);
      expect(
        (
          await fixture.companyRequest("POST", "createCompany", login.cookie, {
            name: "Denied",
            slug: `denied-${v7()}`,
            defaultCountry: "NP",
            timezone: "Asia/Kathmandu",
          })
        ).statusCode,
      ).toBe(403);
      expect(
        (
          await fixture.companyRequest(
            "POST",
            "inviteSuperAdmin",
            login.cookie,
            fixture.companyInput(a.companyId),
          )
        ).statusCode,
      ).toBe(403);
    }
    expect(
      (
        await fixture.companyRequest(
          "POST",
          "inviteSuperAdmin",
          owner.cookie,
          fixture.companyInput(a.companyId),
        )
      ).statusCode,
    ).toBe(403);
    for (const extra of [
      { role: "admin" },
      { agencyId: b.agencyId },
      { createdBy: owner.user.id },
      { companyId: "invalid" },
    ]) {
      expect(
        (
          await fixture.companyRequest(
            "POST",
            "inviteSuperAdmin",
            a.cookie,
            fixture.companyInput(a.companyId, extra),
          )
        ).statusCode,
      ).toBe(400);
    }
    expect(await fixture.companyCounts()).toEqual([
      { invites: 0, audits: 0, jobs: 0 },
    ]);
  });

  it("requires same origin and fresh OTP before issuing an invite", async () => {
    const { a } = await fixture.setup();
    expect(
      (
        await fixture.apps[0].app.inject({
          method: "POST",
          url: "/api/companies/inviteSuperAdmin",
          payload: fixture.companyInput(a.companyId),
          headers: { cookie: a.cookie, origin: "https://hostile.example" },
        })
      ).statusCode,
    ).toBe(403);
    fixture.advance(900001);
    const response = await fixture.companyRequest(
      "POST",
      "inviteSuperAdmin",
      a.cookie,
      fixture.companyInput(a.companyId),
    );
    expect(response.statusCode).toBe(428);
    expect(response.json()).toMatchObject({ error: "step_up_required" });
    expect(await fixture.companyCounts()).toEqual([
      { invites: 0, audits: 0, jobs: 0 },
    ]);
  });

  it.each(["user", "session", "staff"])(
    "rejects a captured actor after queued %s revocation commits",
    async (kind) => {
      const { a } = await fixture.setup();
      const service = companyService.create({
        context: context.create({
          db: fixture.db,
          sessions: fixture.apps[0].sessions,
        }),
        now: fixture.now,
        createCompanyInvite: fixture.invitations.createCompanyInvite,

        async seedCompany() {
          throw new Error("Unexpected company seed");
        },
      });
      const actor = await service.requireAgencyContext({
        headers: { cookie: a.cookie },
      });
      const held = await fixture.holdUser(a.user.id, async (tx) => {
        if (kind === "user")
          await tx
            .update(users)
            .set({ deactivatedAt: fixture.now() })
            .where(eq(users.id, a.user.id));
        if (kind === "session")
          await tx
            .update(sessions)
            .set({ revokedAt: fixture.now() })
            .where(eq(sessions.id, actor.session.id));
        if (kind === "staff")
          await withPlatformAgency(
            tx,
            { agencyId: a.agencyId, userId: a.user.id },
            (scoped) =>
              scoped
                .update(agencyMembers)
                .set({ status: "deactivated" })
                .where(eq(agencyMembers.userId, a.user.id)),
          );
      });
      const assertion = expect(
        service.inviteSuperAdmin(actor, fixture.companyInput(a.companyId), {
          ip: "198.51.100.1",
        }),
      ).rejects.toMatchObject({
        code: kind === "staff" ? "forbidden" : "unauthorized",
      });
      try {
        await fixture.waitForLock();
      } finally {
        held.release();
        await held.done;
      }
      await assertion;
      expect(await fixture.companyCounts()).toEqual([
        { invites: 0, audits: 0, jobs: 0 },
      ]);
    },
  );
});
