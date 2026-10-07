import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { json, err } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { getActiveSuspension, suspensionStatus, unreadTotalFor, chatAccess } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Lightweight client state: feature flags, suspension banner data, unread badge.
// Does NOT touch presence (called periodically by every page).
export async function GET(req: Request) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const s = getSettings();
  const acc = chatAccess();
  const enabled = acc.anyStudent;
  const susp = suspensionStatus(await getActiveSuspension(sess.user.id));
  return json({
    userId: sess.user.id,
    enabled,
    studentChat: acc.student,
    teacherChat: acc.teacher,
    moderation: s.chatModeration,
    maxLength: s.chatMaxLength,
    attachments: s.chatAttachments,
    maxAttachmentMB: s.chatMaxAttachmentMB,
    showOnline: s.chatShowOnline,
    showLastSeen: s.chatShowLastSeen,
    browserNotify: s.chatBrowserNotify,
    suspension: susp,
    unreadTotal: enabled ? await unreadTotalFor(sess.user.id) : 0,
  });
}
