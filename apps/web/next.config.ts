import type { NextConfig } from "next";

// Dev-only proxy: the API (apps/api) enables no CORS, so a browser on the web
// origin cannot call it cross-origin. In dev we serve the API under the web
// origin via a rewrite — the browser stays same-origin and Next forwards to
// the API. Production should front both behind one origin or enable CORS.
const apiProxyTarget =
  process.env.API_PROXY_TARGET ?? "http://localhost:3000";

const nextConfig: NextConfig = {
  async rewrites() {
    return [
      {
        source: "/api/:path*",
        destination: `${apiProxyTarget}/api/:path*`,
      },
    ];
  },
};

export default nextConfig;
