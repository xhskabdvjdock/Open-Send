import { cookies } from 'next/headers';
import { getDb, dbReady, type UserRow, type AdminRow } from './db';
import { newToken, sha256Hex } from './crypto';

export const STUDENT_COOKIE = 'opensend_session';
export const ADMIN_COOKIE = 'opensend_admin';
export const TEACHER_COOKIE = 'opensend_teacher';

const STUDENT_TTL_MS = 7 * 24 * 3600 * 1000;
const ADMIN_TTL_MS = 24 * 3600 * 1000;
const TEACHER_TTL_MS = 7 * 24 * 3600 * 1000;

export interface StudentSession {
  user: UserRow & { className: string | null };
  expiresAt: string;
}

export async function createStudentSession(userId: string, ip = '', userAgent = ''): Promise<string> {
  const db = await dbReady();
  const token = newToken();
  const id = newToken(16);
  const expiresAt = new Date(Date.now() + STUDENT_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions(id, tokenHash, userId, adminId, expiresAt, createdAt, ip, userAgent) VALUES (?, ?, ?, NULL, ?, ?, ?, ?)').run(
    id,
    sha256Hex(token),
    userId,
    expiresAt,
    new Date().toISOString(),
    ip.slice(0, 80),
    userAgent.slice(0, 200)
  );
  return token;
}

export async function createAdminSession(adminId: string, ip = '', userAgent = ''): Promise<string> {
  const db = await dbReady();
  const token = newToken();
  const id = newToken(16);
  const expiresAt = new Date(Date.now() + ADMIN_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions(id, tokenHash, userId, adminId, expiresAt, createdAt, ip, userAgent) VALUES (?, ?, NULL, ?, ?, ?, ?, ?)').run(
    id,
    sha256Hex(token),
    adminId,
    expiresAt,
    new Date().toISOString(),
    ip.slice(0, 80),
    userAgent.slice(0, 200)
  );
  return token;
}

export async function getStudentFromToken(token: string | undefined | null): Promise<StudentSession | null> {
  if (!token) return null;
  const db = await dbReady();
  const sess = db
    .prepare('SELECT * FROM sessions WHERE tokenHash = ? AND userId IS NOT NULL')
    .get(sha256Hex(token)) as unknown as { userId: string; expiresAt: string; id: string } | undefined;
  if (!sess) return null;
  if (new Date(sess.expiresAt).getTime() < Date.now()) {
    try {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sess.id);
    } catch {}
    return null;
  }
  const user = db
    .prepare(
      `SELECT u.*, c.name AS className FROM users u LEFT JOIN classes c ON c.id = u.classId WHERE u.id = ?`
    )
    .get(sess.userId) as unknown as ((UserRow & { className: string | null }) | undefined);
  if (!user || user.enabled !== 1) return null;
  return { user, expiresAt: sess.expiresAt };
}

export async function getAdminFromToken(token: string | undefined | null): Promise<AdminRow | null> {
  if (!token) return null;
  const db = await dbReady();
  const sess = db
    .prepare('SELECT * FROM sessions WHERE tokenHash = ? AND adminId IS NOT NULL')
    .get(sha256Hex(token)) as unknown as { adminId: string; expiresAt: string; id: string } | undefined;
  if (!sess) return null;
  if (new Date(sess.expiresAt).getTime() < Date.now()) {
    try {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sess.id);
    } catch {}
    return null;
  }
  const admin = db.prepare('SELECT * FROM admins WHERE id = ?').get(sess.adminId) as unknown as AdminRow | undefined;
  return admin ?? null;
}

export async function destroySessionByToken(token: string): Promise<void> {
  const db = await dbReady();
  try {
    db.prepare('DELETE FROM sessions WHERE tokenHash = ?').run(sha256Hex(token));
  } catch {}
}

export interface TeacherSession {
  teacher: import('./db').TeacherRow & { classIds: string[] };
  expiresAt: string;
}

export async function createTeacherSession(teacherId: string, ip = '', userAgent = ''): Promise<string> {
  const db = await dbReady();
  const token = newToken();
  const id = newToken(16);
  const expiresAt = new Date(Date.now() + TEACHER_TTL_MS).toISOString();
  db.prepare('INSERT INTO sessions(id, tokenHash, userId, adminId, teacherId, expiresAt, createdAt, ip, userAgent) VALUES (?, ?, NULL, NULL, ?, ?, ?, ?, ?)').run(
    id,
    sha256Hex(token),
    teacherId,
    expiresAt,
    new Date().toISOString(),
    ip.slice(0, 80),
    userAgent.slice(0, 200)
  );
  return token;
}

export async function getTeacherFromToken(token: string | undefined | null): Promise<TeacherSession | null> {
  if (!token) return null;
  const db = await dbReady();
  const sess = db
    .prepare('SELECT * FROM sessions WHERE tokenHash = ? AND teacherId IS NOT NULL')
    .get(sha256Hex(token)) as unknown as { teacherId: string; expiresAt: string; id: string } | undefined;
  if (!sess) return null;
  if (new Date(sess.expiresAt).getTime() < Date.now()) {
    try {
      db.prepare('DELETE FROM sessions WHERE id = ?').run(sess.id);
    } catch {}
    return null;
  }
  const teacher = db.prepare('SELECT * FROM teachers WHERE id = ?').get(sess.teacherId) as unknown as import('./db').TeacherRow | undefined;
  if (!teacher || teacher.enabled !== 1) return null;
  let classIds: string[] = [];
  try {
    classIds = (db.prepare('SELECT classId FROM teacher_classes WHERE teacherId = ?').all(teacher.id) as unknown as { classId: string }[]).map((r) => r.classId);
  } catch {}
  return { teacher: { ...teacher, classIds }, expiresAt: sess.expiresAt };
}

export function teacherCookieHeader(token: string): string {
  const maxAge = Math.floor(TEACHER_TTL_MS / 1000);
  return `${TEACHER_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearTeacherCookieHeader(): string {
  return `${TEACHER_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function requireTeacherSession(): Promise<TeacherSession | null> {
  const { cookies } = await import('next/headers');
  const c = (await cookies()).get(TEACHER_COOKIE)?.value;
  return getTeacherFromToken(c);
}

export function studentCookieHeader(token: string): string {
  const maxAge = Math.floor(STUDENT_TTL_MS / 1000);
  return `${STUDENT_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function adminCookieHeader(token: string): string {
  const maxAge = Math.floor(ADMIN_TTL_MS / 1000);
  return `${ADMIN_COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}`;
}

export function clearStudentCookieHeader(): string {
  return `${STUDENT_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export function clearAdminCookieHeader(): string {
  return `${ADMIN_COOKIE}=; Path=/; HttpOnly; SameSite=Lax; Max-Age=0`;
}

export async function requireStudent(): Promise<StudentSession | null> {
  const c = cookies().get(STUDENT_COOKIE)?.value;
  return getStudentFromToken(c);
}

export async function requireAdmin(): Promise<AdminRow | null> {
  const c = cookies().get(ADMIN_COOKIE)?.value;
  return getAdminFromToken(c);
}

export function getCookieFromHeader(cookieHeader: string | null, name: string): string | null {
  if (!cookieHeader) return null;
  const parts = cookieHeader.split(';');
  for (const p of parts) {
    const [k, ...rest] = p.trim().split('=');
    if (k === name) return rest.join('=');
  }
  return null;
}
