// Minimal .env loader for Open Send's plain-node helper scripts
// (scripts/mdns.mjs, scripts/network-check.mjs).
// Next.js loads .env by itself; bare `node` does not — so these scripts would
// otherwise ignore it. Explicit process environment always wins.
// Runs on import as a side effect (imports evaluate before module bodies,
// so values are ready before any `process.env.X` reads below).
import fs from 'node:fs';
import path from 'node:path';

export function loadEnvFile(root = process.cwd()) {
  for (const name of ['.env.local', '.env']) {
    let text;
    try {
      text = fs.readFileSync(path.join(root, name), 'utf8');
    } catch {
      continue;
    }
    for (const line of text.split(/\r?\n/)) {
      let t = line.trim();
      if (!t || t.startsWith('#')) continue;
      if (t.toLowerCase().startsWith('export ')) t = t.slice(7).trim();
      const eq = t.indexOf('=');
      if (eq < 0) continue;
      const key = t.slice(0, eq).trim();
      let val = t.slice(eq + 1).trim();
      if (
        val.length >= 2 &&
        ((val.startsWith('"') && val.endsWith('"')) || (val.startsWith("'") && val.endsWith("'")))
      ) {
        val = val.slice(1, -1);
      }
      if (key && !(key in process.env)) process.env[key] = val;
    }
  }
}

loadEnvFile();
