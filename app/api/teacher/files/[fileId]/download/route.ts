import fs from 'node:fs';
import { dbReady } from '@/lib/db';
import { err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { audit } from '@/lib/server-utils';
import { findSubmissionFile } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const f = db.prepare('SELECT * FROM submission_files WHERE id = ?').get(params.fileId) as unknown as {
    id: string; submissionId: string; storedFile: string; originalName: string; mime: string; size: number;
  } | undefined;
  if (!f) return err('File not found.', 404);
  const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(f.submissionId) as unknown as { folderId: string } | undefined;
  if (!s) return err('File not found.', 404);
  const folder = db.prepare('SELECT teacherId FROM submission_folders WHERE id = ?').get(s.folderId) as unknown as { teacherId: string } | undefined;
  if (!folder || folder.teacherId !== g.teacher.id) return err('You are not authorized.', 403);
  const disk = findSubmissionFile(f.storedFile);
  if (!disk) return err('File not found on server.', 404);
  const stat = fs.statSync(disk);
  audit('Teacher Downloaded File', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `file=${f.originalName}`, ip: clientIp(req) });
  const stream = fs.createReadStream(disk);
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': f.mime || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': contentDisposition(f.originalName),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
