-- مساعد الدراسة الذكي والمرشد الأكاديمي (من حزمة الدمج، 2026-11). إضافة فقط: كل الجداول تبدأ بـ ai_ ولا يُعدَّل أي جدول قائم.
-- department_key = d<رقم القسم>. user_id = رقم المستخدم في users (نصاً). نصوص الصفحات يرسلها متصفح الطالب من «اكتب وظلّل» وتبقى خاصة به.

CREATE TABLE IF NOT EXISTS ai_department_knowledge (
  id TEXT PRIMARY KEY,
  department_key TEXT NOT NULL,
  department_name TEXT NOT NULL,
  category TEXT NOT NULL,
  title TEXT NOT NULL,
  content TEXT NOT NULL,
  created_by TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_dept_kb_key ON ai_department_knowledge(department_key, category);

CREATE TABLE IF NOT EXISTS ai_documents (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  course_id TEXT,
  filename TEXT NOT NULL,
  safe_name TEXT NOT NULL,
  r2_object_key TEXT NOT NULL,
  mime_type TEXT NOT NULL DEFAULT 'application/pdf',
  size_bytes INTEGER NOT NULL,
  sha256 TEXT NOT NULL,
  page_count INTEGER NOT NULL DEFAULT 0,
  text_page_count INTEGER NOT NULL DEFAULT 0,
  ocr_needed_pages_json TEXT NOT NULL DEFAULT '[]',
  status TEXT NOT NULL DEFAULT 'ready',
  error_message TEXT,
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_documents_user ON ai_documents(user_id, created_at DESC);
CREATE INDEX IF NOT EXISTS idx_ai_documents_sha256 ON ai_documents(user_id, sha256);

CREATE TABLE IF NOT EXISTS ai_document_pages (
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  text_content TEXT NOT NULL,
  has_extractable_text INTEGER NOT NULL DEFAULT 1,
  char_count INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (document_id, page_number),
  FOREIGN KEY (document_id) REFERENCES ai_documents(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_document_chunks (
  chunk_id TEXT PRIMARY KEY,
  document_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  chunk_index INTEGER NOT NULL,
  content TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES ai_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_chunks_doc_page ON ai_document_chunks(document_id, page_number);

CREATE TABLE IF NOT EXISTS ai_conversations (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  title TEXT NOT NULL,
  document_id TEXT,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_conversations_user ON ai_conversations(user_id, updated_at DESC);

CREATE TABLE IF NOT EXISTS ai_messages (
  id TEXT PRIMARY KEY,
  conversation_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  role TEXT NOT NULL,
  task TEXT NOT NULL DEFAULT 'ask',
  content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  artifact_id TEXT,
  provider_mode TEXT NOT NULL DEFAULT 'cloudflare',
  status TEXT NOT NULL DEFAULT 'completed',
  created_at TEXT NOT NULL,
  FOREIGN KEY (conversation_id) REFERENCES ai_conversations(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_messages_conv ON ai_messages(conversation_id, created_at ASC);

CREATE TABLE IF NOT EXISTS ai_artifacts (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  document_id TEXT,
  conversation_id TEXT,
  kind TEXT NOT NULL,
  title TEXT NOT NULL,
  page_refs_json TEXT NOT NULL DEFAULT '[]',
  payload_json TEXT NOT NULL,
  provider_mode TEXT NOT NULL DEFAULT 'cloudflare',
  created_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_artifacts_user ON ai_artifacts(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS ai_quiz_attempts (
  id TEXT PRIMARY KEY,
  quiz_artifact_id TEXT NOT NULL,
  user_id TEXT NOT NULL,
  score INTEGER NOT NULL,
  total INTEGER NOT NULL,
  percentage INTEGER NOT NULL,
  answers_json TEXT NOT NULL,
  created_at TEXT NOT NULL,
  FOREIGN KEY (quiz_artifact_id) REFERENCES ai_artifacts(id) ON DELETE CASCADE
);

CREATE TABLE IF NOT EXISTS ai_notebook_notes (
  id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  document_id TEXT NOT NULL,
  page_number INTEGER NOT NULL,
  selected_text TEXT NOT NULL DEFAULT '',
  action_type TEXT NOT NULL DEFAULT 'note',
  note_content TEXT NOT NULL,
  citations_json TEXT NOT NULL DEFAULT '[]',
  artifact_id TEXT,
  created_at TEXT NOT NULL,
  FOREIGN KEY (document_id) REFERENCES ai_documents(id) ON DELETE CASCADE
);

CREATE INDEX IF NOT EXISTS idx_ai_notes_doc_page ON ai_notebook_notes(user_id, document_id, page_number);

CREATE TABLE IF NOT EXISTS ai_quota_ledger (
  reservation_id TEXT PRIMARY KEY,
  user_id TEXT NOT NULL,
  task TEXT NOT NULL,
  units INTEGER NOT NULL DEFAULT 1,
  status TEXT NOT NULL,
  day_key TEXT NOT NULL,
  created_at TEXT NOT NULL,
  updated_at TEXT NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_ai_quota_user_day ON ai_quota_ledger(user_id, day_key, status);

CREATE TABLE IF NOT EXISTS ai_audit_logs (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id TEXT,
  action TEXT NOT NULL,
  resource_type TEXT NOT NULL,
  resource_id TEXT,
  status_code INTEGER NOT NULL,
  meta_json TEXT NOT NULL DEFAULT '{}',
  created_at TEXT NOT NULL
);
