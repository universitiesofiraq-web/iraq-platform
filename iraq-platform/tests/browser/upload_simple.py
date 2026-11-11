"""فحص صفحة الرفع المبسّطة لممثل مرحلة واحدة (API وهمي). تشغيل: python3 -I tests/browser/upload_simple.py"""
import json, os, threading, http.server, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "site")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8794), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
subjects, posted = [], []
def route(r):
    u = r.request.url
    def j(o, c=200): r.fulfill(status=c, content_type="application/json", body=json.dumps(o))
    if "/api/auth/me" in u: return j({"ok": True, "user": {"id": 7, "admin": False, "scopes": [{"type": "stage", "node_id": 11, "level": "rep", "stage_number": 1, "department_id": 5, "label": "قسم · المرحلة 1"}]}})
    if "/api/upload-options" in u and "department_id" in u: return j({"ok": True, "items": subjects})
    if "/api/upload-options" in u: return j({"ok": True, "admin": False, "universities": [{"id": 1, "name_ar": "جامعة البصرة"}], "colleges": [{"id": 2, "university_id": 1, "name_ar": "كلية الطب"}], "departments": [{"id": 5, "college_id": 2, "name_ar": "الطب العام"}]})
    if "/api/catalog/add" in u:
        body = json.loads(r.request.post_data); posted.append(body)
        subjects.append({"id": 99, "name_ar": body["name_ar"], "stage": 1, "term": body["term"], "can_publish": True}); return j({"ok": True, "id": 99})
    if "/api/finish" in u or "/api/link" in u or "/api/chunk" in u: posted.append(u); return j({"ok": True, "status": "approved"})
    r.continue_()
res = []
def ck(n, ok): res.append(ok); print(("PASS " if ok else "FAIL ") + n)
with sync_playwright() as p:
    b = p.chromium.launch(); c = b.new_context(service_workers="block", viewport={"width": 390, "height": 800}, locale="ar")
    pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.route("**/*", lambda r: route(r) if "/api/" in r.request.url else r.continue_())
    pg.goto("http://127.0.0.1:8794/contribute.html"); pg.wait_for_selector("#form", state="visible")
    ck("no university/college/department selectors", not pg.locator("#pick").is_visible())
    ck("scope shows only own stage", "المرحلة الأولى" in pg.locator("#scope").inner_text() and "جامعة البصرة" in pg.locator("#scope").inner_text())
    ck("no stage picker for stage rep", not pg.locator("#stageBox").is_visible())
    ck("add box opens when no subjects", pg.locator("#addBox").is_visible())
    pg.fill("#an", "التشريح"); pg.click("#termSeg button[data-v='2']"); pg.click("#addGo")
    pg.wait_for_function("document.getElementById('s').value === '99'")
    ck("subject added with stage_id and term 2", posted and posted[0].get("stage_id") == 11 and posted[0]["term"] == 2 and "stage" not in posted[0])
    ck("only 2 courses offered", pg.locator("#termSeg button").count() == 2)
    pg.fill("#ti", "مقدمة"); pg.set_input_files("#f", {"name": "a.pdf", "mimeType": "application/pdf", "buffer": b"%PDF-1.4 x"})
    pg.click("#go"); pg.wait_for_selector(".ct-msg.ok")
    ck("upload ok + next lecture number", pg.input_value("#n") == "2")
    ck("no page errors", not errs)
    b.close()
print("%d/%d" % (sum(res), len(res))); raise SystemExit(0 if all(res) else 1)
