-- تراجع يدوي عن 0001_question_bank.sql: يحذف جداول qb_ فقط (بترتيب معاكس للإنشاء). لا يمس أي جدول آخر.
-- يُشغَّل يدوياً على قاعدة المعاينة فقط، ولا يُطبَّق تلقائياً. احذف أيضاً صف qb_0001 من _qb_schema قبل إعادة التطبيق.
DROP TABLE IF EXISTS qb_rate;
DROP TABLE IF EXISTS qb_audit;
DROP TABLE IF EXISTS qb_seen;
DROP TABLE IF EXISTS qb_card_state;
DROP TABLE IF EXISTS qb_student_stats;
DROP TABLE IF EXISTS qb_question_stats;
DROP TABLE IF EXISTS qb_reports;
DROP TABLE IF EXISTS qb_bookmarks;
DROP TABLE IF EXISTS qb_attempt_answers;
DROP TABLE IF EXISTS qb_attempts;
DROP TABLE IF EXISTS qb_templates;
DROP TABLE IF EXISTS qb_quiz_versions;
DROP TABLE IF EXISTS qb_quiz_conditions;
DROP TABLE IF EXISTS qb_quiz_items;
DROP TABLE IF EXISTS qb_quiz_sections;
DROP TABLE IF EXISTS qb_quizzes;
DROP TABLE IF EXISTS qb_question_reviews;
DROP TABLE IF EXISTS qb_question_versions;
DROP TABLE IF EXISTS qb_question_tags;
DROP TABLE IF EXISTS qb_questions;
DROP TABLE IF EXISTS qb_cases;
DROP TABLE IF EXISTS qb_tags;
DROP TABLE IF EXISTS qb_categories;
