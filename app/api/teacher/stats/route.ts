import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { teacherStorageBytes } from '@/lib/folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const tid = g.teacher.id;
  const q = (sql: string, ...p: (string | number)[]) => (db.prepare(sql).get(...p) as unknown as { c: number }).c;
  const myFolders = q('SELECT COUNT(*) AS c FROM submission_folders WHERE teacherId = ?', tid);
  const totalSubmissions = q('SELECT COUNT(*) AS c FROM submissions WHERE teacherId = ?', tid);
  const currentSubmissions = q("SELECT COUNT(*) AS c FROM submissions WHERE teacherId = ? AND status = 'current'", tid);
  const lateSubmissions = q('SELECT COUNT(*) AS c FROM submissions WHERE teacherId = ? AND isLate = 1', tid);
  // Students = distinct students in teacher's assigned classes
  let students = 0;
  try {
    if (g.teacher.classIds.length > 0) {
      const ph = g.teacher.classIds.map(() => '?').join(',');
      students = q(`SELECT COUNT(*) AS c FROM users WHERE classId IN (${ph}) AND enabled = 1`, ...g.teacher.classIds);
    }
  } catch { students = 0; }
  const unread = q('SELECT COUNT(*) AS c FROM teacher_notifications WHERE teacherId = ? AND isRead = 0', tid);
  const storageUsed = teacherStorageBytes(tid);
  return json({ stats: { myFolders, totalSubmissions, pendingSubmissions: currentSubmissions, students, lateSubmissions, unread, storageUsed } });
}
