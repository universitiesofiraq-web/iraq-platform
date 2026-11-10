-- ADMIN_EMAILS remains the authority for owners. Delegated administrators are separate.
CREATE TABLE IF NOT EXISTS global_admins (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  active INTEGER NOT NULL CHECK (active IN (0,1)),
  changed_by INTEGER NOT NULL REFERENCES users(id),
  changed_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS global_admin_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  actor_id INTEGER NOT NULL,
  action TEXT NOT NULL CHECK (action IN ('grant','revoke')),
  created_at INTEGER NOT NULL
);

CREATE TRIGGER IF NOT EXISTS global_admin_granted AFTER INSERT ON global_admins
WHEN NEW.active=1
BEGIN
  INSERT INTO global_admin_audit (user_id,actor_id,action,created_at)
  VALUES (NEW.user_id,NEW.changed_by,'grant',NEW.changed_at);
END;

CREATE TRIGGER IF NOT EXISTS global_admin_changed AFTER UPDATE OF active ON global_admins
WHEN OLD.active<>NEW.active
BEGIN
  INSERT INTO global_admin_audit (user_id,actor_id,action,created_at)
  VALUES (NEW.user_id,NEW.changed_by,CASE NEW.active WHEN 1 THEN 'grant' ELSE 'revoke' END,NEW.changed_at);
END;
