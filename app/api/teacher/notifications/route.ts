import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const unreadOnly = url.searchParams.get('unread') === '1';
  const db = await dbReady();
  const rows = db.prepare(
    `SELECT n.*, f.name AS folderName FROM teacher_notifications n LEFT JOIN submission_folders f ON f.id = n.folderId
     WHERE n.teacherId = ? ${unreadOnly ? 'AND n.isRead = 0' : ''} ORDER BY n.createdAt DESC LIMIT 100`
  ).all(g.teacher.id);
  const unread = (db.prepare('SELECT COUNT(*) AS c FROM teacher_notifications WHERE teacherId = ? AND isRead = 0').get(g.teacher.id) as unknown as { c: number }).c;
  return json({ notifications: rows, unread });
}

export async function POST(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { action?: string; id?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  if (body.action === 'read-all') {
    db.prepare('UPDATE teacher_notifications SET isRead = 1 WHERE teacherId = ?').run(g.teacher.id);
    return json({ ok: true });
  }
  if (body.action === 'read' && body.id) {
    db.prepare('UPDATE teacher_notifications SET isRead = 1 WHERE id = ? AND teacherId = ?').run(body.id, g.teacher.id);
    return json({ ok: true });
  }
  return err('Unknown action.', 400);
}
