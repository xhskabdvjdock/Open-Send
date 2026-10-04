import fs from 'node:fs';
import path from 'node:path';
import { dbReady } from '@/lib/db';
import { json, err, clientIp } from '@/lib/api';
import { requireTeacher } from '@/lib/teacherGuard';
import { audit } from '@/lib/server-utils';
import { teacherOwnsFolder, cleanupOldZips } from '@/lib/folders';
import { storageSubdir, sanitizeZipSegment, sanitizeZipFileName } from '@/lib/paths';
import { createZipStore } from '@/lib/zip';
import { getSettings } from '@/lib/settings';
import { newId, nowISO } from '@/lib/crypto';

export const runtime = 'nodejs';
export const dynamic = 'force-dynamic';

/**
 * POST { includeMessages, includeHistory, includeDates } -> generates ZIP, returns { jobId, file, files, bytes }
 * GET ?file=xxx -> downloads generated ZIP (with progress-friendly streaming)
 * GET (no file) -> lists recent ZIPs for this folder
 */
export async function POST(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherOwnsFolder(g.teacher.id, params.id)) return err('Folder not found.', 404);
  let body: { includeMessages?: boolean; includeHistory?: boolean; includeDates?: boolean; includeMeta?: boolean } = {};
  try {
    body = await req.json();
  } catch { body = {}; }
  // Defaults: current submissions only, with metadata+dates. Messages + history opt-in.
  const wantMessages = body.includeMessages === true;
  const wantHistory = body.includeHistory === true;
  const wantDates = body.includeDates !== false;
  const wantMeta = (body as Record<string, unknown>).includeMeta !== false;

  const db = await dbReady();
  const folder = db.prepare('SELECT * FROM submission_folders WHERE id = ?').get(params.id) as unknown as { id: string; name: string } | undefined;
  if (!folder) return err('Folder not found.', 404);

  const statusFilter = wantHistory ? '' : "AND s.status = 'current'";
  const subs = db.prepare(
    `SELECT s.*, u.username AS studentUsername, u.displayName AS studentName
     FROM submissions s JOIN users u ON u.id = s.studentId
     WHERE s.folderId = ? ${statusFilter} ORDER BY u.displayName, s.submissionNumber`
  ).all(params.id) as unknown as { id: string; studentUsername: string; displayName?: string; studentName: string; submissionNumber: number; message: string; createdAt: string; isLate: number; status: string }[];

  const settings = getSettings();
  cleanupOldZips(settings.zipRetentionMinutes);

  fs.mkdirSync(storageSubdir('zips'), { recursive: true });
  fs.mkdirSync(storageSubdir('submissions'), { recursive: true });

  const folderBase = sanitizeZipFileName(folder.name);
  const stamp = new Date().toISOString().slice(0, 10);
  const zipName = `${folderBase}-${stamp}-${params.id.slice(0, 6)}.zip`;
  const outPath = path.join(storageSubdir('zips'), `${params.id}-${newId().slice(0, 8)}.zip`);

  const entries: { name: string; diskPath: string }[] = [];
  const usedNames = new Set<string>();
  const manifestLines: string[] = [`Folder: ${folder.name}`, `Exported: ${nowISO()}`, `Submissions: ${subs.length}`, ''];

  for (const s of subs) {
    const studentDir = sanitizeZipSegment(`${s.studentName || s.studentUsername}`.replace(/\s+/g, '-'), 'student');
    const files = db.prepare('SELECT * FROM submission_files WHERE submissionId = ? ORDER BY createdAt').all(s.id) as unknown as { storedFile: string; originalName: string }[];
    for (const fl of files) {
      const disk = path.join(storageSubdir('submissions'), fl.storedFile);
      if (!fs.existsSync(disk)) continue;
      const safeFile = sanitizeZipSegment(fl.originalName, 'file');
      let entry = `${folderBase}/${studentDir}/${safeFile}`;
      // Deduplicate
      let n = 1;
      while (usedNames.has(entry)) {
        const dot = safeFile.lastIndexOf('.');
        const stem = dot > 0 ? safeFile.slice(0, dot) : safeFile;
        const ext = dot > 0 ? safeFile.slice(dot) : '';
        entry = `${folderBase}/${studentDir}/${stem} (${n})${ext}`;
        n++;
        if (n > 50) break;
      }
      usedNames.add(entry);
      entries.push({ name: entry, diskPath: disk });
    }
    manifestLines.push(`- ${s.studentName} (@${s.studentUsername}) #${s.submissionNumber} ${s.status}${s.isLate ? ' LATE' : ''} ${wantDates ? s.createdAt : ''}`);
    if (wantMessages && s.message) manifestLines.push(`  Message: ${s.message.slice(0, 300)}`);
  }

  // Manifest file
  const manifestTmp = path.join(storageSubdir('tmp'), `manifest-${newId().slice(0, 8)}.txt`);
  try {
    fs.writeFileSync(manifestTmp, manifestLines.join('\n'), 'utf8');
    if (wantMeta) entries.push({ name: `${folderBase}/_manifest.txt`, diskPath: manifestTmp });
  } catch {}

  try {
    const result = createZipStore(outPath, entries);
    try { if (fs.existsSync(manifestTmp)) fs.unlinkSync(manifestTmp); } catch {}
    audit('Teacher Downloaded ZIP', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `folder=${params.id} files=${result.files} bytes=${result.bytes}`, ip: clientIp(req) });
    const token = path.basename(outPath);
    return json({ ok: true, file: token, zipName, files: result.files, bytes: result.bytes });
  } catch (e) {
    try { if (fs.existsSync(manifestTmp)) fs.unlinkSync(manifestTmp); } catch {}
    return err('ZIP generation failed.', 500);
  }
}

export async function GET(req: Request, { params }: { params: { id: string } }) {
  const g = await requireTeacher(req);
  if ('errorResponse' in g) return g.errorResponse;
  if (!teacherOwnsFolder(g.teacher.id, params.id)) return err('Folder not found.', 404);
  const url = new URL(req.url);
  const file = (url.searchParams.get('file') || '').trim();
  if (!file) {
    // List zips for this folder
    let files: { name: string; size: number; createdAt: string }[] = [];
    try {
      const entries = fs.readdirSync(storageSubdir('zips'));
      for (const e of entries) {
        if (!e.startsWith(params.id + '-')) continue;
        try {
          const st = fs.statSync(path.join(storageSubdir('zips'), e));
          files.push({ name: e, size: st.size, createdAt: st.mtime.toISOString() });
        } catch {}
      }
    } catch {}
    return json({ zips: files });
  }
  // Validate file token: must be "<folderId>-<hex>.zip"
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
  audit('Teacher Downloaded ZIP File', { actorType: 'teacher', actorId: g.teacher.id, actorName: g.teacher.username, details: `folder=${params.id} zip=${file}`, ip: clientIp(req) });
  const ascii = zipName.replace(/[^\x20-\x7E]/g, '_');
  return new Response(stream as unknown as BodyInit, {
    status: 200,
    headers: {
      'Content-Type': 'application/zip',
      'Content-Length': String(stat.size),
      'Content-Disposition': `attachment; filename="${ascii}"`,
      'X-Content-Type-Options': 'nosniff',
      'Cache-Control': 'private, no-store',
    },
  });
}
