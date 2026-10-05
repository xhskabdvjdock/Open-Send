import { DatabaseSync } from 'node:sqlite';
import fs from 'node:fs';
import { dataDir, dbPath, ensureDirs } from './paths';
import { hashPassword, nowISO, newId } from './crypto';

export type Db = DatabaseSync;

type GlobalWithDb = typeof globalThis & { __opensendDb?: DatabaseSync };
const g = globalThis as GlobalWithDb;

const DEFAULT_CLASSES: string[] = [];

// Classes removed per owner request — deleted from seed and cleaned from existing DBs on boot.
const REMOVED_DEFAULT_CLASSES = [
  'Grade 10 - A',
  'Grade 10 - B',
  'Grade 10 - C',
  'Grade 11 - A',
  'Grade 11 - B',
  'Grade 11 - C',
  'Grade 12 - A',
  'Grade 12 - B',
];

export const TEACHER_SETTINGS_DEFAULTS: Record<string, string> = {
  allowTeacherDeleteFolders: 'true',
  zipRetentionMinutes: '60',
};

export const DEFAULT_SETTINGS: Record<string, string> = {
  appName: 'Open Send',
  appVersion: '1.1.0',
  registrationEnabled: 'true',
  maintenanceMode: 'false',
  allowClassChange: 'false',
  maxFileSizeMB: '50',
  maxFilesPerTransfer: '5',
  allowedExtensions: '',
  blockedExtensions: 'exe,bat,cmd,com,scr,msi,ps1,vbs,jar,apk,reg,dll,sys',
  defaultExpiryHours: '168', // 7 days; 0 = never
  allowMultipleDownloads: 'true',
  maxDownloads: '0', // 0 = unlimited
  sendScope: 'anyone', // anyone | same-class | selected
  classRestrictions: '{}', // JSON: { [senderClassId]: [allowedClassId,...] }
  retentionDeclinedDays: '7',
  retentionCancelledDays: '7',
  retentionExpiredDays: '3',
  retentionCompletedDays: '30',
  autoDeleteExpired: 'true',
  adminCanPreview: 'false',
  allowTeacherDeleteFolders: 'true',
  zipRetentionMinutes: '60',
};

