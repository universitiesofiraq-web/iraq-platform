"""صفحة روابط الدعوة (API وهمي). python3 -I tests/browser/invites_page.py"""
import json, os, threading, http.server, functools
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "site")
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8796), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
codes = []; revoked = []
def route(r):
    u = r.request.url
    def j(o, c=200): r.fulfill(status=c, content_type="application/json", body=json.dumps(o))
    if "/api/auth/me" in u: return j({"ok": True, "user": {"id": 1, "admin": False, "scopes": [{"type": "department", "level": "rep", "node_id": 8, "label": "الطب العام"}, {"type": "stage", "level": "rep", "node_id": 20, "label": "الطب العام", "stage_number": 2}]}})
    if "/api/upload-options" in u: return j({"ok": False})
    if "/api/admin/invites" in u and r.request.method == "POST":
        b = json.loads(r.request.post_data)
        if b["action"] == "create": codes.append("ABCDEFGH23"); return j({"ok": True, "code": codes[-1]})
        revoked.append(b["code"]); codes.clear(); return j({"ok": True})
    if "/api/admin/invites" in u: return j({"ok": True, "items": [{"code": c, "created_at": 1, "revoked_at": None, "uses": 3} for c in codes]})
    r.continue_()
res = []
def ck(n, ok): res.append(ok); print(("PASS " if ok else "FAIL ") + n)
with sync_playwright() as p:
    b = p.chromium.launch(); c = b.new_context(service_workers="block", viewport={"width": 390, "height": 800}, locale="ar")
    pg = c.new_page(); errs = []; pg.on("pageerror", lambda e: errs.append(str(e)))
    pg.route("**/*", lambda r: route(r) if "/api/" in r.request.url else r.continue_())
    pg.goto("http://127.0.0.1:8796/invites.html"); pg.wait_for_selector(".inv-row")
    ck("two nodes listed (department + stage)", pg.locator(".inv-row").count() == 2)
    pg.locator(".inv-row").first.locator("button.pri").click()
    pg.wait_for_selector(".inv-link input")
    ck("link created and shown", pg.locator(".inv-link input").first.input_value().endswith("/join.html?inv=ABCDEFGH23"))
    ck("telegram + whatsapp share links", pg.locator(".inv-link a").count() == 2)
    pg.once("dialog", lambda d: d.accept()); pg.locator(".inv-link button", has_text="إيقاف").click(); pg.wait_for_timeout(500)
    ck("revoke calls API", revoked == ["ABCDEFGH23"])
    ck("no page errors", not errs); b.close()
print("%d/%d" % (sum(res), len(res))); raise SystemExit(0 if all(res) else 1)
