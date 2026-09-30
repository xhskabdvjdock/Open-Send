import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const today = new Date().toISOString().slice(0, 10);
  const q = (sql: string, ...p: (string | number)[]) => (db.prepare(sql).get(...p) as unknown as { c: number }).c;
  const students = q('SELECT COUNT(*) AS c FROM users');
  const studentsToday = q('SELECT COUNT(*) AS c FROM users WHERE substr(createdAt,1,10) = ?', today);
  const classes = q('SELECT COUNT(*) AS c FROM classes WHERE enabled = 1');
  const transfers = q('SELECT COUNT(*) AS c FROM transfers');
  const transfersToday = q('SELECT COUNT(*) AS c FROM transfers WHERE substr(createdAt,1,10) = ?', today);
  const pending = q("SELECT COUNT(*) AS c FROM transfers WHERE status = 'PENDING'");
  const filesToday = q('SELECT COUNT(*) AS c FROM transfer_files WHERE substr(createdAt,1,10) = ?', today);
  const notifUnread = q('SELECT COUNT(*) AS c FROM notifications WHERE isRead = 0');
  const storageUsed = q('SELECT COALESCE(SUM(size),0) AS c FROM transfer_files');
  return json({
    stats: { students, studentsToday, classes, transfers, transfersToday, pending, filesToday, notifUnread, storageUsed },
  });
}
