import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { nowISO } from '@/lib/crypto';
import { audit } from '@/lib/server-utils';
import { chatPush } from '@/lib/chatBus';
import { CHAT_MAX_SUSPENSION_MINUTES as MAX_SUSPENSION_MINUTES } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// POST { action: 'unsuspend' } — lift immediately.
// POST { action: 'extend', extraMinutes } — extend from later of now/end.
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  const s = db.prepare(
    'SELECT s.*, u.username AS username FROM chat_suspensions s JOIN users u ON u.id = s.userId WHERE s.id = ?'
  ).get(params.id) as unknown as { id: string; userId: string; username: string; endsAt: string; active: number } | undefined;
  if (!s) return err('Suspension not found.', 404);
  const action = String(body.action || '');
  const now = nowISO();
  if (action === 'unsuspend') {
    db.prepare('UPDATE chat_suspensions SET active = 0 WHERE id = ?').run(params.id);
    db.prepare(
      "INSERT INTO chat_moderation_events(userId, conversationId, ruleId, matchedWord, action, suspensionId, details, createdAt) VALUES (?, '', '', '', 'unsuspended', ?, ?, ?)"
    ).run(s.userId, params.id, `by ${g.admin.username}`, now);
    chatPush([s.userId], 'unsuspended', {});
    audit('Admin Chat Unsuspended Student', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `student=${s.username}`, ip: clientIp(req) });
    return json({ ok: true });
  }
  if (action === 'extend') {
    const extra = Math.floor(Number(body.extraMinutes));
    if (!Number.isFinite(extra) || extra < 1 || extra > MAX_SUSPENSION_MINUTES) {
      return err(`Extension must be 1-${MAX_SUSPENSION_MINUTES} minutes.`, 400);
    }
    const base = Math.max(Date.now(), new Date(s.endsAt).getTime() || Date.now());
    const endsAt = new Date(base + extra * 60_000).toISOString();
    db.prepare('UPDATE chat_suspensions SET endsAt = ?, active = 1 WHERE id = ?').run(endsAt, params.id);
    db.prepare(
      "INSERT INTO chat_moderation_events(userId, conversationId, ruleId, matchedWord, action, suspensionId, details, createdAt) VALUES (?, '', '', '', 'extended', ?, ?, ?)"
    ).run(s.userId, params.id, `+${extra}m by ${g.admin.username}`, now);
    chatPush([s.userId], 'suspended', { until: endsAt, remainingMs: Math.max(0, new Date(endsAt).getTime() - Date.now()), reason: 'extended' });
    audit('Admin Chat Extended Suspension', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `student=${s.username} +${extra}m`, ip: clientIp(req) });
    return json({ ok: true, endsAt });
  }
  return err('Unknown action. Use unsuspend or extend.', 400);
}
