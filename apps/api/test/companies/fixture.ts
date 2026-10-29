import { users, withPlatformTenant } from "@anar/db/platform";
import { companyMembers } from "@anar/db/tenant";
import { eq, sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { v7 } from "uuid";
import { expect } from "vitest";
import { startAgencyFixture } from "../agencies/fixture.js";
import { publicOrigin } from "../auth/fixture.js";

export async function startCompanyFixture() {
  const fixture = await startAgencyFixture();
  const request = (
    method: "GET" | "POST",
    path: string,
    cookie?: string,
    payload?: object,
    index = 0,
  ): Promise<LightMyRequestResponse> =>
    fixture.apps[index].app.inject({
      method,
      url: `/api/companies/${path}`,
      payload,
      headers: { origin: publicOrigin, ...(cookie ? { cookie } : {}) },
    });
  async function createCompany(cookie: string) {
    const details = {
      name: "Client company",
      slug: `client-${v7()}`,
      defaultCountry: "NP",
      timezone: "Asia/Kathmandu",
    };
    const response = await request("POST", "createCompany", cookie, details);
    expect(response.statusCode).toBe(200);
    return { ...details, id: response.json().data.companyId as string };
  }
  async function onboard(cookie: string, ip: string) {
    const invitation = await fixture.invite(cookie);
    const accepted = await fixture.post(
      "acceptInvite",
      { token: invitation.token, name: "Agency staff" },
      { ip },
    );
    expect(accepted.statusCode).toBe(200);
    const [user] = await fixture.db.transaction((tx) =>
      tx.select().from(users).where(eq(users.id, accepted.json().data.userId)),
    );
    const login = await fixture.loginAs(user, { ip });
    const company = await createCompany(login.cookie);
    return { ...invitation, ...login, company, companyId: company.id };
  }
  const details = (companyId: string, overrides: object = {}) => ({
    companyId,
    email: `${v7()}@example.test`,
    name: "Sales manager",
    ...overrides,
  });
  async function invite(
    actor: Awaited<ReturnType<typeof onboard>>,
    overrides: object = {},
  ) {
    const input = details(actor.companyId, overrides);
    const response = await request(
      "POST",
      "inviteSuperAdmin",
      actor.cookie,
      input,
    );
    expect(response.statusCode).toBe(200);
    const inviteId = response.json().data.inviteId as string;
    const job = (await fixture.jobs()).find(
      (row) => row.data.referenceId === inviteId,
    );
    if (!job) throw new Error("Expected company invitation job");
    const message = fixture.codec.decryptMessage(
      job.data.encryptedMessage,
      job.key,
    );
    const token = message.text.match(/\/invite#token=([A-Za-z0-9_-]{43})/)?.[1];
    if (!token) throw new Error("Expected company invitation token");
    return { input, inviteId, job, message, token };
  }
  return {
    ...fixture,
    companyRequest: request,
    createCompany,
    companyInvite: invite,
    companyInput: details,
    async setup() {
      const owner = await fixture.login({ owner: true });
      const a = await onboard(owner.cookie, "198.51.100.81");
      const b = await onboard(owner.cookie, "198.51.100.82");
      return { owner, a, b };
    },
    companyCounts: () =>
      fixture.rows(sql`select
      (select count(*)::int from invites where company_id is not null) as invites,
      (select count(*)::int from audit_log where action='company.super_admin_invited') as audits,
      (select count(*)::int from pgboss.job where data->>'referenceId' in (select id::text from invites where company_id is not null)) as jobs`),
    async seedMember(
      target: { agencyId: string; companyId: string },
      userId: string,
      status: "active" | "invited" | "deactivated" = "active",
      role: "super_admin" | "admin" = "super_admin",
    ) {
      return fixture.db.transaction((tx) =>
        withPlatformTenant(tx, { ...target, userId }, async (scoped) => {
          const [member] = await scoped
            .insert(companyMembers)
            .values({
              id: v7(),
              ...target,
              userId,
              name: "Company member",
              role,
              status,
              deactivatedAt: status === "deactivated" ? fixture.now() : null,
            })
            .returning();
          return member;
        }),
      );
    },
  };
}
export type CompanyFixture = Awaited<ReturnType<typeof startCompanyFixture>>;
