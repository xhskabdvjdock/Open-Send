import fs from 'node:fs';
import path from 'node:path';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { backupsDir, dbPath, storageRoot } from '@/lib/paths';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeName(n: string): boolean {
  return /^[a-zA-Z0-9._-]{1,120}$/.test(n);
}

function copyDir(src: string, dest: string): void {
  fs.mkdirSync(dest, { recursive: true });
  for (const e of fs.readdirSync(src, { withFileTypes: true })) {
    const s = path.join(src, e.name);
    const d = path.join(dest, e.name);
    if (e.isDirectory()) copyDir(s, d);
    else {
      try {
        fs.copyFileSync(s, d);
      } catch {}
    }
  }
}

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  fs.mkdirSync(backupsDir(), { recursive: true });
  const files = fs.readdirSync(backupsDir()).filter((f) => f.endsWith('.db') || f.endsWith('.json'));
  const list = files
    .map((f) => {
      try {
        const st = fs.statSync(path.join(backupsDir(), f));
        return { name: f, size: st.size, createdAt: st.mtime.toISOString() };
      } catch {
        return null;
      }
    })
    .filter(Boolean)
    .sort((a, b) => (b!.createdAt > a!.createdAt ? 1 : -1));
  return json({ backups: list });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { includeFiles?: boolean } = {};
  try {
    body = await req.json();
  } catch {}
  fs.mkdirSync(backupsDir(), { recursive: true });
  const ts = new Date().toISOString().replace(/[:.]/g, '-');
  const dbName = `opensend-backup-${ts}.db`;
  const dbDest = path.join(backupsDir(), dbName);
  try {
    // Checkpoint then copy the SQLite file safely.
    const db = getDb();
    try {
      db.exec('PRAGMA wal_checkpoint(TRUNCATE)');
    } catch {}
    fs.copyFileSync(dbPath(), dbDest);
    // Manifest with settings + metadata (never passwords/hashes).
    const manifest = {
      createdAt: new Date().toISOString(),
      dbFile: dbName,
      includeFiles: !!body.includeFiles,
      note: 'Open Send backup: SQLite database copy. Restore via /webadmin → System → Backup.',
    };
    fs.writeFileSync(path.join(backupsDir(), dbName + '.json'), JSON.stringify(manifest, null, 2));
    if (body.includeFiles) {
      copyDir(storageRoot(), path.join(backupsDir(), `opensend-files-${ts}`));
    }
  } catch (e) {
    return err('Backup failed.', 500);
  }
  audit('Admin Created Backup', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: dbName, ip: clientIp(req) });
  return json({ ok: true, file: dbName }, 201);
}
