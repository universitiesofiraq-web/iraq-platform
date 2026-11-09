# عقد API — الممثلون v2 (مسودة C0)

> هذا الملف يصف الواجهات الموجودة فعلًا، ثم يحدد ما سيُضاف. التغييرات الكاسرة تُوثَّق هنا قبل تطبيقها.

## 1. المصادقة
- `GET /api/auth/config`: إعدادات المصادقة (عام).
- `POST /api/auth/google`: تسجيل الدخول عبر Google. `POST /api/auth/logout`: تسجيل الخروج.
- `GET /api/sync` و`PUT /api/sync`: مزامنة بيانات المستخدم (تتطلب جلسة).
- `GET /api/auth/users` (مشرف) و`POST /api/auth/user` (مشرف): إدارة الحسابات.
- `GET /api/auth/me`: المستخدم الحالي، ويتطلب جلسة.
- الخطأ عند غياب الجلسة: `401 {"ok":false,"error":"unauthorized"}`.

## 2. الصلاحيات والنطاق (الموجود)
- `GET /api/auth/scopes`: نطاقات المستخدم. الاستجابة تتضمن `university_id` واسم الجامعة لكل صف.
- `GET /api/auth/scope`: مثل `scopes`.
- الأدوار: `admin` (مشرف عام)، `rep` (ممثل)، `uploader` (رافع).
- مستويات النطاق في `scopes.level`: `uploader`، `rep`.

## 3. طلبات التمثيل (مُنفَّذة في `scope.js`)
- `POST /api/auth/rep-request` — الجسم: `{ "type": "university|college|department", "id": <number> }`. يُنشئ طلبًا `pending`.
- `GET /api/auth/rep-requests` — المشرف: كل الطلبات المعلّقة. المستخدم: طلباته فقط.
- `POST /api/auth/rep-request/decide` — المشرف فقط: `{ "id": <number>, "action": "approve"|"reject" }`. الموافقة تُضيف صفًا في `scopes` بمستوى `rep`.
- القاعدة: الطلب لا يمنح صلاحية وحده.

## 4. الكتالوج
- `GET /api/platform?dept=<id>` — بيانات قسم واحد: `{ ok, dept, site, semesters, courses }`.
- نقاط الكتالوج الأخرى في `functions/_lib/catalog.js` (جامعات، كليات، أقسام، مواد) — قراءة عامة، وإضافة للمشرف.

## 5. الرفع والملفات (الموجود)
- `POST /api/chunk?id=<uuid>&index=<n>`: قطعة ≤ 3 MB. القطعة الأولى تبدأ بـ `%PDF-`.
- `POST /api/finish`: `{ id, chunks, courseId, number, type, title, filename, label, showInLatest? }`. يتحقق بنيويًا من PDF قبل التسجيل. يرفض بـ `400 invalid_pdf` مع `code` و`reason`.
- `POST /api/link`، `POST /api/edit`، `POST /api/delete`، `POST /api/abort`.
- `GET /api/uploads` (منشورة فقط)، `GET /api/file/<uuid>` (مع فحص الظهور).
- الحدود: 20 MB للملف الكامل، 16 قطعة كحد أقصى.

## 6. المراجعة والبلاغات (الموجود)
- `POST /api/admin` — عناصر المستخدم القابل للإدارة.
- `POST /api/review` — `{ id, action: "approve"|"reject" }` (يتطلب `mayManage` على مادة العنصر).
- `POST /api/reports` و`POST /api/reportdone`.
- `POST /api/report` — بلاغ عام.

## 7. الإعلانات (الموجود)
- `GET /api/announcements` — عامة.
- `POST /api/announcements` (إنشاء) و`POST /api/announcements/delete` (حذف) — مشرف.

## 8. الأدوار المقترحة للمرحلة C2 (غير مُنفَّذة بعد)
| الدور المطلوب | الدور الحالي | ملاحظة |
|---|---|---|
| Super Admin | `admin` | تطابق مباشر |
| University Admin | — | غير موجود |
| Main Representative | `rep` | بمستوى `rep` على نطاق |
| Assistant Representative | — | غير موجود |
| Student | مستخدم عادي | بلا نطاق |

## 9. الأخطاء
- الشكل: `{ "ok": false, "error": "<code>" }` مع رمز HTTP.
- الرموز: `400 bad_request`، `401 unauthorized`، `403 forbidden`، `404 not_found`، `409` (`admin_locked`، `not_empty`)، `413 too_big`، `503 busy|not_configured`.

## 10. الترقيم
- لا توجد صفحات حاليًا في نقاط القوائم. تُضاف في C3 بمعامل `?page=&limit=` (الحد الأعلى 100).

## 11. التغييرات المخطط لها (كاسرة؟)
- لا شيء كاسر حتى الآن.
