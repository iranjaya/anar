import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.integration.spec.ts"],
    hookTimeout: 60000,
    testTimeout: 45000,
    fileParallelism: false,
  },
});
