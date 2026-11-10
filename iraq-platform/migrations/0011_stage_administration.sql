-- One representative per stable academic stage. Existing university, college, and department grants are preserved.
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_stage_representative ON scopes(node_id)
  WHERE type='stage' AND level='rep';
CREATE UNIQUE INDEX IF NOT EXISTS idx_single_stage_per_representative ON scopes(user_id)
  WHERE type='stage' AND level='rep';

CREATE TABLE IF NOT EXISTS stage_announcements (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  author_id INTEGER NOT NULL REFERENCES users(id),
  title TEXT NOT NULL,
  body TEXT NOT NULL,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_stage_announcements_stage ON stage_announcements(stage_id,id DESC);
