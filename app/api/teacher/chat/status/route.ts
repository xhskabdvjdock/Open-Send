import { json, err } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { getSettings } from '@/lib/settings';
import { unreadTotalFor } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  const s = getSettings();
  const enabled = s.chatEnabled && s.chatTeacherChat;
  return json({
    userId: g.teacher.id,
    isTeacher: true,
    enabled,
    maxLength: s.chatMaxLength,
    showOnline: s.chatShowOnline,
    showLastSeen: s.chatShowLastSeen,
    unreadTotal: enabled ? await unreadTotalFor(g.teacher.id) : 0,
  });
}
