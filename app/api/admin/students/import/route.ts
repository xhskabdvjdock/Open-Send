import { dbReady } from '@/lib/db';
import { hashPassword, newId, nowISO } from '@/lib/crypto';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { validateUsername, sanitizeDisplayName } from '@/lib/validation';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// CSV import: username,password,name,class  (class matched by name, case-insensitive)
export async function POST(req: Request) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { csv?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const csv = (body.csv || '').slice(0, 500000);
  if (!csv.trim()) return err('CSV is empty.', 400);
  const lines = csv.split(/\r?\n/).map((l) => l.trim()).filter(Boolean);
  // Skip header if it looks like one
  const rows = lines[0].toLowerCase().startsWith('username') ? lines.slice(1) : lines;

  const db = await dbReady();
  const classMap = new Map(
    (db.prepare('SELECT id, name FROM classes').all() as unknown as { id: string; name: string }[]).map((c) => [c.name.toLowerCase(), c.id])
  );
  let created = 0;
  let skipped = 0;
  const errors: string[] = [];
  const ins = db.prepare('INSERT INTO users(id, username, usernameLower, displayName, passwordHash, classId, enabled, createdAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?)');
  const now = nowISO();

  for (let i = 0; i < rows.length; i++) {
    const cols = rows[i].split(',').map((c) => c.trim());
    if (cols.length < 4) {
      skipped++;
      errors.push(`Line ${i + 1}: expected 4 columns.`);
      continue;
    }
    const [username, password, name, className] = cols;
    if (validateUsername(username) || !password || password.length < 6) {
      skipped++;
      errors.push(`Line ${i + 1}: invalid username/password.`);
      continue;
    }
    const dn = sanitizeDisplayName(name);
    if (!dn) {
      skipped++;
      errors.push(`Line ${i + 1}: invalid name.`);
      continue;
    }
    const classId = classMap.get(className.toLowerCase());
    if (!classId) {
      skipped++;
      errors.push(`Line ${i + 1}: class "${className}" not found.`);
      continue;
    }
    if (db.prepare('SELECT id FROM users WHERE usernameLower = ?').get(username.toLowerCase())) {
      skipped++;
      errors.push(`Line ${i + 1}: username taken.`);
      continue;
    }
    try {
      ins.run(newId(), username, username.toLowerCase(), dn, await hashPassword(password), classId, now);
      created++;
    } catch {
      skipped++;
      errors.push(`Line ${i + 1}: failed to create.`);
    }
  }
  audit('Admin Bulk Import', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `created=${created} skipped=${skipped}`, ip: clientIp(req) });
  // Never echo passwords back.
  return json({ ok: true, created, skipped, errors: errors.slice(0, 50) });
}
