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
      "test/agencies/onboarding.integration.spec.ts",
      "test/agencies/acceptance.integration.spec.ts",
      "test/agencies/resend.integration.spec.ts",
      "test/agencies/staffLists.integration.spec.ts",
      "test/companies/companies.integration.spec.ts",
      "test/auth/invite.integration.spec.ts",
      "test/companies/members.integration.spec.ts",
    ],
    hookTimeout: 60000,
    testTimeout: 30000,
    fileParallelism: false,
  },
});
