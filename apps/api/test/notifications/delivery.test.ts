import { createECDH, randomBytes } from "node:crypto";
import type { TenantTx } from "@anar/db/tenant";
import { afterEach, describe, expect, it, vi } from "vitest";
import delivery from "../../src/modules/notifications/delivery.js";
import push from "../../src/modules/notifications/push.js";
import repository from "../../src/modules/notifications/repository.js";

const timezone = "Asia/Kathmandu";
const createdAt = new Date("2026-10-31T08:00:00.000Z");
const leadId = "01900000-0000-7000-8000-000000000002";
const id = "01900000-0000-7000-8000-000000000009";

describe("push expiry", () => {
  const expires = (data: Record<string, unknown>) =>
    delivery
      ._expiresAt({ createdAt, data: data as never }, timezone)
      .toISOString();

  it("gives one-off notices 24 hours", () => {
    expect(expires({ type: "import_complete" })).toBe(
      "2026-11-01T08:00:00.000Z",
    );
    expect(expires({ type: "assigned" })).toBe("2026-11-01T08:00:00.000Z");
    expect(expires({ type: "lost_suggested" })).toBe(
      "2026-11-01T08:00:00.000Z",
    );
  });

  it("ends overdue and daily notices at the next local midnight", () => {
    expect(expires({ type: "overdue", leadId, localDate: "2026-10-31" })).toBe(
      "2026-10-31T18:15:00.000Z",
    );
    expect(expires({ type: "daily", localDate: "2026-12-31" })).toBe(
      "2026-12-31T18:15:00.000Z",
    );
  });

  it("ends a weekly notice at the next local Monday", () => {
    expect(expires({ type: "weekly", weekStart: "2026-10-26" })).toBe(
      "2026-11-08T18:15:00.000Z",
    );
  });
});

describe("push fallback", () => {
  afterEach(() => vi.restoreAllMocks());

  it("does not send push on replay after email fallback starts", async () => {
    vi.spyOn(repository, "lockNotification").mockResolvedValue();
    vi.spyOn(repository, "readNotification").mockResolvedValue({ id } as never);
    vi.spyOn(repository, "hasEmailFallback").mockResolvedValue(true);
    const list = vi.spyOn(repository, "listLiveSubscriptions");
    const sendPush = vi.fn();
    const worker = delivery.create({
      withSystemTenant: async (_scope, fn) => fn({} as TenantTx),
      now: () => createdAt,
      sendPush,
      canReceiveCompanyNotification: async () => true,
      isScopedCompanyMember: async () => true,
      readScopedCompanyTimezone: async () => timezone,
      readLivePushBinding: async () => undefined,
    });
    await worker.deliverPush(
      { agencyId: leadId, companyId: leadId, notificationId: id },
      { signal: new AbortController().signal },
    );
    expect(sendPush).not.toHaveBeenCalled();
    expect(list).not.toHaveBeenCalled();
  });
});

describe("retry after", () => {
  const at = new Date("2026-10-31T08:00:00.000Z");

  it("reads seconds and dates, and caps the wait at two minutes", () => {
    expect(delivery._retryAfterMs("30", at)).toBe(30_000);
    expect(delivery._retryAfterMs("3600", at)).toBe(120_000);
    expect(delivery._retryAfterMs("Sat, 31 Oct 2026 08:01:00 GMT", at)).toBe(
      60_000,
    );
  });

  it("treats a missing, past or broken header as no wait", () => {
    expect(delivery._retryAfterMs(null, at)).toBe(0);
    expect(delivery._retryAfterMs("Sat, 31 Oct 2026 07:00:00 GMT", at)).toBe(0);
    expect(delivery._retryAfterMs("soon", at)).toBe(0);
  });
});

describe("push message", () => {
  it("uses generic lock-screen text, the notification tag and its link", () => {
    expect(
      push.message({ id, type: "overdue", url: `/client-one/leads/${leadId}` }),
    ).toEqual({
      notificationId: id,
      title: "A follow-up is overdue",
      body: "Open Anar to see it.",
      url: `/client-one/leads/${leadId}`,
      tag: id,
    });
  });
});

describe("push transport", () => {
  afterEach(() => {
    vi.unstubAllGlobals();
  });

  function keys() {
    const server = createECDH("prime256v1");
    server.generateKeys();
    const device = createECDH("prime256v1");
    device.generateKeys();
    return {
      vapid: {
        subject: "mailto:alerts@anar.example.test",
        publicKey: server.getPublicKey().toString("base64url"),
        privateKey: server.getPrivateKey().toString("base64url"),
      },
      target: {
        endpoint: "https://fcm.googleapis.com/fcm/send/device",
        p256dh: device.getPublicKey().toString("base64url"),
        auth: randomBytes(16).toString("base64url"),
      },
    };
  }
  const message = push.message({ id, type: "assigned", url: "/client-one" });

  it("sends an encrypted, signed request without following redirects", async () => {
    const { vapid, target } = keys();
    const fetch = vi.fn(
      async () =>
        new Response(null, { status: 429, headers: { "Retry-After": "12" } }),
    );
    vi.stubGlobal("fetch", fetch);
    const response = await push.createSender(vapid)(
      target,
      message,
      600,
      new AbortController().signal,
    );
    expect(response).toEqual({ status: 429, retryAfter: "12" });
    const [url, init] = fetch.mock.calls[0] as unknown as [
      string,
      RequestInit & { headers: [string, string][] },
    ];
    expect(url).toBe(target.endpoint);
    expect(init.redirect).toBe("error");
    const headers = Object.fromEntries(
      init.headers.map(([name, value]) => [name.toLowerCase(), value]),
    );
    expect(headers["content-encoding"]).toBe("aes128gcm");
    expect(headers.ttl).toBe("600");
    expect(headers.authorization).toMatch(
      new RegExp(`^vapid t=.+, k=${vapid.publicKey}$`),
    );
    expect(Buffer.from(init.body as Uint8Array).toString()).not.toContain(
      "Open Anar",
    );
  });

  it("stops when the job is cancelled", async () => {
    const { vapid, target } = keys();
    vi.stubGlobal(
      "fetch",
      vi.fn(
        (_url: string, init: RequestInit) =>
          new Promise((_resolve, reject) => {
            init.signal?.addEventListener("abort", () =>
              reject(init.signal?.reason),
            );
          }),
      ),
    );
    const controller = new AbortController();
    const sending = push.createSender(vapid)(
      target,
      message,
      600,
      controller.signal,
    );
    controller.abort();
    await expect(sending).rejects.toThrow();
  });
});
