import path from "path";
import { fileURLToPath } from "url";

const __dirname = path.dirname(fileURLToPath(import.meta.url));

/** @type {import("next").NextConfig} */
const nextConfig = {
  turbopack: {
    // node_modules lives at the repo root (one level up from frontend/)
    root: path.resolve(__dirname, ".."),
  },
};

export default nextConfig;
