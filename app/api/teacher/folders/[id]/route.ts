import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { audit } from '@/lib/server-utils';
import { getSubmissionFolder, getTeacherClasses, teacherOwnsFolder, folderEffectiveStatus } from '@/lib/folders';
import { getSettings } from '@/lib/settings';
import { nowISO } from '@/lib/crypto';
import fs from 'node:fs';
import path from 'node:path';
import { storageSubdir } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_LATE = new Set(['blocked', 'allowed', 'marked']);

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherOwnsFolder(g.teacher.id, params.id)) return err('Folder not found.', 404);
  const db = await dbReady();
  const f = getSubmissionFolder(params.id);
  if (!f) return err('Folder not found.', 404);
  const submissions = db.prepare(
    `SELECT s.*, u.username AS studentUsername, u.displayName AS studentName, c.name AS className,
      (SELECT COUNT(*) FROM submission_files sf WHERE sf.submissionId = s.id) AS fileCount,
      (SELECT COALESCE(SUM(sf.size),0) FROM submission_files sf WHERE sf.submissionId = s.id) AS totalBytes
     FROM submissions s JOIN users u ON u.id = s.studentId LEFT JOIN classes c ON c.id = s.classId
     WHERE s.folderId = ? ORDER BY s.createdAt DESC`
  ).all(params.id);
  // Missing students: assigned-class students minus submitters
  let missing: Record<string, unknown>[] = [];
  let progress = { submitted: 0, total: 0, percent: 0 };
  try {
    const classIds = f.classIds;
    if (classIds.length > 0) {
      const ph = classIds.map(() => '?').join(',');
      const all = db.prepare(`SELECT u.id, u.username, u.displayName, u.classId, c.name AS className FROM users u LEFT JOIN classes c ON c.id = u.classId WHERE u.classId IN (${ph}) AND u.enabled = 1 ORDER BY u.displayName`).all(...classIds) as unknown as Record<string, unknown>[];
      const submittedIds = new Set((db.prepare("SELECT DISTINCT studentId FROM submissions WHERE folderId = ? AND status = 'current'").all(params.id) as unknown as { studentId: string }[]).map((r) => r.studentId));
      missing = all.filter((u) => !submittedIds.has(String(u.id)));
      progress = { submitted: submittedIds.size, total: all.length, percent: all.length ? Math.round((submittedIds.size / all.length) * 100) : 0 };
    }
  } catch {}
  return json({ folder: { ...f, effectiveStatus: folderEffectiveStatus(f as never) }, submissions, missing, progress });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherOwnsFolder(g.teacher.id, params.id)) return err('Folder not found.', 404);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  const f = db.prepare('SELECT * FROM submission_folders WHERE id = ?').get(params.id) as unknown as Record<string, unknown> | undefined;
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
    const st = String(body.status);
    if (!['active', 'closed', 'archived'].includes(st)) return err('Invalid status.', 400);
    set('status', st);
  }
  if (body.deadline !== undefined) {
    if (!body.deadline) set('deadline', null);
    else {
      const d = new Date(String(body.deadline));
      if (isNaN(d.getTime())) return err('Invalid deadline.', 400);
      set('deadline', d.toISOString());
    }
  }
  if (body.maxFileSizeMB !== undefined) set('maxFileSizeMB', Math.max(1, Math.min(2048, Math.floor(Number(body.maxFileSizeMB) || 50))));
  if (body.maxFiles !== undefined) set('maxFiles', Math.max(1, Math.min(20, Math.floor(Number(body.maxFiles) || 5))));
  if (body.maxTotalSizeMB !== undefined) set('maxTotalSizeMB', Math.max(10, Math.min(10240, Math.floor(Number(body.maxTotalSizeMB) || 500))));
  if (body.allowedExtensions !== undefined) {
    const ae = String(body.allowedExtensions).split(',').map((s) => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean).slice(0, 40).join(',');
    set('allowedExtensions', ae);
  }
  if (body.allowMultiple !== undefined) set('allowMultiple', body.allowMultiple ? 1 : 0);
  if (body.allowReplace !== undefined) set('allowReplace', body.allowReplace ? 1 : 0);
  if (body.allowDeleteOwn !== undefined) set('allowDeleteOwn', body.allowDeleteOwn ? 1 : 0);
  if (body.lateMode !== undefined) {
    const lm = String(body.lateMode);
    if (!VALID_LATE.has(lm)) return err('Invalid late mode.', 400);
    set('lateMode', lm);
    set('allowLate', lm === 'blocked' ? 0 : 1);
  } else if (body.allowLate !== undefined) {
    set('allowLate', body.allowLate ? 1 : 0);
    if (!body.allowLate) set('lateMode', 'blocked');
  }
  if (body.requireMessage !== undefined) set('requireMessage', body.requireMessage ? 1 : 0);
  if (body.classIds !== undefined) {
    const classIds = Array.isArray(body.classIds) ? (body.classIds as unknown[]).map(String) : [];
    const assigned = getTeacherClasses(g.teacher.id);
    for (const c of classIds) {
      if (!assigned.includes(c)) return err('You can only assign your own classes.', 403);
    }
    db.prepare('DELETE FROM folder_classes WHERE folderId = ?').run(params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO folder_classes(folderId, classId) VALUES (?, ?)');
    for (const c of classIds) ins.run(params.id, c);
  }
  if (updates.length > 0) {
    set('updatedAt', nowISO());
    db.prepare(`UPDATE submission_folders SET ${updates.join(', ')} WHERE id = ?`).run(...vals, params.id);
  }
  audit('Teacher Edited Folder', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `folder=${params.id}`, ip: clientIp(req) });
  return json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherOwnsFolder(g.teacher.id, params.id)) return err('Folder not found.', 404);
  const url = new URL(req.url);
  const permanent = url.searchParams.get('permanent') === '1';
  const confirmName = (url.searchParams.get('confirm') || '').trim();
  const db = await dbReady();
  const f = db.prepare('SELECT * FROM submission_folders WHERE id = ?').get(params.id) as unknown as { name: string } | undefined;
  if (!f) return err('Folder not found.', 404);
  const settings = getSettings();
  if (permanent) {
    if (!settings.allowTeacherDeleteFolders) return err('Permanent deletion is disabled. Archive the folder instead.', 403);
    if (confirmName !== f.name) return err('Type the folder name to confirm deletion.', 400);
    // Delete physical submission files
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
    audit('Teacher Deleted Folder', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `folder=${f.name}`, ip: clientIp(req) });
    return json({ ok: true, deleted: true });
  }
  // Default: archive
  db.prepare("UPDATE submission_folders SET status = 'archived', updatedAt = ? WHERE id = ?").run(nowISO(), params.id);
  audit('Teacher Archived Folder', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `folder=${params.id}`, ip: clientIp(req) });
  return json({ ok: true, archived: true });
}