function migrate(db: DatabaseSync): void {
  try {
    db.exec('PRAGMA journal_mode = WAL;');
  } catch {}
  try {
    db.exec('PRAGMA foreign_keys = ON;');
  } catch {}
  try {
    db.exec('PRAGMA synchronous = NORMAL;');
  } catch {}
  // Wait (instead of instantly failing) when many students write at once
  // (e.g. mass submissions before a deadline). Writers still serialize fast.
  try {
    db.exec('PRAGMA busy_timeout = 5000;');
  } catch {}
  db.exec(`
    CREATE TABLE IF NOT EXISTS classes (
      id TEXT PRIMARY KEY,
      name TEXT NOT NULL UNIQUE,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS users (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      usernameLower TEXT NOT NULL UNIQUE,
      displayName TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      classId TEXT REFERENCES classes(id) ON DELETE SET NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      lastLoginAt TEXT
    );
    CREATE TABLE IF NOT EXISTS admins (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      usernameLower TEXT NOT NULL UNIQUE,
      passwordHash TEXT NOT NULL,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS sessions (
      id TEXT PRIMARY KEY,
      tokenHash TEXT NOT NULL UNIQUE,
      userId TEXT REFERENCES users(id) ON DELETE CASCADE,
      adminId TEXT REFERENCES admins(id) ON DELETE CASCADE,
      expiresAt TEXT NOT NULL,
      createdAt TEXT NOT NULL,
      ip TEXT DEFAULT '',
      userAgent TEXT DEFAULT ''
    );
    CREATE TABLE IF NOT EXISTS transfers (
      id TEXT PRIMARY KEY,
      senderId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      recipientId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'PENDING',
      expiresAt TEXT,
      downloadCount INTEGER NOT NULL DEFAULT 0,
      firstDownloadAt TEXT,
      lastDownloadAt TEXT,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS transfer_files (
      id TEXT PRIMARY KEY,
      transferId TEXT NOT NULL REFERENCES transfers(id) ON DELETE CASCADE,
      storedFile TEXT NOT NULL,
      originalName TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS notifications (
      id TEXT PRIMARY KEY,
      userId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      transferId TEXT REFERENCES transfers(id) ON DELETE SET NULL,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS audit_logs (
      id INTEGER PRIMARY KEY AUTOINCREMENT,
      actorType TEXT NOT NULL DEFAULT 'student',
      actorId TEXT NOT NULL DEFAULT '',
      actorName TEXT NOT NULL DEFAULT '',
      action TEXT NOT NULL,
      details TEXT NOT NULL DEFAULT '',
      ip TEXT NOT NULL DEFAULT '',
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS system_settings (
      key TEXT PRIMARY KEY,
      value TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teachers (
      id TEXT PRIMARY KEY,
      username TEXT NOT NULL UNIQUE,
      usernameLower TEXT NOT NULL UNIQUE,
      displayName TEXT NOT NULL,
      passwordHash TEXT NOT NULL,
      enabled INTEGER NOT NULL DEFAULT 1,
      createdAt TEXT NOT NULL,
      lastLoginAt TEXT
    );
    CREATE TABLE IF NOT EXISTS teacher_classes (
      teacherId TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      classId TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      PRIMARY KEY (teacherId, classId)
    );
    CREATE TABLE IF NOT EXISTS submission_folders (
      id TEXT PRIMARY KEY,
      teacherId TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      name TEXT NOT NULL,
      description TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'active',
      deadline TEXT,
      maxFileSizeMB INTEGER NOT NULL DEFAULT 50,
      maxFiles INTEGER NOT NULL DEFAULT 5,
      maxTotalSizeMB INTEGER NOT NULL DEFAULT 500,
      allowedExtensions TEXT NOT NULL DEFAULT '',
      allowMultiple INTEGER NOT NULL DEFAULT 1,
      allowReplace INTEGER NOT NULL DEFAULT 1,
      allowDeleteOwn INTEGER NOT NULL DEFAULT 0,
      allowLate INTEGER NOT NULL DEFAULT 1,
      lateMode TEXT NOT NULL DEFAULT 'marked',
      requireMessage INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS folder_classes (
      folderId TEXT NOT NULL REFERENCES submission_folders(id) ON DELETE CASCADE,
      classId TEXT NOT NULL REFERENCES classes(id) ON DELETE CASCADE,
      PRIMARY KEY (folderId, classId)
    );
    CREATE TABLE IF NOT EXISTS submissions (
      id TEXT PRIMARY KEY,
      folderId TEXT NOT NULL REFERENCES submission_folders(id) ON DELETE CASCADE,
      studentId TEXT NOT NULL REFERENCES users(id) ON DELETE CASCADE,
      teacherId TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      classId TEXT REFERENCES classes(id) ON DELETE SET NULL,
      submissionNumber INTEGER NOT NULL DEFAULT 1,
      message TEXT NOT NULL DEFAULT '',
      status TEXT NOT NULL DEFAULT 'current',
      isLate INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL,
      updatedAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS submission_files (
      id TEXT PRIMARY KEY,
      submissionId TEXT NOT NULL REFERENCES submissions(id) ON DELETE CASCADE,
      storedFile TEXT NOT NULL,
      originalName TEXT NOT NULL,
      mime TEXT NOT NULL DEFAULT 'application/octet-stream',
      size INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE TABLE IF NOT EXISTS teacher_notifications (
      id TEXT PRIMARY KEY,
      teacherId TEXT NOT NULL REFERENCES teachers(id) ON DELETE CASCADE,
      kind TEXT NOT NULL DEFAULT 'info',
      title TEXT NOT NULL,
      body TEXT NOT NULL DEFAULT '',
      folderId TEXT REFERENCES submission_folders(id) ON DELETE SET NULL,
      submissionId TEXT REFERENCES submissions(id) ON DELETE SET NULL,
      isRead INTEGER NOT NULL DEFAULT 0,
      createdAt TEXT NOT NULL
    );
    CREATE INDEX IF NOT EXISTS idx_users_lower ON users(usernameLower);
    CREATE INDEX IF NOT EXISTS idx_users_class ON users(classId);
    CREATE INDEX IF NOT EXISTS idx_transfers_sender ON transfers(senderId);
    CREATE INDEX IF NOT EXISTS idx_transfers_recipient ON transfers(recipientId);
    CREATE INDEX IF NOT EXISTS idx_transfers_status ON transfers(status);
    CREATE INDEX IF NOT EXISTS idx_transfers_created ON transfers(createdAt);
    CREATE INDEX IF NOT EXISTS idx_notif_user ON notifications(userId, isRead, createdAt);
    CREATE INDEX IF NOT EXISTS idx_audit_action ON audit_logs(action, createdAt);
    CREATE INDEX IF NOT EXISTS idx_audit_actor ON audit_logs(actorId, createdAt);
    CREATE INDEX IF NOT EXISTS idx_sessions_token ON sessions(tokenHash);
    CREATE INDEX IF NOT EXISTS idx_sessions_exp ON sessions(expiresAt);
    CREATE INDEX IF NOT EXISTS idx_tfiles_transfer ON transfer_files(transferId);
    CREATE INDEX IF NOT EXISTS idx_teachers_lower ON teachers(usernameLower);
    CREATE INDEX IF NOT EXISTS idx_tclasses_teacher ON teacher_classes(teacherId);
    CREATE INDEX IF NOT EXISTS idx_tclasses_class ON teacher_classes(classId);
    CREATE INDEX IF NOT EXISTS idx_folders_teacher ON submission_folders(teacherId, status);
    CREATE INDEX IF NOT EXISTS idx_fclasses_folder ON folder_classes(folderId);
    CREATE INDEX IF NOT EXISTS idx_fclasses_class ON folder_classes(classId);
    CREATE INDEX IF NOT EXISTS idx_sub_folder ON submissions(folderId, studentId, status);
    CREATE INDEX IF NOT EXISTS idx_sub_student ON submissions(studentId);
    CREATE INDEX IF NOT EXISTS idx_sub_teacher ON submissions(teacherId);
    CREATE INDEX IF NOT EXISTS idx_sfiles_sub ON submission_files(submissionId);
    CREATE INDEX IF NOT EXISTS idx_tnotif_teacher ON teacher_notifications(teacherId, isRead, createdAt);
    -- sessions.teacherId for teacher auth (added if missing)
  `);
  try {
    const cols = db.prepare("PRAGMA table_info(sessions)").all() as unknown as { name: string }[];
    if (!cols.some((c) => c.name === 'teacherId')) {
      db.exec('ALTER TABLE sessions ADD COLUMN teacherId TEXT REFERENCES teachers(id) ON DELETE CASCADE;');
    }
  } catch {}
  try {
    db.exec('CREATE INDEX IF NOT EXISTS idx_sessions_teacher ON sessions(teacherId);');
  } catch {}
  // One-time: permanent folder deletion used to default to disabled, which made
  // the typed-name confirmation always fail. Align existing installs with the new
  // default exactly once (later admin toggles are never touched again).
  try {
    const done = db.prepare("SELECT value FROM system_settings WHERE key = 'deleteDefaultMigrated'").get() as unknown as { value: string } | undefined;
    if (!done) {
      const cur = db.prepare("SELECT value FROM system_settings WHERE key = 'allowTeacherDeleteFolders'").get() as unknown as { value: string } | undefined;
      if (cur && cur.value === 'false') {
        db.prepare("UPDATE system_settings SET value = 'true', updatedAt = ? WHERE key = 'allowTeacherDeleteFolders'").run(new Date().toISOString());
      }
      db.prepare("INSERT OR IGNORE INTO system_settings(key, value, updatedAt) VALUES ('deleteDefaultMigrated', '1', ?)").run(new Date().toISOString());
    }
  } catch {}
}

