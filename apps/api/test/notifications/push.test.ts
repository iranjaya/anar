import { createECDH, randomBytes } from "node:crypto";
import { apiSuccessSchema } from "@anar/domain/http";
import {
  pushStateSchema,
  type SubscribePushInput,
  subscribePushSchema,
} from "@anar/domain/notifications";
import { describe, expect, it, vi } from "vitest";
import subscriptions from "../../src/modules/notifications/subscriptions.js";
import type { Ctx } from "../../src/modules/tenant/index.js";

const ecdh = createECDH("prime256v1");
ecdh.generateKeys();
const input: SubscribePushInput = {
  endpoint: "https://fcm.googleapis.com/fcm/send/device-token",
  keys: {
    p256dh: ecdh.getPublicKey().toString("base64url"),
    auth: randomBytes(16).toString("base64url"),
  },
  expirationTime: null,
};
const valid = (change: Partial<SubscribePushInput>) =>
  subscribePushSchema.safeParse({ ...input, ...change }).success;
const keys = (change: Partial<SubscribePushInput["keys"]>) => ({
  keys: { ...input.keys, ...change },
});

describe("push subscription input", () => {
  it("accepts what a browser gives for a subscription", () => {
    expect(valid({})).toBe(true);
    expect(valid({ expirationTime: Date.now() + 60_000 })).toBe(true);
  });

  it.each([
    ["plain http", "http://fcm.googleapis.com/fcm/send/x"],
    ["a user and password", "https://a:b@fcm.googleapis.com/fcm/send/x"],
    ["a port", "https://fcm.googleapis.com:8443/fcm/send/x"],
    ["a fragment", "https://fcm.googleapis.com/fcm/send/x#y"],
    ["no URL at all", "fcm.googleapis.com/fcm/send/x"],
    ["a very long URL", `https://fcm.googleapis.com/${"a".repeat(1000)}`],
  ])("refuses an endpoint with %s", (_name, endpoint) => {
    expect(valid({ endpoint })).toBe(false);
  });

  it("refuses keys of the wrong size or shape", () => {
    const notUncompressed = Buffer.concat([Buffer.from([2]), randomBytes(64)]);
    expect(valid(keys({ p256dh: notUncompressed.toString("base64url") }))).toBe(
      false,
    );
    expect(valid(keys({ p256dh: randomBytes(33).toString("base64url") }))).toBe(
      false,
    );
    expect(valid(keys({ p256dh: `${input.keys.p256dh}=` }))).toBe(false);
    expect(valid(keys({ auth: randomBytes(15).toString("base64url") }))).toBe(
      false,
    );
    expect(valid(keys({ auth: randomBytes(32).toString("base64url") }))).toBe(
      false,
    );
    expect(valid(keys({ auth: `${input.keys.auth}=` }))).toBe(false);
  });

  it("refuses unknown fields and a zero or fractional expiry", () => {
    expect(valid({ userId: "x" } as Partial<SubscribePushInput>)).toBe(false);
    expect(
      valid(keys({ extra: "x" } as Partial<SubscribePushInput["keys"]>)),
    ).toBe(false);
    expect(valid({ expirationTime: 0 })).toBe(false);
    expect(valid({ expirationTime: 1.5 })).toBe(false);
  });
});

describe("subscribing a device", () => {
  const withContext = vi.fn();
  const service = subscriptions.create({
    context: { withContext },
    now: () => new Date("2026-10-31T08:00:00.000Z"),
    pushEnabled: false,
    pushHosts: ["fcm.googleapis.com", "web.push.apple.com"],
    vapidPublicKey: "test-public-key",
    bindPushEndpoint: vi.fn(),
  });
  const actor = {} as Ctx;

  it.each([
    ["a host nobody configured", "https://push.example.com/send/x"],
    ["a loopback address", "https://127.0.0.1/send/x"],
    ["a private address", "https://10.0.0.8/send/x"],
    ["a look-alike host", "https://fcm.googleapis.com.example.com/send/x"],
  ])("refuses %s before opening the database", async (_name, endpoint) => {
    await expect(async () =>
      service.subscribePush(actor, { ...input, endpoint }, { ip: null }),
    ).rejects.toMatchObject({ code: "validation" });
    expect(withContext).not.toHaveBeenCalled();
  });

  it("refuses a subscription that has already expired", async () => {
    await expect(async () =>
      service.subscribePush(
        actor,
        { ...input, expirationTime: Date.parse("2026-10-31T08:00:00.000Z") },
        { ip: null },
      ),
    ).rejects.toMatchObject({ code: "validation" });
    expect(withContext).not.toHaveBeenCalled();
  });
});

describe("push state response", () => {
  const response = apiSuccessSchema(pushStateSchema);

  it("decodes on and off states", () => {
    expect(
      response.parse({
        ok: true,
        data: { enabled: false, subscriptionId: null, publicKey: "k" },
      }).data.enabled,
    ).toBe(false);
    expect(
      response.parse({
        ok: true,
        data: {
          enabled: true,
          subscriptionId: "01900000-0000-7000-8000-000000000001",
          publicKey: "k",
        },
      }).data.subscriptionId,
    ).toBe("01900000-0000-7000-8000-000000000001");
  });

  it("refuses a response that carries the endpoint", () => {
    expect(
      response.safeParse({
        ok: true,
        data: {
          enabled: true,
          subscriptionId: "01900000-0000-7000-8000-000000000001",
          publicKey: "k",
          endpoint: input.endpoint,
        },
      }).success,
    ).toBe(false);
  });
});
