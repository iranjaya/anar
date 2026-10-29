import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: ["test/**/*.integration.test.ts"],
    hookTimeout: 60000,
    testTimeout: 45000,
    fileParallelism: false,
  },
});
