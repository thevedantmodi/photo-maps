import type { NextConfig } from "next";

// The API, share cards and RSS feed are served by the Rust backend in backend/. The
// browser keeps talking to this origin; these rewrites proxy those paths through.
const backendUrl = process.env.BACKEND_URL?.replace(/\/$/, "");
if (!backendUrl && process.env.VERCEL) {
  throw new Error("BACKEND_URL must be set to the Rust backend's origin");
}
const backend = backendUrl ?? "http://localhost:8080";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      { source: "/api/:path*", destination: `${backend}/api/:path*` },
      { source: "/feed.xml", destination: `${backend}/feed.xml` },
    ];
  },
};

export default nextConfig;
