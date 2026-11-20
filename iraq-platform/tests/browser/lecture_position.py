"""Round trip from the real PDF reader to a fresh phone context."""
from functools import partial
from http.server import SimpleHTTPRequestHandler, ThreadingHTTPServer
from pathlib import Path
from threading import Thread
from urllib.parse import parse_qs, urlsplit
from os import environ
from shutil import which
from playwright.sync_api import sync_playwright

project = Path(__file__).resolve().parents[2]
pdf = (project / "tests/fixtures/reader-sample.pdf").read_bytes()

class Quiet(SimpleHTTPRequestHandler):
    def log_message(self, *args):
        pass

with ThreadingHTTPServer(("127.0.0.1", 0), partial(Quiet, directory=project / "site")) as server, sync_playwright() as pw:
    Thread(target=server.serve_forever, daemon=True).start()
    origin = f"http://127.0.0.1:{server.server_port}"
    browser = pw.chromium.launch(executable_path=environ.get("CHROMIUM_PATH") or which("chromium"))
    def open_reader(url, width, allowed=True):
        ctx = browser.new_context(viewport={"width": width, "height": 840}, service_workers="block",
                                  permissions=["clipboard-read", "clipboard-write"])
        pg = ctx.new_page()
        pg.route("**/api/file/sample", lambda r: r.fulfill(status=200 if allowed else 403,
                 content_type="application/pdf", body=pdf if allowed else b""))
        pg.goto(url)
        return pg
    sender = open_reader(origin + "/pdf-notes.html?file=%2Fapi%2Ffile%2Fsample&private=omit", 1180)
    sender.locator("#st-compact-files").click()
    sender.get_by_role("button", name="شارك هذا الموضع").click()
    target = sender.locator(".lecture-position-target").last
    page_id = target.locator("..").get_attribute("data-page")
    size = target.bounding_box()
    target.click(position={"x": size["width"] * .27, "y": size["height"] * .62})
    sender.get_by_text("تم نسخ رابط الموضع", exact=False).wait_for()
    url = sender.evaluate("navigator.clipboard.readText()")
    parts = urlsplit(url)
    assert parse_qs(parts.query) == {"file": ["/api/file/sample"]}
    position = parse_qs(parts.fragment)
    assert position["page"] == [page_id]
    assert abs(float(position["x"][0]) - .27) < .01 and abs(float(position["y"][0]) - .62) < .01
    phone = open_reader(url, 390)
    dot = phone.locator(".lecture-position-dot")
    dot.wait_for()
    assert dot.locator("../..").get_attribute("data-page") == page_id
    point = dot.bounding_box()
    assert 0 < point["x"] < 390 and 0 < point["y"] < 840
    assert phone.locator(".lecture-position-target").count() == 0
    phone.reload()
    dot.wait_for()
    denied = open_reader(url, 390, False)
    denied.locator("#error").get_by_text("HTTP 403", exact=False).wait_for()
    assert denied.locator(".lecture-position-dot").count() == 0
    browser.close()
    print("PASS: select, clipboard, clean URL, coordinates, fresh mobile reader, reload, access denied")
