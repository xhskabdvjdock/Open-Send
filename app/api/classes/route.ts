import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Public enabled class list (needed for registration + filters). No private data.
export async function GET() {
  const db = await dbReady();
  const rows = db
    .prepare(
      `SELECT c.id, c.name, (SELECT COUNT(*) FROM users u WHERE u.classId = c.id AND u.enabled = 1) AS studentCount
       FROM classes c WHERE c.enabled = 1 ORDER BY c.name COLLATE NOCASE`
    )
    .all() as unknown as { id: string; name: string; studentCount: number }[];
  return json({ classes: rows });
}
