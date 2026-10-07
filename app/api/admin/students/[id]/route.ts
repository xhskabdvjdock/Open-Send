import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { sanitizeDisplayName } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { displayName?: string; classId?: string | null; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  const user = db.prepare('SELECT id, username FROM users WHERE id = ?').get(params.id) as unknown as { id: string; username: string } | undefined;
  if (!user) return err('Student not found.', 404);

  const updates: string[] = [];
  const vals: (string | number | null)[] = [];
  if (body.displayName !== undefined) {
    const dn = sanitizeDisplayName(body.displayName);
    if (dn.length < 2) return err('Display name too short.', 400);
    updates.push('displayName = ?');
    vals.push(dn);
  }
  if (body.classId !== undefined) {
    if (body.classId) {
      const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(body.classId) as unknown as { id: string } | undefined;
      if (!cls) return err('Class not found.', 400);
      updates.push('classId = ?');
      vals.push(body.classId);
    } else {
      updates.push('classId = NULL');
    }
  }
  if (body.enabled !== undefined) {
    updates.push('enabled = ?');
    vals.push(body.enabled ? 1 : 0);
  }
  if (updates.length === 0) return err('Nothing to update.', 400);
  vals.push(params.id);
  db.prepare(`UPDATE users SET ${updates.join(', ')} WHERE id = ?`).run(...vals);
  audit('Admin Updated Student', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `username=${user.username} fields=${updates.join(',')}`, ip: clientIp(req) });
  return json({ ok: true });
}

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const user = db.prepare('SELECT username FROM users WHERE id = ?').get(params.id) as unknown as { username: string } | undefined;
  if (!user) return err('Student not found.', 404);
  // Delete physical files of their transfers first
  const { deleteTransferFiles } = await import('@/lib/transfers');
  const transfers = db.prepare('SELECT id FROM transfers WHERE senderId = ? OR recipientId = ?').all(params.id, params.id) as unknown as { id: string }[];
  for (const t of transfers) deleteTransferFiles(t.id);
  // Delete physical files of their teacher-folder submissions (rows cascade, bytes must be removed)
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { storageSubdir } = await import('@/lib/paths');
    const sfiles = db.prepare('SELECT storedFile FROM submission_files sf JOIN submissions s ON s.id = sf.submissionId WHERE s.studentId = ?').all(params.id) as unknown as { storedFile: string }[];
    for (const fl of sfiles) {
      try {
        const p = path.join(storageSubdir('submissions'), fl.storedFile);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
  // Delete physical files of their chat attachments (no FK cascade there)
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { storageSubdir } = await import('@/lib/paths');
    const cfiles = db.prepare("SELECT attachmentFile FROM chat_messages WHERE senderId = ? AND attachmentFile != ''").all(params.id) as unknown as { attachmentFile: string }[];
    for (const fl of cfiles) {
      try {
        const p = path.join(storageSubdir('chat'), fl.attachmentFile);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
  // Delete their profile picture bytes too (no FK cascade on the column).
  try {
    const fs = await import('node:fs');
    const path = await import('node:path');
    const { storageSubdir } = await import('@/lib/paths');
    const av = db.prepare('SELECT avatarFile FROM users WHERE id = ?').get(params.id) as unknown as { avatarFile: string } | undefined;
    if (av?.avatarFile) {
      try {
        const p = path.join(storageSubdir('avatars'), av.avatarFile);
        if (fs.existsSync(p)) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
  // Chat rows reference students without FKs (teachers share the tables):
  // remove participations, own messages, presence and blocks, then conversations left empty.
  try {
    db.prepare('DELETE FROM conversation_participants WHERE userId = ?').run(params.id);
    db.prepare('DELETE FROM chat_messages WHERE senderId = ?').run(params.id);
    db.prepare('DELETE FROM chat_presence WHERE userId = ?').run(params.id);
    db.prepare('DELETE FROM chat_blocks WHERE blockerId = ? OR blockedId = ?').run(params.id, params.id);
    db.prepare('DELETE FROM conversations WHERE id NOT IN (SELECT conversationId FROM conversation_participants)').run();
  } catch {}
  db.prepare('DELETE FROM users WHERE id = ?').run(params.id);
  audit('Admin Deleted Student', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `username=${user.username}`, ip: clientIp(req) });
  return json({ ok: true });
}
