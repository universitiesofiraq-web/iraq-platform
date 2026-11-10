# سجل الصيانة — fix/platform-core-stability

| المرحلة | الحالة | Commit | الاختبار |
|---|---|---|---|
| P0.1 تسجيل الطالب لا يفعّل الجامعة | مكتملة | aa00fe1 | `node --test iraq-platform/tests/university_onboarding.test.mjs iraq-platform/tests/invites_growth.test.mjs iraq-platform/tests/admin_dashboard.test.mjs` |
| P0.2 ظهور الجامعات | مكتملة | الـ commit التالي لـ aa00fe1 | `node --test iraq-platform/tests/university_onboarding.test.mjs iraq-platform/tests/admin_dashboard.test.mjs iraq-platform/tests/admin_router.test.mjs iraq-platform/tests/admin_security_regression.test.mjs` |

## ملاحظات
- P0.1: `POST /api/catalog/join` يحفظ `user_profile` فقط ويعيد `university_state` (active/pending). التفعيل والتعليق من `onboarding.js` للإدارة فقط. `GET /api/catalog/me` يعيد `university_state`. صفحة `join.html` تعرض «جامعتك لم تُفعَّل بعد» بدل فتح صفحة القسم.
- أثر على الإنتاج عند الدمج: جامعات فُعّلت سابقاً تلقائياً تبقى مفعّلة (لا ترحيل). طلاب جامعة غير مفعّلة ينتظرون تفعيل الإدارة.
- P0.2: لا ترحيل قاعدة بيانات. الإدارة: تصفية جديدة `filter=not_onboarded` وعدّادا `not_onboarded` و`waiting` (جامعات غير مفعّلة فيها طلاب مسجّلون). حذف جامعة مفعّلة/موقوفة مرفوض (409 onboarded)، والدمج ينقل حالة التفعيل بدل تركها يتيمة. التفعيل upsert على مفتاح أساسي فلا تكرار.
