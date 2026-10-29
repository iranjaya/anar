import { mkdirSync, writeFileSync } from "node:fs";
import { defineConfig } from "@playwright/test";

const port = Number(process.env.E2E_PORT ?? 3100);
const baseURL = `http://127.0.0.1:${port}`;
const tsconfigPath = `.cache/e2e-${port}.tsconfig.json`;
const phone = {
  viewport: { width: 390, height: 844 },
  isMobile: true,
  hasTouch: true,
};
const desktop = { viewport: { width: 1440, height: 900 } };

mkdirSync(".cache", { recursive: true });
writeFileSync(
  tsconfigPath,
  JSON.stringify({
    extends: "../tsconfig.json",
    include: ["../next-env.d.ts", "../**/*.ts", "../**/*.tsx"],
    exclude: ["../node_modules", "../.cache"],
  }),
);

export default defineConfig({
  testDir: "./e2e",
  workers: 1,
  use: { baseURL, browserName: "chromium" },
  projects: [
    {
      name: "phone",
      use: phone,
      grepInvert: /@failure/,
    },
    { name: "desktop", use: desktop, grepInvert: /@failure/ },
    {
      name: "phone-failure",
      use: phone,
      grep: /@failure/,
      dependencies: ["phone", "desktop"],
    },
    {
      name: "desktop-failure",
      use: desktop,
      grep: /@failure/,
      dependencies: ["phone-failure"],
    },
  ],
  webServer: {
    command: `pnpm dev --hostname 127.0.0.1 --port ${port}`,
    env: {
      E2E_PORT: String(port),
      ANAR_DATA_MODE: "demo",
      ANAR_ENV: "test",
      ANAR_AUTH_ENABLED: "false",
    },
    url: baseURL,
    reuseExistingServer: false,
  },
});
