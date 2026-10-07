import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { newId, nowISO } from '@/lib/crypto';
import { audit } from '@/lib/server-utils';
import { chatPush } from '@/lib/chatBus';
import { CHAT_MAX_SUSPENSION_MINUTES as MAX_SUSPENSION_MINUTES } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// GET ?active=1 → active suspensions with student info.
// GET ?userId=X → that student: profile, active suspension, recent history.
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const userId = (url.searchParams.get('userId') || '').trim();
  const activeOnly = (url.searchParams.get('active') || '1') === '1';
  const db = await dbReady();
  const now = nowISO();
  try {
    db.prepare('UPDATE chat_suspensions SET active = 0 WHERE active = 1 AND endsAt <= ?').run(now);
  } catch {}
  if (userId) {
    const u = db.prepare(
      'SELECT u.id, u.username, u.displayName, c.name AS className FROM users u LEFT JOIN classes c ON c.id = u.classId WHERE u.id = ?'
    ).get(userId) as unknown as Record<string, unknown> | undefined;
    if (!u) return err('Student not found.', 404);
    const active = db.prepare('SELECT * FROM chat_suspensions WHERE userId = ? AND active = 1 AND endsAt > ? ORDER BY endsAt DESC LIMIT 1').get(userId, now);
    const history = db.prepare('SELECT * FROM chat_suspensions WHERE userId = ? ORDER BY createdAt DESC LIMIT 20').all(userId);
    return json({ student: u, active: active || null, history });
  }
  const rows = db.prepare(
    `SELECT s.*, u.username AS username, u.displayName AS displayName
     FROM chat_suspensions s JOIN users u ON u.id = s.userId
     ${activeOnly ? 'WHERE s.active = 1 AND s.endsAt > ?' : ''}
     ORDER BY s.endsAt DESC LIMIT 200`
  ).all(...(activeOnly ? [now] : []));
  return json({ suspensions: rows });
}

// Manual suspension by admin (reason is admin-authored; also pushed live so
// an online student loses sending ability immediately).
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const userId = String(body.userId || '').trim();
  if (!userId) return err('Student is required.', 400);
  const minutes = Math.floor(Number(body.minutes ?? 10));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_SUSPENSION_MINUTES) {
    return err(`Suspension must be 1-${MAX_SUSPENSION_MINUTES} minutes.`, 400);
  }
  const reason = String(body.reason || 'manual-suspend').slice(0, 200) || 'manual-suspend';
  const db = await dbReady();
  const u = db.prepare('SELECT id, username FROM users WHERE id = ?').get(userId) as unknown as { id: string; username: string } | undefined;
  if (!u) return err('Student not found.', 404);
  const now = nowISO();
  const endsAt = new Date(Date.now() + minutes * 60_000).toISOString();
  const id = newId();
  db.prepare(
    'INSERT INTO chat_suspensions(id, userId, startsAt, endsAt, reason, ruleId, active, createdBy, createdAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)'
  ).run(id, userId, now, endsAt, reason, '', `admin:${g.admin.username}`, now);
  db.prepare(
    "INSERT INTO chat_moderation_events(userId, conversationId, ruleId, matchedWord, action, suspensionId, details, createdAt) VALUES (?, '', '', '', 'manual-suspend', ?, ?, ?)"
  ).run(userId, id, `${minutes}m by ${g.admin.username}`, now);
  chatPush([userId], 'suspended', { until: endsAt, remainingMs: minutes * 60_000, reason });
  audit('Admin Chat Suspended Student', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `student=${u.username} minutes=${minutes} reason=${reason}`, ip: clientIp(req) });
  return json({ ok: true, id, endsAt }, 201);
}
