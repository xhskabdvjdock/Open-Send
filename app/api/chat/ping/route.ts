import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { touchPresence, chatAccess } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lightweight presence heartbeat (called ~1/min by open chat pages).
export async function POST(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  if (!chatAccess().anyStudent) return err('Chat is disabled.', 403);
  const db = await dbReady();
  await touchPresence(db, sess.user.id);
  return json({ ok: true });
}
