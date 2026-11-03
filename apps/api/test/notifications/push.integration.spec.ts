import { createECDH, randomBytes } from "node:crypto";
import {
  createTenantDb,
  pushSubscriptions,
  type TenantDb,
} from "@anar/db/tenant";
import { asc, sql } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
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

describe("people turn push on and off for their own device", () => {
  let fixture: CompanyFixture;
  let tenantDb: TenantDb;
  beforeAll(async () => {
    fixture = await startCompanyFixture();
    tenantDb = await createTenantDb(fixture.postgres.appUrl);
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await tenantDb?.close();
    await fixture?.close();
  });

  function browser() {
    const ecdh = createECDH("prime256v1");
    ecdh.generateKeys();
    return {
      endpoint: `https://fcm.googleapis.com/fcm/send/${randomBytes(12).toString("hex")}`,
      keys: {
        p256dh: ecdh.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
      expirationTime: null,
    };
  }
  const request = (
    method: "GET" | "POST",
    slug: string,
    action: string,
    cookie: string,
    payload?: object,
    origin: string | null = publicOrigin,
  ) =>
    fixture.apps[0].app.inject({
      method,
      url: `/api/companies/${slug}/notifications/${action}`,
      ...(payload ? { payload } : {}),
      headers: { cookie, ...(origin ? { origin } : {}) },
    });
  const subscribe = (slug: string, cookie: string, input: object) =>
    request("POST", slug, "subscribePush", cookie, input);
  const unsubscribe = (slug: string, cookie: string, subscriptionId: string) =>
    request("POST", slug, "unsubscribePush", cookie, { subscriptionId });
  const state = async (slug: string, cookie: string) => {
    const response = await request("GET", slug, "getPushState", cookie);
    expect(response.statusCode).toBe(200);
    return response.json().data as {
      enabled: boolean;
      subscriptionId: string | null;
    };
  };
  async function stored(userId: string, ...targets: Company[]) {
    const rows = [];
    for (const target of targets)
      rows.push(
        ...(await tenantDb.withTenant(
          { agencyId: target.agencyId, companyId: target.companyId, userId },
          (tx) =>
            tx
              .select()
              .from(pushSubscriptions)
              .orderBy(
                asc(pushSubscriptions.createdAt),
                asc(pushSubscriptions.id),
              ),
        )),
      );
    return rows;
  }
  const audits = () =>
    fixture.rows<{ action: string; data: object }>(
      sql`select action, data from audit_log where action like 'notifications.%subscribed' order by id`,
    );
  async function companyUser(target: Company, ip: string) {
    const user = await fixture.seedUser();
    await fixture.seedMember(target, user.id, "active", "admin");
    return fixture.loginAs(user, { ip });
  }
  async function setup() {
    const base = await fixture.setup();
    const seller = await companyUser(base.a, "198.51.100.91");
    return { ...base, seller, slug: base.a.company.slug };
  }

  it("saves one device per session and company, and repeat subscribe keeps it", async () => {
    const { a, seller, slug } = await setup();
    expect(await state(slug, seller.cookie)).toMatchObject({
      enabled: false,
      subscriptionId: null,
    });
    const device = browser();
    const first = await subscribe(slug, seller.cookie, device);
    expect(first.statusCode).toBe(200);
    const { subscriptionId } = first.json().data;
    const again = await subscribe(slug, seller.cookie, device);
    expect(again.json().data.subscriptionId).toBe(subscriptionId);
    expect(await state(slug, seller.cookie)).toMatchObject({
      enabled: true,
      subscriptionId,
    });
    const rows = await stored(seller.user.id, a);
    expect(rows).toHaveLength(1);
    expect(rows[0]).toMatchObject({
      companyId: a.companyId,
      userId: seller.user.id,
    });
    expect(JSON.stringify(first.json())).not.toContain(device.endpoint);
    expect(JSON.stringify(await audits())).not.toContain(device.endpoint);
  });

  it("lets the same session subscribe one browser in two companies", async () => {
    const { a, b, seller, slug } = await setup();
    await fixture.seedMember(b, seller.user.id, "active", "admin");
    const device = browser();
    expect((await subscribe(slug, seller.cookie, device)).statusCode).toBe(200);
    expect(
      (await subscribe(b.company.slug, seller.cookie, device)).statusCode,
    ).toBe(200);
    const rows = await stored(seller.user.id, a, b);
    expect(rows.map((row) => row.companyId).sort()).toEqual(
      [a.companyId, b.companyId].sort(),
    );
    expect(new Set(rows.map((row) => row.sessionId)).size).toBe(1);
  });

  it("refuses a browser that another live session already holds", async () => {
    const { a, seller, slug } = await setup();
    const other = await companyUser(a, "198.51.100.92");
    const device = browser();
    expect((await subscribe(slug, seller.cookie, device)).statusCode).toBe(200);
    const taken = await subscribe(slug, other.cookie, device);
    expect(taken.statusCode).toBe(409);
    const secondLogin = await fixture.loginAs(seller.user, {
      ip: "198.51.100.93",
    });
    expect((await subscribe(slug, secondLogin.cookie, device)).statusCode).toBe(
      409,
    );
    expect(await stored(seller.user.id, a)).toHaveLength(1);
  });

  it("frees the browser on logout so the next sign-in can use it", async () => {
    const { a, seller, slug } = await setup();
    const device = browser();
    expect((await subscribe(slug, seller.cookie, device)).statusCode).toBe(200);
    const logout = await fixture.apps[0].app.inject({
      method: "POST",
      url: "/api/auth/logout",
      payload: {},
      headers: { cookie: seller.cookie, origin: publicOrigin },
    });
    expect(logout.statusCode).toBe(200);
    expect(
      (await request("GET", slug, "getPushState", seller.cookie)).statusCode,
    ).toBe(401);
    const next = await companyUser(a, "198.51.100.94");
    expect((await subscribe(slug, next.cookie, device)).statusCode).toBe(200);
    expect(await state(slug, next.cookie)).toMatchObject({ enabled: true });
  });

  it("lets a new sign-in take a browser whose old session expired", async () => {
    const { a, seller, slug } = await setup();
    const device = browser();
    expect((await subscribe(slug, seller.cookie, device)).statusCode).toBe(200);
    await fixture.rows(
      sql`update sessions set expires_at = ${new Date(fixture.now().getTime() - 60_000)} where user_id = ${seller.user.id}`,
    );
    expect((await subscribe(slug, seller.cookie, device)).statusCode).toBe(401);
    const next = await companyUser(a, "198.51.100.95");
    expect((await subscribe(slug, next.cookie, device)).statusCode).toBe(200);
  });

  it("turns off only own devices, and repeat turn-off is fine", async () => {
    const { a, b, seller, slug } = await setup();
    const other = await companyUser(a, "198.51.100.96");
    const mine = (await subscribe(slug, seller.cookie, browser())).json().data
      .subscriptionId as string;
    expect((await unsubscribe(slug, other.cookie, mine)).statusCode).toBe(404);
    await fixture.seedMember(b, seller.user.id, "active", "admin");
    expect(
      (await unsubscribe(b.company.slug, seller.cookie, mine)).statusCode,
    ).toBe(404);
    expect((await unsubscribe(slug, seller.cookie, mine)).statusCode).toBe(200);
    expect((await unsubscribe(slug, seller.cookie, mine)).statusCode).toBe(200);
    expect(await state(slug, seller.cookie)).toMatchObject({
      enabled: false,
      subscriptionId: null,
    });
    expect((await audits()).map((row) => row.action)).toEqual([
      "notifications.subscribed",
      "notifications.unsubscribed",
    ]);
  });

  it("takes the owner from the session, not the request body", async () => {
    const { a, seller, slug } = await setup();
    const forged = await subscribe(slug, seller.cookie, {
      ...browser(),
      userId: a.user.id,
    });
    expect(forged.statusCode).toBe(400);
    expect(await stored(seller.user.id, a)).toHaveLength(0);
  });

  it("refuses a hostile origin, an unknown push host and the owner", async () => {
    const { a, owner, seller, slug } = await setup();
    expect(
      (
        await request(
          "POST",
          slug,
          "subscribePush",
          seller.cookie,
          browser(),
          "https://evil.example",
        )
      ).statusCode,
    ).toBe(403);
    expect(
      (
        await subscribe(slug, seller.cookie, {
          ...browser(),
          endpoint: "https://127.0.0.1/push/x",
        })
      ).statusCode,
    ).toBe(400);
    expect(
      (await request("GET", slug, "getPushState", owner.cookie)).statusCode,
    ).toBe(403);
    expect(await stored(seller.user.id, a)).toHaveLength(0);
  });
});
