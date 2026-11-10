-- Group chat v1: each named group belongs to exactly one academic stage.
-- No public group roster: messages are visible only through explicit chat_members membership.
CREATE TABLE IF NOT EXISTS chat_groups (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  name TEXT NOT NULL,
  invite_hash TEXT NOT NULL UNIQUE,
  created_by INTEGER NOT NULL REFERENCES users(id),
  created_at INTEGER NOT NULL,
  active INTEGER NOT NULL DEFAULT 1 CHECK(active IN (0,1)),
  UNIQUE(stage_id, name)
);
CREATE INDEX IF NOT EXISTS idx_chat_groups_stage ON chat_groups(stage_id);

CREATE TABLE IF NOT EXISTS chat_members (
  group_id INTEGER NOT NULL REFERENCES chat_groups(id),
  user_id INTEGER NOT NULL REFERENCES users(id),
  joined_at INTEGER NOT NULL,
  last_read_id INTEGER NOT NULL DEFAULT 0,
  muted INTEGER NOT NULL DEFAULT 0 CHECK(muted IN (0,1)),
  PRIMARY KEY(group_id, user_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_members_user ON chat_members(user_id, group_id);

CREATE TABLE IF NOT EXISTS chat_messages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES chat_groups(id),
  sender_id INTEGER NOT NULL REFERENCES users(id),
  client_id TEXT NOT NULL,
  body TEXT NOT NULL CHECK(length(body) <= 2000 AND (length(body) >= 1 OR deleted_at IS NOT NULL)),
  reply_to INTEGER REFERENCES chat_messages(id),
  created_at INTEGER NOT NULL,
  edited_at INTEGER,
  deleted_at INTEGER,
  pinned_at INTEGER,
  pinned_by INTEGER REFERENCES users(id),
  UNIQUE(sender_id, client_id)
);
CREATE INDEX IF NOT EXISTS idx_chat_messages_group_id ON chat_messages(group_id, id);
CREATE INDEX IF NOT EXISTS idx_chat_messages_sender ON chat_messages(sender_id, created_at);
CREATE INDEX IF NOT EXISTS idx_chat_messages_pinned ON chat_messages(group_id, pinned_at) WHERE pinned_at IS NOT NULL AND deleted_at IS NULL;

CREATE TABLE IF NOT EXISTS chat_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  message_id INTEGER NOT NULL REFERENCES chat_messages(id),
  reporter_id INTEGER NOT NULL REFERENCES users(id),
  reason TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE(message_id, reporter_id)
);

CREATE TABLE IF NOT EXISTS chat_moderation_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  group_id INTEGER NOT NULL REFERENCES chat_groups(id),
  message_id INTEGER REFERENCES chat_messages(id),
  actor_id INTEGER NOT NULL REFERENCES users(id),
  action TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
