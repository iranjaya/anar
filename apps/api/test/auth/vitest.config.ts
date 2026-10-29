import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/auth/bootstrap.integration.spec.ts"],
    hookTimeout: 60000,
    testTimeout: 10000,
  },
});
