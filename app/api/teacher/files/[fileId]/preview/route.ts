import fs from 'node:fs';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { audit } from '@/lib/server-utils';
import { findSubmissionFile } from '@/lib/paths';
import { extOf } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PREVIEWABLE_TEXT = new Set(['txt', 'md', 'csv', 'json', 'log', 'xml', 'html', 'css', 'js', 'ts', 'py', 'java', 'c', 'cpp']);
const PREVIEWABLE_IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);

// Safe preview: PDF / images / text are served inline. Office docs return metadata
// (client shows metadata + download). Never executes anything.
export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const f = db.prepare('SELECT * FROM submission_files WHERE id = ?').get(params.fileId) as unknown as {
    id: string; submissionId: string; storedFile: string; originalName: string; mime: string; size: number;
  } | undefined;
  if (!f) return err('File not found.', 404);
  const s = db.prepare('SELECT * FROM submissions WHERE id = ?').get(f.submissionId) as unknown as { folderId: string; studentId: string } | undefined;
  if (!s) return err('File not found.', 404);
  const folder = db.prepare('SELECT teacherId FROM submission_folders WHERE id = ?').get(s.folderId) as unknown as { teacherId: string } | undefined;
  if (!folder || folder.teacherId !== g.teacher.id) return err('You are not authorized.', 403);
  const disk = findSubmissionFile(f.storedFile);
  if (!disk) return err('File not found on server.', 404);
  audit('Teacher Previewed File', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `file=${f.originalName}`, ip: clientIp(req) });

  const ext = extOf(f.originalName);
  const url = new URL(req.url);
  const wantMeta = url.searchParams.get('meta') === '1';

  if (wantMeta) {
    return json({ file: { id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, ext, preview: previewKind(ext, f.mime) } });
  }

  const kind = previewKind(ext, f.mime);
  if (kind === 'pdf' || kind === 'image') {
    const stat = fs.statSync(disk);
    const stream = fs.createReadStream(disk);
    const ct = kind === 'pdf' ? 'application/pdf' : f.mime;
    return new Response(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': ct,
        'Content-Length': String(stat.size),
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': "sandbox",
      },
    });
  }
  if (kind === 'text') {
    if (f.size > 512 * 1024) {
      return json({ file: { id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, ext }, preview: 'too-large' });
    }
    try {
      const text = fs.readFileSync(disk, 'utf8').slice(0, 20000);
      return json({ file: { id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, ext }, preview: 'text', text });
    } catch {
      return err('File not found on server.', 404);
    }
  }
  // Office + others: metadata only
  return json({ file: { id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, ext }, preview: kind });
}

function previewKind(ext: string, mime: string): string {
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (PREVIEWABLE_IMAGE.has(ext) || mime.startsWith('image/')) return 'image';
  if (PREVIEWABLE_TEXT.has(ext) || mime.startsWith('text/')) return 'text';
  if (['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt'].includes(ext)) return 'office';
  return 'none';
}
