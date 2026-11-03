import { createHash } from "node:crypto";
import { pushEndpointBindings, sessions } from "@anar/db/platform";
import { eq } from "drizzle-orm";
import { afterAll, beforeAll, beforeEach, describe, expect, it } from "vitest";
import pushBindings from "../../src/modules/auth/pushBindings.js";
import { type AuthFixture, startAuthFixture } from "./fixture.js";

const hash = (endpoint: string) =>
  createHash("sha256").update(endpoint).digest("hex");

describe("one push endpoint belongs to one live session", () => {
  let fixture: AuthFixture;
  beforeAll(async () => {
    fixture = await startAuthFixture();
  });
  beforeEach(async () => {
    await fixture.reset();
  });
  afterAll(async () => {
    await fixture?.close();
  });

  const endpointHash = hash("https://fcm.googleapis.com/fcm/send/proof");
  const bind = (binding: { userId: string; sessionId: string }) =>
    fixture.db.transaction((tx) =>
      pushBindings.bindPushEndpoint(
        tx,
        { endpointHash, ...binding },
        fixture.now(),
      ),
    );
  const live = () =>
    fixture.db.transaction((tx) =>
      pushBindings.readLivePushBinding(tx, endpointHash),
    );
  const released = async () =>
    (
      await fixture.db.transaction((tx) =>
        tx
          .select({ releasedAt: pushEndpointBindings.releasedAt })
          .from(pushEndpointBindings)
          .where(eq(pushEndpointBindings.endpointHash, endpointHash)),
      )
    )[0]?.releasedAt;
  async function signedIn(ip: string) {
    const login = await fixture.login({ ip });
    const [session] = await fixture.sessionRows(login.user.id);
    return {
      ...login,
      binding: { userId: login.user.id, sessionId: session.id },
    };
  }

  it("binds a free endpoint and binds it again for the same session", async () => {
    const one = await signedIn("198.51.100.141");
    expect(await bind(one.binding)).toBe(true);
    expect(await bind(one.binding)).toBe(true);
    expect(await live()).toEqual({
      ...one.binding,
      actingCompanyId: null,
      actingUntil: null,
    });
  });

  it("refuses another live session, even of the same user", async () => {
    const one = await signedIn("198.51.100.142");
    const [user] = [one.user];
    const second = await fixture.loginAs(user, { ip: "198.51.100.143" });
    const sessionIds = (await fixture.sessionRows(user.id)).map((s) => s.id);
    const other = sessionIds.find((id) => id !== one.binding.sessionId);
    if (!other || !second) throw new Error("Expected a second session");
    expect(await bind(one.binding)).toBe(true);
    expect(await bind({ userId: user.id, sessionId: other })).toBe(false);
    const stranger = await signedIn("198.51.100.144");
    expect(await bind(stranger.binding)).toBe(false);
    expect(await live()).toEqual({
      ...one.binding,
      actingCompanyId: null,
      actingUntil: null,
    });
  });

  it("lets only one of two sessions bind at the same time", async () => {
    const one = await signedIn("198.51.100.145");
    const two = await signedIn("198.51.100.146");
    const results = await Promise.all([bind(one.binding), bind(two.binding)]);
    expect(results.filter(Boolean)).toHaveLength(1);
  });

  it("takes over an endpoint held by an expired session", async () => {
    const one = await signedIn("198.51.100.147");
    const two = await signedIn("198.51.100.148");
    expect(await bind(one.binding)).toBe(true);
    await fixture.db.transaction((tx) =>
      tx
        .update(sessions)
        .set({ expiresAt: new Date(fixture.now().getTime() - 1000) })
        .where(eq(sessions.id, one.binding.sessionId)),
    );
    expect(await live()).toBeUndefined();
    expect(await bind(two.binding)).toBe(true);
    expect(await live()).toEqual({
      ...two.binding,
      actingCompanyId: null,
      actingUntil: null,
    });
  });

  it("releases the binding on logout", async () => {
    const one = await signedIn("198.51.100.149");
    const two = await signedIn("198.51.100.150");
    await bind(one.binding);
    expect(
      (await fixture.post("logout", {}, { cookie: one.cookie })).statusCode,
    ).toBe(200);
    expect(await released()).not.toBeNull();
    expect(await live()).toBeUndefined();
    expect(await bind(two.binding)).toBe(true);
  });

  it("releases the binding when the session is revoked from another device", async () => {
    const one = await signedIn("198.51.100.151");
    const second = await fixture.loginAs(one.user, { ip: "198.51.100.152" });
    await bind(one.binding);
    expect(
      (
        await fixture.post(
          "revokeSession",
          { sessionId: one.binding.sessionId },
          { cookie: second.cookie },
        )
      ).statusCode,
    ).toBe(200);
    expect(await released()).not.toBeNull();
    expect(await live()).toBeUndefined();
  });

  it("releases every binding when all sessions are revoked", async () => {
    const one = await signedIn("198.51.100.153");
    await bind(one.binding);
    await fixture.db.transaction((tx) =>
      fixture.apps[0].sessions.revokeAllSessions(tx, one.user.id),
    );
    expect(await released()).not.toBeNull();
    expect(await live()).toBeUndefined();
  });

  it("does not release another session's binding", async () => {
    const one = await signedIn("198.51.100.154");
    const two = await signedIn("198.51.100.155");
    await bind(one.binding);
    await fixture.post("logout", {}, { cookie: two.cookie });
    expect(await released()).toBeNull();
    expect(await live()).toEqual({
      ...one.binding,
      actingCompanyId: null,
      actingUntil: null,
    });
  });
});
