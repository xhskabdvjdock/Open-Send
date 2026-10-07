import { dbReady } from '@/lib/db';
import { json } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { chatStreamCount } from '@/lib/chatBus';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const now = new Date().toISOString();
  const dayAgo = new Date(Date.now() - 24 * 3600_000).toISOString();
  const weekAgo = new Date(Date.now() - 7 * 24 * 3600_000).toISOString();
  const c = (sql: string, ...p: (string | number)[]) => (db.prepare(sql).get(...p) as unknown as { c: number }).c;
  try {
    db.prepare('UPDATE chat_suspensions SET active = 0 WHERE active = 1 AND endsAt <= ?').run(now);
  } catch {}
  return json({
    stats: {
      chatUsers: c("SELECT COUNT(DISTINCT senderId) AS c FROM chat_messages WHERE moderationStatus = 'VISIBLE' AND senderId IN (SELECT id FROM users)"),
      activeConversations: c("SELECT COUNT(DISTINCT conversationId) AS c FROM chat_messages WHERE moderationStatus = 'VISIBLE' AND createdAt > ?", weekAgo),
      messagesToday: c("SELECT COUNT(*) AS c FROM chat_messages WHERE moderationStatus = 'VISIBLE' AND createdAt > ?", dayAgo),
      messagesWeek: c("SELECT COUNT(*) AS c FROM chat_messages WHERE moderationStatus = 'VISIBLE' AND createdAt > ?", weekAgo),
      violationsTotal: c('SELECT COUNT(*) AS c FROM chat_moderation_events'),
      violationsToday: c('SELECT COUNT(*) AS c FROM chat_moderation_events WHERE createdAt > ?', dayAgo),
      activeSuspensions: c('SELECT COUNT(*) AS c FROM chat_suspensions WHERE active = 1 AND endsAt > ?', now),
      bannedWords: c('SELECT COUNT(*) AS c FROM chat_banned_words'),
      bannedWordsActive: c('SELECT COUNT(*) AS c FROM chat_banned_words WHERE enabled = 1'),
      openStreams: chatStreamCount(),
    },
  });
}
