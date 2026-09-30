import fs from 'node:fs';
import path from 'node:path';
import { DatabaseSync } from 'node:sqlite';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { backupsDir, dbPath } from '@/lib/paths';
import { closeDb, getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function safeName(n: string): boolean {
  return /^[a-zA-Z0-9._-]{1,120}$/.test(n) && n.endsWith('.db');
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { file?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const file = (body.file || '').trim();
  if (!file || !safeName(file)) return err('Invalid backup file.', 400);
  const src = path.join(backupsDir(), file);
  if (!fs.existsSync(src)) return err('Backup not found.', 404);

  // Validate: must be a readable SQLite db with expected tables.
  try {
    const probe = new DatabaseSync(src, { readOnly: true } as unknown as { readOnly: boolean });
    const tables = probe.prepare("SELECT name FROM sqlite_master WHERE type='table'").all() as unknown as { name: string }[];
    probe.close();
    const names = new Set(tables.map((t) => t.name));
    for (const need of ['users', 'classes', 'transfers', 'transfer_files', 'system_settings']) {
      if (!names.has(need)) return err('Backup validation failed: not an Open Send database.', 400);
    }
  } catch {
    return err('Backup validation failed.', 400);
  }

  try {
    // Safety: automatic backup of current db first.
    const ts = new Date().toISOString().replace(/[:.]/g, '-');
    try {
      getDb().exec('PRAGMA wal_checkpoint(TRUNCATE);');
    } catch {}
    fs.copyFileSync(dbPath(), path.join(backupsDir(), `opensend-pre-restore-${ts}.db`));
    // Replace current db: close, copy, reopen (getDb lazily reopens+migrates).
    closeDb();
    fs.copyFileSync(src, dbPath());
    try {
      fs.unlinkSync(dbPath() + '-wal');
    } catch {}
    try {
      fs.unlinkSync(dbPath() + '-shm');
    } catch {}
    getDb();
  } catch {
    return err('Restore failed.', 500);
  }
  audit('Admin Restored Backup', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: file, ip: clientIp(req) });
  return json({ ok: true });
}
