import { afterEach, describe, expect, it, vi } from "vitest";
import { buildApp } from "../../src/app.js";
import { originGuard } from "../../src/lib/http.js";
import type { FollowUpService } from "../../src/modules/followups/index.js";
import type { ImportService } from "../../src/modules/imports/index.js";
import type {
  LeadAssignService,
  LeadDetailService,
  LeadListService,
  LeadStageService,
  LeadSuggestionService,
  LeadUpdateService,
  TodayService,
} from "../../src/modules/leads/index.js";

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

function contextFixture() {
  return {
    context: {
      requireContext: vi.fn(async (): Promise<never> => {
        throw new Error("Unexpected context lookup");
      }),
      view: vi.fn((): never => {
        throw new Error("Unexpected context view");
      }),
    },
    discovery: {
      getSession: vi.fn(async (): Promise<never> => {
        throw new Error("Unexpected session discovery");
      }),
      listWorkspaces: vi.fn(async () => ({ items: [], nextCursor: null })),
    },
  };
}

function stepUpFixture() {
  return {
    requestStepUp: vi.fn(async () => ({ sent: true })),
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
    resendFirstInvite: vi.fn(async () => ({ allowed: true, retryAfter: 0 })),
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

function staffFixture() {
  return {
    requireAgencyContext: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected agency context");
    }),
    getAgency: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected agency lookup");
    }),
    listStaff: vi.fn(async () => ({ items: [], nextCursor: null })),
    listStaffInvites: vi.fn(async () => ({ items: [], nextCursor: null })),
    inviteStaff: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected staff invite");
    }),
    resendStaffInvite: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected staff invite resend");
    }),
    deactivateStaff: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected staff removal");
    }),
  };
}

function notificationFixture() {
  return {
    notify: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected notify");
    }),
    requireContext: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected notification context");
    }),
    listNotifications: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected notification list");
    }),
    markRead: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected mark read");
    }),
    getPushState: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected push state");
    }),
    subscribePush: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected push subscribe");
    }),
    unsubscribePush: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected push unsubscribe");
    }),
  };
}

function importFixture() {
  const unexpected = vi.fn(async (): Promise<never> => {
    throw new Error("Unexpected imports call");
  });
  return new Proxy({} as ImportService, { get: () => unexpected });
}

function settingsFixture() {
  const unexpected = vi.fn(async (): Promise<never> => {
    throw new Error("Unexpected settings call");
  });
  return {
    requireContext: unexpected,
    loadSchema: unexpected,
    getSettings: unexpected,
    write: unexpected,
  };
}

function memberFixture() {
  return {
    requireContext: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected member context");
    }),
    listMembers: vi.fn(async () => []),
    listInvites: vi.fn(async () => []),
    listAgencyEntries: vi.fn(async () => []),
    inviteAdmin: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected Admin invite");
    }),
    resendInvite: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected invite resend");
    }),
    deactivateMember: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected member removal");
    }),
  };
}

function companyFixture() {
  return {
    inviteSuperAdmin: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected company invitation");
    }),
    requireAgencyContext: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected company context");
    }),
    createCompany: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected company creation");
    }),
    listCompanies: vi.fn(async () => ({ items: [], nextCursor: null })),
    enterCompany: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected company entry");
    }),
    leaveCompany: vi.fn(async (): Promise<never> => {
      throw new Error("Unexpected company leave");
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
      ...contextFixture(),
      otp: { requestOtp },
      verifier: { verifyOtp },
      sessions: { ...sessionFixture(), refreshSession },
      stepUp: stepUpFixture(),
      agencies: agencyFixture(),
      staff: staffFixture(),
      companies: companyFixture(),
      members: memberFixture(),
      notifications: notificationFixture(),
      settings: settingsFixture(),
      imports: importFixture(),
      leadAssign: new Proxy({} as LeadAssignService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected lead assign call");
          }),
      }),
      today: new Proxy({} as TodayService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected today call");
          }),
      }),
      followUps: new Proxy({} as FollowUpService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected follow-up call");
          }),
      }),
      leadStage: new Proxy({} as LeadStageService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected lead stage call");
          }),
      }),
      leadSuggestion: new Proxy({} as LeadSuggestionService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected lead suggestion call");
          }),
      }),
      leadUpdate: new Proxy({} as LeadUpdateService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected lead update call");
          }),
      }),
      leadDetail: new Proxy({} as LeadDetailService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected lead detail call");
          }),
      }),
      leads: new Proxy({} as LeadListService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected leads call");
          }),
      }),
      scoring: {
        requireContext: vi.fn(async (): Promise<never> => {
          throw new Error("Unexpected scoring context");
        }),
        getScoringDefaults: vi.fn(async (): Promise<never> => {
          throw new Error("Unexpected scoring read");
        }),
      },
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
      ...contextFixture(),
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
      staff: staffFixture(),
      companies: companyFixture(),
      members: memberFixture(),
      notifications: notificationFixture(),
      settings: settingsFixture(),
      imports: importFixture(),
      leadAssign: new Proxy({} as LeadAssignService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected lead assign call");
          }),
      }),
      today: new Proxy({} as TodayService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected today call");
          }),
      }),
      followUps: new Proxy({} as FollowUpService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected follow-up call");
          }),
      }),
      leadStage: new Proxy({} as LeadStageService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected lead stage call");
          }),
      }),
      leadSuggestion: new Proxy({} as LeadSuggestionService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected lead suggestion call");
          }),
      }),
      leadUpdate: new Proxy({} as LeadUpdateService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected lead update call");
          }),
      }),
      leadDetail: new Proxy({} as LeadDetailService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected lead detail call");
          }),
      }),
      leads: new Proxy({} as LeadListService, {
        get: () =>
          vi.fn(async (): Promise<never> => {
            throw new Error("Unexpected leads call");
          }),
      }),
      scoring: {
        requireContext: vi.fn(async (): Promise<never> => {
          throw new Error("Unexpected scoring context");
        }),
        getScoringDefaults: vi.fn(async (): Promise<never> => {
          throw new Error("Unexpected scoring read");
        }),
      },
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
