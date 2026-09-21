import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The share-card route reads these TTFs at runtime: satori cannot take buffers from
  // next/font, so the files must be traced into the deployment explicitly.
  outputFileTracingIncludes: {
    "/api/share/[slug]": ["./src/app/fonts/**"],
  },
};

export default nextConfig;
