import { json } from '@/lib/api';
import { getDb } from '@/lib/db';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET() {
  try {
    const db = getDb();
    db.prepare('SELECT 1').get();
    return json({ ok: true, status: 'Running', time: new Date().toISOString() });
  } catch {
    return json({ ok: false, status: 'Error' }, 500);
  }
}
