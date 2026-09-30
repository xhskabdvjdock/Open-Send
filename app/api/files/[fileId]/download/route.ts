import fs from 'node:fs';
import path from 'node:path';
import { getStudentFromToken, getAdminFromToken, STUDENT_COOKIE, ADMIN_COOKIE, getCookieFromHeader } from '@/lib/auth';
import { dbReady, type TransferRow, type TransferFileRow } from '@/lib/db';
import { err, clientIp } from '@/lib/api';
import { audit } from '@/lib/server-utils';
import { getSettings } from '@/lib/settings';
import { storageSubdir, findStoredFile } from '@/lib/paths';
import { nowISO } from '@/lib/crypto';
import { isTransferExpired, moveTransferFiles } from '@/lib/transfers';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

function contentDisposition(filename: string): string {
  const ascii = filename.replace(/[^\x20-\x7E]/g, '_').replace(/"/g, "'");
  const encoded = encodeURIComponent(filename).replace(/'/g, '%27');
  return `attachment; filename="${ascii}"; filename*=UTF-8''${encoded}`;
}

export async function GET(req: Request, { params }: { params: { fileId: string } }) {
  const cookieHeader = req.headers.get('cookie');
  const studentToken = getCookieFromHeader(cookieHeader, STUDENT_COOKIE);
  const sess = await getStudentFromToken(studentToken);

  const db = await dbReady();
  const f = db.prepare('SELECT * FROM transfer_files WHERE id = ?').get(params.fileId) as unknown as TransferFileRow | undefined;
  if (!f) return err('File not found.', 404);
  const t = db.prepare('SELECT * FROM transfers WHERE id = ?').get(f.transferId) as unknown as TransferRow | undefined;
  if (!t) return err('File not found.', 404);

  // Optional admin preview path (only when explicitly enabled in settings).
  if (!sess) {
    const adminToken = getCookieFromHeader(cookieHeader, ADMIN_COOKIE);
    const admin = await getAdminFromToken(adminToken);
    const settings = getSettings();
    if (admin && settings.adminCanPreview) {
      audit('File Previewed', { actorType: 'admin', actorId: admin.id, actorName: admin.username, details: `file=${f.originalName} transfer=${t.id}`, ip: clientIp(req) });
      return serveFile(f);
    }
    return err('Unauthorized', 401);
  }

  // Authorization: must be the intended recipient.
  if (t.recipientId !== sess.user.id) {
    audit('Unauthorized Download Attempt', { actorType: 'student', actorId: sess.user.id, actorName: sess.user.username, details: `file=${params.fileId} transfer=${t.id}`, ip: clientIp(req) });
    return err('You are not authorized to download this file.', 403);
  }
  // Transfer must be accepted (or already downloaded when multi-download allowed).
  if (t.status !== 'ACCEPTED' && t.status !== 'DOWNLOADED') {
    return err(t.status === 'PENDING' ? 'The recipient must accept the file before downloading.' : `Download not allowed (status: ${t.status}).`, 403);
  }
  // Expiry check.
  if (isTransferExpired(t)) {
    db.prepare("UPDATE transfers SET status='EXPIRED', updatedAt=? WHERE id=?").run(nowISO(), t.id);
    moveTransferFiles(t.id, 'accepted', 'rejected');
    moveTransferFiles(t.id, 'completed', 'rejected');
    return err('This file has expired.', 410);
  }

  const settings = getSettings();
  if (!settings.allowMultipleDownloads && t.downloadCount > 0 && t.status === 'DOWNLOADED') {
    return err('Multiple downloads are disabled by the administrator.', 403);
  }
  if (settings.maxDownloads > 0 && t.downloadCount >= settings.maxDownloads) {
    return err('Download limit reached.', 403);
  }

  // Locate file on disk without trusting any client path.
  let disk: string | null = null;
  for (const k of ['accepted', 'completed', 'pending'] as const) {
    const p = path.join(storageSubdir(k), f.storedFile);
    if (fs.existsSync(p)) {
      disk = p;
      break;
    }
  }
  if (!disk) return err('File not found on server.', 404);

  // Track download.
  const now = nowISO();
  const first = t.firstDownloadAt || now;
  db.prepare('UPDATE transfers SET downloadCount = downloadCount + 1, firstDownloadAt = ?, lastDownloadAt = ?, updatedAt = ? WHERE id = ?').run(
    first, now, now, t.id
  );
  // Single-download mode transitions to DOWNLOADED + moves to completed bucket.
  if (!settings.allowMultipleDownloads) {
    db.prepare("UPDATE transfers SET status='DOWNLOADED' WHERE id=?").run(t.id);
    moveTransferFiles(t.id, 'accepted', 'completed');
  } else if (t.status === 'ACCEPTED') {
    // Keep ACCEPTED but mark downloaded-ish? Spec includes DOWNLOADED status; only flip when single mode
    // to keep "Accepted" visible while still tracking counts. Flip to DOWNLOADED after first download
    // for clearer history when maxDownloads unlimited? No — keep ACCEPTED to avoid confusion.
  }
  audit('File Downloaded', { actorType: 'student', actorId: sess.user.id, actorName: sess.user.username, details: `file=${f.originalName} transfer=${t.id}`, ip: clientIp(req) });

  return serveFile(f, disk);
}

function serveFile(f: TransferFileRow, disk?: string): Response {
  let diskPath = disk ?? findStoredFile(f.storedFile);
  if (!diskPath) return err('File not found on server.', 404) as unknown as Response;
  const stat = fs.statSync(diskPath);
  const stream = fs.createReadStream(diskPath);
  const body = stream as unknown as BodyInit;
  return new Response(body, {
    status: 200,
    headers: {
      'Content-Type': f.mime || 'application/octet-stream',
      'Content-Length': String(stat.size),
      'Content-Disposition': contentDisposition(f.originalName),
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
