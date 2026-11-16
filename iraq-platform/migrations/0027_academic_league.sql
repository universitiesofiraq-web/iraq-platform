-- المواسم اختيارية، والعضوية ثابتة لكل موسم. لا تُنشأ منافسة تلقائياً.
CREATE TABLE IF NOT EXISTS league_seasons (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 title TEXT NOT NULL,
 starts_at INTEGER NOT NULL,
 ends_at INTEGER NOT NULL CHECK(ends_at>starts_at),
 state TEXT NOT NULL DEFAULT 'draft' CHECK(state IN ('draft','active','closed')),
 created_by INTEGER NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL
);
CREATE UNIQUE INDEX IF NOT EXISTS league_one_active ON league_seasons(state) WHERE state='active';
CREATE TABLE IF NOT EXISTS league_members (
 season_id INTEGER NOT NULL REFERENCES league_seasons(id),
 user_id INTEGER NOT NULL REFERENCES users(id),
 stage_id INTEGER NOT NULL REFERENCES stages(id),
 display_name TEXT NOT NULL,
 public INTEGER NOT NULL DEFAULT 0 CHECK(public IN (0,1)),
 joined_at INTEGER NOT NULL,
 PRIMARY KEY(season_id,user_id)
);
CREATE INDEX IF NOT EXISTS league_stage_members ON league_members(season_id,stage_id);
CREATE TABLE IF NOT EXISTS league_challenges (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 season_id INTEGER NOT NULL REFERENCES league_seasons(id),
 title TEXT NOT NULL,
 description TEXT NOT NULL,
 points INTEGER NOT NULL CHECK(points BETWEEN 1 AND 100),
 deadline INTEGER NOT NULL,
 created_by INTEGER NOT NULL REFERENCES users(id)
);
CREATE TABLE IF NOT EXISTS league_submissions (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 challenge_id INTEGER NOT NULL REFERENCES league_challenges(id),
 user_id INTEGER NOT NULL REFERENCES users(id),
 evidence TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','approved','rejected')),
 submitted_at INTEGER NOT NULL,
 review_reason TEXT,
 reviewed_by INTEGER REFERENCES users(id),
 reviewed_at INTEGER,
 UNIQUE(challenge_id,user_id)
);
CREATE TABLE IF NOT EXISTS league_ledger (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 submission_id INTEGER NOT NULL REFERENCES league_submissions(id),
 season_id INTEGER NOT NULL,
 user_id INTEGER NOT NULL,
 delta INTEGER NOT NULL,
 reason TEXT NOT NULL,
 actor_id INTEGER NOT NULL REFERENCES users(id),
 created_at INTEGER NOT NULL,
 FOREIGN KEY(season_id,user_id) REFERENCES league_members(season_id,user_id)
);
CREATE INDEX IF NOT EXISTS league_user_ledger ON league_ledger(season_id,user_id,id);
CREATE TRIGGER IF NOT EXISTS league_lock_challenges_insert BEFORE INSERT ON league_challenges
WHEN (SELECT state FROM league_seasons WHERE id=NEW.season_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'season_locked'); END;
CREATE TRIGGER IF NOT EXISTS league_lock_challenges_update BEFORE UPDATE ON league_challenges
BEGIN SELECT RAISE(ABORT,'challenge_immutable'); END;
CREATE TRIGGER IF NOT EXISTS league_submission_update BEFORE UPDATE OF state ON league_submissions
WHEN (SELECT s.state FROM league_challenges c JOIN league_seasons s ON s.id=c.season_id WHERE c.id=OLD.challenge_id)<>'active'
BEGIN SELECT RAISE(ABORT,'season_locked'); END;

CREATE TRIGGER IF NOT EXISTS league_account_anonymized AFTER UPDATE OF google_sub ON users
WHEN NEW.google_sub='deleted-' || NEW.id
BEGIN
 UPDATE league_members SET display_name='حساب محذوف',public=0 WHERE user_id=NEW.id;
 UPDATE league_submissions SET evidence='' WHERE user_id=NEW.id;
END;
