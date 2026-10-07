import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { nowISO } from '@/lib/crypto';
import { audit } from '@/lib/server-utils';
import { CHAT_MAX_SUSPENSION_MINUTES as MAX_SUSPENSION_MINUTES } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MATCH_TYPES = new Set(['whole', 'contains', 'phrase']);

export async function PATCH(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const db = await dbReady();
  const cur = db.prepare('SELECT * FROM chat_banned_words WHERE id = ?').get(params.id) as unknown as {
    id: string; word: string; matchType: string; suspensionMinutes: number; enabled: number;
  } | undefined;
  if (!cur) return err('Word not found.', 404);
  const updates: string[] = [];
  const vals: (string | number)[] = [];
  const prev: string[] = [];
  if (body.word !== undefined) {
    const w = String(body.word).trim().slice(0, 60);
    if (!w) return err('Word is required.', 400);
    const dup = db.prepare('SELECT id FROM chat_banned_words WHERE lower(word) = lower(?) AND id != ?').get(w, params.id) as unknown as { id: string } | undefined;
    if (dup) return err('This word already exists.', 409);
    updates.push('word = ?');
    vals.push(w);
    prev.push(`word: ${cur.word} -> ${w}`);
  }
  if (body.matchType !== undefined) {
    const mt = String(body.matchType);
    if (!MATCH_TYPES.has(mt)) return err('Invalid match type.', 400);
    updates.push('matchType = ?');
    vals.push(mt);
    prev.push(`type: ${cur.matchType} -> ${mt}`);
  }
  if (body.suspensionMinutes !== undefined) {
    const m = Math.floor(Number(body.suspensionMinutes));
    if (!Number.isFinite(m) || m < 1 || m > MAX_SUSPENSION_MINUTES) {
      return err(`Suspension must be 1-${MAX_SUSPENSION_MINUTES} minutes.`, 400);
    }
    updates.push('suspensionMinutes = ?');
    vals.push(m);
    prev.push(`minutes: ${cur.suspensionMinutes} -> ${m}`);
  }
  if (body.enabled !== undefined) {
    const e = body.enabled ? 1 : 0;
    updates.push('enabled = ?');
    vals.push(e);
    prev.push(`enabled: ${cur.enabled} -> ${e}`);
  }
  if (updates.length === 0) return err('Nothing to update.', 400);
  updates.push('updatedAt = ?');
  vals.push(nowISO());
  db.prepare(`UPDATE chat_banned_words SET ${updates.join(', ')} WHERE id = ?`).run(...vals, params.id);
  audit('Admin Chat Word Edited', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: prev.join(' | ').slice(0, 500), ip: clientIp(req) });
  return json({ ok: true });
}

// Hard-deletes the RULE only; past moderation events keep ruleId + matched
// word, so history is preserved.
export async function DELETE(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const db = await dbReady();
  const cur = db.prepare('SELECT * FROM chat_banned_words WHERE id = ?').get(params.id) as unknown as { id: string; word: string } | undefined;
  if (!cur) return err('Word not found.', 404);
  db.prepare('DELETE FROM chat_banned_words WHERE id = ?').run(params.id);
  audit('Admin Chat Word Deleted', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `word=${cur.word}`, ip: clientIp(req) });
  return json({ ok: true });
}
