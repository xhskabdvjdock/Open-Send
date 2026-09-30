/** @type {import('next').NextConfig} */
const nextConfig = {
  reactStrictMode: true,
  poweredByHeader: false,
  // Serve user files only through authenticated API routes, never statically.
  // Bind to LAN is done via `npm run start -- -H 0.0.0.0` / start-lan scripts.
  experimental: {
    serverActions: { bodySizeLimit: '128mb' },
  },
};

module.exports = nextConfig;
