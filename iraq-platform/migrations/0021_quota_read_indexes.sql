-- فهارس تمنع مسح جداول كاملة في مسارات ساخنة (حصة D1 المجانية: 5 ملايين قراءة يومياً).
CREATE INDEX IF NOT EXISTS idx_sessions_expires ON sessions(expires_at);
CREATE INDEX IF NOT EXISTS idx_users_lower_email ON users(lower(email));
CREATE INDEX IF NOT EXISTS idx_ai_quota_day ON ai_quota_ledger(day_key, status);
CREATE INDEX IF NOT EXISTS idx_ai_chunks_user ON ai_document_chunks(user_id);
CREATE INDEX IF NOT EXISTS idx_ai_dept_files_dept ON ai_dept_files(department_key);
CREATE INDEX IF NOT EXISTS idx_chat_reports_reporter ON chat_reports(reporter_id, created_at);
