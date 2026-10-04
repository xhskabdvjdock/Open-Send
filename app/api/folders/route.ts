import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { folderEffectiveStatus } from '@/lib/folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Student: list teacher folders available to my class
export async function GET(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const settings = getSettings();
  if (settings.maintenanceMode) return err('Open Send is temporarily unavailable.', 503);
  const db = await dbReady();
  const classId = sess.user.classId;
  if (!classId) return json({ folders: [] });
  const rows = db.prepare(
    `SELECT f.*, t.displayName AS teacherName, t.username AS teacherUsername,
      (SELECT COUNT(*) FROM submissions s WHERE s.folderId = f.id AND s.studentId = ? AND s.status = 'current') AS mySubmissions
     FROM submission_folders f
     JOIN teachers t ON t.id = f.teacherId
     JOIN folder_classes fc ON fc.folderId = f.id
     WHERE fc.classId = ? AND f.status IN ('active','closed') AND t.enabled = 1
     ORDER BY f.deadline IS NULL, f.deadline ASC, f.createdAt DESC`
  ).all(sess.user.id, classId) as unknown as Record<string, unknown>[];
  const folders = rows.map((r) => {
    const eff = folderEffectiveStatus(r as never);
    return { ...r, effectiveStatus: eff };
  });
  return json({ folders });
}
