import { dbReady } from '@/lib/db';
import { getSettings, setSetting, isAllowedSettingKey, normalizeSettingValue } from '@/lib/settings';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function GET(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  await dbReady();
  return json({ settings: getSettings() });
}

export async function PUT(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: Record<string, unknown>;
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const settings = (body.settings || body) as Record<string, unknown>;
  const changed: string[] = [];
  for (const [k, v] of Object.entries(settings)) {
    if (!isAllowedSettingKey(k)) continue;
    // Basic sanity validation for numeric fields
    if (['maxFileSizeMB', 'maxFilesPerTransfer', 'defaultExpiryHours', 'maxDownloads', 'retentionDeclinedDays', 'retentionCancelledDays', 'retentionExpiredDays', 'retentionCompletedDays'].includes(k)) {
      const n = Number(v);
      if (!Number.isFinite(n) || n < 0 || n > 100000) return err(`Invalid value for ${k}.`, 400);
    }
    if (k === 'sendScope' && !['anyone', 'same-class', 'selected'].includes(String(v))) {
      return err('Invalid sendScope.', 400);
    }
    if (k === 'classRestrictions' && typeof v !== 'object') {
      try {
        JSON.parse(String(v));
      } catch {
        return err('Invalid classRestrictions JSON.', 400);
      }
    }
    setSetting(k, normalizeSettingValue(k, v));
    changed.push(k);
  }
  audit('Admin Updated Settings', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: changed.join(','), ip: clientIp(req) });
  await dbReady();
  return json({ ok: true, settings: getSettings() });
}
