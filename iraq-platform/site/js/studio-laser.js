/* MEDIXA Study Studio — laser pointer (طلب محمد 7) and view mode (طلب محمد 10), 2026-10-21, as in his Notewise videos.
   Laser: a passive custom tool. A glowing line follows the pen and fades by itself; it is never saved, synced, exported
   or put in undo history. Modes: تأخير (the whole drawing holds, then fades together; drawing again before it is gone
   brings everything back), خط (a comet tail), نقطة (a dot under the pen). Settings per device in medixa.studio.laser.v1.
   View mode (eye in the right header pill): the drawing tools disappear, the pen and finger only move the page, and the
   laser stays one tap away in the page pill. Nothing here touches the document. */
(function () {
  'use strict';
  const M = window.MedixaStudio; if (!M || !M.registerTool) return;
  const S = M.S, $ = id => document.getElementById(id);
  const KEY = 'medixa.studio.laser.v1', HOLD = [0, 150, 300, 800, 1500, 3000], FADE = 450, TAIL = 380, DOT_FADE = 150;
  const COLORS = [['#000000', 'أسود'], ['#ff0000', 'أحمر'], ['#00cdff', 'سماوي'], ['#01d101', 'أخضر'], ['#fdc800', 'أصفر'], ['#ff7d2d', 'برتقالي'], ['#9801fe', 'بنفسجي'], ['#141950', 'كحلي']];
  const HEX6 = /^#[0-9a-f]{6}$/i;
  const svg = (d, n) => '<svg viewBox="0 0 24 24" width="' + (n || 22) + '" height="' + (n || 22) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON = '<path d="M4 20l9.4-9.4"/><circle cx="15" cy="9" r="2.2"/><path d="M15 3.2v1.6M19.1 4.9l-1.1 1.1M20.8 9h-1.6M19.1 13.1l-1.1-1.1M15 14.8v-1.6M9.2 9h1.6M10.9 4.9l1.1 1.1"/>';
  const EYE = '<path d="M2.06 12.35a1 1 0 0 1 0-.7 10.75 10.75 0 0 1 19.88 0 1 1 0 0 1 0 .7 10.75 10.75 0 0 1-19.88 0"/><circle cx="12" cy="12" r="3"/>';
  function load() {
    let v = null; try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    v = v && typeof v === 'object' ? v : {};
    return { color: HEX6.test(v.color) ? v.color.toLowerCase() : '#ff0000', mode: ['dot', 'line', 'delay'].includes(v.mode) ? v.mode : 'delay', delay: Math.min(5, Math.max(1, Math.round(+v.delay || 2))) };
  }
  let st = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(st)); } catch {} };
  const now = () => performance.now();

  /* ---------------- drawing ---------------- */
  const strokes = []; let cur = null, liftAt = null, raf = 0;
  function trace(ctx, pts) {
    ctx.beginPath(); ctx.moveTo(pts[0][0], pts[0][1]);
    if (pts.length === 1) { ctx.lineTo(pts[0][0] + 0.01, pts[0][1]); return; }
    for (let i = 1; i < pts.length - 1; i++) { const a = pts[i], b = pts[i + 1]; ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    const l = pts[pts.length - 1]; ctx.lineTo(l[0], l[1]);
  }
  /* neon: a coloured line with a soft halo, and a thin white core (sizes in screen px, k = canvas px per CSS px) */
  function neon(ctx, pts, color, k, alpha) {
    if (!pts.length || alpha <= 0) return;
    ctx.save(); ctx.globalAlpha = Math.min(1, alpha); ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    trace(ctx, pts); ctx.strokeStyle = color; ctx.lineWidth = 4.6 * k; ctx.shadowColor = color; ctx.shadowBlur = 9 * k; ctx.stroke();
    ctx.shadowBlur = 0; ctx.shadowColor = 'transparent'; trace(ctx, pts); ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.6 * k; ctx.stroke();
    ctx.restore();
  }
  function sessionAlpha(t) { if (liftAt == null) return 1; const h = HOLD[st.delay] || 300, dt = t - liftAt; return dt < h ? 1 : Math.max(0, 1 - (dt - h) / FADE); }
  function drawOn(pg, ctx) {
    const k = pg.ink.width / Math.max(1, pg.totW), t = now();
    for (const s of strokes) {
      if (s.pg !== pg) continue;
      const px = s.pts.map(p => pg.px(p[0], p[1]));
      if (s.mode === 'delay') neon(ctx, px, s.color, k, sessionAlpha(t));
      else if (s.mode === 'line') {
        for (let i = Math.max(1, 0); i < px.length; i++) {
          const a = 1 - (t - s.pts[i][2]) / TAIL; if (a <= 0) continue;
          neon(ctx, [px[i - 1] || px[i], px[i]], s.color, k, a);
        }
        if (px.length === 1 && s.down) neon(ctx, px, s.color, k, 1);
      } else {
        const a = s.down ? 1 : Math.max(0, 1 - (t - s.up) / DOT_FADE);
        neon(ctx, [px[px.length - 1]], s.color, k * 1.15, a);
      }
    }
  }
  function alive(s, t) {
    if (s.down) return true;
    if (s.mode === 'delay') return sessionAlpha(t) > 0;
    if (s.mode === 'line') return t - s.pts[s.pts.length - 1][2] < TAIL;
    return t - s.up < DOT_FADE;
  }
  function loop() {
    raf = 0; const t = now(), pages = new Set();
    for (let i = strokes.length - 1; i >= 0; i--) { pages.add(strokes[i].pg); if (!alive(strokes[i], t)) strokes.splice(i, 1); }
    pages.forEach(pg => M.paint(pg));
    if (strokes.length) raf = requestAnimationFrame(loop);
  }
  const kick = () => { if (!raf) raf = requestAnimationFrame(loop); };
  M.on('overlay', o => { if (strokes.length && o && o.pg && o.ctx) drawOn(o.pg, o.ctx); });
  M.registerTool('laser', {
    passive: true,                                                  /* never marks the document as being edited */
    down(pg, e, p) {
      const t = now();
      for (let i = strokes.length - 1; i >= 0; i--) if (!alive(strokes[i], t)) strokes.splice(i, 1);
      if (st.mode === 'delay') liftAt = null;                       /* drawing again brings the fading drawing back */
      cur = { pg, pts: [[p[0], p[1], t]], color: st.color, mode: st.mode, down: true };
      strokes.push(cur); M.paint(pg); kick();
    },
    move(pg, e, p) {
      if (!cur || cur.pg !== pg) return;
      const l = cur.pts[cur.pts.length - 1], dx = (p[0] - l[0]) * (pg.cssW || 800), dy = (p[1] - l[1]) * (pg.cssH || 1000);
      if (dx * dx + dy * dy < 0.64) return;
      cur.pts.push([p[0], p[1], now()]); M.paint(pg); kick();
    },
    up(pg, e, cancelled) {
      if (!cur) return;
      const s = cur; cur = null; s.down = false; s.up = now();
      if (cancelled) { const i = strokes.indexOf(s); if (i >= 0) strokes.splice(i, 1); }
      if (st.mode === 'delay' && !strokes.some(x => x.down)) liftAt = now();
      M.paint(pg); kick();
    }
  });
  /* the settings preview uses the same renderer */
  function preview(cv) {
    const r = cv.getBoundingClientRect(), d = Math.min(3, devicePixelRatio || 1), w = r.width || 300, h = r.height || 100;
    cv.width = Math.round(w * d); cv.height = Math.round(h * d);
    const ctx = cv.getContext('2d'); ctx.clearRect(0, 0, cv.width, cv.height);
    const pts = []; for (let i = 0; i <= 48; i++) { const x = w / 2 - 92 + 184 * i / 48; pts.push([x * d, (h / 2 - 13 * Math.sin(i / 48 * 2 * Math.PI)) * d]); }
    if (st.mode === 'dot') neon(ctx, [[w / 2 * d, h / 2 * d]], st.color, d * 1.15, 1);
    else if (st.mode === 'line') for (let i = 1; i < pts.length; i++) neon(ctx, [pts[i - 1], pts[i]], st.color, d, i / pts.length);
    else neon(ctx, pts, st.color, d, 1);
  }

  /* ---------------- toolbar button + settings sheet ---------------- */
  const root = $('studio-toolbar');
  const mqPhone = window.matchMedia ? matchMedia('(max-width: 720px)') : { matches: false };
  const pop = document.createElement('div'); pop.className = 'st-pop st-laserpop'; pop.id = 'st-laserpop'; pop.hidden = true;
  pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'إعدادات مؤشر الليزر'); pop.dir = 'rtl';
  function buildPop() {
    pop.replaceChildren();
    const head = document.createElement('div'); head.className = 'lz-head';
    const title = document.createElement('p'); title.className = 'lz-title'; title.textContent = 'مؤشر الليزر';
    const x = document.createElement('button'); x.type = 'button'; x.className = 'lz-x'; x.setAttribute('aria-label', 'إغلاق'); x.innerHTML = svg('<path d="M18 6 6 18M6 6l12 12"/>', 16);
    x.onclick = () => { closePop(); };
    head.append(title, x);
    const cv = document.createElement('canvas'); cv.className = 'lz-prev'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'معاينة');
    const modes = document.createElement('div'); modes.className = 'lz-modes'; modes.setAttribute('role', 'group'); modes.setAttribute('aria-label', 'نوع المؤشر');
    for (const [v, t] of [['dot', 'نقطة'], ['line', 'خط'], ['delay', 'تأخير']]) {
      const b = document.createElement('button'); b.type = 'button'; b.dataset.lmode = v; b.setAttribute('aria-pressed', String(st.mode === v));
      const g = document.createElement('span'); g.className = 'lz-glyph'; g.dataset.g = v; const l = document.createElement('span'); l.textContent = t;
      b.append(g, l); b.onclick = () => { st.mode = v; save(); refresh(); }; modes.append(b);
    }
    const delay = document.createElement('div'); delay.className = 'lz-delay';
    const dl = document.createElement('div'); dl.className = 'lz-row';
    const lab = document.createElement('label'); lab.htmlFor = 'lz-delay'; lab.textContent = 'تأخير الاختفاء';
    const out = document.createElement('output'); out.className = 'lz-pill'; out.htmlFor = 'lz-delay';
    dl.append(lab, out);
    const rg = document.createElement('input'); rg.type = 'range'; rg.id = 'lz-delay'; rg.min = 1; rg.max = 5; rg.step = 1; rg.className = 'lz-range'; rg.dir = 'ltr';
    rg.oninput = () => { st.delay = +rg.value; save(); refresh(); };
    rangeTouch(rg);
    delay.append(dl, rg);
    const ch = document.createElement('p'); ch.className = 'lz-h'; ch.textContent = 'اللون';
    const row = document.createElement('div'); row.className = 'lz-colors'; row.setAttribute('role', 'group'); row.setAttribute('aria-label', 'اللون');
    for (const [c, n] of COLORS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'lz-sw'; b.dataset.color = c; b.style.setProperty('--sw', c); b.setAttribute('aria-label', n); b.title = n; b.onclick = () => { st.color = c; save(); refresh(); }; row.append(b); }
    const sep = document.createElement('span'); sep.className = 'lz-sep'; sep.setAttribute('aria-hidden', 'true');
    const cl = document.createElement('label'); cl.className = 'lz-custom'; cl.title = 'لون آخر';
    const ci = document.createElement('input'); ci.type = 'color'; ci.setAttribute('aria-label', 'لون آخر'); ci.oninput = () => { st.color = ci.value.toLowerCase(); save(); refresh(); };
    cl.append(ci); row.append(sep, cl);
    pop.append(head, cv, modes, delay, ch, row);
    pop._refresh = () => {
      modes.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.lmode === st.mode)));
      delay.hidden = st.mode !== 'delay'; rg.value = st.delay; out.textContent = String(st.delay); rg.style.setProperty('--f', (st.delay - 1) / 4);
      let known = false; row.querySelectorAll('.lz-sw').forEach(b => { const on = b.dataset.color === st.color; known = known || on; b.setAttribute('aria-pressed', String(on)); });
      cl.setAttribute('aria-pressed', String(!known)); if (ci.value !== st.color) ci.value = st.color;
      cl.style.setProperty('--sw', st.color);
      preview(cv);
      const b = laserBtn(); if (b) b.style.setProperty('--tool-c', st.color);
    };
  }
  /* iPad Safari moves a range only when its thumb is dragged: let a touch anywhere on the track set the value */
  function rangeTouch(rg) {
    rg.style.touchAction = 'none';
    const at = e => { const r = rg.getBoundingClientRect(), min = +rg.min, max = +rg.max, step = +rg.step || 1; let f = (e.clientX - r.left - 12) / Math.max(1, r.width - 24); f = Math.min(1, Math.max(0, f)); const v = Math.round((min + f * (max - min)) / step) * step; if (+rg.value !== v) { rg.value = v; rg.dispatchEvent(new Event('input', { bubbles: true })); } };
    rg.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse') return; e.preventDefault(); try { rg.setPointerCapture(e.pointerId); } catch {} at(e); const mv = ev => at(ev), up = () => { rg.removeEventListener('pointermove', mv); rg.removeEventListener('pointerup', up); rg.removeEventListener('pointercancel', up); }; rg.addEventListener('pointermove', mv); rg.addEventListener('pointerup', up); rg.addEventListener('pointercancel', up); });
  }
  function refresh() { if (pop._refresh) pop._refresh(); }
  const laserBtn = () => root && root.querySelector('[data-tool="laser"]');
  function closePop() { pop.hidden = true; const b = laserBtn(); if (b) b.setAttribute('aria-expanded', 'false'); }
  function openPop() {
    if (M.closePops) M.closePops();
    if (!pop.firstChild) buildPop();
    const b = laserBtn(); pop._anchor = b || null;
    if (pop.parentNode !== root && root) root.append(pop);
    pop.hidden = false; if (b) b.setAttribute('aria-expanded', 'true');
    placePop(); refresh();
  }
  function placePop() {
    pop.style.left = ''; pop.style.right = '';
    if (mqPhone.matches || !root) return;
    const b = laserBtn(), r = (pop.offsetParent || root).getBoundingClientRect(), w = pop.offsetWidth; if (!b || !w) return;
    const br = b.getBoundingClientRect(); let x = br.left + br.width / 2 - w / 2; x = Math.max(8, Math.min(innerWidth - 8 - w, x));
    pop.style.left = Math.round(x - r.left) + 'px'; pop.style.right = 'auto';
  }
  addEventListener('resize', () => { if (!pop.hidden) placePop(); });
  function makeBtn() {
    const b = document.createElement('button'); b.type = 'button'; b.className = 'st-btn st-laserbtn'; b.dataset.tool = 'laser';
    b.setAttribute('aria-label', 'مؤشر الليزر'); b.title = 'مؤشر الليزر'; b.innerHTML = svg(ICON);
    const on = S.tool === 'laser'; b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on)); b.style.setProperty('--tool-c', st.color);
    if (on) { b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', String(!pop.hidden)); b.title = 'مؤشر الليزر — اضغط مرة أخرى للإعدادات'; }
    let tm = 0, held = false;
    b.addEventListener('pointerdown', e => { if (e.button > 0) return; held = false; clearTimeout(tm); tm = setTimeout(() => { held = true; if (S.tool !== 'laser') M.setTool('laser'); setTimeout(openPop, 30); }, 500); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, () => clearTimeout(tm));
    b.addEventListener('contextmenu', e => e.preventDefault());
    b.onclick = () => {
      if (held) { held = false; return; }
      if (S.tool === 'laser') { if (pop.hidden) openPop(); else closePop(); return; }
      if (M.closePops) M.closePops(); M.setTool('laser');
    };
    return b;
  }
  /* the toolbar re-renders on every tool change: put the button back each time (after the image button, before the
     settings), or in «أدوات أخرى» on phones (it shows on the bar while it is the active tool) */
  function inject() {
    if (!root) return;
    const old = root.querySelectorAll('.st-laserbtn'); old.forEach(n => n.remove());
    const tools = root.querySelector('.st-tools');
    const grid = root.querySelector('.st-morepop .st-grid');
    if (mqPhone.matches) {
      if (grid) grid.append(labelled(makeBtn()));
      if (S.tool === 'laser' && tools) { const b = makeBtn(); b.classList.add('st-extra'); tools.append(b); }
    } else if (tools) tools.append(makeBtn());
    else root.append(makeBtn());
    if (!pop.hidden) { if (pop.parentNode !== root) root.append(pop); placePop(); }
  }
  const labelled = b => { const s = document.createElement('span'); s.className = 'st-lab'; s.textContent = 'مؤشر الليزر'; b.append(s); return b; };
  if (root) {
    root.addEventListener('st-rendered', inject);
    let q = false; new MutationObserver(() => { if (q) return; q = true; queueMicrotask(() => { q = false; if (!root.querySelector('.st-laserbtn')) inject(); }); }).observe(root, { childList: true });
    inject();
  }
  M.on('tool', t => { if (t !== 'laser') closePop(); if (t !== 'laser' && cur) { cur = null; } });
  M.laser = { settings: () => Object.assign({}, st), open: openPop, preview };

  /* ---------------- view mode (eye) ---------------- */
  let prevTool = null, viewOn = false;
  const toast = text => { if (M.toast) M.toast(text); };
  function setView(on) {
    if (on === viewOn) return;
    viewOn = on; document.body.classList.toggle('st-viewmode', on);
    const eye = $('st-viewmode'); if (eye) { eye.setAttribute('aria-pressed', String(on)); eye.title = on ? 'إنهاء وضع القراءة' : 'وضع القراءة'; eye.setAttribute('aria-label', eye.title); }
    if (on) { prevTool = S.tool === 'hand' || S.tool === 'laser' ? (prevTool || 'pen') : S.tool; if (M.closePops) M.closePops(); M.setTool('hand'); toast('أنت الآن في وضع القراءة'); }
    else { M.setTool(prevTool || 'pen'); prevTool = null; toast('عادت أدوات الكتابة'); }
    syncDockLaser();
  }
  function eyeBtn() {
    const pill = $('studio-hdr-actions'); if (!pill || $('st-viewmode')) return;
    const b = document.createElement('button'); b.type = 'button'; b.id = 'st-viewmode'; b.className = 'st-hdr-btn st-eye';
    b.setAttribute('aria-pressed', 'false'); b.setAttribute('aria-label', 'وضع القراءة'); b.title = 'وضع القراءة'; b.innerHTML = svg(EYE);
    b.onclick = () => setView(!viewOn);
    const more = $('st-docmenu-btn'); if (more && more.parentNode === pill) pill.insertBefore(b, more); else pill.append(b);
  }
  /* in view mode the laser sits in the page pill, as in Notewise */
  function syncDockLaser() {
    const dock = $('mx-dock'); if (!dock) return;
    let b = $('st-dock-laser');
    if (!b) {
      b = document.createElement('button'); b.type = 'button'; b.id = 'st-dock-laser'; b.className = 'st-dock-laser';
      b.setAttribute('aria-label', 'مؤشر الليزر'); b.title = 'مؤشر الليزر'; b.innerHTML = svg(ICON, 20);
      b.onclick = () => { if (!viewOn) return; M.setTool(S.tool === 'laser' ? 'hand' : 'laser'); };
      dock.append(b);
    }
    b.hidden = !viewOn; b.setAttribute('aria-pressed', String(viewOn && S.tool === 'laser'));
  }
  M.on('tool', t => { if (viewOn && t !== 'hand' && t !== 'laser') { viewOn = false; document.body.classList.remove('st-viewmode'); const e = $('st-viewmode'); if (e) e.setAttribute('aria-pressed', 'false'); prevTool = null; } syncDockLaser(); });
  const start = () => { eyeBtn(); syncDockLaser(); };
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', start, { once: true }); else start();
  setTimeout(start, 600);                                            /* the compact shell may build the header pills later */
  M.viewMode = { set: setView, get: () => viewOn };
})();
