import fs from 'node:fs';
import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { err } from '@/lib/api';
import { findSubmissionFile } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Student downloads their OWN submitted file only.
export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const db = await dbReady();
  const f = db.prepare('SELECT * FROM submission_files WHERE id = ?').get(params.fileId) as unknown as {
    id: string; submissionId: string; storedFile: string; originalName: string; mime: string;
  } | undefined;
  if (!f) return err('File not found.', 404);
  const s = db.prepare('SELECT studentId FROM submissions WHERE id = ?').get(f.submissionId) as unknown as { studentId: string } | undefined;
  if (!s || s.studentId !== sess.user.id) return err('You are not authorized.', 403);
  const disk = findSubmissionFile(f.storedFile);
  if (!disk) return err('File not found on server.', 404);
  const stat = fs.statSync(disk);
  const stream = fs.createReadStream(disk);
  const ascii = f.originalName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(f.originalName).replace(/'/g, '%27');
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': f.mime || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
