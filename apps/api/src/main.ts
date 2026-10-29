import { buildApp } from "./app.js";

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

  const app = buildApp();
  const stop = () => {
    void app.close().catch((error: unknown) => {
      console.error(error);
      process.exitCode = 1;
    });
  };
  app.addHook("onClose", async () => {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  });
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);

  try {
    await app.listen({ host, port });
  } catch (error) {
    await app.close();
    throw error;
  }
}

if (import.meta.main) {
  await startApi().catch((error: unknown) => {
    console.error(error);
    process.exitCode = 1;
  });
}
