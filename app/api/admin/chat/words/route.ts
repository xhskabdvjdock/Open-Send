import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { newId, nowISO } from '@/lib/crypto';
import { audit } from '@/lib/server-utils';
import { CHAT_MAX_SUSPENSION_MINUTES as MAX_SUSPENSION_MINUTES } from '@/lib/chat';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

const MATCH_TYPES = new Set(['whole', 'contains', 'phrase']);

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const q = (url.searchParams.get('q') || '').trim().slice(0, 60).toLowerCase();
  const enabled = url.searchParams.get('enabled') || '';
  const db = await dbReady();
  let sql = 'SELECT * FROM chat_banned_words';
  const clauses: string[] = [];
  const vals: (string | number)[] = [];
  if (q) {
    clauses.push("lower(word) LIKE ? ESCAPE '\\'");
    const like = `%${q.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    vals.push(like);
  }
  if (enabled === '1' || enabled === '0') {
    clauses.push('enabled = ?');
    vals.push(Number(enabled));
  }
  if (clauses.length) sql += ' WHERE ' + clauses.join(' AND ');
  sql += ' ORDER BY word COLLATE NOCASE';
  const words = db.prepare(sql).all(...vals);
  const counts = db.prepare('SELECT ruleId AS id, COUNT(*) AS c FROM chat_moderation_events GROUP BY ruleId').all() as unknown as { id: string; c: number }[];
  const hits = new Map(counts.map((r) => [r.id, r.c]));
  return json({
    words: (words as unknown as Record<string, unknown>[]).map((w) => ({ ...w, violations: hits.get(String(w.id)) || 0 })),
  });
}

export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const word = String(body.word || '').trim().slice(0, 60);
  if (!word) return err('Word is required.', 400);
  const matchType = String(body.matchType || 'whole');
  if (!MATCH_TYPES.has(matchType)) return err('Invalid match type.', 400);
  const minutes = Math.floor(Number(body.suspensionMinutes ?? 10));
  if (!Number.isFinite(minutes) || minutes < 1 || minutes > MAX_SUSPENSION_MINUTES) {
    return err(`Suspension must be 1-${MAX_SUSPENSION_MINUTES} minutes.`, 400);
  }
  const enabled = body.enabled === undefined ? 1 : body.enabled ? 1 : 0;
  const db = await dbReady();
  const dup = db.prepare('SELECT id FROM chat_banned_words WHERE lower(word) = lower(?)').get(word) as unknown as { id: string } | undefined;
  if (dup) return err('This word already exists.', 409);
  const now = nowISO();
  const id = newId();
  db.prepare('INSERT INTO chat_banned_words(id, word, matchType, suspensionMinutes, enabled, hitCount, createdAt, updatedAt) VALUES (?, ?, ?, ?, ?, 0, ?, ?)').run(
    id, word, matchType, minutes, enabled, now, now
  );
  audit('Admin Chat Word Added', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `word=${word} type=${matchType} minutes=${minutes}`, ip: clientIp(req) });
  return json({ ok: true, id }, 201);
}
