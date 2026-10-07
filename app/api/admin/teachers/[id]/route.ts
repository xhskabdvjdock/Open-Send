import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { sanitizeDisplayName } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const t = db.prepare('SELECT id, username, displayName, enabled, createdAt, lastLoginAt FROM teachers WHERE id = ?').get(params.id) as unknown as Record<string, unknown> | undefined;
  if (!t) return err('Teacher not found.', 404);
  (t as Record<string, unknown>).classes = db.prepare('SELECT c.id, c.name FROM teacher_classes tc JOIN classes c ON c.id = tc.classId WHERE tc.teacherId = ?').all(params.id);
  (t as Record<string, unknown>).folders = db.prepare(
    `SELECT f.*, (SELECT COUNT(*) FROM submissions s WHERE s.folderId = f.id) AS submissionCount FROM submission_folders f WHERE f.teacherId = ? ORDER BY f.createdAt DESC`
  ).all(params.id);
  (t as Record<string, unknown>).activity = db.prepare("SELECT id, action, details, ip, createdAt FROM audit_logs WHERE actorType = 'teacher' AND actorId = ? ORDER BY id DESC LIMIT 50").all(params.id);
  return json({ teacher: t });
}

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { displayName?: string; enabled?: boolean; classIds?: string[] };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  const t = db.prepare('SELECT id FROM teachers WHERE id = ?').get(params.id) as unknown as { id: string } | undefined;
  if (!t) return err('Teacher not found.', 404);
  if (body.displayName !== undefined) {
    const n = sanitizeDisplayName(body.displayName || '');
    if (!n || n.length < 2) return err('Display name is required (min 2 characters).', 400);
    db.prepare('UPDATE teachers SET displayName = ? WHERE id = ?').run(n, params.id);
  }
  if (body.enabled !== undefined) {
    db.prepare('UPDATE teachers SET enabled = ? WHERE id = ?').run(body.enabled ? 1 : 0, params.id);
    if (!body.enabled) {
      // Invalidate teacher sessions
      try { db.prepare('DELETE FROM sessions WHERE teacherId = ?').run(params.id); } catch {}
    }
  }
  if (body.classIds !== undefined) {
    const classIds = Array.isArray(body.classIds) ? body.classIds.map(String) : [];
    for (const c of classIds) {
      const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(c) as unknown as { id: string } | undefined;
      if (!cls) return err('Selected class is invalid.', 400);
    }
    db.prepare('DELETE FROM teacher_classes WHERE teacherId = ?').run(params.id);
    const ins = db.prepare('INSERT OR IGNORE INTO teacher_classes(teacherId, classId) VALUES (?, ?)');
    for (const c of classIds) ins.run(params.id, c);
  }
  audit('Admin Edited Teacher', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `teacher=${params.id}`, ip: clientIp(req) });
  return json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const t = db.prepare('SELECT username FROM teachers WHERE id = ?').get(params.id) as unknown as { username: string } | undefined;
  if (!t) return err('Teacher not found.', 404);
  // Delete physical submission files of this teacher's folders
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { storageSubdir } = await import('@/lib/paths');
    const files = db.prepare('SELECT sf.storedFile FROM submission_files sf JOIN submissions s ON s.id = sf.submissionId WHERE s.teacherId = ?').all(params.id) as unknown as { storedFile: string }[];
    for (const fl of files) {
      try {
        const p = path.join(storageSubdir('submissions'), fl.storedFile);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
  // Chat: students keep their history (sender shows as unknown), but drop the
  // teacher's presence and any blocks involving them.
  try {
    db.prepare('DELETE FROM chat_presence WHERE userId = ?').run(params.id);
    db.prepare('DELETE FROM chat_blocks WHERE blockerId = ? OR blockedId = ?').run(params.id, params.id);
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { storageSubdir } = await import('@/lib/paths');
    const av = db.prepare('SELECT avatarFile FROM teachers WHERE id = ?').get(params.id) as unknown as { avatarFile: string } | undefined;
    if (av?.avatarFile) {
      try {
        const p = path.join(storageSubdir('avatars'), av.avatarFile);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
  db.prepare('DELETE FROM teachers WHERE id = ?').run(params.id);
  audit('Admin Deleted Teacher', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `teacher=${t.username}`, ip: clientIp(req) });
  return json({ ok: true });
}
