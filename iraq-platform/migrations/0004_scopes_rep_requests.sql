-- الفرق المستقلة وطلبات التمثيل (مطابقة لما ينشئه functions/_lib/scope.js عند التشغيل).
-- scopes: من يملك صلاحية ممثل أو رافع على جامعة/كلية/قسم. المفتاح المركّب يمنع التكرار.
CREATE TABLE IF NOT EXISTS scopes (
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  node_id INTEGER NOT NULL,
  level TEXT NOT NULL,
  PRIMARY KEY (user_id, type, node_id)
);
-- rep_requests: طلبات الطلاب لتمثيل قسم/كلية/جامعة، يقرّرها المشرف (pending | approved | rejected).
CREATE TABLE IF NOT EXISTS rep_requests (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  type TEXT NOT NULL,
  node_id INTEGER NOT NULL,
  status TEXT NOT NULL DEFAULT 'pending',
  created_at TEXT NOT NULL
);
