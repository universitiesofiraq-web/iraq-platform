# تسليم تطوير الممثلين v2

## الحالة
- الفرع: feature/rep-v2-backend-claude. PR مسودة #2. لم يُدمج شيء في main ولم يُنشر شيء.
- الاختبارات: 5 ملفات، 63 اختبارًا، كلها تنجح محليًا: node tests/<name>.test.mjs

## ما تم (مرفوع إلى الفرع)
- C0: docs/representatives-v2/API_CONTRACT.md و CLAUDE_PROGRESS.md.
- C1: migrations/0004 (scopes, rep_requests) و 0005 (scope_audit + فهارس). إضافات فقط، بلا حذف.
- 02.2: فحص بنية PDF في finish (pdfcheck.mjs + core.mjs).
- C2: functions/_lib/authz.js — محرك صلاحيات نقي (deny-by-default).
- C2 (ربط): functions/_lib/authz_bridge.js — يربط المحرك ببيانات scope.js. اختبارات: tests/authz_bridge.test.mjs.
- C3: functions/_lib/rep_lifecycle.js — انتقالات الطلب، منع التكرار، سحب rep فقط.
- C3: functions/_lib/rep_assignments.js — منع تصعيد الصلاحيات، نقل المسؤولية، منع التكرار. اختبارات: tests/rep_assignments.test.mjs.
- C3/C5: functions/_lib/scope.js — نسخة main + سجل scope_audit على المنح والسحب والقرار. اختبارات نقاط حقيقية: tests/scope_endpoints.test.mjs.
- C4: functions/_lib/notify_events.js — بناء أحداث الإشعارات (نقي، غير مربوط بتخزين أو إرسال).
- C4: functions/_lib/announcement_audience.js — عزل جمهور الإعلانات والتحقق من الحقول. اختبارات: tests/announcement_audience.test.mjs.
- C5: tests/rep_v2.test.mjs — اختبارات الوحدات الأمنية.

## ما لم يُنفَّذ بعد
- ربط authz_bridge و rep_assignments بمسارات الـAPI الفعلية في catalog.js وauth.js.
- جدول الإشعارات وإرسالها الفعلي (C4 حتى الآن بناء أحداث فقط).
- مسارات API للإعلانات (إنشاء، تعديل، أرشفة، قراءة/عدم قراءة).
- ترقيم الصفحات في نقاط القوائم.
- اختبارات على قاعدة بيانات حقيقية (D1) والهجرات على بيانات موجودة.
- اختبار توافق رفع PDF الحالي بعد التغييرات.
- مراجعة واجهة ChatGPT Work (فرع feature/rep-v2-frontend-work) — لم تُلمس.

## قيود
- الفرع غير مزامن مع main الحالي. الدمج يتطلب موافقة صاحب المشروع.
- auth.js وcatalog.js وصفحات site/* المحلية أقدم من main، ولم تُرفع.
- الرفع يتم عبر المتصفح؛ لا يوجد وصول git من الجلسة.
- ملف CLAUDE_PROGRESS.md على الفرع قديم، والتحديث عبر المحرر لم ينجح بعد.

## نشر
- لا نشر ولا دمج بدون موافقة صريحة.
- قبل الدمج: مزامنة مع main، وتشغيل كل الاختبارات، ومراجعة PR.

## الاستئناف
1. اقرأ هذا الملف ثم API_CONTRACT.md.
2. زامن auth.js وcatalog.js وصفحات site/* مع main (بعد التأكد من عدم فقد تغييرات).
3. اربط authz_bridge بمسارات الـAPI خلف الاختبارات، ثم أضف مسارات الإعلانات.
