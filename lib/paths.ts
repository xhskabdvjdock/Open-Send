import path from 'node:path';
import fs from 'node:fs';

export function rootDir(): string {
  return process.cwd();
}

export function dataDir(): string {
  return path.join(rootDir(), 'data');
}

export function dbPath(): string {
  return process.env.OPENSEND_DB || path.join(dataDir(), 'opensend.db');
}

export function storageRoot(): string {
  return process.env.OPENSEND_STORAGE || path.join(rootDir(), 'storage');
}

export function storageSubdir(kind: 'pending' | 'accepted' | 'completed' | 'rejected' | 'tmp' | 'submissions' | 'zips' | 'chat' | 'avatars' | 'library' | 'folders'): string {
  return path.join(storageRoot(), kind);
}

export function backupsDir(): string {
  return path.join(rootDir(), 'backups');
}

export function ensureDirs(): void {
  for (const d of [dataDir(), storageRoot(), backupsDir()]) {
    fs.mkdirSync(d, { recursive: true });
  }
  for (const k of ['pending', 'accepted', 'completed', 'rejected', 'tmp', 'submissions', 'zips', 'chat', 'avatars', 'library', 'folders'] as const) {
    fs.mkdirSync(storageSubdir(k), { recursive: true });
  }
  // Prevent static serving / execution surprises: deny directory listing hint files
  for (const k of ['pending', 'accepted', 'completed', 'rejected', 'tmp', 'submissions', 'zips', 'chat', 'avatars', 'library', 'folders'] as const) {
    const deny = path.join(storageSubdir(k), '.deny');
    if (!fs.existsSync(deny)) {
      try {
        fs.writeFileSync(deny, 'Open Send private storage. Do not serve directly.\n');
      } catch {}
    }
  }
}

/** Resolve a stored internal file id to an absolute path, searching known subdirs.
 *  Only allows hex/uuid-like ids — blocks path traversal entirely. */
export function isSafeInternalId(id: string): boolean {
  return /^[a-fA-F0-9]{8,64}$/.test(id) || /^[a-fA-F0-9-]{10,64}$/.test(id);
}

export function findStoredFile(storedFile: string): string | null {
  if (!isSafeInternalId(storedFile)) return null;
  // storedFile never contains separators, so joining is safe.
  for (const k of ['accepted', 'completed', 'pending', 'rejected', 'submissions'] as const) {
    const p = path.join(storageSubdir(k), storedFile);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function findSubmissionFile(storedFile: string): string | null {
  if (!isSafeInternalId(storedFile)) return null;
  const p = path.join(storageSubdir('submissions'), storedFile);
  return fs.existsSync(p) ? p : null;
}

/** Chat attachment lookup (isolated bucket — never mixed with transfers). */
export function findChatFile(storedFile: string): string | null {
  if (!isSafeInternalId(storedFile)) return null;
  const p = path.join(storageSubdir('chat'), storedFile);
  return fs.existsSync(p) ? p : null;
}

/** Teacher folder attachment lookup (isolated bucket). */
export function findFolderFile(storedFile: string): string | null {
  if (!isSafeInternalId(storedFile)) return null;
  const p = path.join(storageSubdir('folders'), storedFile);
  return fs.existsSync(p) ? p : null;
}

/** Sanitize a name for use inside a ZIP or as a Windows-safe filename. */
export function sanitizeZipSegment(name: string, fallback = 'file'): string {
  let s = (name || fallback).trim();
  // Remove path separators and control chars
  s = s.replace(/[\\/]/g, '-').replace(/[\x00-\x1F\x7F]/g, '');
  // Windows invalid chars <>:"|?*
  s = s.replace(/[<>:"|?*]/g, '-');
  // Dots at start, trailing dots/spaces (Windows)
  s = s.replace(/^\.+/, '').replace(/[. ]+$/g, '');
  // Windows reserved names
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(s)) s = '_' + s;
  s = s.replace(/\s+/g, ' ').trim();
  if (!s) s = fallback;
  return s.slice(0, 100);
}

export function sanitizeZipFileName(name: string): string {
  const base = sanitizeZipSegment(name, 'folder');
  // Ensure .zip extension handling is done by caller; just strip extra dots
  return base.replace(/\.zip$/i, '');
}

export function locateStoredFileIn(storedFile: string, kind: 'pending' | 'accepted' | 'completed' | 'rejected'): string | null {
  if (!isSafeInternalId(storedFile)) return null;
  const p = path.join(storageSubdir(kind), storedFile);
  return fs.existsSync(p) ? p : null;
}
