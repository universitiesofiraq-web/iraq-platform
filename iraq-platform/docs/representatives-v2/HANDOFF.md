# تسليم تطوير الممثلين v2 (C6)

## ما تم (على الفرع feature/rep-v2-backend-claude، PR مسودة #2)
- C0: docs/representatives-v2/API_CONTRACT.md وCLAUDE_PROGRESS.md.
- 02.1 / C1: migrations/0004 (scopes, rep_requests) و0005 (scope_audit + فهارس). إضافات فقط، بلا حذف.
- 02.2: فحص بنية PDF في finish (pdfcheck.mjs + core.mjs).
- C2: functions/_lib/authz.js — محرك صلاحيات نقي، يطابق covers() في scope.js.
- C3: functions/_lib/rep_lifecycle.js — انتقالات الطلب (pending→approved|rejected)، منع التكرار، سحب rep فقط.
- C4: functions/_lib/notify_events.js — بناء أحداث الإشعارات (نقي، غير مربوط بتخزين أو إرسال).
- C5: tests/rep_v2.test.mjs — 16 اختبارًا، تشغيل: node tests/rep_v2.test.mjs. كلها تنجح.

## ما لم يُنفَّذ بعد
- ربط authz.js بالمسارات الفعلية (functions/_lib/scope.js و catalog.js لم تُعدَّل).
- جدول الإشعارات وإرسالها (C4 مجرد بناء أحداث).
- كتابة سجل scope_audit عند المنح والسحب.
- ترقيم الصفحات (C3 في العقد).
- واجهة الأمام (فرع منفصل: feature/rep-v2-frontend-work، لم يُلمس).

## قيود
- الفرع لا يزال غير مزامن مع main الحالي، ولم يُدمج شيء. الدمج يتطلب موافقة صاحب المشروع.
- الملفات الأحدث على GitHub لم تُرفع (auth.js وcatalog.js وscope.js وصفحات site/*)، لأن النسخ المحلية أقدم.
- الرفع تم عبر المتصفح؛ لا يوجد وصول git من الجلسة.

## نشر
- لا نشر ولا دمج بدون موافقة.
- قبل الدمج: مزامنة مع main، وتشغيل tests/rep_v2.test.mjs، ومراجعة PR.

## الاستئناف
1. اقرأ هذا الملف ثم API_CONTRACT.md.
2. ابدأ بربط authz.js بـ scope.js خلف اختبار، ثم أضف scope_audit.
