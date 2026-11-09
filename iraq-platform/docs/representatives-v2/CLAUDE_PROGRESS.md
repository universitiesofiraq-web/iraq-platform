# تقدم تطوير الممثلين v2 (الواجهة الخلفية)

## الوضع الحالي
- الفرع على GitHub: feature/rep-v2-backend-claude (من main). PR مسودة: #2.
- المسارات على GitHub تحت iraq-platform/.
- لا يوجد وصول git من الجلسة. الرفع يتم عبر محرر GitHub في المتصفح، والتحقق بمقارنة بصمة git-blob.
- لم يُدمج شيء في main ولم يُنشر شيء. الدمج يتطلب موافقة صاحب المشروع.
- الحالة: C0 و C1 و C2 و C3 و C4 (منطق) وC5 (اختبارات وحدات ونقاط) منجزة محليًا ومرفوعة. الربط مع catalog.js وauth.js والإعلانات الفعلية والإشعارات لم يبدأ.

## ما هو على الفرع (مُتحقَّق بالبصمة)
- docs/representatives-v2/API_CONTRACT.md (C0)
- docs/representatives-v2/CLAUDE_PROGRESS.md (هذا الملف، نسخة قديمة على الفرع)
- docs/representatives-v2/HANDOFF.md (C6، محدّث)
- netlify/lib/pdfcheck.mjs و netlify/lib/core.mjs (02.2)
- migrations/0004_scopes_rep_requests.sql (02.1 / C1)
- migrations/0005_rep_audit_indexes.sql (C1)
- functions/_lib/authz.js (C2)
- functions/_lib/authz_bridge.js (C2)
- functions/_lib/rep_lifecycle.js (C3)
- functions/_lib/rep_assignments.js (C3)
- functions/_lib/notify_events.js (C4)
- functions/_lib/announcement_audience.js (C4)
- functions/_lib/scope.js (نسخة main + scope_audit، C3/C5)
- tests/authz_bridge.test.mjs, tests/rep_assignments.test.mjs, tests/scope_endpoints.test.mjs, tests/announcement_audience.test.mjs

## ما لم يُرفع ولماذا
- functions/_lib/auth.js و functions/_lib/catalog.js: النسخ المحلية أقدم من main. رفعها كان سيمحو تغييرات موجودة على GitHub.
- site/admin.html و catalog.html و contribute.html و dept.html و index.html و platform.html و login.html و js/login.js و sw.js: نفس السبب.
- .gitignore: غير موجود على الفرع.
- tests/rep_v2.test.mjs: النسخة على الفرع تختلف في سطر واحد (السطر الأخير)، وتعمل كما هي.

## الاختبارات (محليًا)
- node tests/authz_bridge.test.mjs: 6/6
- node tests/rep_assignments.test.mjs: 14/14
- node tests/scope_endpoints.test.mjs: 15/15
- node tests/announcement_audience.test.mjs: 12/12
- node tests/rep_v2.test.mjs: 16/16
- فحص 02.2 محليًا: ملف صالح متعدد القطع → 200، ملف %PDF- مزيف → 400، ملف مقطوع → 400، الملف المرفوض لا يُسجَّل والقطع تُحذف.
- لا يوجد package.json ولا مجلد اختبارات رسمي في المستودع. الاختبارات تعمل بالتشغيل المباشر بـ node.

## الملاحظات والمخاطر
- الأدوار الموجودة: admin و rep و uploader. لا يوجد دور assistant على مستوى الـAPI بعد.
- جدول user_scopes قديم في migrations/0003 وغير مستخدم.
- لا يوجد نظام إشعارات حالي، بل announcements فقط.
- الاختبارات على قاعدة وهمية، وليست على D1 حقيقية.

## الخطوة التالية
1. مزامنة auth.js وcatalog.js وصفحات site/* مع main (بعد التأكد من عدم فقد تغييرات).
2. ربط authz_bridge بمسارات الـAPI، ثم مسارات الإعلانات، ثم الإشعارات.
3. اختبارات على D1 حقيقية، وتوافق رفع PDF.

## تعليمات الاستئناف
- اقرأ هذا الملف و API_CONTRACT.md و HANDOFF.md أولًا.
- لا تعدّل main ولا تنشر على الإنتاج.
- لا تبدأ Development 03 ولا تلمس فرع الواجهة feature/rep-v2-frontend-work.
