import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const action = (url.searchParams.get('action') || '').trim();
  const actor = (url.searchParams.get('actor') || '').trim().slice(0, 80);
  const date = (url.searchParams.get('date') || '').trim();
  const limit = Math.min(500, Math.max(1, Number(url.searchParams.get('limit') || 200) || 200));

  const db = await dbReady();
  const where: string[] = [];
  const params: (string | number | null)[] = [];
  if (action) {
    where.push('action = ?');
    params.push(action);
  }
  if (actor) {
    where.push("(actorName LIKE ? ESCAPE '\\' OR actorId = ?)");
    params.push(`%${actor.replace(/[\\%_]/g, (c) => `\\${c}`)}%`, actor);
  }
  if (date) {
    where.push('substr(createdAt,1,10) = ?');
    params.push(date);
  }
  const rows = db.prepare(
    `SELECT * FROM audit_logs ${where.length ? 'WHERE ' + where.join(' AND ') : ''} ORDER BY id DESC LIMIT ?`
  ).all(...params, limit);
  const actions = db.prepare('SELECT DISTINCT action FROM audit_logs ORDER BY action').all() as unknown as { action: string }[];
  return json({ logs: rows, actions: actions.map((a) => a.action) });
}
