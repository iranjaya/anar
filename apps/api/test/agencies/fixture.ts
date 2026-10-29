import { sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { v7 } from "uuid";
import { expect } from "vitest";
import { publicOrigin, startAuthFixture } from "../auth/fixture.js";

export async function startAgencyFixture() {
  const fixture = await startAuthFixture();
  const request = (
    method: "GET" | "POST",
    path: string,
    cookie?: string,
    payload?: object,
    index = 0,
  ): Promise<LightMyRequestResponse> =>
    fixture.apps[index].app.inject({
      method,
      url: `/api/agencies/${path}`,
      payload,
      headers: { origin: publicOrigin, ...(cookie ? { cookie } : {}) },
      remoteAddress: "198.51.100.50",
    });
  const input = (overrides: object = {}) => ({
    name: "Proof agency",
    slug: `agency-${v7()}`,
    email: `${v7()}@example.test`,
    staffName: "Invited staff",
    ...overrides,
  });
  async function invite(cookie: string, overrides: object = {}) {
    const details = input(overrides);
    const response = await request("POST", "createAgency", cookie, details);
    expect(response.statusCode).toBe(200);
    const ids = response.json().data as { agencyId: string; inviteId: string };
    const job = (await fixture.jobs()).find(
      (row) => row.data.referenceId === ids.inviteId,
    );
    if (!job) throw new Error("Expected invite email job");
    const message = fixture.codec.decryptMessage(
      job.data.encryptedMessage,
      job.key,
    );
    const token = message.text.match(/\/invite#token=([A-Za-z0-9_-]{43})/)?.[1];
    if (!token) throw new Error("Expected invite link");
    return { ...ids, details, job, message, token };
  }
  const counts = () =>
    fixture.rows(sql`select
    (select count(*)::int from agencies) as agencies,
    (select count(*)::int from invites) as invites,
    (select count(*)::int from audit_log where action = 'agency.created') as audits,
    (select count(*)::int from pgboss.job where data->>'kind' = 'invite') as jobs`);
  return { ...fixture, request, input, invite, counts };
}

export type AgencyFixture = Awaited<ReturnType<typeof startAgencyFixture>>;
