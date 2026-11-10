-- Step 63: كتابة الطالب وتظليله وبطاقاته على ملفات PDF تُحفظ في حسابه (بطلب محمد 2026-10-19). إضافة فقط: جدول جديد.
-- صف لكل (طالب، ملف، جزء): الملف بمعرّف مختصر (بصمة مسار الملف، لا اسم ولا رابط)،
-- والجزء ink:<رقم الصفحة> أو study أو layout أو occl. t وقت آخر تعديل بالمللي ثانية، ويُستعمل لكشف التعارض بين جهازين.
-- لا يدخل هذا الجدول في تصدير المشرف؛ كل طالب يقرأ صفوفه فقط.
CREATE TABLE IF NOT EXISTS pdf_notes (
  user_id INTEGER NOT NULL,
  doc TEXT NOT NULL,
  k TEXT NOT NULL,
  d TEXT NOT NULL,
  t INTEGER NOT NULL,
  PRIMARY KEY (user_id, doc, k)
);
