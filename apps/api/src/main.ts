import type { FastifyInstance } from "fastify";
import { buildApp } from "./app.js";
import { loadApiConfig } from "./lib/config.js";
import { createMailCodec } from "./lib/email/crypto.js";
import stepUpCode from "./lib/email/templates/stepUpCode.js";
import { originGuard } from "./lib/http.js";
import otp from "./modules/auth/otp.js";

export async function startApi(): Promise<void> {
  const host = process.env.HOST ?? "0.0.0.0";
  const portValue = process.env.PORT ?? "3001";
  const port = Number(portValue);
  if (
    !/^\d+$/.test(portValue) ||
    !Number.isInteger(port) ||
    port < 1 ||
    port > 65535
  ) {
    throw new Error("PORT must be an integer from 1 to 65535");
  }

  const config = loadApiConfig();
  const runtime = await otp.start({
    connectionString: config.connectionString,
    otpPepper: config.otpPepper,
    mailCodec: createMailCodec(config.mailKey),
    now: () => new Date(),
  });
  let app: FastifyInstance | undefined;
  let verifier: Awaited<ReturnType<typeof otp.startVerifier>> | undefined;
  try {
    verifier = await otp.startVerifier({
      connectionString: config.connectionString,
      otpPepper: config.otpPepper,
      cookieTransport: config.cookieTransport,
      now: () => new Date(),
    });
    const verification = verifier;
    app = buildApp({
      otp: runtime.service,
      verifier: verification.service,
      sessions: verification.sessions,
      stepUp: runtime.createStepUp({
        sessions: verification.sessions,
        renderCode: stepUpCode.render,
      }),
      requireOrigin: originGuard(config.publicOrigin),
      trustProxy: config.trustProxy,
      logging: true,
    });
    const server = app;
    const stop = () => {
      void server.close().catch(() => {
        console.error("API shutdown failed");
        process.exitCode = 1;
      });
    };
    app.addHook("onClose", async () => {
      process.off("SIGINT", stop);
      process.off("SIGTERM", stop);
      await Promise.all([runtime.close(), verification.close()]);
    });
    process.once("SIGINT", stop);
    process.once("SIGTERM", stop);
    await app.listen({ host, port });
  } catch (error) {
    if (app) await app.close();
    else await Promise.all([runtime.close(), verifier?.close()]);
    throw error;
  }
}

if (import.meta.main) {
  await startApi().catch(() => {
    console.error("API startup failed");
    process.exitCode = 1;
  });
}
