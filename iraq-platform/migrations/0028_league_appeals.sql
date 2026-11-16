CREATE TABLE IF NOT EXISTS league_appeals (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 submission_id INTEGER NOT NULL UNIQUE REFERENCES league_submissions(id),
 reason TEXT NOT NULL,
 state TEXT NOT NULL DEFAULT 'pending' CHECK(state IN ('pending','resolved')),
 created_at INTEGER NOT NULL,
 resolved_at INTEGER
);
CREATE TABLE IF NOT EXISTS league_review_history (
 id INTEGER PRIMARY KEY AUTOINCREMENT,
 submission_id INTEGER NOT NULL REFERENCES league_submissions(id),
 state TEXT NOT NULL,
 reason TEXT NOT NULL,
 actor_id INTEGER REFERENCES users(id),
 created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS league_history_submission ON league_review_history(submission_id,id);
CREATE TRIGGER IF NOT EXISTS league_record_decision AFTER UPDATE OF state,review_reason ON league_submissions
WHEN NEW.reviewed_by IS NOT NULL AND (OLD.state!=NEW.state OR COALESCE(OLD.review_reason,'')!=COALESCE(NEW.review_reason,'') OR OLD.reviewed_by IS NOT NEW.reviewed_by OR EXISTS(SELECT 1 FROM league_appeals a WHERE a.submission_id=NEW.id AND a.state='pending'))
BEGIN
 INSERT INTO league_review_history(submission_id,state,reason,actor_id,created_at)
 VALUES(NEW.id,NEW.state,NEW.review_reason,NEW.reviewed_by,NEW.reviewed_at);
END;
CREATE TRIGGER IF NOT EXISTS league_remove_appeal_identity AFTER UPDATE OF google_sub ON users
WHEN NEW.google_sub='deleted-' || NEW.id
BEGIN
 UPDATE league_appeals SET reason='' WHERE submission_id IN (SELECT id FROM league_submissions WHERE user_id=NEW.id);
END;

CREATE TABLE IF NOT EXISTS league_challenge_stages (
 challenge_id INTEGER PRIMARY KEY REFERENCES league_challenges(id),
 stage_id INTEGER NOT NULL REFERENCES stages(id)
);
CREATE TRIGGER IF NOT EXISTS league_scope_insert BEFORE INSERT ON league_challenge_stages
WHEN (SELECT s.state FROM league_challenges c JOIN league_seasons s ON s.id=c.season_id WHERE c.id=NEW.challenge_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'season_locked'); END;
CREATE TRIGGER IF NOT EXISTS league_scope_update BEFORE UPDATE ON league_challenge_stages
BEGIN SELECT RAISE(ABORT,'season_locked'); END;
CREATE TRIGGER IF NOT EXISTS league_scope_delete BEFORE DELETE ON league_challenge_stages
WHEN (SELECT s.state FROM league_challenges c JOIN league_seasons s ON s.id=c.season_id WHERE c.id=OLD.challenge_id)<>'draft'
BEGIN SELECT RAISE(ABORT,'season_locked'); END;

CREATE TRIGGER IF NOT EXISTS league_independent_appeal_review BEFORE UPDATE OF state ON league_submissions
WHEN OLD.reviewed_by=NEW.reviewed_by AND EXISTS(SELECT 1 FROM league_appeals WHERE submission_id=OLD.id AND state='pending')
BEGIN SELECT RAISE(ABORT,'independent_review_required'); END;
