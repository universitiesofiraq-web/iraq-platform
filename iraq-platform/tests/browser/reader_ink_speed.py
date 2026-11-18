"""سلاسة القلم في «اكتب وظلّل» — python3 -I tests/browser/reader_ink_speed.py
1) الرسم الحي التدريجي (liveInc) يطابق رسم drawStroke الكامل بكسلاً بكسل (فروق حواف التنعيم فقط).
2) الملء على دفعات (fillPolys) يطابق الملء القديم بمسار واحد، للحبر المعتم والشفاف والرصاص.
   «يطابق» = أقل من 1% من بكسلات الحبر تختلف في حافة التنعيم، ومتوسط الفرق أقل من 2/255.
3) زمن الإطار لا يكبر مع طول الخط: خط من ~1500 نقطة يبقى قريباً من 60 إطاراً/ثانية."""
import json, os, sys, threading, http.server, functools
from playwright.sync_api import sync_playwright
HERE = os.path.dirname(os.path.abspath(__file__)); ROOT = os.path.join(HERE, "..", "..", "site")
PDF = open(os.path.join(HERE, "..", "fixtures", "reader-sample.pdf"), "rb").read()
class Q(http.server.SimpleHTTPRequestHandler):
    def log_message(self, *a): pass
srv = http.server.ThreadingHTTPServer(("127.0.0.1", 8791), functools.partial(Q, directory=ROOT)); threading.Thread(target=srv.serve_forever, daemon=True).start()
sys.path.insert(0, HERE)
from ui_mock import route_for
res = []
def ck(name, ok, info=""): res.append(bool(ok)); print(("PASS " if ok else "FAIL ") + name + (("  " + str(info)) if info else ""))

