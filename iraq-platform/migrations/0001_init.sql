-- قاعدة بيانات المنصة العراقية (Cloudflare D1): حسابات Google وجلساتها وبيانات الطالب المتزامنة.
-- لا نخزّن كلمات مرور: الدخول بحساب Google فقط. نخزّن الاسم والبريد فقط.
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  google_sub TEXT NOT NULL UNIQUE,
  email TEXT NOT NULL,
  name TEXT NOT NULL,
  role TEXT NOT NULL DEFAULT 'student',
  active INTEGER NOT NULL DEFAULT 1,
  created_at INTEGER NOT NULL
);
CREATE TABLE IF NOT EXISTS sessions (
  token_hash TEXT PRIMARY KEY,
  user_id INTEGER NOT NULL,
  expires_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS sessions_user ON sessions(user_id);
CREATE TABLE IF NOT EXISTS user_data (
  user_id INTEGER NOT NULL,
  k TEXT NOT NULL,
  v TEXT NOT NULL,
  t INTEGER NOT NULL,
  PRIMARY KEY (user_id, k)
);
