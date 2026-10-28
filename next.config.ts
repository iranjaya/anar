import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  distDir: process.env.E2E_PORT
    ? `.cache/e2e-${process.env.E2E_PORT}`
    : ".next",
};

export default nextConfig;
