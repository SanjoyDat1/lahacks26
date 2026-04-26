import path from "path";
import type { NextConfig } from "next";

import { applyMonorepoDotEnvFromFrontendPackage } from "./src/lib/load-env-dot-only";

const nextConfig: NextConfig = {
  turbopack: {
    // node_modules lives at the repo root (one level up from frontend/)
    root: path.resolve(__dirname, ".."),
  },
};

// Only `{repo}/.env` and `frontend/.env` — not `.env.local` (see `load-env-dot-only.ts`).
// Run after the config object so merges win over Next’s earlier `.env.local` for keys present in `.env`.
applyMonorepoDotEnvFromFrontendPackage(__dirname);

export default nextConfig;
