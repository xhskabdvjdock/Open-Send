import fs from 'node:fs';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { findSubmissionFile } from '@/lib/paths';
import { extOf } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const PREVIEWABLE_IMAGE = new Set(['png', 'jpg', 'jpeg', 'gif', 'webp', 'bmp', 'svg']);
const PREVIEWABLE_TEXT = new Set(['txt', 'md', 'csv', 'json', 'log', 'xml', 'html', 'css', 'js', 'ts', 'py', 'java', 'c', 'cpp']);

export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const f = db.prepare('SELECT * FROM submission_files WHERE id = ?').get(params.fileId) as unknown as {
    id: string; submissionId: string; storedFile: string; originalName: string; mime: string; size: number;
  } | undefined;
  if (!f) return err('File not found.', 404);
  const disk = findSubmissionFile(f.storedFile);
  if (!disk) return err('File not found on server.', 404);
  audit('Admin Previewed Submission File', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `file=${f.originalName}`, ip: clientIp(req) });
  const ext = extOf(f.originalName);
  const url = new URL(req.url);
  if (url.searchParams.get('meta') === '1') {
    return json({ file: { id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, ext, preview: kind(ext, f.mime) } });
  }
  const k = kind(ext, f.mime);
  if (k === 'pdf' || k === 'image') {
    const stat = fs.statSync(disk);
    const stream = fs.createReadStream(disk);
    return new Response(stream as unknown as BodyInit, {
      status: 200,
      headers: {
        'Content-Type': k === 'pdf' ? 'application/pdf' : f.mime,
        'Content-Length': String(stat.size),
        'Content-Disposition': 'inline',
        'X-Content-Type-Options': 'nosniff',
        'Cache-Control': 'private, no-store',
        'Content-Security-Policy': 'sandbox',
      },
    });
  }
  if (k === 'text') {
    if (f.size > 512 * 1024) return json({ file: { id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, ext }, preview: 'too-large' });
    try {
      const text = fs.readFileSync(disk, 'utf8').slice(0, 20000);
      return json({ file: { id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, ext }, preview: 'text', text });
    } catch {
      return err('File not found on server.', 404);
    }
  }
  return json({ file: { id: f.id, originalName: f.originalName, mime: f.mime, size: f.size, ext }, preview: k });
}

function kind(ext: string, mime: string): string {
  if (ext === 'pdf' || mime === 'application/pdf') return 'pdf';
  if (PREVIEWABLE_IMAGE.has(ext) || mime.startsWith('image/')) return 'image';
  if (PREVIEWABLE_TEXT.has(ext) || mime.startsWith('text/')) return 'text';
  if (['docx', 'xlsx', 'pptx', 'doc', 'xls', 'ppt'].includes(ext)) return 'office';
  return 'none';
}
