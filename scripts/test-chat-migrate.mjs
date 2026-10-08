// Chat migration test: runs the REAL migrate()/seed on a COPY of the live DB.
// Run from project root: node scripts/test-chat-migrate.mjs (never touches production files)
import { register } from 'node:module';
import { pathToFileURL } from 'node:url';
register(pathToFileURL('scripts/chat-test-loader.mjs'));
import fs from 'node:fs';
import os from 'node:os';
import path from 'node:path';

const tmp = fs.mkdtempSync(path.join(os.tmpdir(), 'chatmig-'));
for (const ext of ['', '-wal', '-shm']) {
  const src = `D:/project/Open-Send-main/data/opensend.db${ext}`;
  if (fs.existsSync(src)) fs.copyFileSync(src, path.join(tmp, `opensend.db${ext}`));
}
process.env.OPENSEND_DB = path.join(tmp, 'opensend.db');
process.env.OPENSEND_STORAGE = path.join(tmp, 'storage');

const { dbReady } = await import('../lib/db.ts');
const db = await dbReady();

let pass = 0, fail = 0;
const eq = (name, got, want) => {
  if (JSON.stringify(got) === JSON.stringify(want)) pass++;
  else { fail++; console.log(`FAIL ${name}: got ${JSON.stringify(got)}, want ${JSON.stringify(want)}`); }
};

const tables = Object.fromEntries(
  db.prepare("SELECT name FROM sqlite_master WHERE type='table'").all().map((r) => [r.name, true])
);
for (const t of ['conversations', 'conversation_participants', 'chat_messages', 'chat_banned_words', 'chat_suspensions', 'chat_moderation_events', 'chat_presence', 'chat_blocks', 'library_books', 'library_book_classes', 'folder_attachments']) {
  eq('table ' + t, !!tables[t], true);
}
// old tables intact
for (const t of ['users', 'transfers', 'submissions', 'teachers', 'admins', 'sessions']) {
  eq('legacy table ' + t, !!tables[t], true);
}
const idx = Object.fromEntries(
  db.prepare("SELECT name FROM sqlite_master WHERE type='index'").all().map((r) => [r.name, true])
);
for (const i of ['idx_cpart_user', 'idx_cmsg_conv', 'idx_cmsg_clientid', 'idx_cword_enabled', 'idx_csusp_user', 'idx_cmod_user']) {
  eq('index ' + i, !!idx[i], true);
}
const settings = Object.fromEntries(
  db.prepare("SELECT key, value FROM system_settings WHERE key LIKE 'chat%' OR key IN ('allowAvatarUpload', 'allowUsernameChange', 'maxAvatarMB', 'libraryEnabled', 'maxLibraryFileMB')").all().map((r) => [r.key, r.value])
);
// Settings keys exist (values are admin data on a used DB — only presence is asserted).
for (const k of ['chatEnabled', 'chatStudentChat', 'chatTeacherChat', 'chatMaxLength', 'chatAttachments', 'chatMaxAttachmentMB', 'chatModeration', 'chatDefaultSuspensionMinutes', 'chatRateMax', 'chatRateWindowMinutes', 'chatShowOnline', 'chatShowLastSeen', 'chatBrowserNotify', 'allowAvatarUpload', 'allowUsernameChange', 'maxAvatarMB', 'libraryEnabled', 'maxLibraryFileMB']) {
  eq('setting key ' + k, k in settings, true);
}
const ucols = db.prepare('PRAGMA table_info(users)').all().map((c) => c.name);
const tcols = db.prepare('PRAGMA table_info(teachers)').all().map((c) => c.name);
eq('users.avatarFile column', ucols.includes('avatarFile'), true);
eq('teachers.avatarFile column', tcols.includes('avatarFile'), true);
eq('chat key count', Object.keys(settings).length >= 12, true);
const ver = db.prepare("SELECT value FROM system_settings WHERE key='appVersion'").get();
eq('appVersion 1.2.0', ver.value, '1.2.0');
// users preserved (copy of live data)
const users = db.prepare('SELECT COUNT(*) AS c FROM users').get().c;
eq('users preserved (>0)', users > 0, true);
// teacher-chat FK relaxation: participants/messages/presence must NOT
// reference users() anymore (conversations() FK stays), and teacher ids
// must be insertable (would have thrown SQLITE_CONSTRAINT before).
const fkOf = (t) => db.prepare(`PRAGMA foreign_key_list(${t})`).all().map((r) => r.table);
eq('participants: no users-FK', fkOf('conversation_participants').includes('users'), false);
eq('messages: no users-FK', fkOf('chat_messages').includes('users'), false);
eq('presence: no users-FK', fkOf('chat_presence').includes('users'), false);
eq('participants: conversations-FK kept', fkOf('conversation_participants').includes('conversations'), true);
eq('messages: conversations-FK kept', fkOf('chat_messages').includes('conversations'), true);
eq('participants: hiddenAt column', db.prepare('PRAGMA table_info(conversation_participants)').all().some((c) => c.name === 'hiddenAt'), true);
let teacherInsertOk = false;
try {
  const now = new Date().toISOString();
  db.prepare("INSERT INTO conversations(id, kind, createdAt, updatedAt) VALUES ('mig-teacher-conv', 'teacher', ?, ?)").run(now, now);
  db.prepare('INSERT INTO conversation_participants(conversationId, userId, lastReadAt, joinedAt) VALUES (?, ?, ?, ?)').run('mig-teacher-conv', 'teacher ghost id', '', now);
  db.prepare("INSERT INTO chat_messages(id, conversationId, senderId, kind, content, moderationStatus, clientId, createdAt, updatedAt) VALUES ('mig-teacher-msg', 'mig-teacher-conv', 'teacher ghost id', 'text', 'hi', 'VISIBLE', '', ?, ?)").run(now, now);
  db.prepare("INSERT INTO chat_presence(userId, lastSeenAt) VALUES ('teacher ghost id', ?)").run(now);
  teacherInsertOk = true;
  db.prepare("DELETE FROM chat_messages WHERE id = 'mig-teacher-msg'").run();
  db.prepare("DELETE FROM chat_presence WHERE userId = 'teacher ghost id'").run();
  db.prepare("DELETE FROM conversation_participants WHERE conversationId = 'mig-teacher-conv'").run();
  db.prepare("DELETE FROM conversations WHERE id = 'mig-teacher-conv'").run();
} catch (e) {
  console.log('teacher insert err: ' + ((e && e.message) || e));
}
eq('teacher ids insertable + cleaned', teacherInsertOk, true);

console.log(`\nchat migration: ${pass} passed, ${fail} failed`);
try { fs.rmSync(tmp, { recursive: true, force: true }); } catch {}
process.exit(fail ? 1 : 0);
