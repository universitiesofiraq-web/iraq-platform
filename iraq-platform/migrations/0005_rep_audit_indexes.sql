-- C1 (تطوير 02-A): إضافات تراكمية فقط، بلا حذف ولا تعديل لجداول موجودة.
-- سجل تدقيق لمنح/سحب الصلاحيات وقرارات الطلبات.
CREATE TABLE IF NOT EXISTS scope_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  target_user_id INTEGER NOT NULL,
  action TEXT NOT NULL,            -- grant | revoke | approve | reject
  type TEXT,
  node_id INTEGER,
  created_at TEXT NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_scope_audit_target ON scope_audit(target_user_id);
CREATE INDEX IF NOT EXISTS idx_rep_requests_status ON rep_requests(status);
CREATE INDEX IF NOT EXISTS idx_scopes_user ON scopes(user_id);
