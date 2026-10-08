import fs from 'node:fs';
import path from 'node:path';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { teacherOwnsFolder } from '@/lib/folders';
import { audit } from '@/lib/server-utils';
import { storageSubdir } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: { id: string; fileId: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherOwnsFolder(g.teacher.id, params.id)) return err('Folder not found.', 404);
  const db = await dbReady();
  const f = db.prepare('SELECT * FROM folder_attachments WHERE id = ? AND folderId = ?').get(params.fileId, params.id) as unknown as { id: string; storedFile: string; originalName: string } | undefined;
  if (!f) return err('File not found.', 404);
  db.prepare('DELETE FROM folder_attachments WHERE id = ?').run(f.id);
  try {
    const p = path.join(storageSubdir('folders'), f.storedFile);
    if (fs.existsSync(p)) fs.unlinkSync(p);
  } catch {}
  audit('Teacher Deleted Folder File', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `folder=${params.id} file=${f.originalName}`, ip: clientIp(req) });
  return json({ ok: true });
}
