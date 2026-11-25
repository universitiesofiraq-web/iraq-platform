# فحص واجهة المشرف لبنك الأسئلة في Chromium حقيقي: القائمة، محرر السؤال، محرر الاختبارات المرئي (سحب وإفلات، حفظ تلقائي، تراجع، معاينة)،
# الاستيراد، الصلاحيات (مشرف/رافع/طالب)، والهاتف. الخادم الحقيقي (handleQb) على SQLite في الذاكرة.
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from qb_harness import server
_srv = server(); BASE = _srv.__enter__()
SHOTS = os.environ.get("QB_SHOTS", "/tmp/qbshots"); os.makedirs(SHOTS, exist_ok=True)
fails = []
def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

def new_page(ctx, errors):
    pg = ctx.new_page()
    pg.on("pageerror", lambda e: errors.append("PAGEERR " + str(e)))
    pg.on("console", lambda m: errors.append(m.text) if m.type == "error" and "net::" not in m.text and "ERR_FAILED" not in m.text and "401" not in m.text and "403" not in m.text and "409" not in m.text else None)
    return pg

def api(page, method, path, body=None):
    return page.evaluate("""async ([m, p, b]) => { const r = await fetch('/api/qb/' + p, {method: m, headers: {'content-type': 'application/json'}, body: b ? JSON.stringify(b) : undefined}); return {status: r.status, body: await r.json().catch(() => null)}; }""", [method, path, body])

