import fs from 'node:fs';
import { dbReady } from '@/lib/db';
import { err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { findSubmissionFile } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const f = db.prepare('SELECT * FROM submission_files WHERE id = ?').get(params.fileId) as unknown as {
    id: string; submissionId: string; storedFile: string; originalName: string; mime: string;
  } | undefined;
  if (!f) return err('File not found.', 404);
  const disk = findSubmissionFile(f.storedFile);
  if (!disk) return err('File not found on server.', 404);
  const stat = fs.statSync(disk);
  audit('Admin Downloaded Submission File', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `file=${f.originalName}`, ip: clientIp(req) });
  const stream = fs.createReadStream(disk);
  const ascii = f.originalName.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': f.mime || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${ascii}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
