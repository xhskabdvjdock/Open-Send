import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';
import { nowISO } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

async function targetAccount(id: string): Promise<{ id: string; username: string; displayName: string; isTeacher: boolean } | null> {
  const db = await dbReady();
  const u = db.prepare('SELECT id, username, displayName FROM users WHERE id = ? AND enabled = 1').get(id) as unknown as { id: string; username: string; displayName: string } | undefined;
  if (u) return { ...u, isTeacher: false };
  const t = db.prepare('SELECT id, username, displayName FROM teachers WHERE id = ? AND enabled = 1').get(id) as unknown as { id: string; username: string; displayName: string } | undefined;
  if (t) return { ...t, isTeacher: true };
  return null;
}

export async function GET(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const s = getSettings();
  if (!s.chatEnabled || !s.chatTeacherChat) return err('Chat is disabled.', 403);
  const db = await dbReady();
  const rows = db.prepare('SELECT blockedId, createdAt FROM chat_blocks WHERE blockerId = ? ORDER BY createdAt DESC').all(g.teacher.id) as unknown as { blockedId: string; createdAt: string }[];
  const items: Record<string, unknown>[] = [];
  for (const r of rows) {
    const acc = await targetAccount(r.blockedId);
    items.push({ userId: r.blockedId, createdAt: r.createdAt, ...(acc || { username: '', displayName: '', isTeacher: false }) });
  }
  return json({ blocked: items });
}

export async function POST(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const s = getSettings();
  if (!s.chatEnabled || !s.chatTeacherChat) return err('Chat is disabled.', 403);
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const targetId = String(body.userId || '').trim();
  if (!targetId) return err('Student is required.', 400);
  if (targetId === g.teacher.id) return err('You cannot chat with yourself.', 400);
  const acc = await targetAccount(targetId);
  if (!acc) return err('Student not found.', 404);
  const db = await dbReady();
  const now = nowISO();
  const row = db.prepare('SELECT 1 AS ok FROM chat_blocks WHERE blockerId = ? AND blockedId = ?').get(g.teacher.id, targetId) as unknown as { ok: number } | undefined;
  if (!row) {
    db.prepare('INSERT INTO chat_blocks(blockerId, blockedId, createdAt) VALUES (?, ?, ?)').run(g.teacher.id, targetId, now);
  }
  return json({ ok: true, blocked: { userId: targetId, ...acc } }, 201);
}
