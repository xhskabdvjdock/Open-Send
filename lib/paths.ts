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

export function storageSubdir(kind: 'pending' | 'accepted' | 'completed' | 'rejected' | 'tmp'): string {
  return path.join(storageRoot(), kind);
}

export function backupsDir(): string {
  return path.join(rootDir(), 'backups');
}

export function ensureDirs(): void {
  for (const d of [dataDir(), storageRoot(), backupsDir()]) {
    fs.mkdirSync(d, { recursive: true });
  }
  for (const k of ['pending', 'accepted', 'completed', 'rejected', 'tmp'] as const) {
    fs.mkdirSync(storageSubdir(k), { recursive: true });
  }
  // Prevent static serving / execution surprises: deny directory listing hint files
  for (const k of ['pending', 'accepted', 'completed', 'rejected', 'tmp'] as const) {
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
  for (const k of ['accepted', 'completed', 'pending', 'rejected'] as const) {
    const p = path.join(storageSubdir(k), storedFile);
    if (fs.existsSync(p)) return p;
  }
  return null;
}

export function locateStoredFileIn(storedFile: string, kind: 'pending' | 'accepted' | 'completed' | 'rejected'): string | null {
  if (!isSafeInternalId(storedFile)) return null;
  const p = path.join(storageSubdir(kind), storedFile);
  return fs.existsSync(p) ? p : null;
}
