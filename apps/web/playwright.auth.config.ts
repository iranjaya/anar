import { defineConfig } from "@playwright/test";

export default defineConfig({
  testDir: "./e2e-auth",
  testMatch: "**/*.spec.ts",
  workers: 1,
  fullyParallel: false,
  forbidOnly: true,
  retries: 0,
  timeout: 60000,
  outputDir: "test-results/auth",
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
