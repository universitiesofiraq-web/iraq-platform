-- 0017: أدوات الإشراف على الدردشة + فهرس أداء. لا ALTER كي تبقى قابلة لإعادة التشغيل.
CREATE TABLE IF NOT EXISTS chat_silence (
  group_id INTEGER NOT NULL REFERENCES chat_groups(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  until_at INTEGER NOT NULL,
  set_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(group_id, user_id)
);
-- نسخة من نص الرسالة قبل الحذف/التعديل لتبقى أدلة البلاغات
CREATE TABLE IF NOT EXISTS chat_message_archive (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL,
  body TEXT NOT NULL,
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_chat_archive_msg ON chat_message_archive(message_id);
CREATE INDEX IF NOT EXISTS idx_chat_reports_msg ON chat_reports(message_id);
CREATE INDEX IF NOT EXISTS idx_departments_college ON departments(college_id);
