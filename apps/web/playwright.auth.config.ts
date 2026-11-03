import { randomUUID } from "node:crypto";
import { defineConfig } from "@playwright/test";

// Parallel runs must not share an output folder: one run's cleanup deletes the
// other's traces. Workers inherit this from the main process, so all see one ID.
process.env.ANAR_E2E_RUN ??= randomUUID();

export default defineConfig({
  testDir: "./e2e-auth",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60000,
  outputDir: `test-results/auth/${process.env.ANAR_E2E_RUN}`,
  use: {
    browserName: "chromium",
    trace: "off",
    screenshot: "off",
    video: "off",
  },
  projects: [
    {
      name: "phone",
      use: {
        viewport: { width: 390, height: 844 },
        isMobile: true,
        hasTouch: true,
      },
    },
    { name: "desktop", use: { viewport: { width: 1440, height: 900 } } },
  ],
});
