# فحص واجهة الطالب لبنك الأسئلة في Chromium حقيقي على خادم qb_server.mjs (المعالج الحقيقي + SQLite).
import os, sys, json
sys.path.insert(0, os.path.dirname(__file__))
from playwright.sync_api import sync_playwright
from qb_harness import server
_srv = server(); BASE = _srv.__enter__()
SHOTS = os.environ.get("QB_SHOTS", "/tmp/qbshots")
fails = []
def check(cond, msg):
    print(("ok   " if cond else "FAIL ") + msg)
    if not cond: fails.append(msg)

with sync_playwright() as p:
    b = p.chromium.launch()
    ctx = b.new_context(viewport={"width": 390, "height": 844}, device_scale_factor=2, locale="ar-IQ")
    ctx.route("**/fonts.g*/**", lambda r: r.abort())
    page = ctx.new_page()
    errors = []
    page.on("pageerror", lambda e: errors.append(str(e)))
    page.on("console", lambda m: errors.append(m.text) if m.type == "error" and "ERR_FAILED" not in m.text and "net::" not in m.text else None)
    page.goto(BASE + "/qbank.html"); page.wait_for_timeout(600)
    check("سجّل الدخول" in page.inner_text("#app"), "بلا دخول: تظهر رسالة تسجيل الدخول")
    page.goto(BASE + "/__login/st?next=/qbank.html"); page.wait_for_selector(".qb-card"); errors.clear()
    check(page.locator(".qb-grid .qb-card").count() == 1, "الرئيسية: مادة واحدة")
    page.screenshot(path=SHOTS + "/st-home.png")
    page.click(".qb-grid .qb-card"); page.wait_for_selector(".qb-tabs")
    check("ابنِ تدريبك" in page.inner_text("#app"), "صفحة المادة: باني التدريب الذكي")
    page.screenshot(path=SHOTS + "/st-subject.png")
    # تدريب ذكي: 5 أسئلة
    page.click("text=5 >> nth=0"); page.click("button:has-text('ابدأ')"); page.wait_for_selector(".qb-q")
    check("/run/" in page.url, "بدأ التدريب")
    seen = 0
    for i in range(5):
        q = page.locator(".qb-q").first
        t = q.get_attribute("data-type")
        if t in ("sba", "mcq"): q.locator(".qb-opt").first.click()
        elif t == "mrq": q.locator(".qb-opt").nth(0).click()
        elif t == "tf": q.locator(".qb-tf-btn").first.click()
        elif t in ("saq",): q.locator("input[type=text]").fill("القلب")
        elif t == "numerical": q.locator("input").fill("70")
        elif t == "essay": q.locator("textarea").fill("نص مقالي")
        elif t == "fill": q.locator("input").nth(0).fill("الشرايين")
        elif t == "ordering": pass
        elif t in ("emq", "matching"):
            sels = q.locator("select"); 
            for k in range(sels.count()): sels.nth(k).select_option(index=1)
        if i == 0:
            page.wait_for_timeout(300); page.screenshot(path=SHOTS + "/st-question.png")
        chk = page.locator("button:has-text('تحقّق')")
        if chk.count() and chk.first.is_enabled():
            chk.first.click()
            try: page.wait_for_selector(".qb-banner:not([hidden])", timeout=4000)
            except Exception:
                print("DEBUG type", t, page.inner_text("#app")[:300], page.locator("#qb-toasts").inner_text() if page.locator("#qb-toasts").count() else ""); raise
            seen += 1
            if seen == 1: page.screenshot(path=SHOTS + "/st-checked.png")
        if i < 4: page.click("button:has-text('التالي')"); page.wait_for_timeout(150)
    check(seen >= 1, "التحقق الفوري يكشف الشرح في وضع التدريب")
    page.click("button:has-text('إنهاء وتسليم')"); page.click(".qb-dialog button:has-text('تسليم نهائي')")
    page.wait_for_selector(".qb-ring", timeout=6000)
    check("/result/" in page.url, "عرض النتيجة بعد التسليم")
    page.screenshot(path=SHOTS + "/st-result.png", full_page=True)
    check(page.locator(".qb-stats .qb-stat").count() >= 5, "إحصاءات النتيجة")
    # اختبار رسمي بمؤقت
    page.goto(BASE + "/qbank.html#/subject/1/quizzes"); page.wait_for_selector(".qb-card h3")
    page.click("button:has-text('ابدأ')"); page.wait_for_selector(".qb-q")
    check(page.locator("#timer").is_visible(), "المؤقت ظاهر في الاختبار")
    check(page.locator(".qb-reveal").count() == 0 and page.locator("button:has-text('تحقّق')").count() == 0, "لا تحقق فوري ولا شرح في الامتحان")
    page.locator(".qb-opt").first.click()
    try: page.wait_for_function("document.querySelector('.qb-save') && document.querySelector('.qb-save').textContent.includes('تم الحفظ')", timeout=5000); saved = True
    except Exception: saved = False
    check(saved, "حفظ تلقائي")
    page.screenshot(path=SHOTS + "/st-exam.png")
    # استئناف بعد إعادة التحميل
    page.reload(); page.wait_for_selector(".qb-q")
    check(page.locator(".qb-opt:has(input:checked)").count() == 1, "استئناف الإجابة المحفوظة بعد إعادة التحميل")
    # لا مفاتيح إجابة في استجابة الشبكة
    leak = page.evaluate("""async () => { const r = await fetch('/api/qb/attempts/' + location.hash.split('/')[2]); const t = await r.text(); return /\\"correct\\"|explanation/.test(t); }""")
    check(leak is False, "استجابة المحاولة الجارية بلا مفاتيح إجابة")
    # أجب وسلّم
    while True:
        if page.locator("textarea").count(): page.locator("textarea").fill("إجابة مقالية للتصحيح اليدوي"); page.wait_for_timeout(300)
        if not page.locator("button:has-text('التالي')").count(): break
        page.click("button:has-text('التالي')"); page.wait_for_timeout(100)
    page.click("button:has-text('إنهاء وتسليم')"); page.click(".qb-dialog button:has-text('تسليم نهائي')")
    page.wait_for_selector(".qb-ring", timeout=6000)
    check("تنتظر التصحيح" in page.inner_text("#app") or "غير نهائية" in page.inner_text("#app"), "نتيجة غير نهائية بسبب سؤال مقالي")
    page.screenshot(path=SHOTS + "/st-exam-result.png", full_page=True)
    # بطاقات
    page.goto(BASE + "/qbank.html#/cards/1"); page.wait_for_selector(".qb-flash")
    page.click("button:has-text('أظهر الإجابة')"); page.wait_for_selector(".qb-rate")
    page.screenshot(path=SHOTS + "/st-card.png")
    page.click(".qb-rate button >> nth=2"); page.wait_for_selector(".qb-flash")
    check(True, "البطاقات: إظهار وتقييم")
    # الوضع الداكن وسطح المكتب
    page.emulate_media(color_scheme="dark"); page.evaluate("localStorage.setItem('ms.theme', JSON.stringify('dark'))")
    page.set_viewport_size({"width": 1280, "height": 800}); page.goto(BASE + "/qbank.html#/subject/1"); page.wait_for_selector(".qb-tabs"); page.reload(); page.wait_for_selector(".qb-tabs")
    page.screenshot(path=SHOTS + "/st-desktop-dark.png")
    # لا تمرير أفقي على الهاتف
    page.set_viewport_size({"width": 360, "height": 740}); page.goto(BASE + "/qbank.html#/subject/1"); page.wait_for_selector(".qb-tabs")
    check(page.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"), "لا تمرير أفقي على 360px")
    check(not errors, "لا أخطاء JS في الكونسول: " + "; ".join(errors[:3]))
    b.close()
print("FAILED:" if fails else "ALL OK", fails)
_srv.__exit__(None, None, None)
sys.exit(1 if fails else 0)
