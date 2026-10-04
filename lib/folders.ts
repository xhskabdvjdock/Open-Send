import { getDb, type SubmissionFolderRow } from './db';
import { getSettings } from './settings';

export type FolderStatus = 'active' | 'closed' | 'expired' | 'archived';

export function folderEffectiveStatus(f: SubmissionFolderRow): FolderStatus {
  if (f.status === 'archived') return 'archived';
  if (f.status === 'closed') return 'closed';
  if (f.deadline) {
    try {
      if (new Date(f.deadline).getTime() <= Date.now()) return 'expired';
    } catch {}
  }
  return 'active';
}

export function isFolderOpenForSubmit(f: SubmissionFolderRow): { ok: boolean; reason: string } {
  const eff = folderEffectiveStatus(f);
  if (eff === 'archived') return { ok: false, reason: 'This submission folder is archived.' };
  if (eff === 'closed') return { ok: false, reason: 'This submission folder is closed.' };
  if (eff === 'expired') {
    // Deadline passed: check late policy
    if (f.allowLate !== 1) return { ok: false, reason: 'Submission closed. The deadline has passed.' };
    return { ok: true, reason: 'late' };
  }
  return { ok: true, reason: 'ok' };
}

export function isLateNow(deadline: string | null): boolean {
  if (!deadline) return false;
  try {
    return new Date(deadline).getTime() <= Date.now();
  } catch {
    return false;
  }
}

export function getFolderClasses(folderId: string): string[] {
  const db = getDb();
  try {
    return (db.prepare('SELECT classId FROM folder_classes WHERE folderId = ?').all(folderId) as unknown as { classId: string }[]).map((r) => r.classId);
  } catch {
    return [];
  }
}

export function getTeacherClasses(teacherId: string): string[] {
  const db = getDb();
  try {
    return (db.prepare('SELECT classId FROM teacher_classes WHERE teacherId = ?').all(teacherId) as unknown as { classId: string }[]).map((r) => r.classId);
  } catch {
    return [];
  }
}

export function teacherOwnsFolder(teacherId: string, folderId: string): boolean {
  const db = getDb();
  const row = db.prepare('SELECT id FROM submission_folders WHERE id = ? AND teacherId = ?').get(folderId, teacherId) as unknown as { id: string } | undefined;
  return !!row;
}

export function getSubmissionFolder(id: string): (SubmissionFolderRow & { classIds: string[]; teacherName?: string; teacherUsername?: string }) | null {
  const db = getDb();
  const f = db.prepare('SELECT * FROM submission_folders WHERE id = ?').get(id) as unknown as SubmissionFolderRow | undefined;
  if (!f) return null;
  const classIds = getFolderClasses(id);
  let teacherName: string | undefined;
  let teacherUsername: string | undefined;
  try {
    const t = db.prepare('SELECT displayName, username FROM teachers WHERE id = ?').get(f.teacherId) as unknown as { displayName: string; username: string } | undefined;
    teacherName = t?.displayName;
    teacherUsername = t?.username;
  } catch {}
  return { ...f, classIds, teacherName, teacherUsername };
}

export function notifyTeacher(teacherId: string, title: string, body = '', folderId: string | null = null, submissionId: string | null = null): void {
  try {
    const db = getDb();
    const { newId, nowISO } = require('./crypto') as typeof import('./crypto');
    db.prepare(
      'INSERT INTO teacher_notifications(id, teacherId, kind, title, body, folderId, submissionId, isRead, createdAt) VALUES (?, ?, ?, ?, ?, ?, ?, 0, ?)'
    ).run(newId(), teacherId, 'submission', title.slice(0, 160), body.slice(0, 500), folderId, submissionId, nowISO());
  } catch {}
}

export function folderStorageBytes(folderId: string): number {
  try {
    const db = getDb();
    const r = db.prepare('SELECT COALESCE(SUM(sf.size),0) AS c FROM submission_files sf JOIN submissions s ON s.id = sf.submissionId WHERE s.folderId = ?').get(folderId) as unknown as { c: number };
    return r.c || 0;
  } catch {
    return 0;
  }
}

export function teacherStorageBytes(teacherId: string): number {
  try {
    const db = getDb();
    const r = db.prepare('SELECT COALESCE(SUM(sf.size),0) AS c FROM submission_files sf JOIN submissions s ON s.id = sf.submissionId JOIN submission_folders f ON f.id = s.folderId WHERE f.teacherId = ?').get(teacherId) as unknown as { c: number };
    return r.c || 0;
  } catch {
    return 0;
  }
}

export function cleanupOldZips(retentionMinutes: number): void {
  try {
    const { storageSubdir } = require('./paths') as typeof import('./paths');
    const fs = require('node:fs') as typeof import('node:fs');
    const path = require('node:path') as typeof import('node:path');
    const dir = storageSubdir('zips');
    const cutoff = Date.now() - retentionMinutes * 60 * 1000;
    let entries: string[] = [];
    try {
      entries = fs.readdirSync(dir);
    } catch {
      return;
    }
    for (const e of entries) {
      if (!e.endsWith('.zip')) continue;
      try {
        const p = path.join(dir, e);
        const st = fs.statSync(p);
        if (st.mtimeMs < cutoff) fs.unlinkSync(p);
      } catch {}
    }
  } catch {}
}

export function getTeacherSetting(key: string, fallback: string): string {
  try {
    const s = getSettings() as unknown as Record<string, unknown>;
    const v = s[key];
    if (v === undefined || v === null) return fallback;
    return String(v);
  } catch {
    return fallback;
  }
}
