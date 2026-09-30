import { NextResponse } from 'next/server';
import { dbReady } from '@/lib/db';
import { hashPassword } from '@/lib/crypto';
import { createStudentSession, studentCookieHeader } from '@/lib/auth';
import { getSettings } from '@/lib/settings';
import { validateUsername, validatePassword, sanitizeDisplayName } from '@/lib/validation';
import { json, err, clientIp, userAgent } from '@/lib/api';
import { audit } from '@/lib/server-utils';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request) {
  const ip = clientIp(req);
  const ua = userAgent(req);
  const settings = getSettings();
  if (!settings.registrationEnabled) {
    return err('Registration is currently disabled. Please contact the administrator.', 403);
  }
  let body: { username?: string; password?: string; confirmPassword?: string; displayName?: string; classId?: string };
  try {
    body = await req.json();
  } catch {
    return err('Invalid request body.', 400);
  }
  const username = (body.username || '').trim();
  const password = body.password || '';
  const confirm = body.confirmPassword ?? body.password;
  const displayName = sanitizeDisplayName(body.displayName || '');
  const classId = (body.classId || '').trim();

  const uErr = validateUsername(username);
  if (uErr) return err(uErr, 400);
  const pErr = validatePassword(password, 6);
  if (pErr) return err(pErr, 400);
  if (password !== confirm) return err('Passwords do not match.', 400);
  if (!displayName || displayName.length < 2) return err('Display name is required (min 2 characters).', 400);
  if (!classId) return err('Class is required.', 400);

  const db = await dbReady();
  const cls = db.prepare('SELECT id, name, enabled FROM classes WHERE id = ?').get(classId) as unknown as { id: string; name: string; enabled: number } | undefined;
  if (!cls || cls.enabled !== 1) return err('Selected class is invalid.', 400);

  const lower = username.toLowerCase();
  const dup = db.prepare('SELECT id FROM users WHERE usernameLower = ?').get(lower);
  if (dup) return err('Username is already taken.', 409);

  const { newId, nowISO } = await import('@/lib/crypto');
  const id = newId();
  const passwordHash = await hashPassword(password);
  db.prepare('INSERT INTO users(id, username, usernameLower, displayName, passwordHash, classId, enabled, createdAt, lastLoginAt) VALUES (?, ?, ?, ?, ?, ?, 1, ?, ?)').run(
    id, username, lower, displayName, passwordHash, classId, nowISO(), nowISO()
  );

  audit('Account Created', { actorType: 'student', actorId: id, actorName: username, details: `displayName=${displayName} class=${cls.name}`, ip });

  const token = await createStudentSession(id, ip, ua);
  const res = json({ ok: true, user: { id, username, displayName, classId, className: cls.name } }, 201);
  res.headers.set('Set-Cookie', studentCookieHeader(token));
  return res;
}
