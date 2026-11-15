"""تدقيق واجهات كل الصفحات (API وهمي): تمرير أفقي، أخطاء، أهداف لمس صغيرة، حقول بلا تسمية.
python3 -I tests/browser/ui_audit.py [outdir] [--shots]   (يكتب report.json ولقطات اختيارية)"""
import json, os, sys, threading, http.server, functools, re
from playwright.sync_api import sync_playwright
ROOT = os.path.join(os.path.dirname(__file__), "..", "..", "site")
OUT = sys.argv[1] if len(sys.argv) > 1 and not sys.argv[1].startswith("--") else "/tmp/ui_audit"
SHOTS = "--shots" in sys.argv
os.makedirs(OUT, exist_ok=True)
H = functools.partial(http.server.SimpleHTTPRequestHandler, directory=ROOT); H.log_message = lambda *a, **k: None
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8797), H); threading.Thread(target=srv.serve_forever, daemon=True).start()
sys.path.insert(0, os.path.dirname(__file__))
from ui_mock import route_for, PAGES

AUDIT_JS = r"""() => {
  const vw = innerWidth, out = { overflow: document.documentElement.scrollWidth - vw, small: [], unlabeled: [], offscreen: [] };
  const vis = el => { const r = el.getBoundingClientRect(), s = getComputedStyle(el); return r.width > 0 && r.height > 0 && s.visibility !== 'hidden' && s.display !== 'none' && !el.closest('[hidden],dialog:not([open])'); };
  const name = el => (el.getAttribute('aria-label') || el.textContent || el.value || el.id || el.className || el.tagName).toString().trim().replace(/\s+/g,' ').slice(0, 40);
  for (const el of document.querySelectorAll('a[href],button,input:not([type=hidden]),select,textarea,[role=button],summary')) {
    if (!vis(el)) continue;
    const r = el.getBoundingClientRect();
    const inline = el.tagName === 'A' && getComputedStyle(el).display === 'inline' && el.closest('p,li,small,span');
    if (!inline && (r.height < 40 || r.width < 40) && !['checkbox','radio','range'].includes(el.type)) out.small.push(name(el) + ' ' + Math.round(r.width) + 'x' + Math.round(r.height));
    if (r.right > vw + 1 || r.left < -1) out.offscreen.push(name(el));
    if (/^(INPUT|SELECT|TEXTAREA)$/.test(el.tagName)) {
      const lab = el.labels && el.labels.length || el.getAttribute('aria-label') || el.getAttribute('aria-labelledby') || el.title;
      if (!lab) out.unlabeled.push(name(el) + (el.placeholder ? ' ph=' + el.placeholder : ''));
    }
  }
  for (const el of document.querySelectorAll('body *')) { if (!vis(el)) continue; const r = el.getBoundingClientRect(); if (r.right > vw + 2 && getComputedStyle(el).position !== 'fixed' && !el.closest('[style*=overflow],.scroll-x')) { let p = el.parentElement, clip = false; while (p) { const o = getComputedStyle(p).overflowX; if (o === 'auto' || o === 'scroll' || o === 'hidden' || o === 'clip') { clip = true; break; } p = p.parentElement; } if (!clip) out.offscreen.push('BOX ' + el.tagName.toLowerCase() + '.' + (el.className||'').toString().split(' ')[0]); } }
  out.small = [...new Set(out.small)]; out.offscreen = [...new Set(out.offscreen)].slice(0, 12);
  out.title = document.title; out.h1 = (document.querySelector('h1') || {}).textContent || '';
  return out;
}"""
report = []
with sync_playwright() as p:
    b = p.chromium.launch()
    for role, page in PAGES:
        for w in (360, 390, 430, 768, 1280):
            for theme in (("light", "dark") if w == 390 else ("light",)):
                c = b.new_context(service_workers="block", viewport={"width": w, "height": 820}, locale="ar", color_scheme=theme)
                c.add_init_script("try{localStorage.setItem('ms.theme',%s)}catch(e){}" % json.dumps(theme))
                pg = c.new_page(); errs, api = [], []
                pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
                pg.on("console", lambda m: errs.append("console: " + m.text[:160]) if m.type == "error" and "Failed to load resource" not in m.text else None)
                pg.route("**/*", lambda r: route_for(role)(r, api))
                try:
                    pg.goto("http://127.0.0.1:8797/" + page, wait_until="load", timeout=15000); pg.wait_for_timeout(900)
                    a = pg.evaluate(AUDIT_JS)
                except Exception as e:
                    a = {"fatal": str(e)[:200]}
                a.update(role=role, page=page, width=w, theme=theme, errors=errs[:6], unmocked=sorted(set(api)))
                report.append(a)
                if SHOTS and w in (390, 1280) and theme == "light" or (SHOTS and w == 390 and theme == "dark"):
                    pg.screenshot(path=os.path.join(OUT, "%s_%s_%d_%s.png" % (role, re.sub(r"[^a-z0-9]+", "-", page)[:40], w, theme)), full_page=True)
                c.close()
    b.close()
json.dump(report, open(os.path.join(OUT, "report.json"), "w"), ensure_ascii=False, indent=1)
bad = [r for r in report if r.get("fatal") or r.get("overflow", 0) > 1 or r.get("errors")]
print("pages %d checks %d | overflow/errors %d" % (len(PAGES), len(report), len(bad)))
for r in bad: print(" ", r["role"], r["page"], r["width"], r["theme"], "overflow", r.get("overflow"), r.get("fatal", ""), r.get("errors", [])[:2])
