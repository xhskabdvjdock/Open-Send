import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';
import { isParticipant, markConversationRead, unreadTotalFor, unhideConversation } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const s = getSettings();
  if (!s.chatEnabled || !s.chatTeacherChat) return err('Chat is disabled.', 403);
  if (!(await isParticipant(params.id, g.teacher.id))) return err('Conversation not found.', 404);
  await unhideConversation(params.id, g.teacher.id);
  await markConversationRead(params.id, g.teacher.id);
  return json({ ok: true, unreadTotal: await unreadTotalFor(g.teacher.id) });
}
