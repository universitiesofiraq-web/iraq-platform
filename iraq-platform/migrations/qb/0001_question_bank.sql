-- بنك الأسئلة والاختبارات الإلكترونية (QB-002). إضافة فقط: كل الجداول والفهارس بأسماء qb_ ولا يُعدَّل أي جدول قائم.
-- هذا الملف خارج migrations/ الرئيسي عمداً فلا يدخل الترحيل التلقائي. يُطبَّق فقط حين يكون QB_MIGRATE=1 (انظر docs/question-bank/ENVIRONMENTS.md).
-- مراجع subject_id وlecture_id وuser_id قيم بلا قيود FOREIGN KEY على جداول المنصة، حتى لا يعطّل أي حذف قائم.

-- التصنيف الأكاديمي (موضوعات داخل المادة، شجري)
CREATE TABLE IF NOT EXISTS qb_categories (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  parent_id INTEGER REFERENCES qb_categories(id),
  name TEXT NOT NULL,
  created_at INTEGER NOT NULL,
  UNIQUE (subject_id, parent_id, name)
);
CREATE INDEX IF NOT EXISTS idx_qb_categories_subject ON qb_categories(subject_id);

CREATE TABLE IF NOT EXISTS qb_tags (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL UNIQUE
);

-- الحالات السريرية: نص واحد تُربط به أسئلة كثيرة
CREATE TABLE IF NOT EXISTS qb_cases (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  lecture_id INTEGER,
  title TEXT NOT NULL,
  body_json TEXT NOT NULL,            -- {history, exam, vitals, labs, images:[{url,caption,kind}], diagnosis, text}
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','archived')),
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qb_cases_subject ON qb_cases(subject_id, status);

CREATE TABLE IF NOT EXISTS qb_questions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  lecture_id INTEGER,
  category_id INTEGER REFERENCES qb_categories(id),
  case_id INTEGER REFERENCES qb_cases(id),
  type TEXT NOT NULL CHECK (type IN ('sba','mcq','mrq','tf','emq','saq','essay','fill','matching','ordering','numerical')),
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','pending','approved','published','archived')),
  difficulty INTEGER NOT NULL DEFAULT 2 CHECK (difficulty BETWEEN 1 AND 3),
  content_json TEXT NOT NULL,         -- نص السؤال والخيارات ومفتاح الإجابة (لا يُرسل للطالب إلا عبر publicQuestion)
  search_text TEXT NOT NULL DEFAULT '', -- نص مطبَّع للبحث والمكرر
  content_hash TEXT NOT NULL,         -- بصمة النص المطبَّع لاكتشاف التكرار
  points REAL NOT NULL DEFAULT 1 CHECK (points > 0),
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  updated_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL,
  published_at INTEGER
);
CREATE INDEX IF NOT EXISTS idx_qb_questions_subject ON qb_questions(subject_id, status, difficulty);
CREATE INDEX IF NOT EXISTS idx_qb_questions_lecture ON qb_questions(lecture_id, status);
CREATE INDEX IF NOT EXISTS idx_qb_questions_category ON qb_questions(category_id);
CREATE INDEX IF NOT EXISTS idx_qb_questions_case ON qb_questions(case_id);
CREATE INDEX IF NOT EXISTS idx_qb_questions_hash ON qb_questions(subject_id, content_hash);
CREATE INDEX IF NOT EXISTS idx_qb_questions_status ON qb_questions(status, updated_at);

