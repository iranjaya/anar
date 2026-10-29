import {
  createHmac,
  createSecretKey,
  type KeyObject,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import {
  createPlatformDb,
  type PlatformDb,
  type PlatformTx,
} from "@anar/db/platform";
import {
  type AuthUser,
  type RequestOtpInput,
  requestOtpSchema,
  type StepUpInput,
  stepUpSchema,
  type VerifyOtpInput,
  verifyOtpSchema,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { v7 } from "uuid";
import type { createMailCodec } from "../../lib/email/crypto.js";
import type { RenderedEmail } from "../../lib/email/templates/layout.js";
import signInCode from "../../lib/email/templates/signInCode.js";
import { enqueue } from "../../lib/jobs/index.js";
import type { CookieTransport } from "./cookies.js";
import rateLimits from "./rateLimits.js";
import repository from "./repository.js";
import sessions, {
  type AuthSession,
  type RequestMeta,
  type SessionIssue,
  type SessionService,
} from "./sessions.js";

export type { RequestMeta } from "./sessions.js";
export type VerifierService = {
  verifyOtp(
    input: VerifyOtpInput,
    requestMeta: RequestMeta,
  ): Promise<SessionIssue>;
};
export type VerifierDeps = {
  db: PlatformDb;
  otpPepper: string;
  sessions: Pick<SessionService, "issue">;
  now(): Date;
};
export type OtpService = {
  requestOtp(
    input: RequestOtpInput,
    requestMeta: RequestMeta,
  ): Promise<{ ok: true }>;
};
export type OtpDeps = {
  db: PlatformDb;
  otpPepper: string;
  mailCodec: Pick<ReturnType<typeof createMailCodec>, "encryptMessage">;
  now(): Date;
};
export type StepUpService = {
  requestStepUp(
    actor: AuthSession,
    requestMeta: RequestMeta,
  ): Promise<{ ok: true }>;
  stepUp(actor: AuthSession, input: StepUpInput): Promise<{ ok: true }>;
};
export type StepUpDeps = OtpDeps & {
  sessions: Pick<SessionService, "lockSessionActor" | "withPlatformSession">;
  renderCode(input: { code: string }): RenderedEmail;
};
type OtpBinding =
  | { purpose: "login"; sessionId: null }
  | { purpose: "step_up"; sessionId: string };

const otp = {
  create(deps: OtpDeps): OtpService {
    const pepper = otp._pepper(deps.otpPepper);
    return {
      async requestOtp(input, requestMeta) {
        const parsed = requestOtpSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "A valid email is required");
        return deps.db.transaction(async (tx) => {
          if (
            !(await rateLimits.requestOtp(
              tx,
              { email: parsed.data.email, ip: requestMeta.ip },
              pepper,
              deps.now,
            ))
          )
            return { ok: true };
          const user = await repository.findOtpUser(tx, parsed.data.email);
          if (!user) return { ok: true };
          await otp._issue(
            tx,
            deps,
            pepper,
            {
              user,
              ip: requestMeta.ip,
              purpose: "login",
              sessionId: null,
            },
            signInCode.render,
          );
          return { ok: true };
        });
      },
    };
  },

  createVerifier(deps: VerifierDeps): VerifierService {
    const pepper = otp._pepper(deps.otpPepper);
    return {
      async verifyOtp(input, requestMeta) {
        const parsed = verifyOtpSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError(
            "validation",
            "A valid email and six-digit code are required",
          );
        const result = await deps.db.transaction(async (tx) => {
          const user = await repository.findOtpUser(tx, parsed.data.email);
          if (!user) return null;
          const at = await otp._consume(
            tx,
            pepper,
            {
              userId: user.id,
              code: parsed.data.code,
              purpose: "login",
              sessionId: null,
            },
            deps.now,
          );
          if (!at) return null;
          return deps.sessions.issue(tx, user, requestMeta, at);
        });
        if (!result)
          throw new AppError("unauthorized", "Invalid or expired sign-in code");
        return result;
      },
    };
  },

  createStepUp(deps: StepUpDeps): StepUpService {
    const pepper = otp._pepper(deps.otpPepper);
    return {
      async requestStepUp(actor, requestMeta) {
        return deps.db.transaction(async (tx) => {
          const allowed = await rateLimits.requestOtp(
            tx,
            { email: actor.user.email, ip: requestMeta.ip },
            pepper,
            deps.now,
          );
          const current = await deps.sessions.lockSessionActor(tx, actor);
          if (allowed) {
            await otp._issue(
              tx,
              deps,
              pepper,
              {
                user: current.user,
                ip: requestMeta.ip,
                purpose: "step_up",
                sessionId: current.session.id,
              },
              deps.renderCode,
            );
          }
          return { ok: true };
        });
      },

      async stepUp(actor, input) {
        const parsed = stepUpSchema.safeParse(input);
        if (!parsed.success)
          throw new AppError("validation", "A six-digit code is required");
        const valid = await deps.sessions.withPlatformSession(
          actor,
          async (tx, current) => {
            const at = await otp._consume(
              tx,
              pepper,
              {
                userId: current.user.id,
                code: parsed.data.code,
                purpose: "step_up",
                sessionId: current.session.id,
              },
              deps.now,
            );
            if (!at) return false;
            if (at.getTime() >= current.session.expiresAt.getTime()) {
              throw new AppError("unauthorized", "Sign in is required");
            }
            await repository.markFreshOtp(
              tx,
              current.user.id,
              current.session.id,
              at,
            );
            return true;
          },
        );
        if (!valid)
          throw new AppError(
            "unauthorized",
            "Invalid or expired verification code",
          );
        return { ok: true };
      },
    };
  },

  async start(options: Omit<OtpDeps, "db"> & { connectionString: string }) {
    const db = await createPlatformDb(options.connectionString);
    try {
      return {
        service: otp.create({ ...options, db }),
        createStepUp(deps: Pick<StepUpDeps, "sessions" | "renderCode">) {
          return otp.createStepUp({ ...options, db, ...deps });
        },
        close: db.close,
      };
    } catch (error) {
      await db.close();
      throw error;
    }
  },

  async startVerifier(options: {
    connectionString: string;
    otpPepper: string;
    cookieTransport: CookieTransport;
    now(): Date;
  }) {
    const db = await createPlatformDb(options.connectionString);
    try {
      const sessionService = sessions.create({ ...options, db });
      return {
        service: otp.createVerifier({
          ...options,
          db,
          sessions: sessionService,
        }),
        sessions: sessionService,
        close: db.close,
      };
    } catch (error) {
      await db.close();
      throw error;
    }
  },

  _pepper(encoded: string): KeyObject {
    const bytes = Buffer.from(encoded, "base64");
    if (bytes.length !== 32)
      throw new Error("OTP pepper must contain 32 bytes");
    return createSecretKey(bytes);
  },

  async _issue(
    tx: PlatformTx,
    deps: OtpDeps,
    pepper: KeyObject,
    input: OtpBinding & { user: AuthUser; ip: string },
    renderCode: StepUpDeps["renderCode"],
  ): Promise<void> {
    const at = deps.now();
    const id = v7();
    const code = randomInt(1_000_000).toString().padStart(6, "0");
    const codeHash = otp._hash(pepper, id, input.purpose, code);
    const expiresAt = new Date(at.getTime() + 10 * 60 * 1000);
    await repository.replaceOtp(
      tx,
      {
        id,
        userId: input.user.id,
        codeHash,
        expiresAt,
        ip: input.ip,
        purpose: input.purpose,
        sessionId: input.sessionId,
      },
      at,
    );
    const key = `otp:${id}`;
    await enqueue(
      tx,
      "notify.email",
      {
        kind: "otp",
        referenceId: id,
        expiresAt: expiresAt.toISOString(),
        encryptedMessage: deps.mailCodec.encryptMessage(
          { to: input.user.email, ...renderCode({ code }) },
          key,
        ),
      },
      key,
    );
  },

  async _consume(
    tx: PlatformTx,
    pepper: KeyObject,
    input: OtpBinding & { userId: string; code: string },
    now: () => Date,
  ): Promise<Date | null> {
    const challenge = await repository.lockOtp(tx, input.userId);
    const at = now();
    if (
      !challenge ||
      challenge.purpose !== input.purpose ||
      challenge.sessionId !== input.sessionId ||
      challenge.attempts >= 5 ||
      at.getTime() >= challenge.expiresAt.getTime()
    )
      return null;
    const valid = timingSafeEqual(
      Buffer.from(
        otp._hash(pepper, challenge.id, challenge.purpose, input.code),
        "hex",
      ),
      Buffer.from(challenge.codeHash, "hex"),
    );
    const attempts = challenge.attempts + (valid ? 0 : 1);
    await repository.saveOtpAttempt(tx, challenge.id, {
      attempts,
      consumedAt: valid || attempts === 5 ? at : null,
    });
    return valid ? at : null;
  },

  _hash(
    pepper: KeyObject,
    id: string,
    purpose: OtpBinding["purpose"],
    code: string,
  ): string {
    return createHmac("sha256", pepper)
      .update(JSON.stringify(["otp", id, purpose, code]))
      .digest("hex");
  },
};

export default otp;
