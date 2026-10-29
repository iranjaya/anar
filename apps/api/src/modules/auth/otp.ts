import {
  createHmac,
  createSecretKey,
  type KeyObject,
  randomInt,
  timingSafeEqual,
} from "node:crypto";
import { createPlatformDb, type PlatformDb } from "@anar/db/platform";
import {
  type RequestOtpInput,
  requestOtpSchema,
  type VerifyOtpInput,
  verifyOtpSchema,
} from "@anar/domain/auth";
import { AppError } from "@anar/domain/errors";
import { v7 } from "uuid";
import type { createMailCodec } from "../../lib/email/crypto.js";
import { enqueue } from "../../lib/jobs/index.js";
import type { CookieTransport } from "./cookies.js";
import rateLimits from "./rateLimits.js";
import repository from "./repository.js";
import sessions, {
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
          const at = deps.now();
          const id = v7();
          const code = randomInt(1_000_000).toString().padStart(6, "0");
          const codeHash = otp._hash(pepper, id, code);
          const expiresAt = new Date(at.getTime() + 10 * 60 * 1000);
          await repository.replaceOtp(
            tx,
            { id, userId: user.id, codeHash, expiresAt, ip: requestMeta.ip },
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
                {
                  to: user.email,
                  subject: "Your Anar sign-in code",
                  text: `Your Anar sign-in code is ${code}. It expires in 10 minutes.`,
                },
                key,
              ),
            },
            key,
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
          const challenge = await repository.lockOtp(tx, user.id);
          const at = deps.now();
          if (
            challenge?.purpose !== "login" ||
            challenge.attempts >= 5 ||
            at.getTime() >= challenge.expiresAt.getTime()
          )
            return null;
          const valid = timingSafeEqual(
            Buffer.from(
              otp._hash(pepper, challenge.id, parsed.data.code),
              "hex",
            ),
            Buffer.from(challenge.codeHash, "hex"),
          );
          const attempts = challenge.attempts + (valid ? 0 : 1);
          await repository.saveOtpAttempt(tx, challenge.id, {
            attempts,
            consumedAt: valid || attempts === 5 ? at : null,
          });
          if (!valid) return null;
          return deps.sessions.issue(tx, user, requestMeta, at);
        });
        if (!result)
          throw new AppError("unauthorized", "Invalid or expired sign-in code");
        return result;
      },
    };
  },

  async start(options: Omit<OtpDeps, "db"> & { connectionString: string }) {
    const db = await createPlatformDb(options.connectionString);
    try {
      return { service: otp.create({ ...options, db }), close: db.close };
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

  _hash(pepper: KeyObject, id: string, code: string): string {
    return createHmac("sha256", pepper)
      .update(JSON.stringify(["otp", id, "login", code]))
      .digest("hex");
  },
};

export default otp;