async function seed(db: DatabaseSync): Promise<void> {
  const now = nowISO();
  for (const [k, v] of Object.entries(DEFAULT_SETTINGS)) {
    db.prepare('INSERT OR IGNORE INTO system_settings(key, value, updatedAt) VALUES (?, ?, ?)').run(k, v, now);
  }
  for (const name of DEFAULT_CLASSES) {
    const exists = db.prepare('SELECT id FROM classes WHERE name = ?').get(name) as unknown as { id: string } | undefined;
    if (!exists) {
      db.prepare('INSERT INTO classes(id, name, enabled, createdAt) VALUES (?, ?, 1, ?)').run(newId(), name, now);
    }
  }
  // One-time cleanup of previously-seeded default classes:
  // unlink students/submissions (→ no class) and drop teacher/folder links, then delete the class rows.
  // Also prunes classRestrictions entries that reference deleted class ids.
  try {
    const idsToRemove: string[] = [];
    for (const name of REMOVED_DEFAULT_CLASSES) {
      const row = db.prepare('SELECT id FROM classes WHERE name = ?').get(name) as unknown as { id: string } | undefined;
      if (row) idsToRemove.push(row.id);
    }
    for (const cid of idsToRemove) {
      try { db.prepare('UPDATE users SET classId = NULL WHERE classId = ?').run(cid); } catch {}
      try { db.prepare('UPDATE submissions SET classId = NULL WHERE classId = ?').run(cid); } catch {}
      try { db.prepare('DELETE FROM teacher_classes WHERE classId = ?').run(cid); } catch {}
      try { db.prepare('DELETE FROM folder_classes WHERE classId = ?').run(cid); } catch {}
      try { db.prepare('DELETE FROM classes WHERE id = ?').run(cid); } catch {}
    }
    if (idsToRemove.length > 0) {
      try {
        const gone = new Set(idsToRemove);
        const r = db.prepare("SELECT value FROM system_settings WHERE key = 'classRestrictions'").get() as unknown as { value: string } | undefined;
        if (r?.value) {
          const parsed = JSON.parse(r.value) as Record<string, string[]>;
          let changed = false;
          for (const k of Object.keys(parsed)) {
            if (gone.has(k)) { delete parsed[k]; changed = true; continue; }
            const before = parsed[k].length;
            parsed[k] = parsed[k].filter((v) => !gone.has(v));
            if (parsed[k].length !== before) changed = true;
          }
          if (changed) {
            db.prepare("UPDATE system_settings SET value = ?, updatedAt = ? WHERE key = 'classRestrictions'").run(JSON.stringify(parsed), now);
          }
        }
      } catch {}
    }
  } catch {}

  // Default admin (only if none exists). Credentials are printed once to server console.
  const adminCount = (db.prepare('SELECT COUNT(*) AS c FROM admins').get() as unknown as { c: number }).c;
  if (adminCount === 0) {
    const passwordHash = await hashPassword('Admin123!');
    db.prepare('INSERT INTO admins(id, username, usernameLower, passwordHash, createdAt) VALUES (?, ?, ?, ?, ?)').run(
      newId(),
      'admin',
      'admin',
      passwordHash,
      now
    );
    console.log('\n[Open Send] Default admin created → username: admin | password: Admin123!');
    console.log('[Open Send] Change it immediately in /webadmin → System.\n');
  }
}

