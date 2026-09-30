import { dbReady } from '@/lib/db';
import { newId, nowISO } from '@/lib/crypto';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const rows = db.prepare(
    `SELECT c.*, (SELECT COUNT(*) FROM users u WHERE u.classId = c.id) AS studentCount
     FROM classes c ORDER BY c.name COLLATE NOCASE`
  ).all();
  return json({ classes: rows });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { name?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const name = (body.name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
  if (name.length < 2) return err('Class name is required.', 400);
  const db = await dbReady();
  if (db.prepare('SELECT id FROM classes WHERE lower(name) = ?').get(name.toLowerCase())) {
    return err('Class already exists.', 409);
  }
  const id = newId();
  db.prepare('INSERT INTO classes(id, name, enabled, createdAt) VALUES (?, ?, 1, ?)').run(id, name, nowISO());
  audit('Admin Created Class', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `name=${name}`, ip: clientIp(req) });
  return json({ ok: true, id }, 201);
}
