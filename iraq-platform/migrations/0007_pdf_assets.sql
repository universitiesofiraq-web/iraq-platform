-- Step 66 (بطلب محمد 2026-10-22): الصور التي يُدرجها الطالب في PDF تُرفع إلى حسابه وتظهر على كل أجهزته.
-- الصورة مقسّمة إلى أجزاء (d) لتبقى كل جملة صغيرة. المعرّف img_<32 حرفاً سداسياً> هو بصمة محتوى الصورة نفسها.
-- إضافة فقط: جدول جديد. لا يدخل تصدير المشرف، وكل طالب يقرأ صوره فقط.
CREATE TABLE IF NOT EXISTS pdf_assets (
  user_id INTEGER NOT NULL,
  id TEXT NOT NULL,
  part INTEGER NOT NULL,
  type TEXT NOT NULL,
  d TEXT NOT NULL,
  PRIMARY KEY (user_id, id, part)
);