CREATE TABLE IF NOT EXISTS qb_question_tags (
  question_id INTEGER NOT NULL REFERENCES qb_questions(id) ON DELETE CASCADE,
  tag_id INTEGER NOT NULL REFERENCES qb_tags(id) ON DELETE CASCADE,
  PRIMARY KEY (question_id, tag_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_question_tags_tag ON qb_question_tags(tag_id);

-- سجل التغييرات: من عدّل ومتى وما الذي تغيّر
CREATE TABLE IF NOT EXISTS qb_question_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  content_json TEXT NOT NULL,
  status TEXT NOT NULL,
  changed_by INTEGER NOT NULL,
  changed_at INTEGER NOT NULL,
  change_summary TEXT NOT NULL DEFAULT '',
  UNIQUE (question_id, version)
);

CREATE TABLE IF NOT EXISTS qb_question_reviews (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL,
  reviewer_id INTEGER NOT NULL,
  from_status TEXT NOT NULL,
  to_status TEXT NOT NULL,
  note TEXT NOT NULL DEFAULT '',
  created_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qb_question_reviews_q ON qb_question_reviews(question_id, created_at);

CREATE TABLE IF NOT EXISTS qb_quizzes (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  subject_id INTEGER NOT NULL,
  lecture_id INTEGER,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'draft' CHECK (status IN ('draft','published','scheduled','closed','archived')),
  mode TEXT NOT NULL DEFAULT 'practice' CHECK (mode IN ('practice','exam')),
  settings_json TEXT NOT NULL DEFAULT '{}', -- shuffleQuestions, shuffleOptions, allowBack, showResults, allowReview, showExplanations, official...
  pass_score REAL,
  duration_sec INTEGER,
  attempts_allowed INTEGER NOT NULL DEFAULT 1,
  starts_at INTEGER,
  ends_at INTEGER,
  target TEXT NOT NULL DEFAULT '',      -- وصف الفئة المستهدفة
  version INTEGER NOT NULL DEFAULT 1,
  created_by INTEGER NOT NULL,
  created_at INTEGER NOT NULL,
  updated_at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qb_quizzes_subject ON qb_quizzes(subject_id, status);
CREATE INDEX IF NOT EXISTS idx_qb_quizzes_status ON qb_quizzes(status, starts_at, ends_at);

CREATE TABLE IF NOT EXISTS qb_quiz_sections (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES qb_quizzes(id) ON DELETE CASCADE,
  title TEXT NOT NULL,
  description TEXT NOT NULL DEFAULT '',
  position INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qb_quiz_sections_quiz ON qb_quiz_sections(quiz_id, position);

-- عناصر الاختبار: أسئلة أو عناصر عرض (عنوان، وصف، صورة، فيديو، فاصل، فاصل صفحة)
CREATE TABLE IF NOT EXISTS qb_quiz_items (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES qb_quizzes(id) ON DELETE CASCADE,
  section_id INTEGER REFERENCES qb_quiz_sections(id) ON DELETE SET NULL,
  kind TEXT NOT NULL CHECK (kind IN ('question','heading','text','image','video','divider','pagebreak')),
  question_id INTEGER REFERENCES qb_questions(id),
  content_json TEXT NOT NULL DEFAULT '{}',
  position INTEGER NOT NULL,
  points_override REAL,
  required INTEGER NOT NULL DEFAULT 0
);
CREATE INDEX IF NOT EXISTS idx_qb_quiz_items_quiz ON qb_quiz_items(quiz_id, position);
CREATE INDEX IF NOT EXISTS idx_qb_quiz_items_question ON qb_quiz_items(question_id);

-- المنطق الشرطي: إظهار سؤال بناءً على إجابة سابقة، أو تخطي ما بين سؤال وقسم لاحق
CREATE TABLE IF NOT EXISTS qb_quiz_conditions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL REFERENCES qb_quizzes(id) ON DELETE CASCADE,
  kind TEXT NOT NULL CHECK (kind IN ('show_if','jump')),
  source_item_id INTEGER NOT NULL,
  op TEXT NOT NULL CHECK (op IN ('eq','ne','in','answered','notanswered')),
  value_json TEXT NOT NULL DEFAULT 'null',
  target_item_id INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qb_quiz_conditions_quiz ON qb_quiz_conditions(quiz_id);

-- نسخة منشورة ثابتة من الاختبار عند كل نشر
CREATE TABLE IF NOT EXISTS qb_quiz_versions (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  quiz_id INTEGER NOT NULL,
  version INTEGER NOT NULL,
  snapshot_json TEXT NOT NULL,
  published_by INTEGER NOT NULL,
  published_at INTEGER NOT NULL,
  UNIQUE (quiz_id, version)
);

CREATE TABLE IF NOT EXISTS qb_templates (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  name TEXT NOT NULL,
  kind TEXT NOT NULL DEFAULT 'custom',
  settings_json TEXT NOT NULL,
  builtin INTEGER NOT NULL DEFAULT 0,
  created_by INTEGER,
  created_at INTEGER NOT NULL
);

-- المحاولات: اللقطة (الأسئلة وقواعد التصحيح كما كانت) تُجمَّد عند البدء فلا تتغير النتيجة بتعديل لاحق
CREATE TABLE IF NOT EXISTS qb_attempts (
  id TEXT PRIMARY KEY,                -- معرّف عشوائي غير قابل للتخمين
  quiz_id INTEGER,                    -- NULL للاختبار الذكي أو التدريب الحر
  user_id INTEGER NOT NULL,
  kind TEXT NOT NULL DEFAULT 'quiz' CHECK (kind IN ('quiz','smart','practice')),
  mode TEXT NOT NULL CHECK (mode IN ('practice','exam')),
  status TEXT NOT NULL DEFAULT 'in_progress' CHECK (status IN ('in_progress','submitted','graded')),
  snapshot_json TEXT NOT NULL,
  seed TEXT NOT NULL,
  answers_json TEXT NOT NULL DEFAULT '{}',
  flags_json TEXT NOT NULL DEFAULT '[]',
  rev INTEGER NOT NULL DEFAULT 0,     -- يزيد مع كل حفظ لمنع الكتابة القديمة فوق الجديدة
  started_at INTEGER NOT NULL,
  deadline_at INTEGER,                -- من وقت الخادم فقط
  submitted_at INTEGER,
  score REAL,
  max_score REAL,
  percent REAL,
  final INTEGER NOT NULL DEFAULT 0,   -- 0 إن بقي سؤال ينتظر التصحيح اليدوي
  result_json TEXT
);
CREATE INDEX IF NOT EXISTS idx_qb_attempts_user ON qb_attempts(user_id, started_at DESC);
CREATE INDEX IF NOT EXISTS idx_qb_attempts_quiz ON qb_attempts(quiz_id, status);
CREATE INDEX IF NOT EXISTS idx_qb_attempts_review ON qb_attempts(status, final);

CREATE TABLE IF NOT EXISTS qb_attempt_answers (
  attempt_id TEXT NOT NULL REFERENCES qb_attempts(id) ON DELETE CASCADE,
  question_id INTEGER NOT NULL,
  answer_json TEXT NOT NULL DEFAULT 'null',
  score REAL,
  max_score REAL NOT NULL,
  status TEXT NOT NULL,               -- correct | partial | wrong | unanswered | pending
  manual INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (attempt_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_attempt_answers_q ON qb_attempt_answers(question_id, status);

CREATE TABLE IF NOT EXISTS qb_bookmarks (
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL REFERENCES qb_questions(id) ON DELETE CASCADE,
  created_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_bookmarks_user ON qb_bookmarks(user_id, created_at DESC);

CREATE TABLE IF NOT EXISTS qb_reports (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  question_id INTEGER NOT NULL REFERENCES qb_questions(id) ON DELETE CASCADE,
  user_id INTEGER NOT NULL,
  reason TEXT NOT NULL CHECK (reason IN ('wrong_answer','typo','unclear','outdated','other')),
  details TEXT NOT NULL DEFAULT '',
  status TEXT NOT NULL DEFAULT 'open' CHECK (status IN ('open','resolved','dismissed')),
  created_at INTEGER NOT NULL,
  resolved_by INTEGER,
  resolved_at INTEGER,
  resolution_note TEXT NOT NULL DEFAULT '',
  UNIQUE (question_id, user_id, reason)
);
CREATE INDEX IF NOT EXISTS idx_qb_reports_status ON qb_reports(status, created_at);

-- إحصاءات تُحدَّث تراكمياً عند كل تسليم (بلا مسح لجدول الإجابات)
CREATE TABLE IF NOT EXISTS qb_question_stats (
  question_id INTEGER PRIMARY KEY,
  attempts INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  partial INTEGER NOT NULL DEFAULT 0,
  wrong INTEGER NOT NULL DEFAULT 0,
  unanswered INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL
);

CREATE TABLE IF NOT EXISTS qb_student_stats (
  user_id INTEGER NOT NULL,
  subject_id INTEGER NOT NULL,
  category_id INTEGER NOT NULL DEFAULT 0,
  difficulty INTEGER NOT NULL DEFAULT 2,
  answered INTEGER NOT NULL DEFAULT 0,
  correct INTEGER NOT NULL DEFAULT 0,
  updated_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, subject_id, category_id, difficulty)
);

-- البطاقات التعليمية: صناديق التكرار المتباعد (Leitner)
CREATE TABLE IF NOT EXISTS qb_card_state (
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL REFERENCES qb_questions(id) ON DELETE CASCADE,
  box INTEGER NOT NULL DEFAULT 0 CHECK (box BETWEEN 0 AND 5),
  due_at INTEGER NOT NULL,
  reps INTEGER NOT NULL DEFAULT 0,
  lapses INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_card_state_due ON qb_card_state(user_id, due_at);

-- آخر سؤال أجابه الطالب في التدريب، لسؤال «الجديدة فقط» و«غير المكتملة»
CREATE TABLE IF NOT EXISTS qb_seen (
  user_id INTEGER NOT NULL,
  question_id INTEGER NOT NULL,
  last_correct INTEGER NOT NULL DEFAULT 0,
  seen_count INTEGER NOT NULL DEFAULT 1,
  wrong_count INTEGER NOT NULL DEFAULT 0,
  last_at INTEGER NOT NULL,
  PRIMARY KEY (user_id, question_id)
);
CREATE INDEX IF NOT EXISTS idx_qb_seen_user ON qb_seen(user_id, last_correct);

CREATE TABLE IF NOT EXISTS qb_audit (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_id INTEGER NOT NULL,
  action TEXT NOT NULL,
  entity TEXT NOT NULL,
  entity_id TEXT NOT NULL,
  detail TEXT NOT NULL DEFAULT '',
  at INTEGER NOT NULL
);
CREATE INDEX IF NOT EXISTS idx_qb_audit_at ON qb_audit(at DESC);

-- حد معدل بسيط: (مستخدم، سلة، نافذة) → عدد
CREATE TABLE IF NOT EXISTS qb_rate (
  user_id INTEGER NOT NULL,
  bucket TEXT NOT NULL,
  win INTEGER NOT NULL,
  n INTEGER NOT NULL DEFAULT 0,
  PRIMARY KEY (user_id, bucket, win)
);

-- قوالب جاهزة (قابلة للتعديل). الإدخال مكرر الأمان: IGNORE.
INSERT OR IGNORE INTO qb_templates (id, name, kind, settings_json, builtin, created_at) VALUES
  (1, 'اختبار محاضرة', 'lecture', '{"mode":"practice","shuffleOptions":true,"showResults":true,"allowReview":true,"showExplanations":true,"allowBack":true}', 1, 0),
  (2, 'اختبار مادة', 'subject', '{"mode":"practice","shuffleQuestions":true,"shuffleOptions":true,"showResults":true,"allowReview":true,"showExplanations":true,"allowBack":true}', 1, 0),
  (3, 'امتحان نصف السنة', 'midterm', '{"mode":"exam","duration_min":60,"attempts_allowed":1,"shuffleQuestions":true,"shuffleOptions":true,"showResults":true,"allowReview":false,"showExplanations":false,"allowBack":true,"official":true}', 1, 0),
  (4, 'امتحان نهائي', 'final', '{"mode":"exam","duration_min":120,"attempts_allowed":1,"shuffleQuestions":true,"shuffleOptions":true,"showResults":false,"allowReview":false,"showExplanations":false,"allowBack":false,"official":true}', 1, 0),
  (5, 'اختبار سريري', 'clinical', '{"mode":"exam","duration_min":45,"attempts_allowed":1,"shuffleOptions":true,"showResults":true,"allowReview":true,"showExplanations":true,"allowBack":true}', 1, 0),
  (6, 'اختبار صور طبية', 'images', '{"mode":"practice","shuffleOptions":true,"showResults":true,"allowReview":true,"showExplanations":true,"allowBack":true}', 1, 0),
  (7, 'اختبار سريع', 'quick', '{"mode":"practice","duration_min":10,"shuffleQuestions":true,"shuffleOptions":true,"showResults":true,"allowReview":true,"showExplanations":true,"allowBack":false}', 1, 0),
  (8, 'اختبار تجريبي', 'trial', '{"mode":"exam","duration_min":30,"attempts_allowed":3,"shuffleQuestions":true,"shuffleOptions":true,"showResults":true,"allowReview":true,"showExplanations":true,"allowBack":true}', 1, 0),
  (9, 'اختبار حالات سريرية', 'cases', '{"mode":"practice","shuffleOptions":true,"showResults":true,"allowReview":true,"showExplanations":true,"allowBack":true}', 1, 0),
  (10, 'اختبار مراجعة الأخطاء', 'mistakes', '{"mode":"practice","shuffleQuestions":true,"shuffleOptions":true,"showResults":true,"allowReview":true,"showExplanations":true,"allowBack":true}', 1, 0);
