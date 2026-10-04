import { dbReady } from '@/lib/db';
import { newId, nowISO } from '@/lib/crypto';
import { json, err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { audit } from '@/lib/server-utils';
import { getTeacherClasses } from '@/lib/folders';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const VALID_LATE = new Set(['blocked', 'allowed', 'marked']);

export async function GET(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const status = (url.searchParams.get('status') || '').trim();
  const db = await dbReady();
  let sql = `SELECT f.*, t.displayName AS teacherName,
    (SELECT COUNT(*) FROM submissions s WHERE s.folderId = f.id AND s.status = 'current') AS submissionCount,
    (SELECT COUNT(DISTINCT s.studentId) FROM submissions s WHERE s.folderId = f.id AND s.status = 'current') AS studentCount,
    (SELECT COALESCE(SUM(sf.size),0) FROM submission_files sf JOIN submissions s ON s.id = sf.submissionId WHERE s.folderId = f.id) AS totalBytes
    FROM submission_folders f JOIN teachers t ON t.id = f.teacherId WHERE f.teacherId = ?`;
  const params: (string | number)[] = [g.teacher.id];
  if (status && ['active', 'closed', 'archived'].includes(status)) {
    sql += ' AND f.status = ?';
    params.push(status);
  }
  sql += ' ORDER BY f.createdAt DESC';
  const folders = db.prepare(sql).all(...params) as unknown as Record<string, unknown>[];
  // Attach class names
  for (const f of folders) {
    try {
      (f as Record<string, unknown>).classes = db.prepare(
        'SELECT c.id, c.name FROM folder_classes fc JOIN classes c ON c.id = fc.classId WHERE fc.folderId = ?'
      ).all((f as { id: string }).id);
    } catch {
      (f as Record<string, unknown>).classes = [];
    }
  }
  return json({ folders });
}

export async function POST(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const name = String(body.name || '').trim().slice(0, 120);
  if (name.length < 2) return err('Folder name is required (min 2 characters).', 400);
  const description = String(body.description || '').slice(0, 2000);
  const classIds = Array.isArray(body.classIds) ? (body.classIds as unknown[]).map(String) : [];
  const assigned = getTeacherClasses(g.teacher.id);
  if (classIds.length === 0) return err('Select at least one class.', 400);
  for (const c of classIds) {
    if (!assigned.includes(c)) return err('You can only create folders for your assigned classes.', 403);
  }
  // Validate class existence
  const db = await dbReady();
  for (const c of classIds) {
    const cls = db.prepare('SELECT id FROM classes WHERE id = ? AND enabled = 1').get(c) as unknown as { id: string } | undefined;
    if (!cls) return err('Selected class is invalid.', 400);
  }
  let deadline: string | null = null;
  if (body.deadline) {
    const d = new Date(String(body.deadline));
    if (isNaN(d.getTime())) return err('Invalid deadline.', 400);
    deadline = d.toISOString();
  }
  const maxFileSizeMB = Math.max(1, Math.min(2048, Math.floor(Number(body.maxFileSizeMB) || 50)));
  const maxFiles = Math.max(1, Math.min(20, Math.floor(Number(body.maxFiles) || 5)));
  const maxTotalSizeMB = Math.max(10, Math.min(10240, Math.floor(Number(body.maxTotalSizeMB) || 500)));
  const allowedExtensions = String(body.allowedExtensions || '').split(',').map((s) => s.trim().toLowerCase().replace(/^\./, '')).filter(Boolean).slice(0, 40).join(',');
  const allowMultiple = body.allowMultiple === false || body.allowMultiple === 0 ? 0 : 1;
  const allowReplace = body.allowReplace === false || body.allowReplace === 0 ? 0 : 1;
  const allowDeleteOwn = body.allowDeleteOwn === true || body.allowDeleteOwn === 1 ? 1 : 0;
  const lateMode = VALID_LATE.has(String(body.lateMode)) ? String(body.lateMode) : 'marked';
  const allowLate = body.allowLate === false || body.allowLate === 0 || lateMode === 'blocked' ? 0 : 1;
  const requireMessage = body.requireMessage === true || body.requireMessage === 1 ? 1 : 0;

  const id = newId();
  const now = nowISO();
  db.prepare(
    `INSERT INTO submission_folders(id, teacherId, name, description, status, deadline, maxFileSizeMB, maxFiles, maxTotalSizeMB, allowedExtensions, allowMultiple, allowReplace, allowDeleteOwn, allowLate, lateMode, requireMessage, createdAt, updatedAt)
     VALUES (?, ?, ?, ?, 'active', ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`
  ).run(id, g.teacher.id, name, description, deadline, maxFileSizeMB, maxFiles, maxTotalSizeMB, allowedExtensions, allowMultiple, allowReplace, allowDeleteOwn, allowLate, lateMode, requireMessage, now, now);
  const ins = db.prepare('INSERT OR IGNORE INTO folder_classes(folderId, classId) VALUES (?, ?)');
  for (const c of classIds) ins.run(id, c);
  audit('Teacher Created Folder', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `folder=${name} id=${id}`, ip: clientIp(req) });
  return json({ ok: true, id }, 201);
}
