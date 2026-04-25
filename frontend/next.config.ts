import path from "path";
import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  turbopack: {
    // node_modules lives at the repo root (one level up from frontend/)
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
