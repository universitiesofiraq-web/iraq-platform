# سجل الصيانة — fix/platform-core-stability

| المرحلة | الحالة | Commit | الاختبار |
|---|---|---|---|
| P0.1 تسجيل الطالب لا يفعّل الجامعة | مكتملة | انظر سجل Git (أول commit في الفرع) | `node --test iraq-platform/tests/university_onboarding.test.mjs iraq-platform/tests/invites_growth.test.mjs iraq-platform/tests/admin_dashboard.test.mjs` |

## ملاحظات
- P0.1: `POST /api/catalog/join` يحفظ `user_profile` فقط ويعيد `university_state` (active/pending). التفعيل والتعليق من `onboarding.js` للإدارة فقط. `GET /api/catalog/me` يعيد `university_state`. صفحة `join.html` تعرض «جامعتك لم تُفعَّل بعد» بدل فتح صفحة القسم.
- أثر على الإنتاج عند الدمج: جامعات فُعّلت سابقاً تلقائياً تبقى مفعّلة (لا ترحيل). طلاب جامعة غير مفعّلة ينتظرون تفعيل الإدارة.
