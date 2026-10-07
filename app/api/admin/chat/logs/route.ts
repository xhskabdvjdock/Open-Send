import { dbReady } from '@/lib/db';
import { json, err } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Moderation event log: who/when/conversation/rule/word/action — metadata
// only, never message contents. Filters: student, date, word/rule, action.
export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const student = (url.searchParams.get('student') || '').trim().slice(0, 60).toLowerCase();
  const date = (url.searchParams.get('date') || '').trim().slice(0, 10);
  const word = (url.searchParams.get('word') || '').trim().slice(0, 60).toLowerCase();
  const action = (url.searchParams.get('action') || '').trim().slice(0, 40);
  const limit = Math.max(1, Math.min(200, Number(url.searchParams.get('limit') || 100) || 100));
  const db = await dbReady();
  const clauses: string[] = [];
  const vals: (string | number)[] = [];
  if (student) {
    clauses.push("(lower(u.username) LIKE ? ESCAPE '\\' OR lower(u.displayName) LIKE ? ESCAPE '\\')");
    const like = `%${student.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    vals.push(like, like);
  }
  if (date && /^\d{4}-\d{2}-\d{2}$/.test(date)) {
    clauses.push('substr(e.createdAt, 1, 10) = ?');
    vals.push(date);
  }
  if (word) {
    clauses.push("(lower(e.matchedWord) LIKE ? ESCAPE '\\' OR lower(w.word) LIKE ? ESCAPE '\\')");
    const like = `%${word.replace(/[\\%_]/g, (c) => `\\${c}`)}%`;
    vals.push(like, like);
  }
  if (action) {
    clauses.push('e.action = ?');
    vals.push(action);
  }
  const rows = db.prepare(
    `SELECT e.*, u.username AS username, u.displayName AS displayName, w.word AS ruleWord
     FROM chat_moderation_events e
     LEFT JOIN users u ON u.id = e.userId
     LEFT JOIN chat_banned_words w ON w.id = e.ruleId
     ${clauses.length ? 'WHERE ' + clauses.join(' AND ') : ''}
     ORDER BY e.id DESC LIMIT ?`
  ).all(...vals, limit) as unknown as Record<string, unknown>[];
  const actions = db.prepare('SELECT DISTINCT action FROM chat_moderation_events ORDER BY action').all() as unknown as { action: string }[];
  return json({ logs: rows, actions: actions.map((a) => a.action) });
}