let seedPromise: Promise<void> | null = null;

export function getDb(): DatabaseSync {
  if (g.__opensendDb) return g.__opensendDb;
  ensureDirs();
  fs.mkdirSync(dataDir(), { recursive: true });
  const db = new DatabaseSync(dbPath());
  // Enable FK enforcement for this connection.
  try {
    db.exec('PRAGMA foreign_keys = ON;');
  } catch {}
  migrate(db);
  g.__opensendDb = db;
  if (!seedPromise) {
    seedPromise = seed(db).catch((e) => console.error('[Open Send] seed failed:', e));
  }
  return db;
}

export async function dbReady(): Promise<DatabaseSync> {
  const db = getDb();
  if (seedPromise) await seedPromise;
  return db;
}

export function closeDb(): void {
  try {
    g.__opensendDb?.close();
  } catch {}
  g.__opensendDb = undefined;
  seedPromise = null;
}

// ---------- Typed row helpers ----------
export interface ClassRow { id: string; name: string; enabled: number; createdAt: string }
export interface UserRow {
  id: string; username: string; usernameLower: string; displayName: string;
  passwordHash: string; classId: string | null; enabled: number;
  createdAt: string; lastLoginAt: string | null;
}
export interface AdminRow { id: string; username: string; usernameLower: string; passwordHash: string; createdAt: string }
export interface TransferRow {
  id: string; senderId: string; recipientId: string; message: string; status: string;
  expiresAt: string | null; downloadCount: number; firstDownloadAt: string | null;
  lastDownloadAt: string | null; createdAt: string; updatedAt: string;
}
export interface TransferFileRow {
  id: string; transferId: string; storedFile: string; originalName: string; mime: string; size: number; createdAt: string;
}
export interface NotificationRow {
  id: string; userId: string; kind: string; title: string; body: string;
  transferId: string | null; isRead: number; createdAt: string;
}
export interface TeacherRow {
  id: string; username: string; usernameLower: string; displayName: string;
  passwordHash: string; enabled: number; createdAt: string; lastLoginAt: string | null;
}
export interface SubmissionFolderRow {
  id: string; teacherId: string; name: string; description: string; status: string;
  deadline: string | null; maxFileSizeMB: number; maxFiles: number; maxTotalSizeMB: number;
  allowedExtensions: string; allowMultiple: number; allowReplace: number; allowDeleteOwn: number;
  allowLate: number; lateMode: string; requireMessage: number; createdAt: string; updatedAt: string;
}
export interface SubmissionRow {
  id: string; folderId: string; studentId: string; teacherId: string; classId: string | null;
  submissionNumber: number; message: string; status: string; isLate: number;
  createdAt: string; updatedAt: string;
}
export interface SubmissionFileRow {
  id: string; submissionId: string; storedFile: string; originalName: string;
  mime: string; size: number; createdAt: string;
}

export function publicUser(u: UserRow & { className?: string | null }): {
  id: string; username: string; displayName: string; classId: string | null; className: string | null;
} {
  return { id: u.id, username: u.username, displayName: u.displayName, classId: u.classId, className: (u as { className?: string | null }).className ?? null };
}

export function checkpointDb(): void {
  try {
    getDb().exec('PRAGMA wal_checkpoint(TRUNCATE);');
  } catch {}
}

export async function vacuumDb(): Promise<void> {
  getDb().exec('VACUUM');
}
