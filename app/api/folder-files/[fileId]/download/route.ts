import fs from 'node:fs';
import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady, type FolderAttachmentRow } from '@/lib/db';
import { err } from '@/lib/api';
import { getSubmissionFolder } from '@/lib/folders';
import { findFolderFile } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// Students download teacher-attached materials (same visibility rules as the folder itself).
export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const db = await dbReady();
  const f = db.prepare('SELECT * FROM folder_attachments WHERE id = ?').get(params.fileId) as unknown as FolderAttachmentRow | undefined;
  if (!f) return err('File not found.', 404);
  const folder = getSubmissionFolder(f.folderId);
  if (!folder || folder.status === 'archived') return err('File not found.', 404);
  if (!sess.user.classId || !folder.classIds.includes(sess.user.classId)) return err('You are not authorized.', 403);
  const disk = findFolderFile(f.storedFile);
  if (!disk) return err('File not found on server.', 404);
  const stat = fs.statSync(disk);
  const inline = (f.mime || '').toLowerCase() === 'application/pdf';
  const stream = fs.createReadStream(disk);
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': f.mime || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': inline ? 'inline' : contentDisposition(f.originalName),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
