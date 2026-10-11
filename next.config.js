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
  // NOTE on cookies: HttpOnly + SameSite=Lax WITHOUT the Secure flag is
  // deliberate — Secure would break plain-http LAN access (btec-send.local)
  // while offering nothing extra here (no Domain attribute; host-only cookies).
  // Same-origin hardening headers below. Deliberately NO Content-Security-Policy
  // (the app uses an inline theme script + inline styles) and NO HSTS from the
  // app (HSTS would force-https btec-send.local and break the LAN; enable HSTS
  // in the Cloudflare dashboard instead if the public URL is permanent).
  async headers() {
    return [
      {
        source: '/:path*',
        headers: [
          { key: 'X-Content-Type-Options', value: 'nosniff' },
          { key: 'Referrer-Policy', value: 'strict-origin-when-cross-origin' },
          { key: 'X-Frame-Options', value: 'SAMEORIGIN' },
          { key: 'Permissions-Policy', value: 'camera=(), microphone=(), geolocation=(), payment=()' },
        ],
      },
    ];
  },
  experimental: {
    serverActions: { bodySizeLimit: '128mb' },
  },
};

module.exports = nextConfig;
