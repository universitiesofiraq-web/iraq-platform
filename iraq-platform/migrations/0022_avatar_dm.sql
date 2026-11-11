-- منقول من ميدكسا (2026-11-11): صورة الطالب واسمه الظاهر + الرسائل الخاصة. a_id < b_id دائماً.
-- صورة الطالب واسمه الظاهر (للدردشة والملف الشخصي). الصورة مصغّرة JPEG بترميز base64 (حتى ~67KB).
CREATE TABLE IF NOT EXISTS user_avatars (
  user_id INTEGER PRIMARY KEY,
  display_name TEXT,
  avatar TEXT,
  updated_at INTEGER NOT NULL DEFAULT 0
);
-- الرسائل الخاصة بين الحسابات. a_id < b_id دائماً (زوج مرتَّب يعرّف المحادثة).
CREATE TABLE IF NOT EXISTS dm_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  a_id INTEGER NOT NULL,
  b_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  deleted_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_dm_pair ON dm_messages(a_id, b_id, id);
CREATE TABLE IF NOT EXISTS dm_threads (
  a_id INTEGER NOT NULL,
  b_id INTEGER NOT NULL,
  last_id INTEGER NOT NULL,
  last_at INTEGER NOT NULL,
  last_sender INTEGER NOT NULL,
  last_body TEXT NOT NULL,
  PRIMARY KEY (a_id, b_id)
);
CREATE INDEX IF NOT EXISTS idx_dm_threads_b ON dm_threads(b_id, last_at);
CREATE TABLE IF NOT EXISTS dm_reads (
  user_id INTEGER NOT NULL,
  peer_id INTEGER NOT NULL,
  last_read INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, peer_id)
);
CREATE TABLE IF NOT EXISTS dm_blocks (
  blocker_id INTEGER NOT NULL,
  blocked_id INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (blocker_id, blocked_id)
);
CREATE TABLE IF NOT EXISTS dm_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  reporter_id INTEGER NOT NULL,
  sender_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (message_id, reporter_id)
);
