import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // The worker script and manifests are always re-fetched, so an update never waits on a stale copy.
  async headers() {
    const noStore = [{ key: "Cache-Control", value: "no-cache, max-age=0, must-revalidate" }];
    return [
      { source: "/sw.js", headers: noStore },
      { source: "/admin-app.webmanifest", headers: noStore },
    ];
  },
  // The share-card route reads these TTFs at runtime: satori cannot take buffers from
  // next/font, so the files must be traced into the deployment explicitly.
  outputFileTracingIncludes: {
    "/api/share/[slug]": ["./src/app/fonts/**"],
  },
};

export default nextConfig;
