-- جدول الامتحانات: يضيفه ممثل القسم/المرحلة ويراه طلاب القسم. stage فارغ = كل مراحل القسم.
CREATE TABLE IF NOT EXISTS exams (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  stage INTEGER,
  title TEXT NOT NULL,
  exam_date TEXT NOT NULL,
  exam_time TEXT,
  place TEXT,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_exams_dept_date ON exams(department_id, exam_date);
