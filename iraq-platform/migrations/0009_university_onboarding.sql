-- University directory entries do not imply membership. Preserve all existing rows.
CREATE TABLE IF NOT EXISTS university_onboarding (
  university_id INTEGER PRIMARY KEY REFERENCES universities(id),
  state TEXT NOT NULL CHECK (state IN ('registered', 'active', 'suspended')),
  manager_id INTEGER NOT NULL REFERENCES users(id),
  verified_at INTEGER,
  updated_at INTEGER NOT NULL,
  updated_by INTEGER NOT NULL REFERENCES users(id),
  CHECK (state = 'registered' OR verified_at IS NOT NULL)
);

CREATE TABLE IF NOT EXISTS university_onboarding_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  university_id INTEGER NOT NULL,
  actor_id INTEGER NOT NULL,
  manager_id INTEGER NOT NULL,
  previous_state TEXT,
  state TEXT NOT NULL,
  verified_at INTEGER,
  created_at INTEGER NOT NULL
);

CREATE INDEX IF NOT EXISTS idx_university_onboarding_state ON university_onboarding(state);
CREATE INDEX IF NOT EXISTS idx_university_onboarding_audit ON university_onboarding_audit(university_id, id DESC);

CREATE TRIGGER IF NOT EXISTS university_onboarding_registered
AFTER INSERT ON university_onboarding
BEGIN
  INSERT INTO university_onboarding_audit
    (university_id, actor_id, manager_id, previous_state, state, verified_at, created_at)
  VALUES
    (NEW.university_id, NEW.updated_by, NEW.manager_id, NULL, NEW.state, NEW.verified_at, NEW.updated_at);
END;

CREATE TRIGGER IF NOT EXISTS university_onboarding_changed
AFTER UPDATE ON university_onboarding
WHEN OLD.state <> NEW.state OR OLD.manager_id <> NEW.manager_id OR OLD.verified_at IS NOT NEW.verified_at
BEGIN
  INSERT INTO university_onboarding_audit
    (university_id, actor_id, manager_id, previous_state, state, verified_at, created_at)
  VALUES
    (NEW.university_id, NEW.updated_by, NEW.manager_id, OLD.state, NEW.state, NEW.verified_at, NEW.updated_at);
END;
