/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Serve user files only through authenticated API routes, never statically.
  // Bind to LAN is done via `npm run start -- -H 0.0.0.0` / start-lan scripts.
  // Local-network identity (btec-send.local -> 192.168.1.118) is centralized in
  // lib/network.ts + scripts/mdns.mjs + scripts/network-check.mjs.
  // No CORS changes were needed: same-origin relative fetch (/api/...) works on
  // any local hostname, and auth cookies are host-agnostic (no Domain attribute).
  experimental: {
    serverActions: { bodySizeLimit: '128mb' },
  },
};

module.exports = nextConfig;
