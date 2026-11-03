import path from "node:path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  output: "standalone",
  outputFileTracingRoot: path.resolve(import.meta.dirname, "../.."),
  distDir: process.env.E2E_PORT
    ? `.cache/e2e-${process.env.E2E_PORT}`
    : ".next",
  async headers() {
    return [
      {
        source: "/sw.js",
        headers: [
          { key: "Cache-Control", value: "no-cache" },
          {
            key: "Content-Type",
            value: "application/javascript; charset=utf-8",
          },
          {
            key: "Content-Security-Policy",
            value: "default-src 'self'; script-src 'self'; connect-src 'self'",
          },
        ],
      },
    ];
  },
  typescript: {
    tsconfigPath: process.env.E2E_PORT
      ? `.cache/e2e-${process.env.E2E_PORT}.tsconfig.json`
      : "tsconfig.json",
  },
};

export default nextConfig;
