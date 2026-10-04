import { dbReady } from '@/lib/db';
import { hashPassword, newId, nowISO } from '@/lib/crypto';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { validateUsername, validatePassword, sanitizeDisplayName } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60).toLowerCase();
  const db = await dbReady();
  let sql = `SELECT t.id, t.username, t.displayName, t.enabled, t.createdAt, t.lastLoginAt,
    (SELECT COUNT(*) FROM submission_folders f WHERE f.teacherId = t.id) AS folderCount,
    (SELECT COUNT(*) FROM submissions s WHERE s.teacherId = t.id) AS submissionCount
    FROM teachers t`;
  const vals: (string | number)[] = [];
  if (q) {
    sql += " WHERE (t.usernameLower LIKE ? ESCAPE '\\' OR lower(t.displayName) LIKE ? ESCAPE '\\')";
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    vals.push(like, like);
  }
  sql += ' ORDER BY t.createdAt DESC LIMIT 500';
  const teachers = db.prepare(sql).all(...vals) as unknown as Record<string, unknown>[];
  for (const t of teachers) {
    try {
      (t as Record<string, unknown>).classes = db.prepare(
        'SELECT c.id, c.name FROM teacher_classes tc JOIN classes c ON c.id = tc.classId WHERE tc.teacherId = ?'
      ).all((t as { id: string }).id);
    } catch {
      (t as Record<string, unknown>).classes = [];
    }
  }
  return json({ teachers });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { username?: string; password?: string; displayName?: string; classIds?: string[]; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const username = (body.username || '').trim();
  const password = body.password || '';
  const displayName = sanitizeDisplayName(body.displayName || '');
  const uErr = validateUsername(username);
  if (uErr) return err(uErr, 400);
  const pErr = validatePassword(password, 6);
  if (pErr) return err(pErr, 400);
  if (!displayName || displayName.length < 2) return err('Display name is required.', 400);
  const db = await dbReady();
  const lower = username.toLowerCase();
  if (db.prepare('SELECT id FROM teachers WHERE usernameLower = ?').get(lower)) return err('Username is already taken.', 409);
  // Prevent collision with student/admin usernames for clarity
  if (db.prepare('SELECT id FROM users WHERE usernameLower = ?').get(lower)) return err('Username is already taken.', 409);
  const classIds = Array.isArray(body.classIds) ? body.classIds.map(String) : [];
  for (const c of classIds) {
    const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(c) as unknown as { id: string } | undefined;
    if (!cls) return err('Selected class is invalid.', 400);
  }
  const id = newId();
  const now = nowISO();
  db.prepare('INSERT INTO teachers(id, username, usernameLower, displayName, passwordHash, enabled, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)').run(
    id, username, lower, displayName, await hashPassword(password), body.enabled === false ? 0 : 1, now
  );
  const ins = db.prepare('INSERT OR IGNORE INTO teacher_classes(teacherId, classId) VALUES (?, ?)');
  for (const c of classIds) ins.run(id, c);
  audit('Admin Created Teacher', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `username=${username}`, ip: clientIp(req) });
  return json({ ok: true, id }, 201);
}
