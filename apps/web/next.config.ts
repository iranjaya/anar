import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  distDir: process.env.E2E_PORT
    ? `.cache/e2e-${process.env.E2E_PORT}`
    : ".next",
  typescript: {
    tsconfigPath: process.env.E2E_PORT
      ? `.cache/e2e-${process.env.E2E_PORT}.tsconfig.json`
      : "tsconfig.json",
  },
};

export default nextConfig;
