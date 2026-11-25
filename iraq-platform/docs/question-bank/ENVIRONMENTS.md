# فصل بيئة بنك الأسئلة عن الإنتاج

## لماذا
أي ملف في `migrations/*.sql` يُطبَّق تلقائياً على قاعدة D1 عند أول طلب API بعد النشر (`functions/_lib/migrate.js`)، وفروع المعاينة في Cloudflare قد تشارك قاعدة الإنتاج نفسها. لذلك لم نضع أي ترحيل لبنك الأسئلة في ذلك المسار.

## ما فعلناه في الكود
| الآلية | الأثر |
|---|---|
| ترحيل بنك الأسئلة في `migrations/qb/` (مجلد فرعي) | لا يدخل `migrations.generated.js` ولا يُطبَّق تلقائياً. فحص `qb_schema.test.mjs` يضمن ذلك. |
| `QB_ENABLED` غير مضبوط على `1` | كل مسارات `/api/qb/*` تعيد `404`، وكل ما سواها يعمل كما هو. |
| `QB_MIGRATE` غير مضبوط على `1` | لا يُنشأ أي جدول `qb_*` حتى لو فُعّل `QB_ENABLED`. بلا الجداول يعيد الـAPI `503 qb_not_migrated`. |
| جداول `qb_*` فقط، كلها `IF NOT EXISTS` | لا تعديل ولا حذف لأي جدول أو صف قائم (فحص آلي). |
| سجل منفصل `_qb_schema` | لا يمس `_schema_migrations`. |
| تراجع يدوي `migrations/qb/rollback/` | يحذف جداول `qb_*` فقط. |

الإنتاج لا يحتوي أياً من المتغيرين، فسلوكه مطابق لما قبل هذا العمل حتى لو وصل الكود إليه.

## تشغيل المعاينة الكاملة (مرة واحدة، عند المالك)
1. **أنشئ قاعدة D1 جديدة منفصلة** مثل `iraq-platform-qb-preview` (Cloudflare ← Workers & Pages ← D1).
2. في مشروع Pages: **Settings ← Bindings ← D1**، اربطها باسم `DB` في بيئة **Preview** فقط. لا تغيّر ربط **Production**.
3. في **Settings ← Variables and Secrets** بيئة **Preview** فقط أضف:
   - `QB_ENABLED` = `1`
   - `QB_MIGRATE` = `1`
   - `ADMIN_EMAILS` = بريدك
   - `GOOGLE_CLIENT_ID` (وأضف عنوان المعاينة إلى Authorized JavaScript origins)
4. انسخ **الكتالوج فقط** (المواد) من الإنتاج إلى قاعدة المعاينة دون أي بيانات طلاب:
   ```
   npx wrangler d1 export <قاعدة-الإنتاج> --remote --no-schema --output catalog.sql \
     --table universities --table colleges --table departments --table stages --table terms --table subjects --table lectures
   npx wrangler d1 execute iraq-platform-qb-preview --remote --file catalog.sql
   ```
   (يلزم أن تكون الجداول موجودة في قاعدة المعاينة؛ تُنشأ بالترحيلات الرئيسية عند أول زيارة. لم أجرّب أمر التصدير على حسابك: تحقق من خيارات `wrangler d1 export` في توثيق Cloudflare الحالي، فإن لم يقبل تكرار `--table` فصدّر جدولاً جدولاً.)
5. ادفع الفرع `feat/question-bank` وافتح رابط معاينته: `https://feat-question-bank.<مشروعك>.pages.dev/qbank.html`.
6. التراجع: شغّل `migrations/qb/rollback/0001_question_bank.down.sql` على قاعدة المعاينة، أو احذف القاعدة كلها.

## الإنتاج لاحقاً (بعد موافقتك فقط)
لا شيء مما سبق يغيّر الإنتاج. للإطلاق: انسخ `migrations/qb/0001_question_bank.sql` إلى `migrations/0029_question_bank.sql` وشغّل `node scripts/gen-migrations.mjs` (يُطبَّق تلقائياً عند النشر)، ثم فعّل `QB_ENABLED=1` في Production. افعل ذلك في طلب دمج مستقل بعد مراجعتك.

## فحوص CI المتعلقة
`node scripts/gen-qb-migrations.mjs --check` يضمن أن الملف المولَّد يطابق SQL، و`tests/qb_schema.test.mjs` يضمن العزل والقيود والتراجع.
