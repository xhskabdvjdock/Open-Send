#!/bin/sh
# Open Send — start for LAN access (binds 0.0.0.0:80, no :port in the URL)
# Primary address: http://btec-send.local  (server IP 192.168.1.118, mDNS)
# Fallback:        http://192.168.1.118
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
[ -d .next ] || npm run build
echo "Open Send on LAN: http://btec-send.local  (fallback http://192.168.1.118, admin: /webadmin)"
echo "If port 80 is busy: npm run start:3000  (then http://btec-send.local:3000)"
# Zero-config local DNS (mDNS) in the background
node scripts/mdns.mjs &
# Startup network validation (IP + hostname + banner). Never blocks startup.
node scripts/network-check.mjs
# Built-in fallback DNS (open-send.btec) — only if port 53 is free.
# If Technitium DNS Server is installed, it owns port 53; use it instead.
# Manual start when needed: node scripts/dns.mjs
npm run start
