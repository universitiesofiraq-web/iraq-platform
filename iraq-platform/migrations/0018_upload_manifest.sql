-- قائمة الملفات المرفوعة كانت مفتاح KV واحداً (manifest.json)؛ تنتقل إلى صفوف مستقلة في D1.
CREATE TABLE IF NOT EXISTS upload_manifest (
  seq INTEGER PRIMARY KEY AUTOINCREMENT,
  id TEXT NOT NULL UNIQUE,
  course_id TEXT,
  json TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_upload_manifest_course ON upload_manifest(course_id);
CREATE TABLE IF NOT EXISTS import_flags (name TEXT PRIMARY KEY, at INTEGER NOT NULL);
