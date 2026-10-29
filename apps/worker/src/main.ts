export async function startWorker(signal: AbortSignal): Promise<void> {
  if (signal.aborted) return;

  await new Promise<void>((resolve) => {
    const keepalive = setInterval(() => {}, 2_147_483_647);
    signal.addEventListener(
      "abort",
      () => {
        clearInterval(keepalive);
        resolve();
      },
      { once: true },
    );
  });
}

if (import.meta.main) {
  const controller = new AbortController();
  const stop = () => controller.abort();
  process.once("SIGINT", stop);
  process.once("SIGTERM", stop);
  try {
    await startWorker(controller.signal);
  } finally {
    process.off("SIGINT", stop);
    process.off("SIGTERM", stop);
  }
}
