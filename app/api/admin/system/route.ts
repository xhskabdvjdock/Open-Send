import fs from 'node:fs';
import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { getSettings } from '@/lib/settings';
import { dbPath, storageRoot } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const STARTED_AT = Date.now();

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const c = (sql: string) => (db.prepare(sql).get() as unknown as { c: number }).c;
  let dbSize = 0;
  try {
    dbSize = fs.statSync(dbPath()).size;
  } catch {}
  let storageUsed = 0;
  const walk = (p: string): void => {
    try {
      for (const e of fs.readdirSync(p, { withFileTypes: true })) {
        const full = `${p}/${e.name}`;
        try {
          if (e.isDirectory()) walk(full);
          else storageUsed += fs.statSync(full).size;
        } catch {}
      }
    } catch {}
  };
  walk(storageRoot());
  const s = getSettings();
  return json({
    system: {
      status: 'Running',
      appVersion: s.appVersion,
      appName: s.appName,
      dbSize,
      storageUsed,
      users: c('SELECT COUNT(*) AS c FROM users'),
      classes: c('SELECT COUNT(*) AS c FROM classes'),
      transfers: c('SELECT COUNT(*) AS c FROM transfers'),
      uptimeSeconds: Math.floor((Date.now() - STARTED_AT) / 1000),
      node: process.version,
      platform: process.platform,
    },
  });
}
