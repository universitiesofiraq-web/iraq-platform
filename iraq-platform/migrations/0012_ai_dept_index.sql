-- فهرس نصوص ملفات القسم المشترك للمرشد الذكي. يرسله ممثل القسم أو المشرف فقط (لا يستطيع الطلبة تسميمه).
CREATE TABLE IF NOT EXISTS ai_dept_files (
  file_id TEXT NOT NULL,
  department_key TEXT NOT NULL,
  subject TEXT,
  title TEXT,
  pages INTEGER NOT NULL DEFAULT 0,
  chunks INTEGER NOT NULL DEFAULT 0,
  indexed_by TEXT,
  indexed_at TEXT NOT NULL,
  PRIMARY KEY (file_id, department_key)
);
CREATE TABLE IF NOT EXISTS ai_dept_chunks (
  id TEXT PRIMARY KEY,
  department_key TEXT NOT NULL,
  file_id TEXT NOT NULL,
  subject TEXT,
  title TEXT,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_ai_dept_chunks_dept ON ai_dept_chunks(department_key, file_id);