DRAW = """async ({pen, op, n, up})=>{
  MedixaStudio.setTool('pen'); MedixaStudio.setStyle('pen', {pen, op: op||1, dash:'solid'});
  const ink=document.querySelector('#pages section.page canvas.ink'), r=ink.getBoundingClientRect();
  const ev=(t,x,y,p)=>new PointerEvent(t,{pointerId:9,pointerType:'pen',isPrimary:true,clientX:x,clientY:y,pressure:p,buttons:t==='pointerup'?0:1,bubbles:true,cancelable:true,composed:true});
  let x=r.left+50,y=r.top+60; ink.dispatchEvent(ev('pointerdown',x,y,.3));
  const gaps=[]; let last=performance.now();
  for(let i=0;i<n;i++){ for(let k=0;k<4;k++){const j=i*4+k; x=r.left+50+((j*2.6)%(r.width-100)); y=r.top+60+Math.floor((j*2.6)/(r.width-100))*18+Math.sin(j/6)*7; document.dispatchEvent(ev('pointermove',x,y,.3+.6*Math.abs(Math.sin(j/40))));}
    await new Promise(res=>requestAnimationFrame(()=>{const t=performance.now();gaps.push(t-last);last=t;res()})); }
  await new Promise(res=>requestAnimationFrame(()=>requestAnimationFrame(res)));
  const sorted=gaps.slice(20).sort((a,b)=>a-b);
  const out={median: sorted[Math.floor(sorted.length/2)], p90: sorted[Math.floor(sorted.length*.9)]};
  if (up) { document.dispatchEvent(ev('pointerup',x,y,0)); return out; }
  const pg=MedixaStudio.page(1), L=pg.live, v=pg.lv, W=pg.over.width, H=pg.over.height;
  out.incremental = !!(v && v.L===L && !v.wrap.hidden);
  const gop=+(v?v.wrap.style.opacity:1);
  const grp=document.createElement('canvas'); grp.width=W; grp.height=H; const g=grp.getContext('2d'); if(v){g.drawImage(v.pre,0,0); g.drawImage(v.tail,0,0);}
  const a=document.createElement('canvas'); a.width=W; a.height=H; const ax=a.getContext('2d'); ax.globalAlpha=gop; ax.drawImage(grp,0,0);
  const b=document.createElement('canvas'); b.width=W; b.height=H; const bx=b.getContext('2d'); bx.translate(pg.pw*pg.ext.l, pg.ph*pg.ext.t); MedixaStudio.drawStroke(bx, L, pg.pw, pg.ph);
  const A=ax.getImageData(0,0,W,H).data, B=bx.getImageData(0,0,W,H).data; let cnt=0, big=0, max=0, sum=0;
  for(let i=3;i<A.length;i+=4){ if(A[i]>20||B[i]>20){ cnt++; sum+=Math.abs(A[i]-B[i]); } const d=Math.abs(A[i]-B[i]); if(d>max)max=d; if(d>40) big++; }
  out.ink=cnt; out.mean=+(sum/Math.max(1,cnt)).toFixed(2); out.bigDiff=big; out.maxDiff=max; out.points=L.points.length;
  document.dispatchEvent(ev('pointerup',x,y,0));
  return out;
}"""
FILL = """({pen, op})=>{
  const it=MedixaStudio.getItems().filter(s=>s.tool==='pen').at(-1); const s=Object.assign({}, it, {pen, op});
  const mk=()=>{const c=document.createElement('canvas'); c.width=1200; c.height=1700; return c};
  const draw=(K)=>{ MedixaStudio.S.fillChunk=K; const c=mk(), x=c.getContext('2d'); x.translate(5,7); const t0=performance.now(); MedixaStudio.drawStroke(x, s, 1150, 1650); return [c, performance.now()-t0]; };
  const [o, tOld]=draw(1e9), [nw, tNew]=draw(0); MedixaStudio.S.fillChunk=0;
  const A=o.getContext('2d').getImageData(0,0,1200,1700).data, B=nw.getContext('2d').getImageData(0,0,1200,1700).data; let ink=0, big=0, max=0, sum=0;
  for(let i=3;i<A.length;i+=4){ if(A[i]>20||B[i]>20){ ink++; sum+=Math.abs(A[i]-B[i]); } const d=Math.abs(A[i]-B[i]); if(d>max)max=d; if(d>40) big++; }
  return {points:s.points.length, ink, big, max, mean:+(sum/Math.max(1,ink)).toFixed(2), tOld:Math.round(tOld), tNew:Math.round(tNew)};
}"""
with sync_playwright() as p:
    b = p.chromium.launch()
    c = b.new_context(service_workers="block", viewport={"width": 1180, "height": 820}, has_touch=True, locale="ar")
    c.add_init_script("try{localStorage.setItem('ms.theme','\"light\"')}catch(e){}")
    pg = c.new_page(); errs, api = [], []; pg.on("pageerror", lambda e: errs.append(str(e)[:160]))
    base = route_for("student")
    pg.route("**/*", lambda r: r.fulfill(status=200, content_type="application/pdf", body=PDF) if r.request.url.split("?")[0].endswith("/files/test/reader-sample.pdf") else base(r, api))
    pg.goto("http://127.0.0.1:8791/pdf-notes.html?file=files/test/reader-sample.pdf"); pg.wait_for_selector("#pages section.page canvas.pdf"); pg.wait_for_timeout(1500)
    for pen, op in (("ballpoint", 1), ("fountain", 1), ("brush", 1), ("ballpoint", 0.5)):
        r = pg.evaluate(DRAW, {"pen": pen, "op": op, "n": 120, "up": False})
        ck("live %s op=%s drawn incrementally" % (pen, op), r["incremental"], r["points"])
        ck("live %s op=%s matches full drawing" % (pen, op), r["ink"] > 2000 and r["bigDiff"] <= r["ink"] * 0.01 and r["mean"] < 2, {k: r[k] for k in ("ink", "bigDiff", "maxDiff")})
    r = pg.evaluate(DRAW, {"pen": "pencil", "op": 1, "n": 40, "up": False})
    ck("live pencil keeps the full redraw (grain texture)", not r["incremental"])
    pg.evaluate(DRAW, {"pen": "ballpoint", "op": 1, "n": 400, "up": True})
    for pen, op in (("ballpoint", 1), ("pencil", 1), ("brush", 0.6)):
        r = pg.evaluate(FILL, {"pen": pen, "op": op})
        ck("committed %s op=%s: chunked fill = single fill" % (pen, op), r["ink"] > 2000 and r["big"] <= r["ink"] * 0.01 and r["mean"] < 2, r)
    r = pg.evaluate(DRAW, {"pen": "ballpoint", "op": 1, "n": 380, "up": True})
    ck("frame time stays flat on a ~1500-point stroke", r["median"] < 25 and r["p90"] < 40, r)
    ck("no page errors", not errs, errs[:2])
    b.close()
print("%d/%d" % (sum(res), len(res)))
sys.exit(0 if all(res) else 1)
