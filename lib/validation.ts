/** Shared validation helpers — every important check is re-enforced server-side. */

export function validateUsername(username: string): string | null {
  const u = (username || '').trim();
  if (u.length < 3) return 'Username must be at least 3 characters.';
  if (u.length > 32) return 'Username must be at most 32 characters.';
  if (!/^[a-zA-Z0-9_.-]+$/.test(u)) return 'Username may only contain letters, numbers, dot, dash and underscore.';
  return null;
}

export function validatePassword(password: string, minLen = 6): string | null {
  if (!password || password.length < minLen) return `Password must be at least ${minLen} characters.`;
  if (password.length > 128) return 'Password is too long.';
  return null;
}

export function sanitizeDisplayName(name: string): string {
  return (name || '').trim().replace(/\s+/g, ' ').slice(0, 80);
}

/** Strip directories, null bytes and dangerous chars; never used as a disk path. */
export function sanitizeOriginalName(name: string): string {
  let base = (name || 'file').split(/[/\\]/).pop() || 'file';
  base = base.replace(/\0/g, '').replace(/^\.+/, '').trim();
  if (!base) base = 'file';
  // Windows reserved names guard
  if (/^(con|prn|aux|nul|com[1-9]|lpt[1-9])(\..*)?$/i.test(base)) base = '_' + base;
  return base.slice(0, 180);
}

export function extOf(filename: string): string {
  const i = filename.lastIndexOf('.');
  if (i < 0 || i === filename.length - 1) return '';
  return filename.slice(i + 1).toLowerCase().slice(0, 16);
}

/** Profile pictures: small images only (mime AND extension must both match). */
const AVATAR_MIMES = new Set(['image/jpeg', 'image/png', 'image/gif', 'image/webp']);
const AVATAR_EXTS = new Set(['jpg', 'jpeg', 'png', 'gif', 'webp']);

export function isAvatarFile(mime: string, ext: string): boolean {
  return AVATAR_MIMES.has((mime || '').toLowerCase()) && AVATAR_EXTS.has((ext || '').toLowerCase());
}

export function parseCsvList(v: string | null | undefined): string[] {
  if (!v) return [];
  return v
    .split(',')
    .map((s) => s.trim().toLowerCase().replace(/^\./, ''))
    .filter(Boolean);
}

export function formatBytes(n: number): string {
  if (!Number.isFinite(n) || n < 0) return '0 B';
  const units = ['B', 'KB', 'MB', 'GB', 'TB'];
  let v = n;
  let i = 0;
  while (v >= 1024 && i < units.length - 1) {
    v /= 1024;
    i++;
  }
  return `${v >= 100 ? Math.round(v) : Math.round(v * 10) / 10} ${units[i]}`;
}

export function escapeHtml(s: string): string {
  return s.replace(/[&<>"']/g, (c) => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' }[c] as string));
}
