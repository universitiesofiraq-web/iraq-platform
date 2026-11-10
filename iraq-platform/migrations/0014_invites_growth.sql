-- روابط دعوة لكل قسم أو مرحلة، وتسجيل مصدر أول تسجيل لكل طالب لتحليل النمو.
CREATE TABLE IF NOT EXISTS invitations (
  code TEXT PRIMARY KEY,
  type TEXT NOT NULL CHECK (type IN ('department', 'stage')),
  node_id INTEGER NOT NULL,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  revoked_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_invitations_node ON invitations(type, node_id);

CREATE TABLE IF NOT EXISTS signup_events (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  invite_code TEXT,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_signup_events_time ON signup_events(created_at);
