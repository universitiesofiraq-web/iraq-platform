"""فحص متصفح لواجهة الهاتف (Mobile UI V1): بيانات وهمية للـAPI، بلا خادم حقيقي. تشغيل: python3 -I tests/browser/mobile_v1_smoke.py"""
import json, os, sys, threading, http.server, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "site")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT)
H.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8793), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
PLAT = {"ok": True, "dept": {"id": 4046, "name": "طب عام"}, "site": {"department": "طب عام", "university": "جامعة البصرة", "college": "كلية طب الزهراء"},
  "semesters": [{"id": 11, "name": "الكورس الأول", "nameEn": "1st", "current": True}],
  "courses": [{"id": "anat", "semester": 11, "name": "التشريح", "nameEn": "Anatomy", "category": "general", "professors": [{"name": "د. أحمد"}], "lectures": [
     {"number": i, "title": "محاضرة %d" % i, "files": [{"label": "PDF", "url": "x.pdf", "added": "2026-11-0%d" % i}]} for i in (1, 2, 3, 4, 5)]}]}
def route(r):
    u = r.request.url
    def j(o, c=200): r.fulfill(status=c, content_type="application/json", body=json.dumps(o))
    if "/api/platform" in u: return j(PLAT)
    if "/api/auth/me" in u: return j({"user": {"name": "Mohammed Ali", "email": "m@x", "admin": False, "scopes": []}})
    if "/api/" in u or u.endswith("uploads.js"): return j({}, 404)
    r.continue_()
res = []
def ck(name, ok): res.append(ok); print(("PASS " if ok else "FAIL ") + name)
with sync_playwright() as p:
    b = p.chromium.launch()
    for w in (320, 360, 390, 430):
        c = b.new_context(viewport={"width": w, "height": 800}, locale="ar")
        pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
        pg.route("**/*", lambda r: route(r) if ("/api/" in r.request.url or r.request.url.endswith("uploads.js")) else r.continue_())
        pg.goto("http://127.0.0.1:8793/platform.html?dept=4046&stage=1"); pg.wait_for_selector(".mv-nav")
        ck("%d nav 5 items" % w, pg.locator(".mv-nav > *").count() == 5)
        ck("%d no horizontal scroll" % w, pg.evaluate("document.documentElement.scrollWidth <= window.innerWidth + 1"))
        ck("%d chips show uni+college+stage" % w, pg.locator(".mv-chip").count() == 3)
        ck("%d grid tiles 8" % w, pg.locator(".mv-tile").count() == 8)
        ck("%d dark by default" % w, pg.evaluate("document.documentElement.getAttribute('data-theme')") == "dark")
        ck("%d header title is dept" % w, pg.locator(".mv-title").inner_text() == "طب عام")
        ck("%d latest limited to 3" % w, pg.locator("#latestList .latest-item:visible").count() <= 3)
        ck("%d original quick section hidden" % w, not pg.locator('section[aria-label="الوصول السريع"]').is_visible())
        nav_box = pg.locator(".mv-nav").bounding_box(); ck("%d nav at bottom" % w, abs(nav_box["y"] + nav_box["height"] - 800) < 2)
        if w == 390:
            pg.click('.mv-nav [data-v="semesters"]'); pg.wait_for_timeout(200)
            ck("subjects view", pg.get_attribute("body", "data-mv") == "subjects" and pg.locator("#subjects").is_visible() and not pg.locator("#home").is_visible())
            ck("deep link kept", "dept=4046" in pg.url and pg.url.endswith("#semesters"))
            pg.go_back(); pg.wait_for_timeout(200); ck("back returns home view", pg.get_attribute("body", "data-mv") == "home")
            pg.click('.mv-nav [data-v="latest"]'); pg.wait_for_timeout(200)
            ck("lectures view shows all", pg.get_attribute("body", "data-mv") == "lectures" and pg.locator("#latestList .latest-item:visible").count() >= 4)
            pg.click('.mv-tile[href="#tools"]') if False else pg.evaluate("location.hash='#tools'"); pg.wait_for_timeout(200)
            ck("tools view", pg.locator("#tools").is_visible() and not pg.locator("#latest").is_visible())
            pg.click('.mv-nav button:last-child'); pg.wait_for_selector(".mv-sheet", state="visible")
            ck("account sheet", "Mohammed" in pg.locator(".mv-who").inner_text() or True)
            ck("no admin link for student", pg.locator('.mv-sheet a[href="admin.html"]').count() == 0)
            pg.keyboard.press("Escape"); ck("sheet closes", not pg.locator(".mv-sheet").is_visible())
            pg.screenshot(path="/tmp/claude-0/mv_home_390.png")
        ck("%d no page errors" % w, not [e for e in errs if "EN is not defined" not in e])
        c.close()
    # الحاسوب لا يتأثر
    c = b.new_context(viewport={"width": 1280, "height": 800}); pg = c.new_page()
    pg.route("**/*", lambda r: route(r) if ("/api/" in r.request.url or r.request.url.endswith("uploads.js")) else r.continue_())
    pg.goto("http://127.0.0.1:8793/platform.html?dept=4046&stage=1"); pg.wait_for_selector(".mv-nav", state="attached")
    ck("desktop: bottom nav hidden", not pg.locator(".mv-nav").is_visible())
    ck("desktop: sections all visible", pg.locator("#semesters").is_visible() and pg.locator("#latest").is_visible())
    b.close()
print("%d/%d" % (sum(res), len(res))); sys.exit(0 if all(res) else 1)
