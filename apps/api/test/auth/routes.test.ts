import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { originGuard } from "../../src/lib/http.js";

function sessionFixture() {
  return {
    requireSession: vi.fn(async () => {
      throw new Error("Unexpected session lookup");
    }),
    listSessions: vi.fn(async () => []),
    revokeSession: vi.fn(async () => undefined),
    logout: vi.fn(async () => undefined),
    clearCookie: vi.fn(() => "expired-cookie"),
  };
}

function stepUpFixture() {
  return {
    requestStepUp: vi.fn(async () => ({ ok: true as const })),
    stepUp: vi.fn(async () => ({ ok: true as const })),
  };
}

function agencyFixture() {
  return {
    requireOwner: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected owner lookup");
    }),
    createAgency: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected agency creation");
    }),
    listAgencies: vi.fn(async () => ({ items: [], nextCursor: null })),
  };
}

function inviteFixture() {
  return {
    admit: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
    inspectInvite: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected invite inspection");
    }),
    acceptInvite: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected invite acceptance");
    }),
  };
}

describe("auth HTTP guards", () => {
  const apps: ReturnType<typeof buildApp>[] = [];
  afterEach(async () => {
    await Promise.all(apps.splice(0).map((app) => app.close()));
  });

  it.each([
    undefined,
    "null",
    "https://hostile.example",
    "https://anar.example.test.evil.test",
  ])("rejects Origin %s before calling auth", async (origin) => {
    const requestOtp = vi.fn(async () => ({ ok: true as const }));
    const verifyOtp = vi.fn(async () => ({
      cookie: "secret-cookie",
      redirectTo: "/workspaces" as const,
    }));
    const refreshSession = vi.fn(async () => ({
      cookie: "secret-cookie",
      redirectTo: "/workspaces" as const,
    }));
    const app = buildApp({
      otp: { requestOtp },
      verifier: { verifyOtp },
      sessions: { ...sessionFixture(), refreshSession },
      stepUp: stepUpFixture(),
      agencies: agencyFixture(),
      invites: inviteFixture(),
      requireOrigin: originGuard("https://anar.example.test"),
      trustProxy: false,
    });
    apps.push(app);
    for (const path of ["requestOtp", "verifyOtp", "refresh"]) {
      const response = await app.inject({
        method: "POST",
        url: `/api/auth/${path}`,
        payload: {},
        headers: origin === undefined ? {} : { origin },
      });
      expect(response.statusCode).toBe(403);
      expect(response.json()).toMatchObject({ ok: false, error: "forbidden" });
      expect(response.headers["set-cookie"]).toBeUndefined();
    }
    expect(requestOtp).not.toHaveBeenCalled();
    expect(verifyOtp).not.toHaveBeenCalled();
    expect(refreshSession).not.toHaveBeenCalled();
  });

  it("returns a safe failure when an auth dependency fails", async () => {
    const app = buildApp({
      otp: {
        async requestOtp() {
          throw new Error("sensitive@example.test 123456");
        },
      },
      verifier: {
        async verifyOtp() {
          throw new Error("Unexpected verification");
        },
      },
      sessions: {
        ...sessionFixture(),
        async refreshSession() {
          throw new Error("Unexpected refresh");
        },
      },
      stepUp: stepUpFixture(),
      agencies: agencyFixture(),
      invites: inviteFixture(),
      requireOrigin: originGuard("https://anar.example.test"),
      trustProxy: false,
    });
    apps.push(app);
    const response = await app.inject({
      method: "POST",
      url: "/api/auth/requestOtp",
      payload: { email: "sensitive@example.test" },
      headers: { origin: "https://anar.example.test" },
    });
    expect(response.statusCode).toBe(500);
    expect(response.json()).toMatchObject({ ok: false, error: "unavailable" });
    expect(response.body).not.toContain("sensitive@example.test");
    expect(response.body).not.toContain("123456");
    expect(response.headers["cache-control"]).toBe("private, no-store");
  });
});
