-- المنصة العراقية: هيكل متعدد الجامعات (Cloudflare D1 / SQLite)
-- جامعة > كلية > قسم > مرحلة > كورس > مادة > محاضرة > ملف
-- جدول users موجود في 0001 (google_sub, email, name, role, active)، فلا نعيد تعريفه.

CREATE TABLE IF NOT EXISTS universities (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  slug TEXT NOT NULL UNIQUE,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  city TEXT,
  is_active INTEGER NOT NULL DEFAULT 0   -- تُفتح فقط عند وجود ممثل وملفات
);
CREATE TABLE IF NOT EXISTS colleges (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  university_id INTEGER NOT NULL REFERENCES universities(id),
  slug TEXT NOT NULL,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  is_active INTEGER NOT NULL DEFAULT 0,
  UNIQUE (university_id, slug)
);
CREATE TABLE IF NOT EXISTS departments (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  college_id INTEGER NOT NULL REFERENCES colleges(id),
  name_ar TEXT NOT NULL,
  name_en TEXT
);
CREATE TABLE IF NOT EXISTS stages (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  department_id INTEGER NOT NULL REFERENCES departments(id),
  number INTEGER NOT NULL,
  UNIQUE (department_id, number)
);
CREATE TABLE IF NOT EXISTS terms (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  stage_id INTEGER NOT NULL REFERENCES stages(id),
  number INTEGER NOT NULL,
  UNIQUE (stage_id, number)
);
CREATE TABLE IF NOT EXISTS subjects (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  term_id INTEGER NOT NULL REFERENCES terms(id),
  code TEXT,
  name_ar TEXT NOT NULL,
  name_en TEXT,
  professor TEXT,
  credits REAL
);
CREATE TABLE IF NOT EXISTS lectures (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  number INTEGER NOT NULL,
  title TEXT NOT NULL
);
-- kind: lecture ملزمة | exam سؤال وزاري | summary ملخص | other
-- status: pending | approved | rejected | removed (لا يظهر إلا approved)
CREATE TABLE IF NOT EXISTS files (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  lecture_id INTEGER REFERENCES lectures(id),
  subject_id INTEGER NOT NULL REFERENCES subjects(id),
  kind TEXT NOT NULL DEFAULT 'lecture',
  label TEXT NOT NULL,
  r2_key TEXT NOT NULL,
  uploaded_by INTEGER REFERENCES users(id),
  status TEXT NOT NULL DEFAULT 'pending',
  reviewed_by INTEGER REFERENCES users(id),
  created_at INTEGER NOT NULL
);
-- أدوار محصورة بكلية: ممثل كلية يرفع ويوافق على كليته فقط. college_id = 0 يعني كل المنصة.
CREATE TABLE IF NOT EXISTS user_scopes (
  user_id INTEGER NOT NULL REFERENCES users(id),
  role TEXT NOT NULL,                      -- uploader | rep | moderator
  college_id INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, role, college_id)
);
CREATE TABLE IF NOT EXISTS user_profile (
  user_id INTEGER PRIMARY KEY REFERENCES users(id),
  college_id INTEGER REFERENCES colleges(id),
  stage_id INTEGER REFERENCES stages(id)
);
-- "أبلغ عن ملف": حقوق نشر أو أخطاء
CREATE TABLE IF NOT EXISTS reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  file_id INTEGER NOT NULL REFERENCES files(id),
  reporter_id INTEGER REFERENCES users(id),
  reason TEXT NOT NULL,
  status TEXT NOT NULL DEFAULT 'open',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_colleges_uni ON colleges(university_id);
CREATE INDEX IF NOT EXISTS idx_subjects_term ON subjects(term_id);
CREATE INDEX IF NOT EXISTS idx_files_subject_status ON files(subject_id, status);
CREATE INDEX IF NOT EXISTS idx_files_pending ON files(status) WHERE status = 'pending';
