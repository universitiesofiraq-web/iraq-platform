-- التبليغات: يكتبها ممثل الدفعة أو المشرف، وتظهر لكل الطلاب في الرئيسية.
-- الأدوار مخزنة في users.role كنص: student | uploader | rep | admin (لا تغيير في المخطط).
CREATE TABLE IF NOT EXISTS announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  title TEXT NOT NULL,
  body TEXT NOT NULL DEFAULT '',
  author_id INTEGER NOT NULL,
  author_name TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS announcements_time ON announcements (created_at DESC);
