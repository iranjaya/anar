export function dataMode(
  env: Record<string, string | undefined> = process.env,
): "real" | "demo" {
  const mode = env.ANAR_DATA_MODE || "real";
  if (mode !== "real" && mode !== "demo")
    throw new Error("ANAR_DATA_MODE must be real or demo");
  if (mode === "demo" && env.ANAR_ENV !== "local" && env.ANAR_ENV !== "test")
    throw new Error("Demo mode requires the explicit local or test profile");
  if (
    env.ANAR_AUTH_ENABLED &&
    !["true", "false"].includes(env.ANAR_AUTH_ENABLED)
  )
    throw new Error("ANAR_AUTH_ENABLED must be true or false");
  return mode;
}

export function authEnabled() {
  return dataMode() === "real" && process.env.ANAR_AUTH_ENABLED !== "false";
}

export function requireDemoMode() {
  if (dataMode() !== "demo") throw new Error("Demo access is disabled");
}
