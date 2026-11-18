"""«اكتب وظلّل» بشكل المنصة (pdf-notes.html) — python3 -I tests/browser/reader_pro.py
يفحص: بلا أخطاء صفحة، الوضع الليلي واحد مع المنصة (ms.theme ↔ body.medixa-dark)، زر الوضع الليلي في «المزيد» يبدّل وضع المنصة،
زر المرشد الذكي لا يغطي أشرطة الأدوات على الهاتف، القوائم المفتوحة فوق لوحة الصفحات، ولا تمرير أفقي."""
import json, os, sys, threading, http.server, functools
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, "..", "..", "site")
PDF = open(os.path.join(HERE, "..", "fixtures", "reader-sample.pdf"), "rb").read()
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8795), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
sys.path.insert(0, HERE)
from ui_mock import route_for
URL = "http://127.0.0.1:8795/pdf-notes.html?file=files/test/reader-sample.pdf"
res = []
def ck(name, ok): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name)

def open_reader(b, w, h, theme=None, touch=True):
    c = b.new_context(service_workers="block", viewport={"width": w, "height": h}, has_touch=touch, locale="ar")
    if theme: c.add_init_script("try{localStorage.setItem('ms.theme',%s)}catch(e){}" % json.dumps(json.dumps(theme)))
    pg = c.new_page(); errs, api = [], []
    pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    base = route_for("student")
    def handler(r):
        if r.request.url.split("?")[0].endswith("/files/test/reader-sample.pdf"): return r.fulfill(status=200, content_type="application/pdf", body=PDF)
        base(r, api)
    pg.route("**/*", handler)
    pg.goto(URL); pg.wait_for_selector("#pages section.page canvas.pdf"); pg.wait_for_timeout(1500)
    return c, pg, errs

def overlap(a, b): return not (a["x"] + a["width"] <= b["x"] or b["x"] + b["width"] <= a["x"] or a["y"] + a["height"] <= b["y"] or b["y"] + b["height"] <= a["y"])

with sync_playwright() as p:
    b = p.chromium.launch()
    # iPad أفقي، فاتح
    c, pg, errs = open_reader(b, 1180, 820, "light")
    ck("ipad: reader opens without page errors", not errs)
    ck("ipad: platform layer active (st-pro)", pg.evaluate("document.body.classList.contains('st-pro')"))
    ck("ipad: light theme → no medixa-dark", pg.evaluate("!document.body.classList.contains('medixa-dark')"))
    ck("ipad: toolbar uses platform surface", pg.evaluate("getComputedStyle(document.getElementById('studio-toolbar')).backgroundColor") == "rgb(255, 255, 255)")
    ck("ipad: no horizontal scroll", pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    ck("ipad: reader exempt from double-submit guard", pg.evaluate("!window.fetch.__dsGuard"))
    ck("speed: export library not loaded while opening", pg.evaluate("!window.PDFLib"))
    ck("speed: loading card removed after opening", pg.locator("#st-loading").count() == 0)
    ck("speed: early download consumed by the reader", pg.evaluate("window.__stPdf === null"))
    box = pg.locator("#pages section.page").first.bounding_box()
    pg.mouse.move(box["x"] + 200, box["y"] + 300); pg.mouse.down(); pg.mouse.move(box["x"] + 320, box["y"] + 340, steps=8); pg.mouse.up(); pg.wait_for_timeout(300)
    pg.click("#st-docmenu-btn"); pg.wait_for_timeout(200)
    with pg.expect_download(timeout=15000) as dl: pg.click("#download")
    ck("export: annotated PDF downloads (library loads on demand)", dl.value.suggested_filename.endswith(".pdf") and pg.evaluate("!!window.PDFLib"))
    pg.click("#st-docmenu-btn"); pg.wait_for_timeout(200); pg.click("#medixa-dark"); pg.wait_for_timeout(200)
    ck("menu: night button switches the platform theme", pg.evaluate("localStorage.getItem('ms.theme')") == '"dark"' and pg.evaluate("document.body.classList.contains('medixa-dark') && document.documentElement.dataset.theme==='dark'"))
    ck("menu: closes after choosing", pg.evaluate("document.getElementById('st-docmenu').hidden"))
    pg.click("#st-docmenu-btn"); pg.wait_for_timeout(200); pg.click("#medixa-suite-toggle"); pg.wait_for_timeout(400)
    ck("study space: platform name and night surface", pg.evaluate("document.querySelector('#medixa-suite .suite-head b').textContent") == "مساحة الدراسة"
       and pg.evaluate("getComputedStyle(document.getElementById('medixa-suite')).backgroundColor") != "rgb(248, 251, 252)")
    ck("no old English brand labels in the reader", pg.evaluate("!/MEDIXA|Study Mask|Study Suite/.test(document.body.innerText)"))
    pg.keyboard.press("Escape"); pg.evaluate("document.getElementById('medixa-suite').classList.remove('open')")
    pg.click("#medixa-thumbs-toggle"); pg.wait_for_timeout(300)
    pg.click("#studio-settings"); pg.wait_for_timeout(300)
    z = pg.evaluate("""(()=>{const t=document.getElementById('studio-toolbar'),p=document.querySelector('.st-panel:not([hidden])');
      return [+getComputedStyle(t).zIndex, p?+getComputedStyle(p).zIndex:0]})()""")
    ck("popup above the pages panel", z[0] > z[1])
    c.close()
    # الهاتف، الوضع التلقائي (ليلي على الهاتف)
    c, pg, errs = open_reader(b, 390, 844)
    ck("phone: default theme follows platform (dark on phone)", pg.evaluate("document.body.classList.contains('medixa-dark')"))
    pg.wait_for_timeout(1500)
    fab = pg.locator(".sab-fab").bounding_box()
    bars = [pg.locator(s).bounding_box() for s in ("#studio-toolbar", "#mx-dock") if pg.locator(s).count()]
    ck("phone: guide button does not cover tool bars", fab and all(not overlap(fab, x) for x in bars if x))
    ck("phone: guide button keeps the robot icon, label for screen readers", pg.locator(".sab-fab").get_attribute("aria-label") == "المرشد الذكي" and "🤖" in pg.locator(".sab-fab").inner_text())
    ck("phone: no page errors, no horizontal scroll", not errs and pg.evaluate("document.documentElement.scrollWidth <= innerWidth + 1"))
    c.close()
    b.close()
print("%d/%d" % (sum(res), len(res)))
sys.exit(0 if all(res) else 1)
