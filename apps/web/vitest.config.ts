import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: {
    alias: {
      "@": fileURLToPath(new URL(".", import.meta.url)),
      "server-only": fileURLToPath(
        new URL("./node_modules/server-only/empty.js", import.meta.url),
      ),
    },
  },
  test: {
    env: {
      ANAR_DATA_MODE: "demo",
      ANAR_ENV: "test",
      ANAR_AUTH_ENABLED: "false",
    },
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, ".cache/**", ".next/**", "e2e/**"],
  },
});
