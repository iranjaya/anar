import { createHash, randomBytes } from "node:crypto";
import type {
  PlatformDb,
  PlatformTx,
  sessions as sessionTable,
} from "@anar/db/platform";
import type { AuthUser, SessionList } from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import type { FastifyRequest } from "fastify";
import { v7 } from "uuid";
import cookies, { type CookieTransport } from "./cookies.js";
import repository from "./repository.js";

export type SessionState = {
  id: string;
  userId: string;
  lastSeenAt: Date;
  expiresAt: Date;
  revokedAt: Date | null;
  lastOtpAt: Date;
  actingCompanyId: string | null;
  actingReason: string | null;
  actingUntil: Date | null;
  actingActive: boolean;
};
export type RequestMeta = { ip: string; userAgent?: string };
export type AuthSession = { user: AuthUser; session: SessionState };
export type SessionIssue = { cookie: string; redirectTo: "/workspaces" };
export type SessionDeps = {
  db: PlatformDb;
  cookieTransport: CookieTransport;
  now(): Date;
};
export type SessionService = {
  issue(
    tx: PlatformTx,
    user: AuthUser,
    requestMeta: RequestMeta,
    at: Date,
  ): Promise<SessionIssue>;
  requireSession(
    request: Pick<FastifyRequest, "headers">,
  ): Promise<AuthSession>;
  refreshSession(
    request: Pick<FastifyRequest, "headers">,
  ): Promise<SessionIssue>;
  listSessions(actor: AuthSession): Promise<SessionList>;
  revokeSession(actor: AuthSession, sessionId: string): Promise<void>;
  revokeAllSessions(tx: PlatformTx, userId: string): Promise<void>;
  logout(request: Pick<FastifyRequest, "headers">): Promise<void>;
  clearCookie(): string;
  lockSessionActor(
    tx: PlatformTx,
    actor: AuthSession,
    affectedUserIds?: string[],
  ): Promise<AuthSession>;
  withPlatformSession<T>(
    actor: AuthSession,
    fn: (tx: PlatformTx, current: AuthSession) => Promise<T>,
  ): Promise<T>;
};

