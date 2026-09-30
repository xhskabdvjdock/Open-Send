#!/bin/sh
# Open Send — start for LAN access (binds 0.0.0.0:3000)
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
[ -d .next ] || npm run build
echo "Open Send on LAN: http://YOUR-SERVER-IP  (admin: /webadmin)"
echo "If port 80 is busy: npm run start:3000"
npm run start
