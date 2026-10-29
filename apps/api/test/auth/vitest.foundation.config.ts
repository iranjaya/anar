import { defineConfig } from "vitest/config";

export default defineConfig({
  test: {
    environment: "node",
    include: [
      "test/auth/requestOtp.integration.spec.ts",
      "test/auth/verifyOtp.integration.spec.ts",
      "test/auth/otpEmail.integration.spec.ts",
      "test/auth/refresh.integration.spec.ts",
      "test/auth/sessions.integration.spec.ts",
      "test/auth/stepUp.integration.spec.ts",
    ],
    hookTimeout: 60000,
    testTimeout: 30000,
    fileParallelism: false,
  },
});
