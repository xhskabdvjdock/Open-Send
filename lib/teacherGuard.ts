import { getTeacherFromToken, TEACHER_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { err } from '@/lib/api';
import type { TeacherRow } from '@/lib/db';

export interface TeacherAuth {
  teacher: TeacherRow & { classIds: string[] };
}

export async function requireTeacher(req: Request): Promise<{ teacher: TeacherRow & { classIds: string[] } } | { errorResponse: Response }> {
  const token = getCookieFromHeader(req.headers.get('cookie'), TEACHER_COOKIE);
  const sess = await getTeacherFromToken(token);
  if (!sess) return { errorResponse: err('Unauthorized: teacher authentication required.', 401) };
  return { teacher: sess.teacher };
}
