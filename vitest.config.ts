import { fileURLToPath } from "node:url";
import { configDefaults, defineConfig } from "vitest/config";

export default defineConfig({
  resolve: { alias: { "@": fileURLToPath(new URL(".", import.meta.url)) } },
  test: {
    environment: "node",
    include: ["**/*.test.{ts,tsx}"],
    exclude: [...configDefaults.exclude, ".cache/**", ".next/**", "e2e/**"],
  },
});
