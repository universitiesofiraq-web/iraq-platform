CREATE TABLE IF NOT EXISTS chat_join_requests (
  group_id INTEGER NOT NULL REFERENCES chat_groups(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  status TEXT NOT NULL CHECK(status IN ('pending','approved','rejected','revoked')),
  requested_at INTEGER NOT NULL,
  reviewed_by INTEGER REFERENCES users(id),
  reviewed_at INTEGER,
  PRIMARY KEY(group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_join_requests_pending ON chat_join_requests(group_id, user_id)
  WHERE status='pending';
CREATE INDEX IF NOT EXISTS idx_chat_join_requests_user ON chat_join_requests(user_id, requested_at DESC);

CREATE TABLE IF NOT EXISTS chat_report_reviews (
  report_id INTEGER PRIMARY KEY REFERENCES chat_reports(id),
  decision TEXT NOT NULL CHECK(decision IN ('dismiss','remove')),
  reviewed_by INTEGER NOT NULL REFERENCES users(id),
  reviewed_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_chat_messages_removed ON chat_messages(group_id) WHERE deleted_at IS NOT NULL;
