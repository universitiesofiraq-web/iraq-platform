-- تأكيد الممثل لطلاب مرحلته. التأكيد يخصّ المرحلة المسجّل فيها الطالب فيُلغى ضمنياً إن غيّرها.
CREATE TABLE IF NOT EXISTS student_verification (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  verified_by INTEGER NOT NULL REFERENCES users(id),
  verified_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_student_verification_stage ON student_verification(stage_id);
