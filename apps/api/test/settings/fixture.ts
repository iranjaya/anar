import { createTenantDb, leads, type TenantTx } from "@anar/db/tenant";
import { sql } from "drizzle-orm";
import type { LightMyRequestResponse } from "fastify";
import { v7 } from "uuid";
import { publicOrigin } from "../auth/fixture.js";
import { startCompanyFixture } from "../companies/fixture.js";

type Target = { agencyId: string; companyId: string };

export async function startSettingsFixture() {
  const fixture = await startCompanyFixture();
  const tenantDb = await createTenantDb(fixture.postgres.appUrl);
  const scoped = <T>(target: Target, fn: (tx: TenantTx) => Promise<T>) =>
    tenantDb.withTenant({ ...target, userId: v7() }, fn);
  return {
    ...fixture,
    scoped,
    async close() {
      await tenantDb.close();
      await fixture.close();
    },
    post(
      slug: string,
      cookie: string,
      operation: string,
      payload: object,
    ): Promise<LightMyRequestResponse> {
      return fixture.apps[0].app.inject({
        method: "POST",
        url: `/api/companies/${slug}/settings/${operation}`,
        payload,
        headers: { origin: publicOrigin, cookie },
      });
    },
    async catalog(slug: string, cookie: string) {
      const response = await fixture.apps[0].app.inject({
        method: "GET",
        url: `/api/companies/${slug}/settings/getSettings`,
        headers: { cookie },
      });
      return response.json().data as {
        fields: {
          id: string;
          key: string;
          label: string;
          archivedAt: string | null;
          type: string;
          options: { value: string; label: string }[] | null;
        }[];
        stages: {
          id: string;
          name: string;
          kind: string;
          isDefault: boolean;
          position: number;
          archivedAt: string | null;
        }[];
        outcomes: {
          id: string;
          name: string;
          countsAsFailed: boolean;
          position: number;
          archivedAt: string | null;
        }[];
        lostReasons: {
          id: string;
          name: string;
          position: number;
          archivedAt: string | null;
        }[];
      };
    },
    audits(action: string) {
      return fixture.rows<{ target_id: string }>(
        sql`select target_id from audit_log where action = ${action} order by created_at, id`,
      );
    },
    addLead(
      target: Target,
      stageId: string,
      overrides: Partial<typeof leads.$inferInsert> = {},
    ) {
      return scoped(target, (tx) =>
        tx.insert(leads).values({
          id: v7(),
          companyId: target.companyId,
          phoneValid: false,
          sourceKind: "import",
          leadDate: fixture.now(),
          stageId,
          custom: {},
          score: 0,
          priority: "cold",
          scoreBreakdown: {},
          scoredAt: fixture.now(),
          ...overrides,
        }),
      );
    },
    async setup() {
      const base = await fixture.setup();
      const login = async (target: Target, role: "super_admin" | "admin") => {
        const user = await fixture.seedUser();
        await fixture.seedMember(target, user.id, "active", role);
        return fixture.loginAs(user);
      };
      return {
        ...base,
        manager: await login(base.a, "super_admin"),
        seller: await login(base.a, "admin"),
        foreign: await login(base.b, "super_admin"),
        slug: base.a.company.slug,
        foreignSlug: base.b.company.slug,
      };
    },
  };
}
export type SettingsFixture = Awaited<ReturnType<typeof startSettingsFixture>>;
