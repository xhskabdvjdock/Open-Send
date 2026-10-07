import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { chatAccess } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  if (!chatAccess().anyStudent) return err('Chat is disabled.', 403);
  const db = await dbReady();
  db.prepare('DELETE FROM chat_blocks WHERE blockerId = ? AND blockedId = ?').run(sess.user.id, params.id);
  return json({ ok: true });
}
