# طريقة العمل في فريق «دفعتنا»

دليل قصير لكل من يطوّر المنصة. اقرأه مرة واحدة قبل أول طلب دمج.

## القاعدة الأساسية
- **لا أحد يكتب على `main` مباشرة.** كل تغيير في فرع، ثم طلب دمج (Pull Request)، ثم مراجعة المالك، ثم الدمج.
- `main` هو ما يُنشر على الموقع. كل دمج فيه يصل إلى الطلاب خلال دقائق.

## خطوات أي مهمة
1. حدّث نسختك: `git checkout main && git pull`
2. افتح فرعاً باسم واضح:
   - `feat/اسم-الميزة` لميزة جديدة، مثل `feat/chat-notify`
   - `fix/اسم-المشكلة` لإصلاح، مثل `fix/pdf-ipad`
   - `docs/...` للتوثيق
3. اعمل وارفع تغييرات صغيرة: `git push -u origin feat/...`
4. افتح طلب دمج إلى `main` واملأ القائمة التي تظهر فيه.
5. Cloudflare يعطي رابط معاينة للفرع تلقائياً (في تعليق داخل الطلب). جرّب عليه، خصوصاً على الهاتف وiPad.
6. انتظر نجاح الفحوص ✅ وموافقة المالك، ثم يُدمج.

طلب صغير (يوم أو يومان من العمل) أفضل من طلب كبير: مراجعته أسرع وتعارضاته أقل.

## تقسيم العمل
لتقليل التعارض، كل شخص يأخذ منطقة:

| المنطقة | الملفات |
|---|---|
| الواجهة | `iraq-platform/site/` (الصفحات وCSS وJS) |
| الخادم | `iraq-platform/functions/` و`iraq-platform/netlify/lib/` |
| قاعدة البيانات | `iraq-platform/migrations/` (بتنسيق مع المالك فقط) |
| القارئ «اكتب وظلّل» | `site/pdf-notes.html` و`site/js/studio-*.js` |

ملفات يلمسها الجميع، **نسّق قبل تعديلها** في مجموعة الفريق:
`site/sw.js`، `site/js/app.js`، `site/js/i18n.js`، `site/css/dfa.css`، `site/platform.html`.

## الفحوص
شغّلها قبل فتح الطلب (من داخل المجلد `iraq-platform/`):

```bash
node --test tests/*.test.mjs
python3 -I tests/browser/journeys.py
```

فحوص المتصفح تحتاج: `pip install playwright` ثم `python -m playwright install chromium`.
GitHub يشغّل الفحوص نفسها تلقائياً على كل طلب دمج (`.github/workflows/ci.yml`). الطلب الأحمر ❌ لا يُدمج.

## قواعد لا استثناء فيها
- **لا أسرار في الكود ولا في المحادثات:** مفاتيح VAPID، `GRADES_SECRET`، `UPLOAD_CODES`، معرّفات D1، كلمات المرور. هذه في إعدادات Cloudflare عند المالك فقط.
- **لا بيانات طلاب حقيقية** في المستودع أو في الفحوص (أسماء، أرقام، درجات). استعمل بيانات وهمية.
- **الترحيلات** (`migrations/`): كل جملة `IF NOT EXISTS`، وبعد إضافة ملف شغّل `node scripts/gen-migrations.mjs`. الترحيل يُطبَّق على قاعدة الإنتاج تلقائياً عند النشر، فلا ترحيل يحذف بيانات.
- **الصلاحيات والدخول والدرجات** (`functions/_lib/auth.js` وما يشبهه): أي تغيير فيها يُشرح بوضوح في الطلب.
- **الكاش:** عند تغيير CSS أو JS ارفع رقم `?v=` في الصفحة ورقم `V` في `site/sw.js`، وإلا يبقى الطلاب على النسخة القديمة.
- **النصوص:** كل نص عربي جديد في الواجهة يحتاج ترجمته في `i18n.js`.

## إذا حدث تعارض (Conflict)
```bash
git checkout main && git pull
git checkout فرعك
git merge main        # حلّ التعارض في الملفات، ثم:
git add . && git commit
git push
```
لا تستعمل `git push --force` على فرع يعمل عليه غيرك.

## إعداد المالك (مرة واحدة)
1. **Settings → Collaborators:** أضف كل مطوّر بحسابه، بصلاحية Write.
2. **Settings → Branches → Add rule** على `main`:
   - Require a pull request before merging، مع Require approvals = 1 وRequire review from Code Owners
   - Require status checks to pass: اختر `unit` و`browser`
   - Do not allow bypassing the above settings (اختياري: يطبّق القواعد عليك أيضاً)
3. **Cloudflare Pages → Settings → Builds:** تأكد أن معاينات الفروع مفعّلة (Preview deployments: All non-production branches).
4. الأسرار تبقى في Cloudflare فقط، ولا تُعطى صلاحية حساب Cloudflare إلا لمن يحتاجها فعلاً.
