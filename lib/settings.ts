import { getDb } from './db';
import { nowISO } from './crypto';

export interface AppSettings {
  appName: string;
  appVersion: string;
  allowTeacherDeleteFolders: boolean;
  zipRetentionMinutes: number;
  registrationEnabled: boolean;
  maintenanceMode: boolean;
  allowClassChange: boolean;
  maxFileSizeMB: number;
  maxFilesPerTransfer: number;
  allowedExtensions: string;
  blockedExtensions: string;
  defaultExpiryHours: number;
  allowMultipleDownloads: boolean;
  maxDownloads: number;
  sendScope: 'anyone' | 'same-class' | 'selected';
  classRestrictions: Record<string, string[]>;
  retentionDeclinedDays: number;
  retentionCancelledDays: number;
  retentionExpiredDays: number;
  retentionCompletedDays: number;
  autoDeleteExpired: boolean;
  adminCanPreview: boolean;
}

function toBool(v: string | undefined, dflt = false): boolean {
  if (v === undefined) return dflt;
  return v === 'true' || v === '1' || v === 'yes';
}
function toNum(v: string | undefined, dflt: number): number {
  const n = Number(v);
  return Number.isFinite(n) ? n : dflt;
}

export function getRawSetting(key: string): string | null {
  const db = getDb();
  const row = db.prepare('SELECT value FROM system_settings WHERE key = ?').get(key) as unknown as { value: string } | undefined;
  return row ? row.value : null;
}

export function getSettings(): AppSettings {
  const db = getDb();
  const rows = db.prepare('SELECT key, value FROM system_settings').all() as unknown as { key: string; value: string }[];
  const m = new Map(rows.map((r) => [r.key, r.value]));
  const g = (k: string) => m.get(k) ?? undefined;
  let classRestrictions: Record<string, string[]> = {};
  try {
    const raw = g('classRestrictions') || '{}';
    const parsed = JSON.parse(raw) as unknown;
    if (parsed && typeof parsed === 'object') classRestrictions = parsed as Record<string, string[]>;
  } catch {}
  const sendScopeRaw = g('sendScope');
  const sendScope: AppSettings['sendScope'] =
    sendScopeRaw === 'same-class' || sendScopeRaw === 'selected' ? sendScopeRaw : 'anyone';
  return {
    appName: g('appName') || 'Open Send',
    appVersion: g('appVersion') || '1.0.0',
    registrationEnabled: toBool(g('registrationEnabled'), true),
    maintenanceMode: toBool(g('maintenanceMode'), false),
    allowClassChange: toBool(g('allowClassChange'), false),
    maxFileSizeMB: Math.max(1, toNum(g('maxFileSizeMB'), 50)),
    maxFilesPerTransfer: Math.max(1, Math.min(20, Math.floor(toNum(g('maxFilesPerTransfer'), 5)))),
    allowedExtensions: g('allowedExtensions') || '',
    blockedExtensions: g('blockedExtensions') || '',
    defaultExpiryHours: Math.max(0, toNum(g('defaultExpiryHours'), 168)),
    allowMultipleDownloads: toBool(g('allowMultipleDownloads'), true),
    maxDownloads: Math.max(0, Math.floor(toNum(g('maxDownloads'), 0))),
    sendScope,
    classRestrictions,
    retentionDeclinedDays: Math.max(0, toNum(g('retentionDeclinedDays'), 7)),
    retentionCancelledDays: Math.max(0, toNum(g('retentionCancelledDays'), 7)),
    retentionExpiredDays: Math.max(0, toNum(g('retentionExpiredDays'), 3)),
    retentionCompletedDays: Math.max(0, toNum(g('retentionCompletedDays'), 30)),
    autoDeleteExpired: toBool(g('autoDeleteExpired'), true),
    adminCanPreview: toBool(g('adminCanPreview'), false),
    allowTeacherDeleteFolders: toBool(g('allowTeacherDeleteFolders'), false),
    zipRetentionMinutes: Math.max(5, toNum(g('zipRetentionMinutes'), 60)),
  };
}

export const PUBLIC_SETTINGS_KEYS = [
  'appName',
  'registrationEnabled',
  'maintenanceMode',
  'allowClassChange',
  'maxFileSizeMB',
  'maxFilesPerTransfer',
  'allowedExtensions',
  'blockedExtensions',
  'defaultExpiryHours',
  'allowMultipleDownloads',
  'maxDownloads',
  'sendScope',
] as const;

export function getPublicSettings(): Record<string, string | boolean | number> {
  const s = getSettings();
  return {
    appName: s.appName,
    registrationEnabled: s.registrationEnabled,
    maintenanceMode: s.maintenanceMode,
    allowClassChange: s.allowClassChange,
    maxFileSizeMB: s.maxFileSizeMB,
    maxFilesPerTransfer: s.maxFilesPerTransfer,
    allowedExtensions: s.allowedExtensions,
    blockedExtensions: s.blockedExtensions,
    defaultExpiryHours: s.defaultExpiryHours,
    allowMultipleDownloads: s.allowMultipleDownloads,
    maxDownloads: s.maxDownloads,
    sendScope: s.sendScope,
  };
}

const ALLOWED_KEYS = new Set([
  'appName',
  'registrationEnabled',
  'maintenanceMode',
  'allowClassChange',
  'maxFileSizeMB',
  'maxFilesPerTransfer',
  'allowedExtensions',
  'blockedExtensions',
  'defaultExpiryHours',
  'allowMultipleDownloads',
  'maxDownloads',
  'sendScope',
  'classRestrictions',
  'retentionDeclinedDays',
  'retentionCancelledDays',
  'retentionExpiredDays',
  'retentionCompletedDays',
  'autoDeleteExpired',
  'adminCanPreview',
  'allowTeacherDeleteFolders',
  'zipRetentionMinutes',
]);

export function isAllowedSettingKey(k: string): boolean {
  return ALLOWED_KEYS.has(k);
}

export function setSetting(key: string, value: string): void {
  const db = getDb();
  db.prepare('INSERT INTO system_settings(key, value, updatedAt) VALUES (?, ?, ?) ON CONFLICT(key) DO UPDATE SET value=excluded.value, updatedAt=excluded.updatedAt').run(
    key,
    value,
    nowISO()
  );
}

export function normalizeSettingValue(key: string, value: unknown): string {
  if (value === null || value === undefined) return '';
  if (typeof value === 'boolean') return value ? 'true' : 'false';
  if (typeof value === 'number') return String(value);
  if (key === 'classRestrictions' && typeof value === 'object') return JSON.stringify(value);
  return String(value);
}
