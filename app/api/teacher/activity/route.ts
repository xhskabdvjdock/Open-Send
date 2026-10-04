import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const limit = Math.min(200, Math.max(1, Number(url.searchParams.get('limit') || 100) || 100));
  const db = await dbReady();
  const rows = db.prepare(
    "SELECT id, action, details, ip, createdAt FROM audit_logs WHERE actorType = 'teacher' AND actorId = ? ORDER BY id DESC LIMIT ?"
  ).all(g.teacher.id, limit);
  return json({ activity: rows });
}
