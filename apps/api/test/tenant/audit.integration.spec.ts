import { createECDH, randomBytes } from "node:crypto";
import {
  agencyMembers,
  invites,
  users,
  withPlatformAgency,
  withPlatformTenant,
} from "@anar/db/platform";
import {
  companyMembers,
  importBatches,
  importRuns,
  leadEvents,
  leads,
  outcomes,
  stages,
} from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import { publicOrigin } from "../auth/fixture.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

type AuditRow = {
  id: string;
  actor_user_id: string;
  actor_role: string;
  agency_id: string | null;
  company_id: string | null;
  action: string;
  target_type: string;
  target_id: string;
  data: Record<string, string>;
  ip: string | null;
};

describe("audit records for every S1 and S2 mutation", () => {
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

  const ip = "198.51.100.120";
  const anyId = expect.any(String) as unknown as string;
  let secrets: string[] = [];
  const api = (path: string, cookie: string, payload?: object) =>
    fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/${path}`,
      payload,
      remoteAddress: ip,
      headers: { origin: publicOrigin, ...(cookie ? { cookie } : {}) },
    });
  async function ok(path: string, cookie: string, payload?: object) {
    const response = await api(path, cookie, payload);
    expect(response.statusCode, `${path}: ${response.body}`).toBe(200);
    return response.json().data;
  }
  const auditRows = () =>
    fixture.rows<AuditRow>(
      sql`select id, actor_user_id, actor_role, agency_id, company_id, action,
        target_type, target_id, data, ip from audit_log order by id`,
    );
  async function onlyNew(before: AuditRow[]) {
    const seen = new Set(before.map((row) => row.id));
    return (await auditRows())
      .filter((row) => !seen.has(row.id))
      .map(({ id: _id, ...row }) => row);
  }
  async function expectOne(
    run: () => Promise<unknown>,
    expected: Omit<AuditRow, "id" | "ip">,
  ) {
    const before = await auditRows();
    await run();
    expect(await onlyNew(before)).toEqual([{ ...expected, ip }]);
  }
  async function token(inviteId: string) {
    const [stored] = await fixture.db.transaction((tx) =>
      tx.select().from(invites).where(eq(invites.id, inviteId)),
    );
    const job = (await fixture.jobs()).find(
      (row) => row.key === `invite:${inviteId}:${stored.tokenHash}`,
    );
    if (!job) throw new Error("Expected an invite job");
    const found = fixture.codec
      .decryptMessage(job.data.encryptedMessage, job.key)
      .text.match(/\/invite#token=([A-Za-z0-9_-]{43})/)?.[1];
    if (!found) throw new Error("Expected an invite token");
    secrets.push(found, stored.tokenHash);
    return found;
  }
  async function accept(inviteId: string) {
    const data = await ok("auth/acceptInvite", "", {
      token: await token(inviteId),
      name: "Audit person",
    });
    const [user] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, data.userId)),
    );
    return user;
  }
  async function signIn(user: Awaited<ReturnType<typeof accept>>) {
    const login = await fixture.loginAs(user, { ip: "198.51.100.121" });
    secrets.push(login.cookie.split("=")[1], login.code);
    return login;
  }
  const staffId = (agencyId: string, userId: string) =>
    fixture.db.transaction(async (tx) =>
      withPlatformAgency(tx, { agencyId, userId }, async (scoped) => {
        const [row] = await scoped
          .select({ id: agencyMembers.id })
          .from(agencyMembers)
          .where(eq(agencyMembers.userId, userId));
        return row.id;
      }),
    );
  const memberId = (agencyId: string, companyId: string, userId: string) =>
    fixture.db.transaction(async (tx) =>
      withPlatformTenant(
        tx,
        { agencyId, companyId, userId },
        async (scoped) => {
          const [row] = await scoped
            .select({ id: companyMembers.id })
            .from(companyMembers)
            .where(eq(companyMembers.userId, userId));
          return row.id;
        },
      ),
    );
  const email = () => `${v7()}@example.test`;

  it("writes exactly one accurate record per mutation and never a secret", async () => {
    secrets = [];
    const owner = await fixture.login({ owner: true });
    secrets.push(owner.cookie.split("=")[1], owner.code);

    let agency = { agencyId: "", inviteId: "" };
    await expectOne(
      async () => {
        agency = await ok("agencies/createAgency", owner.cookie, {
          name: "Audit agency",
          slug: `audit-${v7()}`,
          email: email(),
          staffName: "First staff",
        });
      },
      {
        actor_user_id: owner.user.id,
        actor_role: "owner",
        agency_id: anyId,
        company_id: null,
        action: "agency.created",
        target_type: "agency",
        target_id: anyId,
        data: { inviteId: anyId },
      },
    );
    const created = (await auditRows()).at(-1);
    expect(created).toMatchObject({
      agency_id: agency.agencyId,
      target_id: agency.agencyId,
      data: { inviteId: agency.inviteId },
    });
    const { agencyId } = agency;

    await expectOne(
      () => ok("agencies/resendFirstInvite", owner.cookie, { agencyId }),
      {
        actor_user_id: owner.user.id,
        actor_role: "owner",
        agency_id: agencyId,
        company_id: null,
        action: "agency.first_invite_resent",
        target_type: "invite",
        target_id: agency.inviteId,
        data: { inviteId: agency.inviteId },
      },
    );

    const staffUser = await accept(agency.inviteId);
    const firstStaff = await staffId(agencyId, staffUser.id);
    const accepted = (await auditRows()).at(-1);
    expect(accepted).toMatchObject({
      actor_user_id: staffUser.id,
      actor_role: "agency_staff",
      agency_id: agencyId,
      company_id: null,
      action: "agency.staff_accepted",
      target_type: "agency_member",
      target_id: firstStaff,
      data: { inviteId: agency.inviteId, inviterId: owner.user.id },
      ip,
    });
    const staff = await signIn(staffUser);

    let staffInvite = "";
    await expectOne(
      async () => {
        staffInvite = (
          await ok("agencies/inviteStaff", staff.cookie, {
            email: email(),
            name: "Second staff",
          })
        ).inviteId;
      },
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: null,
        action: "agency.staff_invited",
        target_type: "invite",
        target_id: anyId,
        data: { inviteId: anyId },
      },
    );
    expect((await auditRows()).at(-1)?.target_id).toBe(staffInvite);
    await expectOne(
      () =>
        ok("agencies/resendStaffInvite", staff.cookie, {
          inviteId: staffInvite,
        }),
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: null,
        action: "agency.staff_invite_resent",
        target_type: "invite",
        target_id: staffInvite,
        data: { inviteId: staffInvite },
      },
    );
    const colleague = await accept(staffInvite);
    expect((await auditRows()).at(-1)).toMatchObject({
      actor_user_id: colleague.id,
      action: "agency.staff_accepted",
      target_id: await staffId(agencyId, colleague.id),
      data: { inviteId: staffInvite, inviterId: staffUser.id },
    });

    let companyId = "";
    const slug = `audit-${v7()}`;
    await expectOne(
      async () => {
        companyId = (
          await ok("companies/createCompany", staff.cookie, {
            name: "Audit company",
            slug,
            defaultCountry: "NP",
            timezone: "Asia/Kathmandu",
          })
        ).companyId;
      },
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: anyId,
        action: "company.created",
        target_type: "company",
        target_id: anyId,
        data: { companyId: anyId },
      },
    );
    expect((await auditRows()).at(-1)).toMatchObject({
      company_id: companyId,
      target_id: companyId,
      data: { companyId },
    });

    let superInvite = "";
    await expectOne(
      async () => {
        superInvite = (
          await ok("companies/inviteSuperAdmin", staff.cookie, {
            companyId,
            email: email(),
            name: "Audit manager",
          })
        ).inviteId;
      },
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: companyId,
        action: "company.super_admin_invited",
        target_type: "invite",
        target_id: anyId,
        data: { inviteId: anyId },
      },
    );
    expect((await auditRows()).at(-1)?.target_id).toBe(superInvite);
    const managerUser = await accept(superInvite);
    expect((await auditRows()).at(-1)).toMatchObject({
      actor_user_id: managerUser.id,
      actor_role: "super_admin",
      agency_id: agencyId,
      company_id: companyId,
      action: "company.member_accepted",
      target_type: "company_member",
      target_id: await memberId(agencyId, companyId, managerUser.id),
      data: { inviteId: superInvite, inviterId: staffUser.id },
      ip,
    });
    const manager = await signIn(managerUser);

    let adminInvite = "";
    await expectOne(
      async () => {
        adminInvite = (
          await ok(`companies/${slug}/members/inviteAdmin`, manager.cookie, {
            email: email(),
            name: "Audit seller",
          })
        ).inviteId;
      },
      {
        actor_user_id: managerUser.id,
        actor_role: "super_admin",
        agency_id: agencyId,
        company_id: companyId,
        action: "company.admin_invited",
        target_type: "invite",
        target_id: anyId,
        data: { inviteId: anyId },
      },
    );
    expect((await auditRows()).at(-1)?.target_id).toBe(adminInvite);
    await expectOne(
      () =>
        ok(`companies/${slug}/members/resendInvite`, manager.cookie, {
          inviteId: adminInvite,
        }),
      {
        actor_user_id: managerUser.id,
        actor_role: "super_admin",
        agency_id: agencyId,
        company_id: companyId,
        action: "company.invite_resent",
        target_type: "invite",
        target_id: adminInvite,
        data: { inviteId: adminInvite },
      },
    );
    const endpoint = `https://fcm.googleapis.com/fcm/send/${v7()}`;
    const keys = {
      p256dh: createECDH("prime256v1").generateKeys().toString("base64url"),
      auth: randomBytes(16).toString("base64url"),
    };
    secrets.push(endpoint, keys.p256dh, keys.auth);
    let subscriptionId = "";
    await expectOne(
      async () => {
        ({ subscriptionId } = await ok(
          `companies/${slug}/notifications/subscribePush`,
          manager.cookie,
          { endpoint, keys, expirationTime: null },
        ));
      },
      {
        actor_user_id: managerUser.id,
        actor_role: "super_admin",
        agency_id: agencyId,
        company_id: companyId,
        action: "notifications.subscribed",
        target_type: "push_subscription",
        target_id: anyId,
        data: { subscriptionId: anyId },
      },
    );
    await expectOne(
      () =>
        ok(`companies/${slug}/notifications/unsubscribePush`, manager.cookie, {
          subscriptionId,
        }),
      {
        actor_user_id: managerUser.id,
        actor_role: "super_admin",
        agency_id: agencyId,
        company_id: companyId,
        action: "notifications.unsubscribed",
        target_type: "push_subscription",
        target_id: subscriptionId,
        data: { subscriptionId },
      },
    );
    const beforeRepeat = await auditRows();
    await ok(
      `companies/${slug}/notifications/unsubscribePush`,
      manager.cookie,
      {
        subscriptionId,
      },
    );
    expect(await onlyNew(beforeRepeat)).toEqual([]);
    const seller = await accept(adminInvite);
    const sellerMember = await memberId(agencyId, companyId, seller.id);
    expect((await auditRows()).at(-1)).toMatchObject({
      actor_user_id: seller.id,
      actor_role: "admin",
      action: "company.member_accepted",
      target_id: sellerMember,
      data: { inviteId: adminInvite, inviterId: managerUser.id },
    });

    await expectOne(
      () =>
        ok(`companies/${slug}/members/deactivateMember`, manager.cookie, {
          memberId: sellerMember,
        }),
      {
        actor_user_id: managerUser.id,
        actor_role: "super_admin",
        agency_id: agencyId,
        company_id: companyId,
        action: "company.member_deactivated",
        target_type: "company_member",
        target_id: sellerMember,
        data: { userId: seller.id },
      },
    );
    const reason = "Checking the import for the manager";
    await expectOne(
      () => ok("companies/enterCompany", staff.cookie, { companyId, reason }),
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: companyId,
        action: "agency.enter_company",
        target_type: "company",
        target_id: companyId,
        data: { companyId, reason },
      },
    );
    const fileName = `secret-leads-${v7()}.csv`;
    const sampleName = `Sample Person ${v7()}`;
    secrets.push(fileName, sampleName);
    const boundary = `----anar${v7()}`;
    let batchId = "";
    await expectOne(
      async () => {
        const response = await fixture.apps[0].app.inject({
          method: "POST",
          url: `/api/imports?company=${slug}`,
          remoteAddress: "198.51.100.120",
          headers: {
            origin: publicOrigin,
            cookie: staff.cookie,
            "content-type": `multipart/form-data; boundary=${boundary}`,
          },
          payload: [
            `--${boundary}`,
            `Content-Disposition: form-data; name="file"; filename="${fileName}"`,
            "Content-Type: text/csv",
            "",
            `full_name,phone\n${sampleName},9800000000\n`,
            `--${boundary}--`,
            "",
          ].join("\r\n"),
        });
        expect(response.statusCode).toBe(200);
        batchId = response.json().data.batchId;
      },
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: companyId,
        action: "imports.uploaded",
        target_type: "import_batch",
        target_id: anyId,
        data: { batchId: anyId, rowCount: "1" },
      },
    );
    const draft = {
      batchId,
      mapping: [
        { header: "full_name", target: "system:full_name" },
        { header: "phone", target: "system:phone" },
      ],
      newFields: [],
      expectedRevision: 0,
    };
    const { previewRevision } = await ok(
      `companies/${slug}/imports/dryRunImport`,
      staff.cookie,
      draft,
    );
    await expectOne(
      () =>
        ok(`companies/${slug}/imports/commitImport`, staff.cookie, {
          ...draft,
          expectedRevision: previewRevision,
          previewRevision,
        }),
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: companyId,
        action: "imports.committed",
        target_type: "import_batch",
        target_id: batchId,
        data: { batchId, runId: anyId },
      },
    );
    await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId, companyId, userId: staffUser.id },
        async (scoped) => {
          const [batch] = await scoped
            .select({ runId: importBatches.activeRunId })
            .from(importBatches)
            .where(eq(importBatches.id, batchId));
          if (!batch.runId) throw new Error("Expected a committed run");
          await scoped
            .update(importRuns)
            .set({ state: "stopped", stopCode: "processing_failed" })
            .where(eq(importRuns.id, batch.runId));
        },
      ),
    );
    let resumed: { jobId: string } = { jobId: "" };
    await expectOne(
      async () => {
        resumed = await ok(
          `companies/${slug}/imports/resumeImport`,
          staff.cookie,
          { batchId },
        );
      },
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: companyId,
        action: "imports.resumed",
        target_type: "import_batch",
        target_id: batchId,
        data: { batchId, runId: anyId },
      },
    );
    expect(resumed).toEqual({ jobId: expect.any(String) });
    const leadId = v7();
    let nextStageId = "";
    await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId, companyId, userId: staffUser.id },
        async (scoped) => {
          const openStages = await scoped
            .select({ id: stages.id, isDefault: stages.isDefault })
            .from(stages)
            .where(eq(stages.kind, "open"))
            .orderBy(stages.position);
          const open = openStages.find((row) => row.isDefault);
          const next = openStages.find((row) => !row.isDefault);
          if (!open || !next) throw new Error("Expected two open stages");
          nextStageId = next.id;
          await scoped.insert(leads).values({
            id: leadId,
            companyId,
            fullName: "Before",
            phoneValid: false,
            sourceKind: "manual",
            leadDate: fixture.now(),
            stageId: open.id,
            custom: {},
            score: 1,
            priority: "cold",
            scoreBreakdown: { base: 1 },
            scoredAt: fixture.now(),
          });
        },
      ),
    );
    await expectOne(
      () =>
        ok(`companies/${slug}/leads/updateLeadFields`, staff.cookie, {
          leadId,
          fullName: "After",
        }),
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: companyId,
        action: "leads.updated",
        target_type: "lead",
        target_id: leadId,
        data: { count: "1" },
      },
    );
    await expectOne(
      () =>
        ok(`companies/${slug}/leads/changeStage`, staff.cookie, {
          leadId,
          stageId: nextStageId,
        }),
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: companyId,
        action: "leads.stage_changed",
        target_type: "lead",
        target_id: leadId,
        data: { stageId: nextStageId },
      },
    );
    const managerMember = await memberId(agencyId, companyId, managerUser.id);
    await expectOne(
      () =>
        ok(`companies/${slug}/leads/assignLeads`, staff.cookie, {
          leadIds: [leadId],
          memberId: managerMember,
        }),
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: companyId,
        action: "leads.assign",
        target_type: "company",
        target_id: companyId,
        data: { count: "1", memberId: managerMember, assignmentId: anyId },
      },
    );
    const outcomeId = await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId, companyId, userId: staffUser.id },
        async (scoped) => {
          const [outcome] = await scoped
            .select({ id: outcomes.id })
            .from(outcomes)
            .where(eq(outcomes.seedKey, "site_visit_done"));
          return outcome.id;
        },
      ),
    );
    let loggedFollowUpId = "";
    await expectOne(
      async () => {
        const result = await ok(
          `companies/${slug}/followups/logFollowUp`,
          staff.cookie,
          {
            requestId: v7(),
            leadId,
            outcomeId,
          },
        );
        loggedFollowUpId = result.followUp.id;
      },
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: companyId,
        action: "followups.logged",
        target_type: "lead",
        target_id: leadId,
        data: { followUpId: anyId, outcomeId },
      },
    );
    const suggestionEventId = v7();
    await fixture.db.transaction((tx) =>
      withPlatformTenant(
        tx,
        { agencyId, companyId, userId: staffUser.id },
        async (scoped) => {
          await scoped
            .update(leads)
            .set({ failedAttempts: 5, lostSuggestedAt: fixture.now() })
            .where(eq(leads.id, leadId));
          await scoped.insert(leadEvents).values({
            id: suggestionEventId,
            companyId,
            leadId,
            type: "lost_suggested",
            actorUserId: staffUser.id,
            actorMemberId: null,
            data: { followUpId: loggedFollowUpId, failedAttempts: 5 },
          });
        },
      ),
    );
    await expectOne(
      () =>
        ok(`companies/${slug}/leads/dismissLostSuggestion`, manager.cookie, {
          leadId,
          suggestionEventId,
        }),
      {
        actor_user_id: managerUser.id,
        actor_role: "super_admin",
        agency_id: agencyId,
        company_id: companyId,
        action: "leads.suggestion_dismissed",
        target_type: "lead",
        target_id: leadId,
        data: { suggestionEventId },
      },
    );
    await expectOne(() => ok("companies/leaveCompany", staff.cookie, {}), {
      actor_user_id: staffUser.id,
      actor_role: "agency_staff",
      agency_id: agencyId,
      company_id: companyId,
      action: "agency.leave_company",
      target_type: "company",
      target_id: companyId,
      data: { companyId },
    });
    const beforeNoop = await auditRows();
    await ok("companies/leaveCompany", staff.cookie, {});
    expect(await onlyNew(beforeNoop)).toEqual([]);

    const colleagueStaff = await staffId(agencyId, colleague.id);
    await expectOne(
      () =>
        ok("agencies/deactivateStaff", staff.cookie, {
          staffId: colleagueStaff,
        }),
      {
        actor_user_id: staffUser.id,
        actor_role: "agency_staff",
        agency_id: agencyId,
        company_id: null,
        action: "agency.staff_deactivated",
        target_type: "agency_member",
        target_id: colleagueStaff,
        data: { userId: colleague.id },
      },
    );

    const [{ text }] = await fixture.rows<{ text: string }>(
      sql`select coalesce(string_agg(row_to_json(a)::text, ' '), '') as text from audit_log a`,
    );
    for (const secret of secrets) expect(text).not.toContain(secret);
  });

  it("writes nothing when a mutation is refused", async () => {
    const { owner, a } = await fixture.setup();
    const before = await auditRows();
    expect(
      (
        await api("agencies/createAgency", a.cookie, {
          name: "Not allowed",
          slug: `no-${v7()}`,
          email: email(),
          staffName: "Nobody",
        })
      ).statusCode,
    ).toBe(403);
    expect((await api("agencies/inviteStaff", a.cookie, {})).statusCode).toBe(
      400,
    );
    expect(
      (
        await api("companies/inviteSuperAdmin", a.cookie, {
          companyId: v7(),
          email: email(),
          name: "Nobody",
        })
      ).statusCode,
    ).toBe(404);
    expect(
      (
        await api("companies/enterCompany", a.cookie, {
          companyId: a.companyId,
          reason: "no",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (
        await api("companies/enterCompany", a.cookie, {
          companyId: v7(),
          reason: "Looking at a company I do not own",
        })
      ).statusCode,
    ).toBe(404);
    fixture.advance(15 * 60000 + 1000);
    for (const [path, cookie, payload] of [
      [
        "agencies/createAgency",
        owner.cookie,
        {
          name: "Stale",
          slug: `stale-${v7()}`,
          email: email(),
          staffName: "S",
        },
      ],
      ["agencies/inviteStaff", a.cookie, { email: email(), name: "Stale" }],
      [
        "companies/createCompany",
        a.cookie,
        {
          name: "Stale company",
          slug: `stale-${v7()}`,
          defaultCountry: "NP",
          timezone: "Asia/Kathmandu",
        },
      ],
    ] as const)
      expect((await api(path, cookie, payload)).statusCode).toBe(428);
    expect(await onlyNew(before)).toEqual([]);
  });

  it("does not let the runtime role change or delete audit records", async () => {
    await fixture.setup();
    const before = await auditRows();
    expect(before.length).toBeGreaterThan(0);
    await expect(
      fixture.rows(sql`update audit_log set action = 'changed'`),
    ).rejects.toMatchObject({ cause: { code: "42501" } });
    await expect(
      fixture.rows(sql`delete from audit_log`),
    ).rejects.toMatchObject({
      cause: { code: "42501" },
    });
    expect(await auditRows()).toEqual(before);
  });

  it.each([
    {
      name: "agency creation",
      table: "agencies",
      run: (ctx: { owner: string; staff: string; companyId: string }) =>
        api("agencies/createAgency", ctx.owner, {
          name: "Rolled back",
          slug: `rollback-${v7()}`,
          email: email(),
          staffName: "Nobody",
        }),
    },
    {
      name: "a staff invite",
      table: "invites",
      run: (ctx: { owner: string; staff: string; companyId: string }) =>
        api("agencies/inviteStaff", ctx.staff, {
          email: email(),
          name: "Nobody",
        }),
    },
    {
      name: "company creation",
      table: "companies",
      run: (ctx: { owner: string; staff: string; companyId: string }) =>
        api("companies/createCompany", ctx.staff, {
          name: "Rolled back",
          slug: `rollback-${v7()}`,
          defaultCountry: "NP",
          timezone: "Asia/Kathmandu",
        }),
    },
    {
      name: "a Super Admin invite",
      table: "invites",
      run: (ctx: { owner: string; staff: string; companyId: string }) =>
        api("companies/inviteSuperAdmin", ctx.staff, {
          companyId: ctx.companyId,
          email: email(),
          name: "Nobody",
        }),
    },
  ])("rolls back $name when the audit insert fails", async ({ table, run }) => {
    const { owner, a } = await fixture.setup();
    const count = async () =>
      (
        await fixture.rows<{ total: number; jobs: number }>(
          sql.raw(`select (select count(*)::int from ${table}) as total,
            (select count(*)::int from pgboss.job) as jobs`),
        )
      )[0];
    const before = await count();
    const audits = await auditRows();
    await fixture.owner(`CREATE FUNCTION fail_audit_fixture() RETURNS trigger LANGUAGE plpgsql AS $$ BEGIN RAISE EXCEPTION 'Proof audit failure'; END $$;
      CREATE TRIGGER fail_audit_fixture BEFORE INSERT ON audit_log FOR EACH ROW EXECUTE FUNCTION fail_audit_fixture()`);
    try {
      const response = await run({
        owner: owner.cookie,
        staff: a.cookie,
        companyId: a.companyId,
      });
      expect(response.statusCode).toBe(500);
    } finally {
      await fixture.owner(
        "DROP TRIGGER fail_audit_fixture ON audit_log; DROP FUNCTION fail_audit_fixture()",
      );
    }
    expect(await count()).toEqual(before);
    expect(await auditRows()).toEqual(audits);
  });

  describe("agency staff entries for company managers", () => {
    const entriesOf = (slug: string, cookie: string) =>
      fixture.apps[0].app.inject({
        method: "GET",
        url: `/api/companies/${slug}/members/listAgencyEntries`,
        headers: { cookie },
      });
    async function companyUser(
      target: { agencyId: string; companyId: string },
      role: "super_admin" | "admin",
    ) {
      const user = await fixture.seedUser();
      await fixture.seedMember(target, user.id, "active", role);
      return fixture.loginAs(user, { ip: "198.51.100.122" });
    }

    it("shows the latest 30 entries newest first, with ties broken by ID", async () => {
      const { a } = await fixture.setup();
      const manager = await companyUser(a, "super_admin");
      const base = Date.parse("2026-10-01T00:00:00.000Z");
      const seeded = Array.from({ length: 32 }, (_, index) => ({
        id: v7(),
        at: new Date(base + Math.floor(index / 2) * 60000).toISOString(),
        reason: `Seeded reason ${index}`,
      }));
      await fixture.owner(
        `INSERT INTO audit_log (id, agency_id, company_id, actor_user_id, actor_role, action, target_type, target_id, data, created_at) VALUES ${seeded
          .map(
            (row) =>
              `('${row.id}', '${a.agencyId}', '${a.companyId}', '${a.user.id}', 'agency_staff', 'agency.enter_company', 'company', '${a.companyId}', '{"companyId":"${a.companyId}","reason":"${row.reason}"}', '${row.at}')`,
          )
          .join(", ")}`,
      );
      expect(
        (
          await api("companies/enterCompany", a.cookie, {
            companyId: a.companyId,
            reason: "Fresh entry through the API",
          })
        ).statusCode,
      ).toBe(200);
      const response = await entriesOf(a.company.slug, manager.cookie);
      expect(response.statusCode).toBe(200);
      const items: { id: string; staffName: string; reason: string }[] =
        response.json().data;
      const expected = [...seeded]
        .sort((left, right) =>
          left.at === right.at
            ? right.id.localeCompare(left.id)
            : right.at.localeCompare(left.at),
        )
        .slice(0, 29)
        .map((row) => row.reason);
      expect(items).toHaveLength(30);
      expect(items[0]).toMatchObject({
        reason: "Fresh entry through the API",
        staffName: a.user.name,
      });
      expect(items.slice(1).map((item) => item.reason)).toEqual(expected);
    });

    it("hides another company's entries and refuses an Admin", async () => {
      const { a, b } = await fixture.setup();
      const manager = await companyUser(a, "super_admin");
      const seller = await companyUser(a, "admin");
      for (const staff of [a, b])
        expect(
          (
            await api("companies/enterCompany", staff.cookie, {
              companyId: staff.companyId,
              reason: `Entry by ${staff.companyId}`,
            })
          ).statusCode,
        ).toBe(200);
      const own = await entriesOf(a.company.slug, manager.cookie);
      expect(
        own.json().data.map((item: { reason: string }) => item.reason),
      ).toEqual([`Entry by ${a.companyId}`]);
      expect((await entriesOf(b.company.slug, manager.cookie)).statusCode).toBe(
        404,
      );
      expect((await entriesOf(a.company.slug, seller.cookie)).statusCode).toBe(
        403,
      );
    });
  });
});
