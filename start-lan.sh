#!/bin/sh
# Open Send — start for LAN access (binds 0.0.0.0:3000)
cd "$(dirname "$0")"
[ -d node_modules ] || npm install
[ -d .next ] || npm run build
echo "Open Send on LAN: http://YOUR-SERVER-IP:3000  (admin: /webadmin)"
npm run start
