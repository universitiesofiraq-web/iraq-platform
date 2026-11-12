"""مركز الرفع (API وهمي): استخراج الرقم والعنوان، طابور بتقدّم، شعار الكلية. python3 -I tests/browser/upload_center.py"""
import json, os, threading, http.server, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "site")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8795), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
finishes, logos = [], []
def route(r):
    u = r.request.url
    def j(o, c=200): r.fulfill(status=c, content_type="application/json", body=json.dumps(o))
    if "/api/auth/me" in u: return j({"ok": True, "user": {"id": 1, "admin": True, "scopes": []}})
    if "/api/college-logo/" in u:
        if r.request.method == "POST": logos.append(json.loads(r.request.post_data)); return j({"ok": True})
        return r.fulfill(status=404, body="")
    if "/api/upload-options" in u and "department_id" in u: return j({"ok": True, "items": [{"id": 5, "name_ar": "التشريح", "stage": 1, "term": 1, "can_publish": True}, {"id": 6, "name_ar": "x", "stage": 1, "term": 1, "can_publish": False}]})
    if "/api/upload-options" in u: return j({"ok": True, "admin": True, "universities": [{"id": 1, "name_ar": "جامعة البصرة"}], "colleges": [{"id": 2, "university_id": 1, "name_ar": "كلية الطب"}, {"id": 3, "university_id": 1, "name_ar": "كلية العلوم"}], "departments": [{"id": 8, "college_id": 2, "name_ar": "الطب العام"}]})
    if "/api/finish" in u: finishes.append(json.loads(r.request.post_data)); return j({"ok": True})
    if "/api/chunk" in u: return j({"ok": True})
    r.continue_()
res = []
def ck(n, ok): res.append(ok); print(("PASS " if ok else "FAIL ") + n)
pdf = lambda n: {"name": n, "mimeType": "application/pdf", "buffer": b"%PDF-1.4 x"}
with sync_playwright() as p:
    b = p.chromium.launch(); c = b.new_context(service_workers="block", viewport={"width": 390, "height": 800}, locale="ar")
    pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.route("**/*", lambda r: route(r) if "/api/" in r.request.url else r.continue_())
    pg.goto("http://127.0.0.1:8795/upload-center.html?college=2"); pg.wait_for_selector("#form", state="visible")
    ck("college preselected + name shown", "كلية الطب" in pg.locator("#collegeName").inner_text())
    ck("only publishable subjects listed", pg.locator("#s option").count() == 2)
    pg.select_option("#s", "5")
    pg.set_input_files("#f", [pdf("Lec 03 - Heart anatomy.pdf"), pdf("محاضرة 4_القلب.pdf"), pdf("Intro.pdf"), pdf("Lec 03 - Heart anatomy.pdf")])
    pg.wait_for_selector(".uc-item")
    nums = [pg.locator(".uc-item").nth(i).locator("[data-f=num]").input_value() for i in range(4)]
    titles = [pg.locator(".uc-item").nth(i).locator("[data-f=title]").input_value() for i in range(4)]
    ck("numbers parsed from names", nums[:2] == ["3", "4"] and nums[2] == "1", )
    ck("titles parsed", titles[0] == "Heart anatomy" and titles[1] == "القلب")
    ck("duplicate file flagged", "مكرر" in pg.locator(".uc-item").nth(3).inner_text())
    pg.click("#start"); pg.wait_for_function("document.querySelectorAll('.uc-item.done').length === 3")
    ck("3 uploaded with right params", len(finishes) == 3 and sorted(f["number"] for f in finishes) == [1, 3, 4] and all(f["courseId"] == "s5" for f in finishes))
    pg.set_input_files("#logoFile", {"name": "l.png", "mimeType": "image/png", "buffer": bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f00050001ff895e5ff00000000049454e44ae426082")})
    pg.wait_for_function("true"); pg.wait_for_timeout(600)
    ck("logo posted as png data url", logos and logos[0]["image"].startswith("data:image/"))
    ck("no page errors", not errs)
    b.close()
print("%d/%d" % (sum(res), len(res))); raise SystemExit(0 if all(res) else 1)