with sync_playwright() as pw:
    br = pw.chromium.launch()
    ctx = br.new_context(viewport={"width": 1280, "height": 800}, locale="ar-IQ", accept_downloads=True)
    ctx.route("**/fonts.g*/**", lambda r: r.abort())
    errors = []
    page = new_page(ctx, errors)

    # 1) بلا دخول
    page.goto(BASE + "/qbank-admin.html"); page.wait_for_timeout(600)
    check("سجّل الدخول" in page.inner_text("#app"), "بلا دخول: رسالة تسجيل الدخول")

    # 2) الطالب لا يملك صلاحية إدارة
    page.goto(BASE + "/__login/st?next=/qbank-admin.html"); page.wait_for_timeout(700)
    check("لا توجد مواد تديرها" in page.inner_text("#app"), "الطالب: لا مواد للإدارة")
    page.goto(BASE + "/__login/other?next=/qbank-admin.html"); page.wait_for_timeout(700)
    check("لا توجد مواد تديرها" in page.inner_text("#app"), "مستخدم خارج النطاق: لا مواد")

    # 3) المشرف/الممثل: اختيار المادة وقائمة الأسئلة
    page.goto(BASE + "/__login/rep?next=/qbank-admin.html"); page.wait_for_selector(".qb-grid .qb-card"); errors.clear()
    page.screenshot(path=SHOTS + "/ad-pick.png")
    page.click(".qb-grid .qb-card"); page.wait_for_selector(".qb-list-item")
    check("11 سؤال" in page.inner_text("#app"), "القائمة: 11 سؤالاً")
    page.select_option("select[aria-label='كل الأنواع']", "tf"); page.wait_for_function("document.querySelectorAll('.qb-list-item').length === 1")
    check(True, "التصفية بالنوع tf تعطي سؤالاً واحداً")
    page.select_option("select[aria-label='كل الأنواع']", ""); page.wait_for_function("document.querySelectorAll('.qb-list-item').length === 11")
    page.fill("input[aria-label='بحث']", "اذكر"); page.wait_for_function("document.querySelectorAll('.qb-list-item').length === 1")
    check(True, "البحث النصي يعمل")
    page.fill("input[aria-label='بحث']", ""); page.wait_for_function("document.querySelectorAll('.qb-list-item').length === 11")

    # 4) إنشاء سؤال SBA جديد عبر المحرر
    page.click("button:has-text('+ سؤال جديد')"); page.click(".qb-dialog button:has-text('اختيار واحد')"); page.wait_for_selector(".qb-editor")
    page.screenshot(path=SHOTS + "/ad-editor-empty.png")
    page.locator(".qb-editor textarea").first.fill("ما الوريد الأجوف؟")
    opts = page.locator(".qb-opt-edit input[type=text]")
    for i, t in enumerate(["وريد كبير", "شريان", "عصب", "عظم"]): opts.nth(i).fill(t)
    page.locator(".qb-opt-edit .qb-correct input").first.check()
    page.wait_for_timeout(500)
    check("وريد كبير" in page.locator(".qb-preview").inner_text(), "المعاينة الحية تعرض الخيارات")
    page.click("button:has-text('حفظ كمسودة')"); page.wait_for_selector(".qb-toast.ok"); page.wait_for_timeout(300)
    check("/q/" in page.url and "/q/new" not in page.url, "بعد الحفظ يصير الرابط رابط السؤال")
    page.screenshot(path=SHOTS + "/ad-editor-saved.png")
    page.click("button:has-text('نشر')"); page.wait_for_function("document.body.innerText.includes('منشور')")
    check(True, "نشر السؤال من المحرر")
    # سؤال غير صالح: بلا إجابة صحيحة
    page.click("button:has-text('إغلاق')"); page.wait_for_selector(".qb-list-item")
    page.click("button:has-text('+ سؤال جديد')"); page.click(".qb-dialog button:has-text('اختيار واحد')"); page.wait_for_selector(".qb-editor")
    page.locator(".qb-editor textarea").first.fill("سؤال ناقص")
    page.click("button:has-text('حفظ كمسودة')"); page.wait_for_selector(".qb-toast.bad")
    check(True, "الخادم يرفض سؤالاً ناقصاً ويظهر خطأ واضح")
    page.click("button:has-text('إغلاق')")
    try: page.click("button:has-text('تجاهل')", timeout=1500)
    except Exception: pass
    page.wait_for_selector(".qb-list-item")
    check("12 سؤال" in page.inner_text("#app"), "القائمة بعد الإضافة: 12 سؤالاً")

    # 5) محرر الاختبارات المرئي
    page.click("a:has-text('الاختبارات')"); page.wait_for_selector(".qb-list-item"); page.click(".qb-title"); page.wait_for_selector(".qb-builder .qb-entry")
    n0 = page.locator(".qb-entry").count()
    check(n0 == 6, f"المحرر: يحمّل 6 عناصر (قسم+عنوان+4 أسئلة) — {n0}")
    # إضافة عنوان بالضغط
    page.click(".qb-pal-item:has-text('عنوان')"); page.wait_for_function(f"document.querySelectorAll('.qb-entry').length === {n0+1}")
    page.locator(".qb-entry.sel input.qb-input").fill("عنوان جديد");
    page.wait_for_function("document.querySelector('.qb-save').textContent.includes('تم الحفظ')", timeout=8000)
    check(True, "حفظ تلقائي بعد التعديل")
    # سحب وإفلات من اللوحة إلى أعلى اللوحة
    src = page.locator(".qb-pal-item:has-text('نص / وصف')"); dst = page.locator(".qb-entry").nth(2)
    src.drag_to(dst); page.wait_for_function(f"document.querySelectorAll('.qb-entry').length === {n0+2}")
    check(True, "إفلات عنصر من اللوحة على الاختبار يضيفه")
    # تراجع وإعادة
    page.wait_for_timeout(900)
    page.click("button[aria-label='تراجع']"); page.wait_for_function(f"document.querySelectorAll('.qb-entry').length === {n0+1}")
    page.click("button[aria-label='إعادة']"); page.wait_for_function(f"document.querySelectorAll('.qb-entry').length === {n0+2}")
    check(True, "تراجع/إعادة يعملان")
    # حفظ ثم إعادة تحميل الصفحة: الحالة محفوظة
    page.wait_for_function("document.querySelector('.qb-save').textContent.includes('تم الحفظ')", timeout=8000)
    page.reload(); page.wait_for_selector(".qb-builder .qb-entry")
    check(page.locator(".qb-entry").count() == n0 + 2, "بعد إعادة التحميل العناصر محفوظة")
    # حذف مع تراجع
    page.locator(".qb-entry").nth(2).locator("button[aria-label='حذف']").click(); page.wait_for_function(f"document.querySelectorAll('.qb-entry').length === {n0+1}")
    page.click(".qb-toast button:has-text('تراجع')"); page.wait_for_function(f"document.querySelectorAll('.qb-entry').length === {n0+2}")
    check(True, "الحذف قابل للتراجع من الإشعار")
    # إضافة من البنك
    page.click(".qb-tab:has-text('من البنك')"); page.wait_for_selector(".qb-bank-item")
    page.locator(".qb-bank-item button:not([disabled])").first.click(); page.wait_for_function(f"document.querySelectorAll('.qb-entry').length === {n0+3}")
    check(True, "إضافة سؤال من البنك")
    # شرط ظهور على سؤال
    q2 = page.locator(".qb-entry.k-question").nth(1); q2.click(position={"x": 200, "y": 40}); page.wait_for_selector(".qb-props .qb-btn:has-text('شرط ظهور')")
    page.click(".qb-props .qb-btn:has-text('شرط ظهور')"); page.wait_for_selector(".qb-pair")
    page.screenshot(path=SHOTS + "/ad-builder.png")
    page.wait_for_function("document.querySelector('.qb-save').textContent.includes('تم الحفظ')", timeout=8000)
    check(page.locator(".qb-chip.on").count() >= 1, "قاعدة شرطية تظهر كشارة على العنصر")
    # معاينة
    page.click("button:has-text('معاينة')"); page.wait_for_selector(".qb-pv-q .qb-q", timeout=8000)
    check(page.locator(".qb-pv-q .qb-q").count() >= 1, "المعاينة ترسم الأسئلة")
    page.screenshot(path=SHOTS + "/ad-preview.png")
    page.click("button:has-text('تحرير')")
    # نسخ حالة: الاختبار منشور وله محاولات؟ الإعدادات
    page.click("button:has-text('الإعدادات')"); page.wait_for_selector(".qb-dialog h3:has-text('إعدادات الاختبار')")
    page.screenshot(path=SHOTS + "/ad-settings.png")
    page.click(".qb-dialog button:has-text('تم')")
    # حالة/نشر: قائمة الإجراءات
    page.click("button:has-text('الحالة / نشر')"); page.wait_for_selector(".qb-dialog h3:has-text('حالة الاختبار')")
    page.click(".qb-dialog button:has-text('إلغاء')")
    page.click("button:has-text('إحصاءات')"); page.wait_for_selector(".qb-stats")
    check("محاولة" in page.locator(".qb-dialog").inner_text(), "إحصاءات الاختبار")
    page.click(".qb-dialog button:has-text('إغلاق')")

    # 6) اختبار جديد من الصفر + التوليد من البنك + نشر
    page.click("button[aria-label='رجوع']"); page.wait_for_selector(".qa-sub")
    page.click("button:has-text('+ اختبار جديد')"); page.fill(".qb-dialog input[aria-label='العنوان']", "اختبار فحص"); page.click(".qb-dialog button:has-text('إنشاء')")
    page.wait_for_selector(".qb-builder"); page.click(".qb-tab:has-text('توليد')"); page.wait_for_selector("button:has-text('ولّد وأضف')")
    page.locator(".qb-palette input[type=number]").first.fill("4"); page.click("button:has-text('ولّد وأضف')")
    page.wait_for_function("document.querySelectorAll('.qb-entry').length === 4", timeout=8000)
    check(True, "توليد 4 أسئلة من البنك")
    page.wait_for_function("document.querySelector('.qb-save').textContent.includes('تم الحفظ')", timeout=8000)
    page.click("button:has-text('الحالة / نشر')"); page.click(".qb-dialog button:has-text('نشر الآن')"); page.wait_for_selector(".qb-toast.ok:has-text('منشور')", timeout=8000)
    check(page.locator(".qb-badge:has-text('منشور')").count() >= 1, "نشر الاختبار الجديد")

    # 7) الاستيراد: CSV وGIFT مع معاينة وكشف تكرار
    page.goto(BASE + "/qbank-admin.html#/s/1/io"); page.wait_for_selector("input[type=file]")
    csv = "type,text,option1,option2,option3,correct,explanation,points,difficulty,tags\nsba,ما عاصمة العراق؟,بغداد,البصرة,الموصل,1,بغداد العاصمة,1,1,جغرافيا\ntf,الأرض كروية,,,,true,,1,1,\ntf,الرئة اليمنى فيها ثلاثة فصوص.,,,,true,,1,1,\nsba,بلا إجابة,أ,ب,,9,,1,2,\n"
    open("/tmp/qb_import.csv", "w", encoding="utf-8").write(csv)
    page.set_input_files("input[type=file]", "/tmp/qb_import.csv"); page.wait_for_selector(".qb-mini-table")
    txt = page.inner_text("#app")
    check("مكرر" in txt and "جاهز" in txt, "معاينة الاستيراد تكشف المكرر وتُظهر الجاهز")
    page.screenshot(path=SHOTS + "/ad-import.png")
    page.click("button:has-text('كمسودات')"); page.wait_for_selector(".qb-toast.ok")
    r = api(page, "GET", "admin/questions?subject=1&status=draft&limit=50")
    check(any("عاصمة العراق" in q["content"]["text"] for q in r["body"]["questions"]), "المستورد يظهر مسودة (لا نشر تلقائي)")
    gift = "::q1::ما لون السماء؟ {=أزرق ~أحمر ~أخضر}\n\nالماء يغلي عند 100 {T}\n"
    open("/tmp/qb_import.gift", "w", encoding="utf-8").write(gift)
    page.reload(); page.wait_for_selector("input[type=file]"); page.set_input_files("input[type=file]", "/tmp/qb_import.gift"); page.wait_for_selector(".qb-mini-table")
    check(page.locator(".qb-badge.ok:has-text('جاهز')").count() == 2, "GIFT: سؤالان جاهزان")
    # تصدير JSON
    with page.expect_download() as dl: page.click("button:has-text('JSON كامل')")
    data = json.load(open(dl.value.path(), encoding="utf-8")); check(data["count"] >= 12 and data["format"] == "iraq-platform-qb", "تصدير JSON")

    # 8) الحالات والتصنيفات والتصحيح والإحصاءات
    page.goto(BASE + "/qbank-admin.html#/s/1/cases"); page.wait_for_selector(".qb-list-item")
    check("رجل بألم صدري" in page.inner_text("#app"), "الحالات السريرية تُعرض")
    page.goto(BASE + "/qbank-admin.html#/s/1/taxonomy"); page.wait_for_selector(".qb-list-item")
    check("القلب والدورة" in page.inner_text("#app"), "التصنيفات تُعرض")
    page.goto(BASE + "/qbank-admin.html#/s/1/stats"); page.wait_for_selector(".qb-stats")
    check("الأسئلة حسب الحالة" in page.inner_text("#app"), "الإحصاءات تُعرض")
    page.goto(BASE + "/qbank-admin.html#/s/1/grading"); page.wait_for_selector("h2")
    page.goto(BASE + "/qbank-admin.html#/s/1/reports"); page.wait_for_selector("h2")
    check(not [e for e in errors if "PAGEERR" in e], "لا أخطاء جافاسكربت في صفحات المشرف: " + str(errors[:3]))

    # 9) الرافع (أقل صلاحية): لا يرى النشر ولا التصنيفات، ويقدر يُدخل مسودة
    ctx2 = br.new_context(viewport={"width": 1280, "height": 800}, locale="ar-IQ"); ctx2.route("**/fonts.g*/**", lambda r: r.abort())
    e2 = []; up = new_page(ctx2, e2)
    up.goto(BASE + "/__login/up?next=/qbank-admin.html"); up.wait_for_selector(".qb-grid .qb-card"); up.click(".qb-grid .qb-card"); up.wait_for_selector(".qa-sub")
    subs = up.inner_text(".qa-sub")
    check("التصحيح" not in subs and "البلاغات" not in subs and "التصنيفات" not in subs, "الرافع: لا يرى تبويبات المراجعة")
    up.goto(BASE + "/qbank-admin.html#/s/1/q/new/tf"); up.wait_for_selector(".qb-editor")
    up.locator(".qb-editor textarea").first.fill("سؤال من رافع"); up.click("button:has-text('حفظ كمسودة')"); up.wait_for_selector(".qb-toast.ok")
    check("نشر" not in up.locator(".qb-sticky-actions").inner_text().replace("إرسال للمراجعة", ""), "الرافع: لا زر نشر في المحرر")
    check(api(up, "GET", "admin/audit")["status"] == 403, "الرافع: الخادم يمنع سجل العمليات")
    # الرافع لا ينشر عبر الواجهة البرمجية أيضاً
    qid = int(up.url.split("/q/")[1]); check(api(up, "POST", f"admin/question/{qid}/status", {"to": "published"})["status"] == 403, "الرافع: نشر مرفوض من الخادم")
    ctx2.close()

    # 10) الهاتف: أوراق سفلية في محرر الاختبارات
    ctx3 = br.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ar-IQ", has_touch=True, is_mobile=True); ctx3.route("**/fonts.g*/**", lambda r: r.abort())
    e3 = []; m = new_page(ctx3, e3)
    m.goto(BASE + "/__login/rep?next=/qbank-admin.html%23/s/1/quizzes"); m.wait_for_selector(".qb-list-item"); m.screenshot(path=SHOTS + "/ad-m-quizzes.png")
    m.click(".qb-title"); m.wait_for_selector(".qb-builder .qb-entry")
    check(not m.locator(".qb-palette").is_visible(), "الهاتف: لوحة العناصر مخفية افتراضياً")
    m.screenshot(path=SHOTS + "/ad-m-builder.png")
    m.click(".qb-fab-row button:has-text('+ إضافة')"); m.wait_for_timeout(400)
    check(m.locator(".qb-palette").is_visible(), "الهاتف: زر إضافة يفتح الورقة السفلية")
    m.screenshot(path=SHOTS + "/ad-m-sheet.png")
    m.click(".qb-pal-item:has-text('فاصل') >> nth=0"); m.wait_for_timeout(300)
    check(not m.locator(".qb-palette").is_visible(), "الهاتف: تُغلق الورقة بعد الإضافة")
    ow = m.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"); check(ow, "الهاتف: لا تمرير أفقي")
    check(not [e for e in e3 if "PAGEERR" in e], "الهاتف: لا أخطاء جافاسكربت")
    ctx3.close(); br.close()
_srv.__exit__(None, None, None)
print("\nFAILS:", len(fails)); [print(" -", f) for f in fails]; sys.exit(1 if fails else 0)
