import { createECDH, randomBytes } from "node:crypto";
import {
  createTenantDb,
  notificationDeliveries,
  notifications,
  pushSubscriptions,
  type TenantDb,
  type TenantTx,
} from "@anar/db/tenant";
import type { NotificationInput } from "@anar/domain/notifications";
import { sql } from "drizzle-orm";
import { v7 } from "uuid";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pushBindings from "../../src/modules/auth/pushBindings.js";
import delivery from "../../src/modules/notifications/delivery.js";
import notify from "../../src/modules/notifications/index.js";
import type { PushTarget } from "../../src/modules/notifications/push.js";
import recipients from "../../src/modules/tenant/recipients.js";
import system from "../../src/modules/tenant/system.js";
import { publicOrigin } from "../auth/fixture.js";
import {
  type CompanyFixture,
  startCompanyFixture,
} from "../companies/fixture.js";

type Company = {
  agencyId: string;
  companyId: string;
  company: { slug: string };
};

describe("each new notification is pushed to the person's live devices", () => {
  let fixture: CompanyFixture;
  let tenantDb: TenantDb;
  let sent: string[];
  let reply: (endpoint: string) => number;
  beforeAll(async () => {
    fixture = await startCompanyFixture();
    tenantDb = await createTenantDb(fixture.postgres.appUrl);
  });
  beforeEach(async () => {
    await fixture.reset();
    sent = [];
    reply = () => 201;
  });
  afterAll(async () => {
    await tenantDb?.close();
    await fixture?.close();
  });

  const service = (pushEnabled: boolean) =>
    notify.create({
      ...recipients,
      context: fixture.apps[0].tenant,
      now: fixture.now,
      pushEnabled,
      pushHosts: ["fcm.googleapis.com"],
      vapidPublicKey: "",
      bindPushEndpoint: pushBindings.bindPushEndpoint,
    });
  const worker = (
    send = async (target: PushTarget) => {
      sent.push(target.endpoint);
      return { status: reply(target.endpoint), retryAfter: null };
    },
  ) =>
    delivery.create({
      ...recipients,
      withSystemTenant: (scope, fn) =>
        fixture.db.transaction((tx) => system.withSystemTenant(tx, scope, fn)),
      now: fixture.now,
      sendPush: send,
      readLivePushBinding: pushBindings.readLivePushBinding,
    });
  const scoped = <T>(target: Company, fn: (tx: TenantTx) => Promise<T>) =>
    tenantDb.withTenant(
      { agencyId: target.agencyId, companyId: target.companyId, userId: v7() },
      fn,
    );
  const input = (target: Company, userId: string): NotificationInput => {
    const batchId = v7();
    return {
      companyId: target.companyId,
      userId,
      title: "Import finished",
      body: "120 leads imported.",
      url: `/${target.company.slug}/imports/${batchId}`,
      dedupeKey: `import:${target.companyId}:${batchId}:complete`,
      data: { type: "import_complete", batchId, imported: 120, duplicateDb: 4 },
    };
  };
  const pushJobs = async () =>
    (
      await fixture.rows<{ count: number }>(
        sql`select count(*)::int as count from pgboss.job where name = 'notify.push'`,
      )
    )[0].count;
  const ledger = (target: Company) =>
    scoped(target, (tx) =>
      tx
        .select()
        .from(notificationDeliveries)
        .orderBy(notificationDeliveries.id),
    );
  async function device(target: Company, cookie: string) {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    const endpoint = `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`;
    const response = await fixture.apps[0].app.inject({
      method: "POST",
      url: `/api/companies/${target.company.slug}/notifications/subscribePush`,
      payload: {
        endpoint,
        keys: {
          p256dh: ecdh.getPublicKey().toString("base64url"),
          auth: randomBytes(16).toString("base64url"),
        },
        expirationTime: null,
      },
      headers: { cookie, origin: publicOrigin },
    });
    expect(response.statusCode).toBe(200);
    return endpoint;
  }
  async function setup() {
    const base = await fixture.setup();
    const user = await fixture.seedUser();
    await fixture.seedMember(base.a, user.id, "active", "admin");
    const seller = await fixture.loginAs(user, { ip: "198.51.100.101" });
    return { ...base, seller };
  }
  async function created(target: Company, userId: string) {
    const { id } = await scoped(target, (tx) =>
      service(true).notify(tx, input(target, userId)),
    );
    return {
      agencyId: target.agencyId,
      companyId: target.companyId,
      notificationId: id,
    };
  }
  const control = () => ({ signal: new AbortController().signal });

  it("queues one push job with a new notification, and a rollback drops both", async () => {
    const { a, seller } = await setup();
    const first = input(a, seller.user.id);
    await scoped(a, (tx) => service(true).notify(tx, first));
    await scoped(a, (tx) => service(true).notify(tx, first));
    expect(await pushJobs()).toBe(1);
    await expect(
      scoped(a, async (tx) => {
        await service(true).notify(tx, input(a, seller.user.id));
        throw new Error("feature write failed");
      }),
    ).rejects.toThrow("feature write failed");
    await scoped(a, (tx) =>
      service(false).notify(tx, input(a, seller.user.id)),
    );
    expect(await pushJobs()).toBe(1);
    expect(
      await scoped(a, (tx) => tx.select().from(notifications)),
    ).toHaveLength(2);
  });

  it("sends once to each live device and marks the notification pushed", async () => {
    const { a, seller } = await setup();
    const second = await fixture.loginAs(seller.user, { ip: "198.51.100.102" });
    const phone = await device(a, seller.cookie);
    const laptop = await device(a, second.cookie);
    const job = await created(a, seller.user.id);
    await worker().deliverPush(job, control());
    await worker().deliverPush(job, control());
    expect(sent.sort()).toEqual([phone, laptop].sort());
    expect((await ledger(a)).map((row) => row.state)).toEqual(["sent", "sent"]);
    const [row] = await scoped(a, (tx) => tx.select().from(notifications));
    expect(row.pushedAt).not.toBeNull();
  });

  it("records a skip when the person has no device", async () => {
    const { a, seller } = await setup();
    await worker().deliverPush(await created(a, seller.user.id), control());
    expect(sent).toEqual([]);
    expect(await ledger(a)).toMatchObject([
      { targetKey: "none", state: "skipped" },
    ]);
  });

  it("sends each device once when two workers run the same job", async () => {
    const { a, seller } = await setup();
    await device(a, seller.cookie);
    const job = await created(a, seller.user.id);
    const results = await Promise.allSettled([
      worker().deliverPush(job, control()),
      worker().deliverPush(job, control()),
    ]);
    expect(results.some((result) => result.status === "fulfilled")).toBe(true);
    expect(sent).toHaveLength(1);
    expect((await ledger(a))[0].state).toBe("sent");
  });

  it("sends after a stopped worker's lease runs out", async () => {
    const { a, seller } = await setup();
    const phone = await device(a, seller.cookie);
    const job = await created(a, seller.user.id);
    const stop = new AbortController();
    await expect(
      worker(async () => {
        stop.abort();
        throw stop.signal.reason;
      }).deliverPush(job, { signal: stop.signal }),
    ).rejects.toThrow();
    await worker().deliverPush(job, control());
    expect(sent).toEqual([]);
    fixture.advance(31_000);
    await worker().deliverPush(job, control());
    expect(sent).toEqual([phone]);
  });

  it("retries a failed device without resending the one that worked", async () => {
    const { a, seller } = await setup();
    const second = await fixture.loginAs(seller.user, { ip: "198.51.100.103" });
    const phone = await device(a, seller.cookie);
    const laptop = await device(a, second.cookie);
    reply = (endpoint) => (endpoint === laptop ? 503 : 201);
    const job = await created(a, seller.user.id);
    await expect(worker().deliverPush(job, control())).rejects.toThrow(
      "Some push targets will retry",
    );
    reply = () => 201;
    await worker().deliverPush(job, control());
    expect(sent.filter((endpoint) => endpoint === phone)).toHaveLength(1);
    expect(sent.filter((endpoint) => endpoint === laptop)).toHaveLength(2);
  });

  it("gives up after the first try and three retries", async () => {
    const { a, seller } = await setup();
    await device(a, seller.cookie);
    reply = () => 500;
    const job = await created(a, seller.user.id);
    for (let run = 0; run < 3; run++)
      await expect(worker().deliverPush(job, control())).rejects.toThrow();
    await worker().deliverPush(job, control());
    expect(sent).toHaveLength(4);
    expect(await ledger(a)).toMatchObject([{ state: "failed", attempts: 4 }]);
  });

  it.each([404, 410])(
    "turns the device off when the provider says %i",
    async (status) => {
      const { a, seller } = await setup();
      await device(a, seller.cookie);
      reply = () => status;
      await worker().deliverPush(await created(a, seller.user.id), control());
      expect(await ledger(a)).toMatchObject([{ state: "failed" }]);
      const [subscription] = await scoped(a, (tx) =>
        tx.select().from(pushSubscriptions),
      );
      expect(subscription.disabledAt).not.toBeNull();
    },
  );

  it("skips devices whose session logged out before the send", async () => {
    const { a, seller } = await setup();
    await device(a, seller.cookie);
    const job = await created(a, seller.user.id);
    const logout = await fixture.apps[0].app.inject({
      method: "POST",
      url: "/api/auth/logout",
      payload: {},
      headers: { cookie: seller.cookie, origin: publicOrigin },
    });
    expect(logout.statusCode).toBe(200);
    await worker().deliverPush(job, control());
    expect(sent).toEqual([]);
    expect(await ledger(a)).toMatchObject([{ state: "skipped" }]);
  });

  it("pushes to staff only while their company entry lasts", async () => {
    const { a } = await setup();
    const entered = await fixture.companyRequest(
      "POST",
      "enterCompany",
      a.cookie,
      {
        companyId: a.companyId,
        reason: "Checking the import for the client",
      },
    );
    expect(entered.statusCode).toBe(200);
    const phone = await device(a, a.cookie);
    await worker().deliverPush(await created(a, a.user.id), control());
    expect(sent).toEqual([phone]);
    fixture.advance(8 * 60 * 60 * 1000);
    sent = [];
    await worker().deliverPush(await created(a, a.user.id), control());
    expect(sent).toEqual([]);
  });

  it("does not push a notification that has expired", async () => {
    const { a, seller } = await setup();
    await device(a, seller.cookie);
    const job = await created(a, seller.user.id);
    const [row] = await scoped(a, (tx) => tx.select().from(notifications));
    fixture.setTime(row.createdAt.getTime() + 24 * 60 * 60 * 1000);
    await worker().deliverPush(job, control());
    expect(sent).toEqual([]);
    expect(await ledger(a)).toEqual([]);
  });
});
