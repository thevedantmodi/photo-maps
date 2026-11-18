import type { NextConfig } from "next";

const nextConfig: NextConfig = {
  // Share cards are rendered with these TTFs, read at runtime: satori cannot take buffers
  // from next/font, so the files must be traced into the deployment explicitly. Not just
  // the share route renders them: the admin routes (upload, edit, rotate, rebuild) store
  // fresh cards too. Keys are picomatch globs, where a bare [slug] would be a character
  // class, so the dynamic segments are matched with ** instead.
  outputFileTracingIncludes: {
    "/api/share/**": ["./src/app/fonts/**"],
    "/api/admin/**": ["./src/app/fonts/**"],
  },
};

export default nextConfig;
