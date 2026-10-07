import fs from 'node:fs';
import { getStudentFromToken, STUDENT_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady, type ChatMessageRow } from '@/lib/db';
import { err } from '@/lib/api';
import { getSettings } from '@/lib/settings';
import { isParticipant } from '@/lib/chat';
import { findChatFile } from '@/lib/paths';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

// Only types safe to render inline ever get `inline`; everything else forces
// download. nosniff is always set, so a renamed hostile file can never execute.
const INLINE_MIMES = new Set([
  'image/jpeg',
  'image/png',
  'image/gif',
  'image/webp',
  'video/mp4',
  'video/webm',
]);

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

// Students only (participants of the conversation). No teacher/admin content
// browsing here, per the chat privacy policy.
export async function GET(req: Request, { params }: { params: { id: string } }) {
  const token = getCookieFromHeader(req.headers.get('cookie'), STUDENT_COOKIE);
  const sess = await getStudentFromToken(token);
  if (!sess) return err('Unauthorized', 401);
  const s = getSettings();
  if (!s.chatEnabled || !s.chatStudentChat) return err('Chat is disabled.', 403);
  const db = await dbReady();
  const m = db.prepare(
    "SELECT * FROM chat_messages WHERE id = ? AND kind = 'attachment' AND moderationStatus = 'VISIBLE' AND deletedAt IS NULL"
  ).get(params.id) as unknown as ChatMessageRow | undefined;
  if (!m || !m.attachmentFile) return err('File not found.', 404);
  if (!(await isParticipant(m.conversationId, sess.user.id))) return err('File not found.', 404);
  const disk = findChatFile(m.attachmentFile);
  if (!disk) return err('File not found on server.', 404);
  const stat = fs.statSync(disk);
  const mime = (m.attachmentMime || 'application/octet-stream').toLowerCase();
  const inline = INLINE_MIMES.has(mime);
  const stream = fs.createReadStream(disk);
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': mime,
      'Content-Length': String(stat.size),
      'Content-Disposition': inline
        ? 'inline'
        : contentDisposition(m.attachmentName || 'file'),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
