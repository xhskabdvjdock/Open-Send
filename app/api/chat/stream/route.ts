import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady } from '@/lib/db';
import { err } from '@/lib/api';
import { touchPresence, chatAccess } from '@/lib/chat';
import { chatCreateStream } from '@/lib/chatBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Real-time delivery over Server-Sent Events (same origin: works on
// btec-send.local with the existing session cookie, no extra ports/CORS).
// Suspended students may still connect (reading is allowed); sending is
// blocked by the POST route on every attempt.
export async function GET(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  if (!chatAccess().anyStudent) return err('Chat is disabled.', 403);
  const db = await dbReady();
  await touchPresence(db, sess.user.id);
  const { stream } = chatCreateStream(sess.user.id);
  return new Response(stream, {
    status: 200,
    headers: {
      'Content-Type': 'text/event-stream',
      'Cache-Control': 'no-cache, no-transform',
      Connection: 'keep-alive',
      'X-Accel-Buffering': 'no',
    },
  });
}
