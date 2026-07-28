import type { NextConfig } from "next";

const config: NextConfig = {
  output: "standalone",
  serverExternalPackages: ["postgres"],
  experimental: {
    serverActions: {
      // Must stay >= MAX_EVIDENCE_SIZE_BYTES (src/lib/evidence/core.ts) plus
      // headroom for multipart overhead, since evidence uploads go through
      // a server action and Next.js enforces this before app code runs.
      bodySizeLimit: "30mb",
    },
  },
};

export default config;
