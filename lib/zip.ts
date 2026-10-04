import fs from 'node:fs';
import path from 'node:path';

/* Minimal ZIP writer (STORE = no compression) with streaming file copy.
 * No dependencies, low memory: files are copied in 64KB chunks.
 * Safe: entry names are sanitized by callers; we additionally reject
 * absolute paths, drive letters, and ".." segments.
 */

const CRC_TABLE = (() => {
  const t = new Uint32Array(256);
  for (let n = 0; n < 256; n++) {
    let c = n;
    for (let k = 0; k < 8; k++) c = c & 1 ? 0xedb88320 ^ (c >>> 1) : c >>> 1;
    t[n] = c >>> 0;
  }
  return t;
})();

export function sanitizeZipEntry(name: string): string | null {
  let s = (name || '').replace(/\\/g, '/').trim();
  if (!s) return null;
  // Reject absolute / drive paths
  if (s.startsWith('/') || /^[a-zA-Z]:/.test(s)) return null;
  const parts = s.split('/').filter((p) => p && p !== '.' && p !== '..');
  if (parts.length === 0) return null;
  const cleaned = parts
    .map((p) => p.replace(/[\x00-\x1F\x7F<>:"|?*]/g, '-').replace(/^\.+/, '').replace(/[. ]+$/, '').slice(0, 100))
    .filter(Boolean);
  if (cleaned.length === 0) return null;
  const joined = cleaned.join('/');
  if (joined.length > 500) return null;
  return joined;
}

function dosTime(date = new Date()): { time: number; date: number } {
  const d = date;
  const time = ((d.getHours() & 31) << 11) | ((d.getMinutes() & 63) << 5) | ((Math.floor(d.getSeconds() / 2)) & 31);
  const dt = (((d.getFullYear() - 1980) & 127) << 9) | (((d.getMonth() + 1) & 15) << 5) | (d.getDate() & 31);
  return { time, date: dt };
}

export interface ZipEntry {
  /** Archive path, e.g. "Folder/Student/file.pdf" */
  name: string;
  /** Absolute disk path to source file */
  diskPath: string;
  mtime?: Date;
}

export interface ZipProgress {
  filesDone: number;
  filesTotal: number;
  bytesDone: number;
  bytesTotal: number;
  percent: number;
}

/**
 * Create a ZIP file at outPath from entries, streaming each file.
 * Calls onProgress periodically. Returns { bytes, files }.
 */
export function createZipStore(outPath: string, entries: ZipEntry[], onProgress?: (p: ZipProgress) => void): { bytes: number; files: number } {
  const safeEntries: { name: string; diskPath: string; mtime: Date; size: number }[] = [];
  let bytesTotal = 0;
  for (const e of entries) {
    const name = sanitizeZipEntry(e.name);
    if (!name) continue;
    if (name.endsWith('/')) continue;
    let st: fs.Stats;
    try {
      st = fs.statSync(e.diskPath);
    } catch {
      continue;
    }
    if (!st.isFile()) continue;
    safeEntries.push({ name, diskPath: e.diskPath, mtime: e.mtime || st.mtime, size: st.size });
    bytesTotal += st.size;
  }

  const fd = fs.openSync(outPath, 'w');
  const central: Buffer[] = [];
  let offset = 0;
  let bytesDone = 0;
  const report = (filesDone: number) => {
    if (onProgress) {
      const percent = bytesTotal > 0 ? Math.round((bytesDone / bytesTotal) * 100) : 100;
      onProgress({ filesDone, filesTotal: safeEntries.length, bytesDone, bytesTotal, percent });
    }
  };
  try {
    safeEntries.forEach((e, idx) => {
      const nameBuf = Buffer.from(e.name, 'utf8');
      const { time, date } = dosTime(e.mtime);
      // Compute CRC32 by streaming
      let crc = 0xffffffff;
      const rfd = fs.openSync(e.diskPath, 'r');
      const CHUNK = 64 * 1024;
      const buf = Buffer.alloc(CHUNK);
      try {
        let pos = 0;
        while (pos < e.size) {
          const toRead = Math.min(CHUNK, e.size - pos);
          const n = fs.readSync(rfd, buf, 0, toRead, pos);
          if (n <= 0) break;
          for (let i = 0; i < n; i++) crc = CRC_TABLE[(crc ^ buf[i]) & 0xff] ^ (crc >>> 8);
          pos += n;
        }
      } finally {
        fs.closeSync(rfd);
      }
      crc = (crc ^ 0xffffffff) >>> 0;

      // Local file header
      const lh = Buffer.alloc(30);
      lh.writeUInt32LE(0x04034b50, 0);
      lh.writeUInt16LE(20, 4); // version needed
      lh.writeUInt16LE(0x0800, 6); // UTF-8 flag
      lh.writeUInt16LE(0, 8); // method STORE
      lh.writeUInt16LE(time, 10);
      lh.writeUInt16LE(date, 12);
      lh.writeUInt32LE(crc, 14);
      lh.writeUInt32LE(e.size, 18);
      lh.writeUInt32LE(e.size, 22);
      lh.writeUInt16LE(nameBuf.length, 26);
      lh.writeUInt16LE(0, 28);
      fs.writeSync(fd, lh);
      fs.writeSync(fd, nameBuf);
      offset += lh.length + nameBuf.length;

      // File data (stream copy)
      const wfd = fd;
      const rfd2 = fs.openSync(e.diskPath, 'r');
      try {
        let pos = 0;
        while (pos < e.size) {
          const toRead = Math.min(CHUNK, e.size - pos);
          const n = fs.readSync(rfd2, buf, 0, toRead, pos);
          if (n <= 0) break;
          fs.writeSync(wfd, buf, 0, n);
          pos += n;
          bytesDone += n;
        }
      } finally {
        fs.closeSync(rfd2);
      }
      offset += e.size;

      // Central directory record
      const ch = Buffer.alloc(46);
      ch.writeUInt32LE(0x02014b50, 0);
      ch.writeUInt16LE(20, 4);
      ch.writeUInt16LE(20, 6);
      ch.writeUInt16LE(0x0800, 8);
      ch.writeUInt16LE(0, 10);
      ch.writeUInt16LE(time, 12);
      ch.writeUInt16LE(date, 14);
      ch.writeUInt32LE(crc, 16);
      ch.writeUInt32LE(e.size, 20);
      ch.writeUInt32LE(e.size, 24);
      ch.writeUInt16LE(nameBuf.length, 28);
      ch.writeUInt16LE(0, 30);
      ch.writeUInt16LE(0, 32);
      ch.writeUInt16LE(0, 34);
      ch.writeUInt16LE(0, 36);
      ch.writeUInt32LE(0, 38);
      ch.writeUInt32LE(offset - e.size - nameBuf.length - 30, 42);
      central.push(ch, nameBuf);
      report(idx + 1);
    });

    const centralStart = offset;
    let centralSize = 0;
    for (const c of central) {
      fs.writeSync(fd, c);
      centralSize += c.length;
    }
    offset += centralSize;
    const eocd = Buffer.alloc(22);
    eocd.writeUInt32LE(0x06054b50, 0);
    eocd.writeUInt16LE(0, 4);
    eocd.writeUInt16LE(0, 6);
    eocd.writeUInt16LE(safeEntries.length, 8);
    eocd.writeUInt16LE(safeEntries.length, 10);
    eocd.writeUInt32LE(centralSize, 12);
    eocd.writeUInt32LE(centralStart, 16);
    eocd.writeUInt16LE(0, 20);
    fs.writeSync(fd, eocd);
    offset += eocd.length;
  } finally {
    fs.closeSync(fd);
  }
  report(safeEntries.length);
  const stat = fs.statSync(outPath);
  return { bytes: stat.size, files: safeEntries.length };
}

export function zipJobFileName(folderName: string, folderId: string): string {
  const { sanitizeZipFileName } = require('./paths') as typeof import('./paths');
  const base = sanitizeZipFileName(folderName || 'folder');
  return `${base}-${folderId.slice(0, 6)}.zip`;
}
