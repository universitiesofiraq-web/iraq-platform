-- طلبات تفعيل قسم/جامعة يرسلها الطالب حين تكون جامعته غير مفعّلة.
CREATE TABLE IF NOT EXISTS activation_requests (
  user_id INTEGER NOT NULL REFERENCES users(id),
  department_id INTEGER NOT NULL REFERENCES departments(id),
  created_at INTEGER NOT NULL,
  PRIMARY KEY(user_id, department_id)
);
CREATE INDEX IF NOT EXISTS idx_activation_requests_dept ON activation_requests(department_id);
