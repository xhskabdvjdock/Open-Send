import fs from 'node:fs';
import path from 'node:path';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { nowISO } from '@/lib/crypto';
import { storageSubdir } from '@/lib/paths';
import { getSubmissionFolder, folderEffectiveStatus } from '@/lib/folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Admin: full access — view / edit / archive / delete / change teacher
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const f = getSubmissionFolder(params.id);
  if (!f) return err('Folder not found.', 404);
  const db = await dbReady();
  const submissions = db.prepare(
    `SELECT s.*, u.username AS studentUsername, u.displayName AS studentName, c.name AS className,
      (SELECT COUNT(*) FROM submission_files sf WHERE sf.submissionId = s.id) AS fileCount,
      (SELECT COALESCE(SUM(sf.size),0) FROM submission_files sf WHERE sf.submissionId = s.id) AS totalBytes
     FROM submissions s JOIN users u ON u.id = s.studentId LEFT JOIN classes c ON c.id = s.classId
     WHERE s.folderId = ? ORDER BY s.createdAt DESC LIMIT 500`
  ).all(params.id);
  return json({ folder: { ...f, effectiveStatus: folderEffectiveStatus(f as never) }, submissions });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  const f = db.prepare('SELECT id FROM submission_folders WHERE id = ?').get(params.id) as unknown as { id: string } | undefined;
  if (!f) return err('Folder not found.', 404);
  const updates: string[] = [];
  const vals: (string | number | null)[] = [];
  const set = (col: string, v: string | number | null) => { updates.push(`${col} = ?`); vals.push(v); };
  if (body.name !== undefined) {
    const n = String(body.name).trim().slice(0, 120);
    if (n.length < 2) return err('Folder name is required (min 2 characters).', 400);
    set('name', n);
  }
  if (body.description !== undefined) set('description', String(body.description).slice(0, 2000));
  if (body.status !== undefined) {
    if (!['active', 'closed', 'archived'].includes(String(body.status))) return err('Invalid status.', 400);
    set('status', String(body.status));
  }
  if (body.deadline !== undefined) {
    if (!body.deadline) set('deadline', null);
    else {
      const d = new Date(String(body.deadline));
      if (isNaN(d.getTime())) return err('Invalid deadline.', 400);
      set('deadline', d.toISOString());
    }
  }
  if (body.teacherId !== undefined) {
    const t = db.prepare('SELECT id FROM teachers WHERE id = ?').get(String(body.teacherId)) as unknown as { id: string } | undefined;
    if (!t) return err('Teacher not found.', 400);
    set('teacherId', String(body.teacherId));
    // Update denormalized teacherId on submissions
    db.prepare('UPDATE submissions SET teacherId = ? WHERE folderId = ?').run(String(body.teacherId), params.id);
  }
  if (body.maxFileSizeMB !== undefined) set('maxFileSizeMB', Math.max(1, Math.min(2048, Math.floor(Number(body.maxFileSizeMB) || 50))));
  if (body.maxFiles !== undefined) set('maxFiles', Math.max(1, Math.min(20, Math.floor(Number(body.maxFiles) || 5))));
  if (body.classIds !== undefined && Array.isArray(body.classIds)) {
    const classIds = (body.classIds as unknown[]).map(String);
    db.prepare('DELETE FROM folder_classes WHERE folderId = ?').run(params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO folder_classes(folderId, classId) VALUES (?, ?)');
    for (const c of classIds) ins.run(params.id, c);
  }
  if (updates.length > 0) {
    set('updatedAt', nowISO());
    db.prepare(`UPDATE submission_folders SET ${updates.join(', ')} WHERE id = ?`).run(...vals, params.id);
  }
  audit('Admin Edited Folder', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `folder=${params.id}`, ip: clientIp(req) });
  return json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const f = db.prepare('SELECT name FROM submission_folders WHERE id = ?').get(params.id) as unknown as { name: string } | undefined;
  if (!f) return err('Folder not found.', 404);
  try {
    const files = db.prepare('SELECT sf.storedFile FROM submission_files sf JOIN submissions s ON s.id = sf.submissionId WHERE s.folderId = ?').all(params.id) as unknown as { storedFile: string }[];
    for (const fl of files) {
      try {
        const p = path.join(storageSubdir('submissions'), fl.storedFile);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
  db.prepare('DELETE FROM submission_folders WHERE id = ?').run(params.id);
  audit('Admin Deleted Folder', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `folder=${f.name}`, ip: clientIp(req) });
  return json({ ok: true });
}
