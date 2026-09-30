import { json } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { runExpirySweep, runCleanupSweep } from '@/lib/transfers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const expired = runExpirySweep();
  const cleanup = runCleanupSweep();
  return json({ ok: true, expired, ...cleanup });
}
