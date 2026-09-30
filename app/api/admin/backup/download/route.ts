import fs from 'node:fs';
import path from 'node:path';
import { err } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { backupsDir } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const file = (new URL(req.url).searchParams.get('file') || '').trim();
  if (!/^[a-zA-Z0-9._-]{1,120}$/.test(file)) return err('Invalid file.', 400);
  const p = path.join(backupsDir(), file);
  if (!fs.existsSync(p)) return err('Not found.', 404);
  const stat = fs.statSync(p);
  const stream = fs.createReadStream(p);
  return new Response(stream as unknown as BodyInit, {
    headers: {
      'Content-Type': 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${file}"`,
    },
  });
}
