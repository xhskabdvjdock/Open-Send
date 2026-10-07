import fs from 'node:fs';
import { writeFile } from 'node:fs/promises';
import path from 'node:path';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';
import { audit } from '@/lib/server-utils';
import { newId } from '@/lib/crypto';
import { sanitizeOriginalName, extOf, isAvatarFile } from '@/lib/validation';
import { storageSubdir } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const s = getSettings();
  if (!s.allowAvatarUpload) return err('Uploading profile pictures is disabled by the administrator.', 403);
  let form: FormData;
  try {
    form = await req.formData();
  } catch {
    return err('Invalid upload.', 400);
  }
  const f = form.get('file');
  const file = f instanceof File ? f : null;
  if (!file) return err('At least one file is required.', 400);
  const safeName = sanitizeOriginalName(file.name || 'avatar');
  const ext = extOf(safeName);
  const mime = (file.type || '').toLowerCase();
  if (!isAvatarFile(mime, ext)) {
    return err('Only JPG, PNG, GIF or WebP images are allowed.', 400);
  }
  if (!file.size || file.size <= 0) return err('The file is empty.', 400);
  const maxBytes = s.maxAvatarMB * 1024 * 1024;
  if (file.size > maxBytes) return err(`Profile picture must be at most ${s.maxAvatarMB} MB.`, 413);
  const buf = Buffer.from(await file.arrayBuffer());
  if (buf.length === 0) return err('The file is empty.', 400);
  const db = await dbReady();
  const cur = db.prepare('SELECT avatarFile FROM teachers WHERE id = ?').get(g.teacher.id) as unknown as { avatarFile: string } | undefined;
  const storedFile = newId();
  try {
    fs.mkdirSync(storageSubdir('avatars'), { recursive: true });
    await writeFile(path.join(storageSubdir('avatars'), storedFile), buf);
    db.prepare('UPDATE teachers SET avatarFile = ? WHERE id = ?').run(storedFile, g.teacher.id);
  } catch {
    try {
      fs.unlinkSync(path.join(storageSubdir('avatars'), storedFile));
    } catch {}
    return err('Upload failed. Please try again.', 500);
  }
  if (cur?.avatarFile) {
    try {
      fs.unlinkSync(path.join(storageSubdir('avatars'), cur.avatarFile));
    } catch {}
  }
  audit('Teacher Avatar Updated', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, ip: clientIp(req) });
  return json({ ok: true, hasAvatar: true }, 201);
}
