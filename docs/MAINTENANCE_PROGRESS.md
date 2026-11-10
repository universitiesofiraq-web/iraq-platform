# سجل الصيانة — fix/platform-core-stability

| المرحلة | الحالة | Commit | الاختبار |
|---|---|---|---|
| P0.1 تسجيل الطالب لا يفعّل الجامعة | مكتملة | aa00fe1 | `node --test iraq-platform/tests/university_onboarding.test.mjs iraq-platform/tests/invites_growth.test.mjs iraq-platform/tests/admin_dashboard.test.mjs` |
| P0.2 ظهور الجامعات | مكتملة | 8fdbb76 | `node --test iraq-platform/tests/university_onboarding.test.mjs iraq-platform/tests/admin_dashboard.test.mjs iraq-platform/tests/admin_router.test.mjs iraq-platform/tests/admin_security_regression.test.mjs` |
| P0.3 عضوية الطالب والمرحلة | مكتملة | 18171f9 | `node --test iraq-platform/tests/admin_stage.test.mjs iraq-platform/tests/university_onboarding.test.mjs iraq-platform/tests/group_chat.test.mjs iraq-platform/tests/admin_security_regression.test.mjs` |
| P1.1 إحصاءات لوحة الإدارة | مكتملة | الـ commit التالي لـ 18171f9 | `node --test iraq-platform/tests/university_onboarding.test.mjs iraq-platform/tests/invites_growth.test.mjs iraq-platform/tests/admin_dashboard.test.mjs iraq-platform/tests/global_admin.test.mjs` |

## ملاحظات
- P0.1: `POST /api/catalog/join` يحفظ `user_profile` فقط ويعيد `university_state` (active/pending). التفعيل والتعليق من `onboarding.js` للإدارة فقط. `GET /api/catalog/me` يعيد `university_state`. صفحة `join.html` تعرض «جامعتك لم تُفعَّل بعد» بدل فتح صفحة القسم.
- أثر على الإنتاج عند الدمج: جامعات فُعّلت سابقاً تلقائياً تبقى مفعّلة (لا ترحيل). طلاب جامعة غير مفعّلة ينتظرون تفعيل الإدارة.
- P0.2: لا ترحيل قاعدة بيانات. الإدارة: تصفية جديدة `filter=not_onboarded` وعدّادا `not_onboarded` و`waiting` (جامعات غير مفعّلة فيها طلاب مسجّلون). حذف جامعة مفعّلة/موقوفة مرفوض (409 onboarded)، والدمج ينقل حالة التفعيل بدل تركها يتيمة. التفعيل upsert على مفتاح أساسي فلا تكرار.
- P0.3: اختيار المرحلة (`user_profile`) صار منفصلاً عن تأكيد العضوية (`student_verification` لنفس المرحلة). `GET /api/stage-announcements` يعيد `membership: pending` وقائمة فارغة حتى يؤكّد ممثل المرحلة الطالب؛ `GET /api/catalog/me` يعيد `membership`. الدردشة كانت محمية أصلاً (طلب انضمام يوافق عليه المسؤول). **تغيير سلوك عند الدمج:** الطلاب غير المؤكَّدين لن يروا إعلانات مرحلتهم حتى يضغط الممثل «تأكيد الكل» في لوحة المرحلة. المحتوى العام (الملفات، التبليغات العامة) لم يتغير.
- P1.1: عدّادات «الملفات المنشورة/بانتظار المراجعة/البلاغات المفتوحة» وملفات كل جامعة كانت تُقرأ من جدولي `files` و`reports` الفارغين دائماً (الرفع يكتب في KV). الآن تُحسب من `manifest.json` و`reports.json`. عدد طلاب الجامعة يستثني من أُزيل من مرحلته (كان يخالف الإجمالي). عدد الممثلين يستثني الحسابات الموقوفة. أرقام «دخلوا آخر ٧/٣٠ يوماً» تعني تسجيل الدخول لا النشاط، وتسميتها في الواجهة صحيحة فلم تُغيَّر؛ لا يوجد قياس نشاط فعلي بعد.