const sessions = {
  create(deps: SessionDeps): SessionService {
    const cookie = cookies.create(deps.cookieTransport);
    const service: SessionService = {
      async issue(tx, user, requestMeta, at) {
        const token = randomBytes(32).toString("base64url");
        const expiresAt = sessions._expiresAt(at);
        const userAgent = requestMeta.userAgent ?? "";
        await repository.insertSession(tx, {
          id: v7(),
          userId: user.id,
          tokenHash: createHash("sha256").update(token).digest("hex"),
          deviceLabel: userAgent.trim().slice(0, 120) || "Unknown device",
          userAgent,
          ip: requestMeta.ip,
          lastSeenAt: at,
          expiresAt,
          lastOtpAt: at,
        });
        return {
          cookie: cookie.issue(token, expiresAt),
          redirectTo: "/workspaces",
        };
      },

      async requireSession(request) {
        const token = cookie.read(request);
        if (!token) throw new AppError("unauthorized", "Sign in is required");
        const tokenHash = createHash("sha256").update(token).digest("hex");
        const row = await deps.db.transaction((tx) =>
          repository.readSession(tx, tokenHash),
        );
        return sessions._current(row?.user, row?.session, deps.now());
      },

      async refreshSession(request) {
        const token = cookie.read(request);
        if (!token) throw new AppError("unauthorized", "Sign in is required");
        const actor = await service.requireSession(request);
        return service.withPlatformSession(actor, async (tx, current) => {
          const at = deps.now();
          let expiresAt = current.session.expiresAt;
          if (at.getTime() >= expiresAt.getTime()) {
            throw new AppError("unauthorized", "Sign in is required");
          }
          if (
            at.getTime() - current.session.lastSeenAt.getTime() >=
            60 * 60 * 1000
          ) {
            expiresAt = sessions._expiresAt(at);
            await repository.refreshSession(
              tx,
              current.session.id,
              at,
              expiresAt,
            );
          }
          return {
            cookie: cookie.issue(token, expiresAt),
            redirectTo: "/workspaces",
          };
        });
      },

      async listSessions(actor) {
        return service.withPlatformSession(actor, async (tx, current) => {
          const rows = await repository.listSessions(
            tx,
            current.user.id,
            deps.now(),
          );
          return rows.map((row) => ({
            ...row,
            lastSeenAt: row.lastSeenAt.toISOString(),
            current: row.id === current.session.id,
          }));
        });
      },

      async revokeSession(actor, sessionId) {
        await service.withPlatformSession(actor, async (tx, current) => {
          const target = await repository.lockSession(
            tx,
            current.user.id,
            sessionId,
          );
          if (!target) throw new AppError("not_found", "Session not found");
          await repository.revokeSession(
            tx,
            current.user.id,
            target.id,
            deps.now(),
          );
        });
      },

      revokeAllSessions(tx, userId) {
        return sessions.revokeAll(tx, userId, deps.now());
      },

      async logout(request) {
        const token = cookie.read(request);
        if (!token) return;
        const tokenHash = createHash("sha256").update(token).digest("hex");
        await deps.db.transaction(async (tx) => {
          const row = await repository.readSession(tx, tokenHash);
          if (!row) return;
          await repository.lockUser(tx, row.user.id);
          const session = await repository.lockSession(
            tx,
            row.user.id,
            row.session.id,
          );
          if (session) {
            await repository.revokeSession(
              tx,
              row.user.id,
              session.id,
              deps.now(),
            );
          }
        });
      },

      clearCookie: cookie.clear,

      async lockSessionActor(tx, actor, affectedUserIds = []) {
        const users = await repository.lockUsers(tx, [
          ...new Set([actor.user.id, ...affectedUserIds]),
        ]);
        const user = users.find((row) => row.id === actor.user.id);
        const rows = await repository.lockActorSessions(
          tx,
          { userId: actor.user.id, id: actor.session.id },
          affectedUserIds,
        );
        const session = rows.find((row) => row.id === actor.session.id);
        return sessions._current(user, session, deps.now());
      },

      async withPlatformSession(actor, fn) {
        return deps.db.transaction(async (tx) => {
          const current = await service.lockSessionActor(tx, actor);
          return fn(tx, current);
        });
      },
    };
    return service;
  },

  async revokeAll(tx: PlatformTx, userId: string, at: Date): Promise<void> {
    await repository.lockUser(tx, userId);
    await repository.revokeAllSessions(tx, userId, at);
  },

  setActing(
    tx: PlatformTx,
    session: { id: string; userId: string },
    acting: { companyId: string; reason: string; until: Date } | null,
  ): Promise<void> {
    return repository.setActing(tx, session.userId, session.id, acting);
  },

  _expiresAt(at: Date): Date {
    return new Date(
      Math.floor(at.getTime() / 1000) * 1000 + 30 * 24 * 60 * 60 * 1000,
    );
  },

  _current(
    user: AuthUser | undefined,
    session: typeof sessionTable.$inferSelect | undefined,
    at: Date,
  ): AuthSession {
    if (
      !user ||
      !session ||
      user.deactivatedAt !== null ||
      session.revokedAt !== null ||
      at.getTime() >= session.expiresAt.getTime()
    ) {
      throw new AppError("unauthorized", "Sign in is required");
    }
    return {
      user,
      session: {
        id: session.id,
        userId: session.userId,
        lastSeenAt: session.lastSeenAt,
        expiresAt: session.expiresAt,
        revokedAt: session.revokedAt,
        lastOtpAt: session.lastOtpAt,
        actingCompanyId: session.actingCompanyId,
        actingReason: session.actingReason,
        actingUntil: session.actingUntil,
        actingActive:
          session.actingUntil !== null &&
          at.getTime() < session.actingUntil.getTime(),
      },
    };
  },
};

export default sessions;
