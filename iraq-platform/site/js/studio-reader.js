/* MEDIXA Study Studio — reader. Loads the PDF (pdf.js, or saved page images when pdf.js is unreachable) — or a notebook
   (a document made only of virtual pages) — and builds one section per page up front (exact size, so scroll position is
   stable), rendering/releasing canvases lazily. Zoom changes only CSS size + a debounced re-render; stored annotation
   coordinates never change. Page ids: source pages keep their number; virtual blank pages use ids >= 100001. */
(function () {
  'use strict';
  const M = window.MedixaStudio; if (!M) return;
  const C = M.C;
  const DPR = () => Math.min(3, window.devicePixelRatio || 1);
  /* iPad/iPhone: Safari has a small total canvas budget; past it pages turn blank. Cap each page canvas and keep fewer. */
  const TOUCH = (navigator.maxTouchPoints || 0) > 0 || /iP(hone|ad|od)/.test(navigator.userAgent);
  const MAX_PX = TOUCH ? 4e6 : 12e6;
  const scaleFor = (w, h) => Math.max(0.05, Math.min(DPR(), Math.sqrt(MAX_PX / Math.max(1, w * h))));   /* never above the canvas budget (Safari blanks it) */
  /* Sharp text at any zoom (2026-10-21, بطلب محمد «النص بدقة منخفضة»): when the page canvas cannot hold full screen
     resolution, the visible part of the page is drawn again from the PDF at device resolution into one small canvas
     on top (like the native iPad note apps). It is rebuilt after scrolling / zooming stops and dropped while zooming. */
  const HD_PX = TOUCH ? 4.2e6 : 9e6;
  const FONTS = new URL('vendor/pdfjs/standard_fonts/', location.href).href /* self-hosted: the fallback font (LiberationSans) sometimes failed to load from cdnjs, leaving pages with blank text */, CMAPS = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/cmaps/';
  const R = { zoom: 1, pages: [], byId: new Map(), doc: null, bytes: null, raster: null, MAXKEEP: TOUCH ? 4 : 12, queue: [], running: 0, io: null, listeners: [], nSources: 0, notebook: null };
  R.minZoom = 0.4; R.maxZoom = 8;
  const clampZ = z => Math.min(R.maxZoom, Math.max(R.minZoom, z));
  const reduced = () => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.classList.contains('reduced-motion') || document.body.classList.contains('reduced-motion');
  const fitWidth = () => Math.max(240, Math.min((R.root ? R.root.clientWidth : innerWidth) - 24, 960));
  const emit = (n, d) => R.listeners.filter(l => l[0] === n).forEach(l => { try { l[1](d); } catch (e) { console.warn(e); } });
  R.on = (n, f) => R.listeners.push([n, f]);

  /* Page area keeps its aspect ratio; margins add room around it, and the whole sheet fits the column at 100% zoom. */
  function layout(p) {
    const pg = M.page(p.id), e = pg ? pg.ext : { l: 0, t: 0, r: 0, b: 0 }, kx = 1 + e.l + e.r, ky = 1 + e.t + e.b;
    const totW = fitWidth() * R.zoom, w = totW / kx, h = w * p.h / p.w;
    p.el.style.width = totW + 'px'; p.el.style.height = h * ky + 'px'; p.cssW = w; p.cssH = h;
    const pa = { left: (e.l / kx * 100) + '%', top: (e.t / ky * 100) + '%', width: (100 / kx) + '%', height: (100 / ky) + '%' };
    Object.assign(p.pdf.style, pa); if (p.text) Object.assign(p.text.style, pa);
    /* the page area, for layers that draw in page coordinates (study masks, source flashes) */
    p.el.style.setProperty('--pa-l', pa.left); p.el.style.setProperty('--pa-t', pa.top); p.el.style.setProperty('--pa-w', pa.width); p.el.style.setProperty('--pa-h', pa.height);
    p.el.classList.toggle('st-has-margin', kx > 1 || ky > 1);
  }

  /* ---------- rendering ---------- */
  function release(p) {
    if (p.task) { try { p.task.cancel(); } catch {} p.task = null; }
    p.token = (p.token || 0) + 1; p.rendered = false;
    p.pdf.width = 0; p.pdf.height = 0; M.setPageActive(p.id, false); if (p.text) p.text.replaceChildren(); dropHd(p);
  }
  /* Template marks for blank pages (same geometry the export uses). */
  /* Safari keeps the multiply blend of the ink layer from before the page pixels arrived (the dim text at opening).
     Re-applying the blend once the page is drawn makes the browser composite the ink layer again. */
  function nudgeInk(p) {
    const layers = p.pdf.parentNode ? p.pdf.parentNode.querySelectorAll('canvas.ink, canvas.ink-hd') : [];
    for (const c of layers) { c.style.mixBlendMode = 'normal'; requestAnimationFrame(() => requestAnimationFrame(() => { c.style.mixBlendMode = ''; })); }
  }
  function paintTemplate(ctx, W, H, rec) {
    ctx.fillStyle = '#fff'; ctx.fillRect(0, 0, W, H);
    const geo = C.templateGeometry(rec.template, rec.w, rec.h), k = W / rec.w;
    ctx.strokeStyle = '#bdd1d9'; ctx.fillStyle = '#bdd1d9'; ctx.lineWidth = Math.max(0.5, 0.5 * k);
    ctx.beginPath(); for (const [x1, y1, x2, y2] of geo.lines) { ctx.moveTo(x1 * k, y1 * k); ctx.lineTo(x2 * k, y2 * k); } ctx.stroke();
    for (const [x, y] of geo.dots) { ctx.beginPath(); ctx.arc(x * k, y * k, Math.max(0.7, 0.9 * k), 0, 7); ctx.fill(); }
  }
  /* A page that already shows a picture is re-drawn off screen and swapped in at once, so zooming never shows a white
     or half-drawn page (pdf.js paints white first and then in slices). The first draw goes straight to the canvas. */
  async function draw(p) {
    const token = ++p.token, d = scaleFor(p.cssW, p.cssH), W = Math.max(1, Math.round(p.cssW * d)), H = Math.max(1, Math.round(p.cssH * d));
    const shown = p.rendered && p.pdf.width > 1, off = shown ? document.createElement('canvas') : null;
    if (off) { off.width = W; off.height = H; } else if (p.pdf.width !== W || p.pdf.height !== H) { p.pdf.width = W; p.pdf.height = H; }
    M.setPageActive(p.id, true);
    const ctx = (off || p.pdf).getContext('2d'); let done = false;
    const swap = () => { if (!off) return; if (p.pdf.width !== W || p.pdf.height !== H) { p.pdf.width = W; p.pdf.height = H; } p.pdf.getContext('2d').drawImage(off, 0, 0); off.width = off.height = 0; };
    const drop = () => { if (off) off.width = off.height = 0; };
    if (p.kind === 'blank') { paintTemplate(ctx, W, H, p.rec); swap(); if (M.bakeHighlights) M.bakeHighlights(p.n, p.pdf.getContext('2d'), p.pdf.width, p.pdf.height); p.rendered = true; p.rw = W; nudgeInk(p); emit('rendered', p); return; }
    const img = !p.proxy && R.raster && R.raster[p.n - 1];   /* saved page images only when pdf.js could not load: they are pictures, not text */
    if (img) { try { const im = await imageFor(p.n); if (token !== p.token) return drop(); if (im && im.naturalWidth > 0) { ctx.clearRect(0, 0, W, H); ctx.drawImage(im, 0, 0, W, H); done = true; } } catch (e) { console.warn('MEDIXA raster unavailable, using PDF renderer', e); } }
    if (!done && p.proxy && p.proxy.render) {
      const vp = p.proxy.getViewport({ scale: W / p.w });
      if (p.task) { try { p.task.cancel(); } catch {} }
      p.task = p.proxy.render({ canvasContext: ctx, viewport: vp });
      try { await p.task.promise; } catch (e) { drop(); if (e && e.name === 'RenderingCancelledException') return; throw e; }
      p.task = null;
    }
    if (token !== p.token) return drop();
    swap();
    if (M.bakeHighlights) M.bakeHighlights(p.n, p.pdf.getContext('2d'), p.pdf.width, p.pdf.height);
    p.rendered = true; p.rw = W; nudgeInk(p); emit('rendered', p);
    textLayer(p, token); hdSoon();
  }
  /* stop a pending sharp render but keep the current sharp layer on screen (it is placed in % of the page and scales) */
  function cancelHd(p) { if (p.hdTask) { try { p.hdTask.cancel(); } catch {} p.hdTask = null; } p.hdTok = (p.hdTok || 0) + 1; }
  M.on('hlchange', n => { const p = R.pages.find(q => q.n === n); if (p && p.rendered) { dropHd(p); draw(p); } });
  function dropHd(p) {
    if (p.hdTask) { try { p.hdTask.cancel(); } catch {} p.hdTask = null; }
    p.hdTok = (p.hdTok || 0) + 1;
    if (p.hd) { p.hd.width = 0; p.hd.height = 0; p.hd.remove(); p.hd = null; }
    if (M.setInkHd) M.setInkHd(p.id, false);
  }
  async function hd(p) {
    if (R.frozen) return;
    if (p.kind !== 'src' || !p.proxy || !p.rendered || !p.near) return dropHd(p);
    const need = DPR(), have = p.rw / Math.max(1, p.cssW);
    if (have >= need * 0.97) return dropHd(p);                       /* the page canvas is already sharp */
    const a = p.pdf.getBoundingClientRect();
    const L = Math.max(a.left, 0), T = Math.max(a.top, 0), Rr = Math.min(a.right, innerWidth), B = Math.min(a.bottom, innerHeight);
    if (Rr - L < 4 || B - T < 4) return dropHd(p);
    const x0 = L - a.left, y0 = T - a.top, w = Rr - L, h = B - T;
    const d = Math.min(need, Math.sqrt(HD_PX / (w * h)));
    if (d <= have * 1.05) return dropHd(p);
    const key = [R.zoom.toFixed(4), Math.round(x0), Math.round(y0), Math.round(w), Math.round(h)].join();
    if (p.hd && p.hdKey === key && !p.hdTask) return;              /* the same region at the same zoom is already sharp */
    const tok = (p.hdTok = (p.hdTok || 0) + 1);
    if (p.hdTask) { try { p.hdTask.cancel(); } catch {} p.hdTask = null; }
    const c = document.createElement('canvas'); c.className = 'pdf-hd'; c.setAttribute('aria-hidden', 'true');
    c.width = Math.max(1, Math.round(w * d)); c.height = Math.max(1, Math.round(h * d));
    const vp = p.proxy.getViewport({ scale: (p.cssW / p.w) * d });
    p.hdTask = p.proxy.render({ canvasContext: c.getContext('2d'), viewport: vp, transform: [1, 0, 0, 1, -Math.round(x0 * d), -Math.round(y0 * d)] });
    try { await p.hdTask.promise; } catch (e) { if (tok === p.hdTok) p.hdTask = null; c.width = 0; return; }
    if (tok !== p.hdTok) { c.width = 0; return; }
    p.hdTask = null;
    if (M.bakeHighlights) { const x = c.getContext('2d'); x.save(); x.setTransform(1, 0, 0, 1, -Math.round(x0 * d), -Math.round(y0 * d)); M.bakeHighlights(p.n, x, vp.width, vp.height); x.restore(); }
    /* place it in % of the page section, so it scrolls with the page and keeps covering the right place while a zoom
       re-lays the page out (until the new one replaces it) */
    const SW = Math.max(1, p.el.clientWidth), SH = Math.max(1, p.el.clientHeight);
    c.style.left = ((p.pdf.offsetLeft + x0) / SW * 100) + '%'; c.style.top = ((p.pdf.offsetTop + y0) / SH * 100) + '%'; c.style.width = (w / SW * 100) + '%'; c.style.height = (h / SH * 100) + '%';
    if (p.hd) { p.hd.width = 0; p.hd.remove(); }
    p.hd = c; p.hdKey = key; p.pdf.after(c); emit('hd', p);
  }
  let hdT = 0;
  function hdSoon(ms) { clearTimeout(hdT); hdT = setTimeout(() => { if (R.frozen) return; for (const p of R.pages) { if (p.near) { hd(p).catch(() => {}); if (M.setInkHd) M.setInkHd(p.id, true); } else { if (p.hd) dropHd(p); if (M.setInkHd) M.setInkHd(p.id, false); } } }, ms == null ? 160 : ms); }
  R.hdSoon = hdSoon;
  /* Selectable, invisible text over the page (also what screen readers read). Pointer events stay off until the
     "select text" tool is active, so drawing is never disturbed. Pages without text (scans) are flagged. */
  async function textLayer(p, token) {
    if (p.kind !== 'src' || !p.proxy || !window.pdfjsLib || !pdfjsLib.renderTextLayer || !p.proxy.streamTextContent) return;
    try {
      let box = p.text;
      if (!box) { box = document.createElement('div'); box.className = 'st-text'; box.setAttribute('lang', 'en'); p.el.insertBefore(box, p.label); p.text = box; layout(p); }
      box.replaceChildren(); const vp = p.proxy.getViewport({ scale: p.cssW / p.w }); box.style.setProperty('--scale-factor', String(vp.scale));
      const task = pdfjsLib.renderTextLayer({ textContentSource: p.proxy.streamTextContent(), container: box, viewport: vp, textDivs: [] }); await task.promise;
      if (token !== p.token) { box.replaceChildren(); return; }
      p.hasText = !!box.textContent.trim(); p.el.classList.toggle('st-notext', !p.hasText); emit('text', p);
    } catch (e) { if (!e || e.name !== 'RenderingCancelledException') console.warn('text layer failed', p.id, e); }
  }
  const imgCache = new Map();
  function imageFor(n) { if (imgCache.has(n)) return imgCache.get(n); const im = new Image(); im.src = R.raster[n - 1]; const pr = im.decode().then(() => im); imgCache.set(n, pr); return pr; }
  function pump() {
    while (R.running < 2 && R.queue.length) {
      const p = R.queue.shift(); p.queued = false; if (!p.near) continue;
      R.running++; p.drawing = true; draw(p).catch(e => console.warn('render failed', p.id, e)).finally(() => { p.drawing = false; R.running--; clearTimeout(R.st); R.st = setTimeout(settle, 30); pump(); });
    }
  }
  function want(p) { if (p.queued || p.drawing || (p.rendered && p.rw === Math.round(p.cssW * scaleFor(p.cssW, p.cssH)))) return; p.queued = true; R.queue.push(p); }
  function distance(p) { const r = p.el.getBoundingClientRect(); return Math.abs((r.top + r.bottom) / 2 - innerHeight / 2); }
  function settle() {
    const near = R.pages.filter(p => p.near).sort((a, b) => distance(a) - distance(b));
    near.forEach(want); R.queue.sort((a, b) => distance(a) - distance(b)); pump();
    const rendered = R.pages.filter(p => p.rendered || p.queued === false && p.pdf.width > 1);
    if (rendered.length > R.MAXKEEP) rendered.filter(p => !p.near).sort((a, b) => distance(b) - distance(a)).slice(0, rendered.length - R.MAXKEEP).forEach(release);
  }

  /* ---------- pinch: frozen while the fingers zoom (no renders, releases or relayouts mid-gesture) ---------- */
  R.frozen = false;
  R.freeze = on => {
    R.frozen = !!on;
    if (!on) { if (R.relayoutPending) { R.relayoutPending = false; relayout(); } }
  };
  R.preview = z => emit('zoompreview', clampZ(z));
  /* after a pinch the content glides the last few px to where the fingers left it, instead of jumping */
  let settleEls = [], settleT = 0;
  R.cancelSettle = () => { if (!settleEls.length) return; clearTimeout(settleT); for (const el of settleEls) { el.style.transition = ''; el.style.transform = ''; } settleEls = []; R.frozen = false; };
  function settleAnim(ex, ey) {
    const vh = innerHeight, els = R.pages.map(p => p.el).filter(el => { const r = el.getBoundingClientRect(); return r.bottom > -vh && r.top < 2 * vh; });
    if (!els.length) return;
    R.cancelSettle(); settleEls = els; R.frozen = true;
    for (const el of els) { el.style.transition = 'none'; el.style.transform = 'translate(' + ex + 'px,' + ey + 'px)'; }
    void els[0].offsetWidth;
    requestAnimationFrame(() => { for (const el of els) { el.style.transition = 'transform 180ms cubic-bezier(.2,.8,.2,1)'; el.style.transform = ''; } });
    settleT = setTimeout(() => { for (const el of els) el.style.transition = ''; settleEls = []; R.frozen = false; settle(); hdSoon(0); }, 230);
  }

  /* ---------- zoom ---------- */
  function anchor() { const p = R.pages.find(x => x.el.getBoundingClientRect().bottom > 120) || R.pages[0]; if (!p) return null; const r = p.el.getBoundingClientRect(); return { p, frac: (120 - r.top) / Math.max(1, r.height) }; }
  function setZoom(z) {
    z = clampZ(z); if (Math.abs(z - R.zoom) < 0.001) return; const a = anchor(); R.zoom = z;
    R.pages.forEach(cancelHd); R.pages.forEach(layout);
    if (a) { const r = a.p.el.getBoundingClientRect(); scrollBy(0, r.top + a.frac * r.height - 120); }
    clearTimeout(R.zt); R.zt = setTimeout(() => { R.pages.forEach(p => { if (p.near) want(p); }); pump(); settle(); hdSoon(0); }, 120);
    emit('zoom', R.zoom);
  }
  /* Zoom so the document point under (cx, cy) — where the pinch started — ends under (tx, ty), where the fingers are
     now. What scrolling cannot reach (top / end of the document, pages centred below 100%) glides there in 180 ms. */
  function zoomAt(z, cx, cy, tx, ty) {
    if (tx == null) tx = cx; if (ty == null) ty = cy;
    z = clampZ(z); if (!R.pages.length) return;
    const p = R.pages.find(x => x.el.getBoundingClientRect().bottom >= cy) || R.pages[R.pages.length - 1], r = p.el.getBoundingClientRect();
    const fx = (cx - r.left) / Math.max(1, r.width), fy = (cy - r.top) / Math.max(1, r.height);
    const same = Math.abs(z - R.zoom) < 0.001;
    if (!same) { R.zoom = z; R.pages.forEach(cancelHd); R.pages.forEach(layout); }
    const r2 = p.el.getBoundingClientRect(); scrollBy(0, r2.top + fy * r2.height - ty);
    if (R.root) R.root.scrollBy(r2.left + fx * r2.width - tx, 0);
    const r3 = p.el.getBoundingClientRect(), ex = tx - (r3.left + fx * r3.width), ey = ty - (r3.top + fy * r3.height);
    if (Math.hypot(ex, ey) > 1 && !reduced()) settleAnim(ex, ey);
    if (same) return;
    clearTimeout(R.zt); R.zt = setTimeout(() => { R.pages.forEach(q => { if (q.near) want(q); }); pump(); settle(); hdSoon(0); }, settleEls.length ? 240 : 120);
    emit('zoom', R.zoom);
  }
  R.setZoom = setZoom; R.zoomAt = zoomAt; R.zoomBy = f => setZoom(R.zoom * f); R.fit = () => setZoom(1);
  addEventListener('keydown', e => { if ((e.ctrlKey || e.metaKey) && (e.key === '+' || e.key === '=')) { e.preventDefault(); R.zoomBy(1.15); } else if ((e.ctrlKey || e.metaKey) && e.key === '-') { e.preventDefault(); R.zoomBy(1 / 1.15); } else if ((e.ctrlKey || e.metaKey) && e.key === '0') { e.preventDefault(); R.fit(); } });
  addEventListener('wheel', e => { if (e.ctrlKey) { e.preventDefault(); R.zoomBy(e.deltaY < 0 ? 1.08 : 1 / 1.08); } }, { passive: false });
  let rt = 0; const relayout = () => { clearTimeout(rt); rt = setTimeout(() => { if (R.frozen) { R.relayoutPending = true; return; } const a = anchor(); R.pages.forEach(cancelHd); R.pages.forEach(layout); if (a) { const r = a.p.el.getBoundingClientRect(); scrollBy(0, r.top + a.frac * r.height - 120); } R.pages.forEach(p => { if (p.near) want(p); }); pump(); hdSoon(0); }, 150); };
  addEventListener('resize', relayout);
  addEventListener('scroll', () => hdSoon(), { capture: true, passive: true });   /* window or the pages column */

  /* ---------- page list (source pages + virtual blank pages, in display order) ---------- */
  function makePage(id) {
    const blank = id >= C.BLANK_ID0, rec = blank ? M.S.layout.blanks.find(b => b.id === id) : null;
    const size = blank ? { w: rec.w, h: rec.h } : R.sizes[id - 1];
    const el = document.createElement('section'); el.className = blank ? 'st-blank' : 'page';   /* blank sheets are not .page: older modules index .page by position and must keep seeing source pages only */ el.dataset.page = id; if (blank) el.dataset.blank = '1';
    const pdf = document.createElement('canvas'); pdf.className = 'pdf'; pdf.width = 1; pdf.height = 1;
    const ink = document.createElement('canvas'); ink.className = 'ink'; ink.dataset.page = id;
    const label = document.createElement('span'); label.className = 'page-label';
    el.append(pdf, ink, label);
    const p = { id, n: id, kind: blank ? 'blank' : 'src', rec, el, pdf, ink, label, w: size.w, h: size.h, proxy: blank ? null : R.proxies[id - 1], near: false, token: 0 };
    el.__p = p; R.byId.set(id, p);
    M.attachPage({ wrap: el, ink, pageNumber: id, pdf }); layout(p); R.io.observe(el);
    return p;
  }
  function labels() { R.pages.forEach(p => { p.label.textContent = p.kind === 'blank' ? 'صفحة فارغة' : p.id + ' / ' + R.nSources; }); }
  /* Make the DOM match M.pageOrder(): add new pages, drop removed ones, reorder. Never touches source page ids. */
  function applyOrder() {
    const order = M.pageOrder(R.nSources), want_ = new Set(order);
    for (const [id, p] of [...R.byId]) if (!want_.has(id)) { release(p); R.io.unobserve(p.el); p.el.remove(); R.byId.delete(id); M.detachPage(id); }
    R.pages = order.map(id => R.byId.get(id) || makePage(id));
    R.root.append(...R.pages.map(p => p.el)); labels(); R.pages.forEach(layout); emit('pages', R.pages);
    settle();
  }
  M.on('pages', () => { if (R.io) applyOrder(); });

  /* ---------- open ---------- */
  R.open = async function (o) {
    const { src, root, status, error } = o; R.root = root;
    const isNotebook = /^notebook:/.test(src);
    const failView = message => {
      error.textContent = ''; const p = document.createElement('p'); p.textContent = message; error.append(p);
      let u = null; try { u = new URL(src, location.href); } catch {}
      if (u && u.origin === location.origin && /^https?:$/.test(u.protocol)) { const a = document.createElement('a'); a.href = u.href; a.target = '_blank'; a.rel = 'noopener'; a.className = 'mx-fail-open'; a.textContent = 'افتح الملف مباشرة'; error.append(a, ' '); }
      const r = document.createElement('button'); r.type = 'button'; r.className = 'mx-fail-retry'; r.textContent = 'أعد المحاولة'; r.onclick = () => location.reload(); error.append(r); status.textContent = 'تعذر عرض الملف هنا';
    };
    const rasterKey = (() => { try { return decodeURIComponent(new URL(src, location.href).pathname).replace(/^\//, ''); } catch { return ''; } })();
    const manifest = !isNotebook && window.medixaRasterManifest && window.medixaRasterManifest[rasterKey];
    const rasterOnly = !isNotebook && !window.pdfjsLib && !!(manifest && manifest.length);
    if (!isNotebook && !window.pdfjsLib && !rasterOnly) { failView('تعذر تحميل مكتبة عرض PDF (قد تكون الشبكة تحجبها). افتح الملف مباشرة أو أعد المحاولة لاحقاً.'); return null; }
    if (window.pdfjsLib) pdfjsLib.GlobalWorkerOptions.workerSrc = 'https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js';
    try {
      R.sizes = []; R.proxies = [];
      if (isNotebook) { R.notebook = { id: src.slice(9) }; }
      else if (rasterOnly) {
        R.raster = manifest.map(u => new URL(u, location.href).href);
        for (let i = 1; i <= R.raster.length; i++) { const im = await imageFor(i); R.sizes.push({ w: im.naturalWidth, h: im.naturalHeight }); R.proxies.push(null); }
        const note = document.createElement('p'); note.className = 'mx-raster-note'; note.textContent = 'مكتبة عرض PDF غير متاحة الآن، فنعرض صور الصفحات المحفوظة. الرسم وأدوات الدراسة تعمل؛ البحث في النص وتنزيل PDF بالتعليقات غير متاحين.'; error.append(note);
      } else {
        const res = await fetch(src); if (!res.ok) throw Error('HTTP ' + res.status);
        R.bytes = new Uint8Array(await res.arrayBuffer());
        R.doc = await pdfjsLib.getDocument({ data: R.bytes.slice(), standardFontDataUrl: FONTS, cMapUrl: CMAPS, cMapPacked: true, disableFontFace: true }).promise; /* same as the course viewer: without these, letters of some files overlap on iPad */
        if (manifest && manifest.length) R.raster = manifest.map(u => new URL(u, location.href).href);
        for (let i = 1; i <= R.doc.numPages; i++) { const pr = await R.doc.getPage(i), vp = pr.getViewport({ scale: 1 }); R.sizes.push({ w: vp.width, h: vp.height }); R.proxies.push(pr); }
      }
      R.nSources = R.sizes.length; M.setSources(R.nSources);
      await M.init({ src, bytes: R.bytes });
      if (isNotebook && !M.S.layout.blanks.length) M.addBlank(0, 'lined');           /* a notebook always has a page to write on */
      R.io = new IntersectionObserver(es => { for (const e of es) { const p = e.target.__p; if (p) p.near = e.isIntersecting; } if (!R.frozen) settle(); }, { rootMargin: TOUCH ? '700px 0px' : '1600px 0px' });
      R.pages = M.pageOrder(R.nSources).map(makePage); root.append(...R.pages.map(p => p.el)); labels();
      if (window.ResizeObserver) { let w0 = root.clientWidth; new ResizeObserver(() => { if (Math.abs(root.clientWidth - w0) > 2) { w0 = root.clientWidth; relayout(); } }).observe(root); }
      M.ready(); emit('opened', R);
      return R;
    } catch (e) { failView('تعذر فتح PDF: ' + e.message); return null; }
  };
  /* The PDF to export over: the original bytes, or an empty document for a notebook. */
  R.getBytes = async function () {
    if (R.bytes) return R.bytes;
    if (R.notebook && window.PDFLib) { const d = await PDFLib.PDFDocument.create(); return new Uint8Array(await d.save()); }
    return null;
  };
  /* Small preview for the page panel (cancellable, never touches the page canvas). */
  R.thumb = async function (id, canvas, cssW) {
    const p = R.byId.get(id); if (!p) return; const d = DPR(), W = Math.max(1, Math.round(cssW * d)), H = Math.max(1, Math.round(cssW * p.h / p.w * d));
    if (canvas.__task) { try { canvas.__task.cancel(); } catch {} canvas.__task = null; }
    canvas.width = W; canvas.height = H; const ctx = canvas.getContext('2d');
    if (p.kind === 'blank') { paintTemplate(ctx, W, H, p.rec); return; }
    if (R.raster && R.raster[id - 1]) { const im = await imageFor(id); ctx.drawImage(im, 0, 0, W, H); return; }
    if (!p.proxy || !p.proxy.render) return;
    const task = p.proxy.render({ canvasContext: ctx, viewport: p.proxy.getViewport({ scale: W / p.w }) }); canvas.__task = task;
    try { await task.promise; } catch (e) { if (!e || e.name !== 'RenderingCancelledException') throw e; } finally { if (canvas.__task === task) canvas.__task = null; }
  };
  /* The page that fills most of the viewport (ties go to the earlier page). */
  R.current = () => { let best = R.pages[0] ? R.pages[0].id : 1, v = -1; for (const p of R.pages) { const r = p.el.getBoundingClientRect(), vis = Math.min(r.bottom, innerHeight) - Math.max(r.top, 0); if (vis > v + 1) { v = vis; best = p.id; } } return best; };
  R.goto = (id, smooth) => { const el = R.pageEl(id); if (el) el.scrollIntoView({ block: 'start', behavior: smooth === false ? 'auto' : 'smooth' }); };
  M.on('layout', ({ n }) => { const p = R.byId.get(n); if (!p) return; layout(p); if (p.near) { p.rendered = false; want(p); pump(); } });
  R.pageEl = id => { const p = R.byId.get(id); return p && p.el; };
  R.destroy = () => { R.pages.forEach(release); if (R.io) R.io.disconnect(); if (R.doc && R.doc.destroy) R.doc.destroy(); };
  M.reader = R;
})();
