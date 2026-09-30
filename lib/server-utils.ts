import { getDb } from './db';
import { nowISO, newId } from './crypto';

export function audit(action: string, opts: {
  actorType?: string;
  actorId?: string;
  actorName?: string;
  details?: string;
  ip?: string;
}): void {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO audit_logs(actorType, actorId, actorName, action, details, ip, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?)'
    ).run(
      opts.actorType || 'student',
      opts.actorId || '',
      (opts.actorName || '').slice(0, 120),
      action,
      (opts.details || '').slice(0, 2000),
      (opts.ip || '').slice(0, 80),
      nowISO()
    );
  } catch {}
}

export function notify(userId: string, kind: string, title: string, body = '', transferId: string | null = null): void {
  try {
    const db = getDb();
    db.prepare(
      'INSERT INTO notifications(id, userId, kind, title, body, transferId, isRead, createdAt) VALUES (?, ?, ?, ?, ?, ?, 0, ?)'
    ).run(newId(), userId, kind, title.slice(0, 160), body.slice(0, 500), transferId, nowISO());
  } catch {}
}
