import fs from 'node:fs';
import path from 'node:path';
import { getDb, type TransferRow } from './db';
import { getSettings } from './settings';
import { storageSubdir } from './paths';
import { nowISO } from './crypto';
import { notify } from './server-utils';

export const TRANSFER_STATUSES = ['PENDING', 'ACCEPTED', 'DECLINED', 'EXPIRED', 'DOWNLOADED', 'CANCELLED'] as const;

export function computeExpiryIso(): string | null {
  const s = getSettings();
  if (s.defaultExpiryHours <= 0) return null;
  return new Date(Date.now() + s.defaultExpiryHours * 3600 * 1000).toISOString();
}

export function isTransferExpired(t: TransferRow): boolean {
  if (t.status === 'EXPIRED') return true;
  if (t.expiresAt && new Date(t.expiresAt).getTime() <= Date.now()) return true;
  return false;
}

export function canSendTo(senderClassId: string | null, recipientClassId: string | null): { ok: boolean; reason?: string } {
  const s = getSettings();
  if (s.sendScope === 'anyone') return { ok: true };
  if (s.sendScope === 'same-class') {
    if (senderClassId && recipientClassId && senderClassId === recipientClassId) return { ok: true };
    return { ok: false, reason: 'Sending is restricted to your own class.' };
  }
  // selected
  if (!senderClassId) return { ok: false, reason: 'Your class is not configured for sending.' };
  const allowed = s.classRestrictions[senderClassId];
  if (!allowed) return { ok: false, reason: 'Your class is not allowed to send files.' };
  if (recipientClassId && allowed.includes(recipientClassId)) return { ok: true };
  return { ok: false, reason: 'Sending to this class is not allowed.' };
}

/** Move physical files between storage buckets. */
export function moveTransferFiles(transferId: string, from: 'pending' | 'accepted' | 'completed' | 'rejected', to: 'pending' | 'accepted' | 'completed' | 'rejected'): void {
  try {
    const db = getDb();
    const files = db.prepare('SELECT storedFile FROM transfer_files WHERE transferId = ?').all(transferId) as unknown as { storedFile: string }[];
    for (const f of files) {
      const src = path.join(storageSubdir(from), f.storedFile);
      const dst = path.join(storageSubdir(to), f.storedFile);
      if (fs.existsSync(src) && !fs.existsSync(dst)) {
        try {
          fs.renameSync(src, dst);
        } catch {
          try {
            fs.copyFileSync(src, dst);
            fs.unlinkSync(src);
          } catch {}
        }
      }
    }
  } catch {}
}

export function deleteTransferFiles(transferId: string): void {
  try {
    const db = getDb();
    const files = db.prepare('SELECT storedFile FROM transfer_files WHERE transferId = ?').all(transferId) as unknown as { storedFile: string }[];
    for (const f of files) {
      for (const k of ['pending', 'accepted', 'completed', 'rejected', 'tmp'] as const) {
        try {
          const p = path.join(storageSubdir(k), f.storedFile);
          if (fs.existsSync(p)) fs.unlinkSync(p);
        } catch {}
      }
    }
  } catch {}
}

/** Expire overdue PENDING transfers. Returns count expired. */
export function runExpirySweep(): number {
  const db = getDb();
  const now = nowISO();
  let count = 0;
  try {
    const overdue = db
      .prepare("SELECT * FROM transfers WHERE status = 'PENDING' AND expiresAt IS NOT NULL AND expiresAt <= ?")
      .all(now) as unknown as TransferRow[];
    const upd = db.prepare("UPDATE transfers SET status = 'EXPIRED', updatedAt = ? WHERE id = ?");
    for (const t of overdue) {
      upd.run(now, t.id);
      moveTransferFiles(t.id, 'pending', 'rejected');
      notify(t.senderId, 'expired', 'Your file expired.', '', t.id);
      notify(t.recipientId, 'expired', 'A file sent to you expired.', '', t.id);
      count++;
    }
  } catch {}
  return count;
}

/** Delete physical files of old terminal transfers per retention settings. Returns files removed. */
export function runCleanupSweep(): { filesRemoved: number; transfersTouched: number } {
  const s = getSettings();
  const db = getDb();
  let filesRemoved = 0;
  let transfersTouched = 0;
  const jobs: { status: string; days: number }[] = [
    { status: 'DECLINED', days: s.retentionDeclinedDays },
    { status: 'CANCELLED', days: s.retentionCancelledDays },
    { status: 'EXPIRED', days: s.retentionExpiredDays },
    { status: 'DOWNLOADED', days: s.retentionCompletedDays },
    { status: 'ACCEPTED', days: s.retentionCompletedDays },
  ];
  try {
    for (const j of jobs) {
      if (j.days < 0) continue;
      const cutoff = new Date(Date.now() - j.days * 86400 * 1000).toISOString();
      const rows = db
        .prepare('SELECT id FROM transfers WHERE status = ? AND updatedAt <= ?')
        .all(j.status, cutoff) as unknown as { id: string }[];
      for (const r of rows) {
        const files = db.prepare('SELECT storedFile FROM transfer_files WHERE transferId = ?').all(r.id) as unknown as { storedFile: string }[];
        let removedAny = false;
        for (const f of files) {
          for (const k of ['pending', 'accepted', 'completed', 'rejected'] as const) {
            try {
              const p = path.join(storageSubdir(k), f.storedFile);
              if (fs.existsSync(p)) {
                fs.unlinkSync(p);
                filesRemoved++;
                removedAny = true;
              }
            } catch {}
          }
        }
        if (removedAny) transfersTouched++;
      }
    }
    // Auto-delete expired physical files immediately when enabled and past expiry
    if (s.autoDeleteExpired) runExpirySweep();
  } catch {}
  return { filesRemoved, transfersTouched };
}
