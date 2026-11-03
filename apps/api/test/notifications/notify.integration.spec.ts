import {
  createTenantDb,
  notifications,
  type TenantDb,
  type TenantTx,
} from "@anar/db/tenant";
import type { NotificationInput } from "@anar/domain/notifications";
import { eq, sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import notify, {
  type NotificationService,
} from "../../src/modules/notifications/index.js";
import recipients from "../../src/modules/tenant/recipients.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

describe("notify writes one in-app notification per event and recipient", () => {
  let fixture: CompanyFixture;
  let service: NotificationService;
  let tenantDb: TenantDb;
  beforeAll(async () => {
    fixture = await startCompanyFixture();
    tenantDb = await createTenantDb(fixture.postgres.appUrl);
    service = notify.create({
      ...recipients,
      context: fixture.apps[0].tenant,
      now: fixture.now,
      pushEnabled: false,
      pushHosts: [],
      vapidPublicKey: "",
      bindPushEndpoint: async () => false,
    });
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await tenantDb?.close();
    await fixture?.close();
  });

  type Company = {
    agencyId: string;
    companyId: string;
    company: { slug: string };
  };
  const scoped = <T>(
    target: Company,
    fn: (tx: TenantTx) => Promise<T>,
  ): Promise<T> =>
    tenantDb.withTenant(
      { agencyId: target.agencyId, companyId: target.companyId, userId: v7() },
      fn,
    );
  const input = (
    target: Company,
    userId: string,
    overrides: Partial<NotificationInput> = {},
  ): NotificationInput => {
    const batchId = "01900000-0000-7000-8000-000000000001";
    return {
      companyId: target.companyId,
      userId,
      title: "Import finished",
      body: "120 leads imported.",
      url: `/${target.company.slug}/imports/${batchId}`,
      dedupeKey: `import:${target.companyId}:${batchId}:complete`,
      data: { type: "import_complete", batchId, imported: 120, duplicateDb: 4 },
      ...overrides,
    };
  };
  let home: Company;
  const rows = () =>
    scoped(home, (tx) =>
      tx.select().from(notifications).orderBy(notifications.id),
    );
  async function setup() {
    const base = await fixture.setup();
    const manager = await fixture.seedUser();
    await fixture.seedMember(base.a, manager.id, "active", "super_admin");
    home = base.a;
    return { ...base, manager };
  }

  it("writes the row once and a repeat returns the same ID", async () => {
    const { a, manager } = await setup();
    const first = await scoped(a, (tx) =>
      service.notify(tx, input(a, manager.id)),
    );
    await scoped(a, (tx) =>
      tx
        .update(notifications)
        .set({ readAt: new Date("2026-10-31T00:00:00Z") })
        .where(eq(notifications.id, first.id)),
    );
    const again = await scoped(a, (tx) =>
      service.notify(tx, input(a, manager.id)),
    );
    expect(again).toEqual(first);
    const stored = await rows();
    expect(stored).toHaveLength(1);
    expect(stored[0].readAt).not.toBeNull();
  });

  it("keeps one row when the same event is sent at the same time", async () => {
    const { a, manager } = await setup();
    const results = await Promise.all(
      Array.from({ length: 4 }, () =>
        scoped(a, (tx) => service.notify(tx, input(a, manager.id))),
      ),
    );
    expect(new Set(results.map((r) => r.id)).size).toBe(1);
    expect(await rows()).toHaveLength(1);
  });

  it("refuses a reused key with different content", async () => {
    const { a, manager } = await setup();
    await scoped(a, (tx) => service.notify(tx, input(a, manager.id)));
    await expect(
      scoped(a, (tx) =>
        service.notify(tx, input(a, manager.id, { title: "Changed" })),
      ),
    ).rejects.toMatchObject({ code: "conflict" });
    expect(await rows()).toHaveLength(1);
  });

  it("removes the notification when the feature write rolls back", async () => {
    const { a, manager } = await setup();
    await expect(
      scoped(a, async (tx) => {
        await service.notify(tx, input(a, manager.id));
        throw new Error("feature write failed");
      }),
    ).rejects.toThrow("feature write failed");
    expect(await rows()).toHaveLength(0);
  });

  it("sends to the uploader staff and a manager of the company", async () => {
    const { a, manager } = await setup();
    for (const userId of [a.user.id, manager.id])
      await scoped(a, (tx) => service.notify(tx, input(a, userId)));
    expect((await rows()).map((r) => r.userId).sort()).toEqual(
      [a.user.id, manager.id].sort(),
    );
  });

  it("refuses recipients who cannot use the company", async () => {
    const { a, b } = await setup();
    const deactivated = await fixture.seedUser();
    await fixture.seedMember(a, deactivated.id, "deactivated");
    const invited = await fixture.seedUser();
    await fixture.seedMember(a, invited.id, "invited");
    const disabled = await fixture.seedUser();
    await fixture.seedMember(a, disabled.id);
    await fixture.rows(
      sql`update users set deactivated_at = now() where id = ${disabled.id}`,
    );
    const otherCompany = await fixture.seedUser();
    await fixture.seedMember(b, otherCompany.id);
    for (const userId of [
      deactivated.id,
      invited.id,
      disabled.id,
      otherCompany.id,
      b.user.id,
      v7(),
    ])
      await expect(
        scoped(a, (tx) => service.notify(tx, input(a, userId))),
      ).rejects.toMatchObject({ code: "forbidden" });
    expect(await rows()).toHaveLength(0);
  });

  it("refuses another company's ID or link in this company's scope", async () => {
    const { a, b, manager } = await setup();
    await expect(
      scoped(a, (tx) =>
        service.notify(tx, {
          ...input(b, manager.id),
          url: input(a, manager.id).url,
        }),
      ),
    ).rejects.toMatchObject({ code: "forbidden" });
    await expect(
      scoped(a, (tx) =>
        service.notify(tx, {
          ...input(a, manager.id),
          url: `/${b.company.slug}`,
        }),
      ),
    ).rejects.toMatchObject({ code: "validation" });
    expect(await rows()).toHaveLength(0);
  });

  it("fails without company scope", async () => {
    const { a, manager } = await setup();
    await expect(
      fixture.db.transaction((tx) => service.notify(tx, input(a, manager.id))),
    ).rejects.toThrow("Company scope is required");
  });

  it("hides the rows from another company's scope", async () => {
    const { a, b, manager } = await setup();
    await scoped(a, (tx) => service.notify(tx, input(a, manager.id)));
    const seen = await scoped(b, (tx) => tx.select().from(notifications));
    expect(seen).toHaveLength(0);
  });
});
