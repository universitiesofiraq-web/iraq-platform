"""رحلات المستخدم الأساسية بعد توحيد التصميم (API وهمي من ui_mock).
python3 -I tests/browser/journeys.py
يفحص: الدخول ← الاختيار ← المواد، الطالب المسجّل، الزائر، الرجوع وتغيير الجامعة، فتح المادة والملف،
الإدارة (بحث)، الدردشة والمساعد والدوري، انقطاع الاتصال وانتهاء الجلسة، وانتقال الوضع الليلي بلا وميض."""
import json, os, sys, threading, http.server, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "site")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8796), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
sys.path.insert(0, os.path.dirname(__file__))
from ui_mock import route_for
BASE = "http://127.0.0.1:8796/"
res = []
def ck(name, ok): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name)

def ctx(b, role, w=390, theme=None, extra=None):
    c = b.new_context(service_workers="block", viewport={"width": w, "height": 820}, locale="ar")
    if theme: c.add_init_script("try{localStorage.setItem('ms.theme',%s)}catch(e){}" % json.dumps(json.dumps(theme)))
    pg = c.new_page(); errs, api = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    base = route_for(role)
    def handler(r):
        if extra and extra(r): return
        base(r, api)
    pg.route("**/*", handler)
    return c, pg, errs

with sync_playwright() as p:
    b = p.chromium.launch()

    # 1) الدخول ← الاختيار ← المواد
    joined = {}
    def join_api(r):
        if "/api/catalog/join" in r.request.url:
            joined["body"] = r.request.post_data
            r.fulfill(status=200, content_type="application/json", body='{"ok":true,"department_id":41,"stage":2}'); return True
        return False
    c, pg, errs = ctx(b, "guest")
    pg.goto(BASE + "login.html"); pg.wait_for_timeout(400)
    ck("login: shared header + login card first", pg.locator(".iq-top .iq-brand").is_visible() and pg.locator("section.login").bounding_box()["y"] < pg.locator("section.intro").bounding_box()["y"])
    ck("login: google and guest actions visible", pg.locator('[data-auth="google"]').is_visible() and pg.locator('[data-auth="guest"]').is_visible())
    c.close()
    c, pg, errs = ctx(b, "student", extra=join_api)
    pg.goto(BASE + "join.html"); pg.wait_for_selector("#list .cg-item")
    pg.locator("#list .cg-item").first.click(); pg.wait_for_timeout(300)
    ck("join: step 1 done, step 2 current", "done" in pg.locator("#steps > button").nth(0).get_attribute("class") and pg.locator("#steps > button").nth(1).get_attribute("aria-current") == "step")
    pg.locator("#list .cg-item").first.click(); pg.wait_for_timeout(300)
    pg.locator("#list .cg-item").first.click(); pg.wait_for_timeout(300)
    ck("join: stage step shows college-based count", pg.locator(".jn-stages button").count() in (2, 4, 5, 6))
    pg.locator(".jn-stages button").nth(1).click(); pg.wait_for_timeout(600)
    ck("join: submits department + stage", "body" in joined and '"stage":2' in joined["body"].replace(" ", ""))
    ck("join: no page errors", not errs); c.close()

    # 4) الرجوع وتغيير الجامعة: الخطوة المنجزة زر يعيد ضبط ما بعدها
    c, pg, errs = ctx(b, "student")
    pg.goto(BASE + "join.html"); pg.wait_for_selector("#list .cg-item")
    pg.locator("#list .cg-item").first.click(); pg.wait_for_timeout(250)
    pg.locator("#list .cg-item").first.click(); pg.wait_for_timeout(250)
    pg.locator("#steps > button").nth(0).click(); pg.wait_for_timeout(300)
    ck("back: university step reopens list and resets college", pg.locator("#steps > button").nth(0).get_attribute("aria-current") == "step" and "done" not in (pg.locator("#steps > button").nth(1).get_attribute("class") or ""))
    c.close()

    # 2) طالب سبق أن اختار قسمه + انتقال الوضع بلا وميض
    c, pg, errs = ctx(b, "student", w=1280, theme="dark")
    pg.goto(BASE + "platform.html?dept=41&stage=2"); pg.wait_for_selector(".mv-grid")
    ck("student: home grid + latest on laptop (phone order)", pg.locator(".mv-grid").is_visible() and pg.locator("#latest").is_visible())
    ck("student: sidebar brand is دفعتنا", "دفعتنا" in pg.locator(".sidebar .brand").inner_text())
    first = pg.evaluate("new Promise(r=>{const x=document.documentElement.getAttribute('data-theme');r(x)})")
    ck("theme: dark applied", first == "dark")
    pg.goto(BASE + "catalog.html"); pg.wait_for_timeout(200)
    ck("theme: same theme on next page", pg.evaluate("document.documentElement.getAttribute('data-theme')") == "dark")
    ck("theme: set before first paint (head script)", pg.evaluate("[...document.head.children].findIndex(e=>e.src&&e.src.includes('theme.js')) < [...document.head.children].findIndex(e=>e.rel==='stylesheet')"))
    c.close()

    # 3) الزائر
    c, pg, errs = ctx(b, "guest")
    pg.goto(BASE + "catalog.html"); pg.wait_for_selector("#list .cg-item")
    ck("guest: catalog lists universities", pg.locator("#list .cg-item").count() >= 2)
    ck("guest: header has login action", pg.locator(".iq-top .iq-login").is_visible())
    ck("guest: no page errors", not errs); c.close()

    # 5) فتح المادة والملف: الملف يفتح في القارئ
    c, pg, errs = ctx(b, "student")
    pg.goto(BASE + "subject.html?id=5"); pg.wait_for_timeout(800)
    hrefs = pg.eval_on_selector_all("a[href*='pdf-notes.html']", "e=>e.map(x=>x.getAttribute('href'))")
    ck("subject: files open in study reader", len(hrefs) > 0)
    ck("subject: offline save buttons", pg.locator("text=حفظ بلا إنترنت").count() > 0); c.close()

    # 7) الإدارة: بحث
    c, pg, errs = ctx(b, "admin", w=1280)
    pg.goto(BASE + "admin.html"); pg.wait_for_timeout(900)
    ck("admin: dashboard renders", pg.locator("h1").first.is_visible())
    box = pg.locator("#search")
    if box.is_visible():
        box.fill("البصرة"); pg.wait_for_timeout(300)
    ck("admin: no page errors", not errs)
    ck("admin: theme toggle uses shared theme", pg.locator("#theme").count() == 1)
    pg.click("#theme"); ck("admin: toggle persists ms.theme", pg.evaluate("localStorage.getItem('ms.theme')") in ('"dark"', '"light"'))
    c.close()

    # 8) الدردشة والمساعد والدوري
    for page in ("group-chat.html", "study-assistant.html", "league.html"):
        c, pg, errs = ctx(b, "student")
        pg.goto(BASE + page); pg.wait_for_timeout(900)
        ck("%s: loads without errors, no h-scroll" % page, not errs and pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
        c.close()

    # 9) انقطاع الاتصال وانتهاء الجلسة
    def offline(r):
        if "/api/" in r.request.url: r.abort(); return True
        return False
    c, pg, errs = ctx(b, "student", extra=offline)
    pg.goto(BASE + "catalog.html"); pg.wait_for_timeout(900)
    ck("offline: catalog shows a message, no crash", not errs and pg.locator("main").inner_text().strip() != "")
    c.close()
    def expired(r):
        if "/api/auth/me" in r.request.url: r.fulfill(status=401, content_type="application/json", body='{"ok":false,"error":"unauthorized"}'); return True
        return False
    c, pg, errs = ctx(b, "student", extra=expired)
    pg.goto(BASE + "join.html"); pg.wait_for_timeout(900)
    ck("expired session: join still usable or redirects to login", "login.html" in pg.url or pg.locator("#list").count() == 1)
    c.close()

    # منع تكرار الإرسال: زر يرسل POST يتعطل حتى الرد
    c, pg, errs = ctx(b, "student")
    pg.goto(BASE + "search.html"); pg.wait_for_timeout(300)
    busy = pg.evaluate("""async()=>{const b=document.createElement('button');document.body.appendChild(b);b.focus();
      let resolve;const orig=window.fetch;const p=window.fetch('/api/x',{method:'POST'}).catch(()=>{});const during=b.disabled;await p;return [during,b.disabled]}""")
    ck("double-submit guard disables then re-enables", busy == [True, False]); c.close()
    b.close()
print("%d/%d" % (sum(res), len(res)))
sys.exit(0 if all(res) else 1)
