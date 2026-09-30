#!/bin/sh
# Open Send — start for LAN access (binds 0.0.0.0:3000)
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
[ -d .next ] || npm run build
echo "Open Send on LAN: http://YOUR-SERVER-IP  (admin: /webadmin)"
echo "Local name (no setup): http://opensend.local"
echo "If port 80 is busy: npm run start:3000"
# Zero-config local DNS (mDNS) in the background
node scripts/mdns.mjs &
# Built-in fallback DNS (open-send.btec) — only if port 53 is free.
# If Technitium DNS Server is installed, it owns port 53; use it instead.
# Manual start when needed: node scripts/dns.mjs
npm run start
