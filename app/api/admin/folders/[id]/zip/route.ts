import fs from 'node:fs';
import path from 'node:path';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireAdmin } from '@/lib/adminGuard';
import { audit } from '@/lib/server-utils';
import { cleanupOldZips } from '@/lib/folders';
import { storageSubdir, sanitizeZipSegment, sanitizeZipFileName } from '@/lib/paths';
import { createZipStore } from '@/lib/zip';
import { getSettings } from '@/lib/settings';
import { newId, nowISO } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  let body: { includeMessages?: boolean; includeHistory?: boolean; includeDates?: boolean } = {};
  try { body = await req.json(); } catch { body = {}; }
  const wantMessages = body.includeMessages === true;
  const wantHistory = body.includeHistory === true;
  const wantDates = body.includeDates !== false;
  const db = await dbReady();
  const folder = db.prepare('SELECT * FROM submission_folders WHERE id = ?').get(params.id) as unknown as { id: string; name: string } | undefined;
  if (!folder) return err('Folder not found.', 404);
  const settings = getSettings();
  cleanupOldZips(settings.zipRetentionMinutes);
  fs.mkdirSync(storageSubdir('zips'), { recursive: true });
  const folderBase = sanitizeZipFileName(folder.name);
  const outPath = path.join(storageSubdir('zips'), `${params.id}-${newId().slice(0, 8)}.zip`);
  const subs = db.prepare(
    `SELECT s.*, u.username AS studentUsername, u.displayName AS studentName FROM submissions s
     JOIN users u ON u.id = s.studentId WHERE s.folderId = ? ${wantHistory ? '' : "AND s.status = 'current'"}
     ORDER BY u.displayName, s.submissionNumber`
  ).all(params.id) as unknown as { id: string; studentUsername: string; studentName: string; submissionNumber: number; message: string; createdAt: string; isLate: number; status: string }[];
  const entries: { name: string; diskPath: string }[] = [];
  const used = new Set<string>();
  const manifest: string[] = [`Folder: ${folder.name}`, `Exported: ${nowISO()} by admin ${g.admin.username}`, `Submissions: ${subs.length}`, ''];
  for (const s of subs) {
    const studentDir = sanitizeZipSegment(`${s.studentName || s.studentUsername}`.replace(/\s+/g, '-'), 'student');
    const files = db.prepare('SELECT * FROM submission_files WHERE submissionId = ? ORDER BY createdAt').all(s.id) as unknown as { storedFile: string; originalName: string }[];
    for (const fl of files) {
      const disk = path.join(storageSubdir('submissions'), fl.storedFile);
      if (!fs.existsSync(disk)) continue;
      const safeFile = sanitizeZipSegment(fl.originalName, 'file');
      let entry = `${folderBase}/${studentDir}/${safeFile}`;
      let n = 1;
      while (used.has(entry)) {
        const dot = safeFile.lastIndexOf('.');
        const stem = dot > 0 ? safeFile.slice(0, dot) : safeFile;
        const ext = dot > 0 ? safeFile.slice(dot) : '';
        entry = `${folderBase}/${studentDir}/${stem} (${n})${ext}`;
        n++;
        if (n > 50) break;
      }
      used.add(entry);
      entries.push({ name: entry, diskPath: disk });
    }
    manifest.push(`- ${s.studentName} (@${s.studentUsername}) #${s.submissionNumber} ${s.status}${s.isLate ? ' LATE' : ''} ${wantDates ? s.createdAt : ''}`);
    if (wantMessages && s.message) manifest.push(`  Message: ${s.message.slice(0, 300)}`);
  }
  const manifestTmp = path.join(storageSubdir('tmp'), `manifest-${newId().slice(0, 8)}.txt`);
  try {
    fs.writeFileSync(manifestTmp, manifest.join('\n'), 'utf8');
    entries.push({ name: `${folderBase}/_manifest.txt`, diskPath: manifestTmp });
  } catch {}
  try {
    const result = createZipStore(outPath, entries);
    try { if (fs.existsSync(manifestTmp)) fs.unlinkSync(manifestTmp); } catch {}
    audit('Admin Downloaded ZIP', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `folder=${params.id} files=${result.files}`, ip: clientIp(req) });
    const stamp = new Date().toISOString().slice(0, 10);
    return json({ ok: true, file: path.basename(outPath), zipName: `${folderBase}-${stamp}.zip`, files: result.files, bytes: result.bytes });
  } catch {
    try { if (fs.existsSync(manifestTmp)) fs.unlinkSync(manifestTmp); } catch {}
    return err('ZIP generation failed.', 500);
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireAdmin(req);
  if ('errorResponse' in g) return g.errorResponse;
  const url = new URL(req.url);
  const file = (url.searchParams.get('file') || '').trim();
  if (!file) return err('File is required.', 400);
  if (!/^[a-fA-F0-9-]{8,80}\.zip$/.test(file)) return err('Invalid file.', 400);
  if (!file.startsWith(params.id + '-')) return err('You are not authorized.', 403);
  const disk = path.join(storageSubdir('zips'), file);
  if (!disk.startsWith(storageSubdir('zips'))) return err('Invalid file.', 400);
  if (!fs.existsSync(disk)) return err('ZIP not found or expired.', 404);
  const db = await dbReady();
  const folder = db.prepare('SELECT name FROM submission_folders WHERE id = ?').get(params.id) as unknown as { name: string } | undefined;
  const zipName = `${sanitizeZipFileName(folder?.name || 'folder')}.zip`;
  const stat = fs.statSync(disk);
  const stream = fs.createReadStream(disk);
  audit('Admin Downloaded ZIP File', { actorType: 'admin', actorId: g.admin.id, actorName: g.admin.username, details: `folder=${params.id} zip=${file}`, ip: clientIp(req) });
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${zipName.replace(/[^\x20-\x7E]/g, '_')}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
