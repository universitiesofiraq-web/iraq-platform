"""مركز الرفع (API وهمي): استخراج الرقم والعنوان، طابور بتقدّم، شعار الكلية. python3 -I tests/browser/upload_center.py"""
import json, os, threading, http.server, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "site")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8795), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
finishes, logos, deleted = [], [], []
def route(r):
    u = r.request.url
    def j(o, c=200): r.fulfill(status=c, content_type="application/json", body=json.dumps(o))
    if "/api/auth/me" in u: return j({"ok": True, "user": {"id": 1, "admin": True, "scopes": []}})
    if "/api/college-logo/" in u:
        if r.request.method == "POST": logos.append(json.loads(r.request.post_data)); return j({"ok": True})
        return r.fulfill(status=404, body="")
    if "/api/upload-options" in u and "department_id" in u: return j({"ok": True, "items": [{"id": 5, "name_ar": "التشريح", "stage": 1, "term": 1, "can_publish": True}, {"id": 6, "name_ar": "x", "stage": 1, "term": 1, "can_publish": False}]})
    if "/api/upload-options" in u: return j({"ok": True, "admin": True, "universities": [{"id": 1, "name_ar": "جامعة البصرة"}], "colleges": [{"id": 2, "university_id": 1, "name_ar": "كلية الطب"}, {"id": 3, "university_id": 1, "name_ar": "كلية العلوم"}], "departments": [{"id": 8, "college_id": 2, "name_ar": "الطب العام"}]})
    if u.endswith("/api/admin"): return j({"ok": True, "items": [{"id": "x", "courseId": "s5", "type": "lecture", "number": 3, "title": "Heart anatomy"}]})
    if "/api/delete" in u: deleted.append(json.loads(r.request.post_data)); return j({"ok": True})
    if "/api/finish" in u: finishes.append(json.loads(r.request.post_data)); return j({"ok": True, "entry": {"id": "e%d" % len(finishes)}})
    if "/api/chunk" in u: return j({"ok": True})
    r.continue_()
res = []
def ck(n, ok): res.append(ok); print(("PASS " if ok else "FAIL ") + n)
pdf = lambda n: {"name": n, "mimeType": "application/pdf", "buffer": b"%PDF-1.4 x"}
with sync_playwright() as p:
    b = p.chromium.launch(); c = b.new_context(service_workers="block", viewport={"width": 390, "height": 800}, locale="ar")
    pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.route("**/*", lambda r: route(r) if "/api/" in r.request.url else r.continue_())
    pg.goto("http://127.0.0.1:8795/upload-center.html?college=2"); pg.wait_for_selector("#main", state="visible")
    ck("college shown", "كلية الطب" in pg.locator("#cName").inner_text())
    ck("only publishable subjects listed", pg.locator("#s option").count() == 2)
    pg.select_option("#s", "5")
    pg.wait_for_timeout(300)
    pg.set_input_files("#fileInput", [pdf("Lec 03 - Heart anatomy.pdf"), pdf("محاضرة 4_القلب.pdf"), pdf("Intro.pdf"), pdf("Lec 03 - Heart anatomy.pdf")])
    pg.wait_for_selector(".uc2-row"); pg.wait_for_timeout(1500)
    ck("duplicate flagged", pg.locator(".uc2-row.is-dup").count() == 1)
    ck("matched + new lecture auto-attached", len(finishes) == 2 and sorted(f["number"] for f in finishes) == [3, 4] and all(f["courseId"] == "s5" for f in finishes))
    ck("unmatched file waits for lecture choice", pg.locator(".uc2-row:not(.is-done):not(.is-dup)").count() == 1)
    pg.locator(".uc2-row:not(.is-done):not(.is-dup) select[data-f=lec]").select_option("3")
    pg.wait_for_function("document.querySelectorAll('.uc2-row.is-done').length === 3", timeout=5000)
    ck("all 3 done", len(finishes) == 3)
    pg.once("dialog", lambda d: d.accept())
    pg.locator(".uc2-row.is-done [data-a=delete]").first.click(); pg.wait_for_timeout(500)
    ck("delete removes file via API", len(deleted) == 1 and pg.locator(".uc2-row.is-done").count() == 2)
    pg.click("#linksBtn"); pg.fill("#linksText", "المحاضرة https://youtu.be/abc123"); pg.click("#linksAdd")
    pg.wait_for_selector(".uc2-row .uc2-tile.yt")
    ck("link row detected as youtube", pg.locator(".uc2-tile.yt").count() == 1)
    pg.set_input_files("#logoFile", {"name": "l.png", "mimeType": "image/png", "buffer": bytes.fromhex("89504e470d0a1a0a0000000d49484452000000010000000108060000001f15c4890000000d49444154789c6360f8cfc0f01f00050001ff895e5ff00000000049454e44ae426082")})
    pg.wait_for_timeout(800)
    ck("logo posted as image data url", logos and logos[0]["image"].startswith("data:image/"))
    ck("no page errors", not errs)
    b.close()
print("%d/%d" % (sum(res), len(res))); raise SystemExit(0 if all(res) else 1)
