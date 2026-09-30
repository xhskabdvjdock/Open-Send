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
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60);
  const classId = (url.searchParams.get('classId') || '').trim();
  const status = (url.searchParams.get('status') || '').trim(); // enabled|disabled
  const db = await dbReady();
  const where: string[] = [];
  const params: (string | number | null)[] = [];
  if (q) {
    where.push("(u.usernameLower LIKE ? ESCAPE '\\' OR lower(u.displayName) LIKE ? ESCAPE '\\')");
    const like = `%${q.toLowerCase().replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    params.push(like, like);
  }
  if (classId) {
    where.push('u.classId = ?');
    params.push(classId);
  }
  if (status === 'enabled') where.push('u.enabled = 1');
  if (status === 'disabled') where.push('u.enabled = 0');
  const sql = `SELECT u.id, u.username, u.displayName, u.classId, c.name AS className, u.enabled, u.createdAt, u.lastLoginAt,
    (SELECT COUNT(*) FROM transfers t WHERE t.senderId = u.id) AS sentCount,
    (SELECT COUNT(*) FROM transfers t WHERE t.recipientId = u.id) AS receivedCount
    FROM users u LEFT JOIN classes c ON c.id = u.classId
    ${where.length ? 'WHERE ' + where.join(' AND ') : ''}
    ORDER BY u.createdAt DESC LIMIT 500`;
  const rows = db.prepare(sql).all(...params);
  return json({ students: rows });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { username?: string; password?: string; displayName?: string; classId?: string; enabled?: boolean };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const username = (body.username || '').trim();
  const password = body.password || '';
  const displayName = sanitizeDisplayName(body.displayName || '');
  const classId = (body.classId || '').trim() || null;
  const uErr = validateUsername(username);
  if (uErr) return err(uErr, 400);
  const pErr = validatePassword(password, 6);
  if (pErr) return err(pErr, 400);
  if (!displayName || displayName.length < 2) return err('Display name is required.', 400);

  const db = await dbReady();
  if (classId) {
    const cls = db.prepare('SELECT id FROM classes WHERE id = ?').get(classId) as unknown as { id: string } | undefined;
    if (!cls) return err('Class not found.', 400);
  }
  const lower = username.toLowerCase();
  if (db.prepare('SELECT id FROM users WHERE usernameLower = ?').get(lower)) return err('Username is already taken.', 409);

  const id = newId();
  const now = nowISO();
  db.prepare('INSERT INTO users(id, username, usernameLower, displayName, passwordHash, classId, enabled, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, ?)').run(
    id, username, lower, displayName, await hashPassword(password), classId, body.enabled === false ? 0 : 1, now
  );
  audit('Admin Created Student', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `username=${username}`, ip: clientIp(req) });
  return json({ ok: true, id }, 201);
}
