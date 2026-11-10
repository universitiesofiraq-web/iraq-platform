/* MEDIXA Study Studio — smart study layer. Turns real selections of the lecture into: text-anchored highlights,
   source-linked flashcards, source-linked multiple-choice questions and study masks, and gives selected text (or a saved
   highlight) the actions ترجمة | بحث | شرح | نسخ. Everything is saved through the existing stores (cards/quiz in
   medixa.study.v1 + its scheduler, masks in medixa.occlusion.v1); nothing is invented: a card's citation is the real page,
   the real text rectangles and the quote the student selected, and a translation or explanation is only ever the
   server's own answer (shown as plain text) or an honest message. Question drafting stays manual.
   What leaves the browser, and only after the student presses a button:
   - «ترجمة» asks GET api/ai/status (no text; once per page load), then sends POST api/ai/translate {text, to} with the
     selected text only (at most 2000 characters; a longer selection is translated only after a second press, cut to 2000).
   - «اشرح» in the explain panel does the same with POST api/ai/explain {text, mode}.
   Both go to MEDIXA's own server (same origin, signed-in students only, Workers AI), which neither stores nor logs the text.
   - «افتح في Google Translate» and «بحث في الإنترنت» open Google in a new tab with the selected text in its address.
   «بحث في الملف» and «نسخ» stay on the device.
   Text selection (2026-10-21, طلب محمد 2 و8 «مثل Notewise تماماً») is MEDIXA's own: the browser's native selection is
   never used (on iPad it brought iOS's tall blue blocks, its edit menu and Chrome's Touch-to-Search, and our bar jumped
   with every change). See «our own text selection» below. */
(function () {
  'use strict';
  const M = window.MedixaStudio; if (!M) return;
  const C = M.C, S = M.S, $ = id => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const src = new URLSearchParams(location.search).get('file'); if (!src) return;
  const docId = new URL(src, location.href).href;
  const HL = [['#f2c230', 'أصفر'], ['#7bd88f', 'أخضر'], ['#6fb1ff', 'أزرق'], ['#ff8fa3', 'وردي']];
  const MAX = 2000;                                   /* the server's limit per request (functions/_lib/ai.js MAX_CHARS) */
  const PHONE = matchMedia('(max-width: 720px)');     /* phones: panels are bottom sheets (studio-textactions.css) */
  const ICON = {
    tr: '<path d="M4 5h8M8 3v2M5.5 5c.8 3 3 5.5 6 7M10.5 5c-.8 3.5-3 6.5-6.5 8"/><path d="m13 21 4-9 4 9M14.5 18h5"/>',
    find: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>',
    ex: '<path d="M9 18h6M10 21h4"/><path d="M12 3a6 6 0 0 0-3.6 10.8c.7.5 1.1 1.3 1.1 2.1V16h5v-.1c0-.8.4-1.6 1.1-2.1A6 6 0 0 0 12 3z"/>',
    copy: '<rect x="8.5" y="3" width="12" height="13" rx="2.2"/><path d="M5 7.5v11A2.5 2.5 0 0 0 7.5 21H16"/>',
    card: '<rect x="3" y="5" width="18" height="14" rx="2"/><path d="M7 10h10M7 14h6"/>',
    mcq: '<circle cx="12" cy="12" r="9"/><path d="M9.6 9.4a2.5 2.5 0 1 1 3.4 2.4c-.6.3-1 .9-1 1.6v.4M12 17h.01"/>',
    mask: '<rect x="3" y="6" width="18" height="12" rx="2"/><path d="M7 10h6M7 14h10"/>',
    del: '<path d="M4 7h16M10 11v6M14 11v6M6 7l1 13h10l1-13M9 7V4h6v3"/>',
    web: '<path d="M20.9 13A9 9 0 1 0 13 20.9"/><path d="M3.6 9h16.8M3.6 15H11M12 3a14 14 0 0 1 3.3 8M12 3a14 14 0 0 0 0 18"/><path d="m15 15 6.2 2.3-2.7 1-1.1 2.7z"/>',
    doc: '<path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/><circle cx="11.5" cy="14" r="2.5"/><path d="m13.4 15.9 1.8 1.8"/>',
    x: '<path d="M6 6l12 12M18 6 6 18"/>',
    hl: '<g transform="rotate(45 12 12)"><path d="M10.5 2.5h3A1.5 1.5 0 0 1 15 4v7.5H9V4a1.5 1.5 0 0 1 1.5-1.5z"/><path d="m9 11.5 1 3.5h4l1-3.5"/><path d="M10 15v4.5l4-2V15"/></g>',
    more: '<circle cx="5.5" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.4" fill="currentColor" stroke="none"/><circle cx="18.5" cy="12" r="1.4" fill="currentColor" stroke="none"/>',
    ul: '<path d="M7 4v7a5 5 0 0 0 10 0V4"/><path d="M5 20h14"/>',
    st: '<path d="M16 6.5C15.2 5 13.8 4 12 4c-2.5 0-4.2 1.4-4.2 3.3 0 1.4.9 2.3 2.4 2.9"/><path d="M4 12h16"/><path d="M8 17.5C8.8 19 10.2 20 12 20c2.6 0 4.3-1.4 4.3-3.4 0-.8-.3-1.5-.8-2"/>',
    share: '<circle cx="18" cy="5" r="2.6"/><circle cx="6" cy="12" r="2.6"/><circle cx="18" cy="19" r="2.6"/><path d="m8.3 10.7 7.4-4.4M8.3 13.3l7.4 4.4"/>'
  };
  const svg = d => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';

  /* ---------- tools ---------- */
  /* «تحديد نص» (the I-beam): the ink engine hands it the Pencil and the mouse, and the finger when the finger draws.
     Tap = the word under it (on release); press + drag = a range by character; a tap while something is selected only
     dismisses; a tap on a saved text highlight opens its popover. (When the finger scrolls — Pencil mode — the finger's
     taps and long presses are read further down, in «gestures».) */
  let sd = null;
  M.registerTool('select', {
    down(pg, e, p) {
      hlClose(true); menuClose(true); moreClose(true);
      const id = pg.n, m = models.get(id); loadModel(id);
      const d = { pageId: id, x0: e.clientX, y0: e.clientY, u: p[0], v: p[1], hadSel: !!ts, anchor: m ? caretAt(m, p[0], p[1], false) : -1, moved: false };
      if (m && d.anchor < 0 && !hlAt(e.clientX, e.clientY)) { tsClear(); return false; }   /* off the text: dismiss only */
      sd = d; return true;
    },
    move(pg, e, p) {
      const d = sd; if (!d) return;
      if (!d.moved) { if (Math.hypot(e.clientX - d.x0, e.clientY - d.y0) < 6) return; d.moved = true; hide(true); }   /* no bar while the first drag runs */
      const m = models.get(d.pageId); if (!m) return;
      if (d.anchor < 0) d.anchor = caretAt(m, d.u, d.v, true); if (d.anchor < 0) return;
      const c = caretAt(m, p[0], p[1], true); if (c < 0 || c === d.anchor) return;
      tsSet(d.pageId, Math.min(c, d.anchor), Math.max(c, d.anchor));
    },
    up(pg, e, cancelled) {
      const d = sd; sd = null; if (!d) return;
      if (d.moved) { if (ts) showSel(); return; }
      if (cancelled) return;
      if (d.hadSel) { tsClear(); return; }
      const h = hlAt(e.clientX, e.clientY); if (h) { hide(true); hlOpen(h); return; }
      wordSelect(d.pageId, d.u, d.v);
    }
  });
  let region = null;
  M.registerTool('region', {
    down(pg, e, p) { region = { pg, a: p, b: p }; },
    move(pg, e, p) { if (region) { region.b = p; M.paint(pg); } },
    up(pg, e, cancelled, p) {
      const r = region; region = null; M.paint(pg); if (!r || cancelled) return;
      const x0 = C.clamp01(Math.min(r.a[0], p[0])), y0 = C.clamp01(Math.min(r.a[1], p[1])), x1 = C.clamp01(Math.max(r.a[0], p[0])), y1 = C.clamp01(Math.max(r.a[1], p[1]));
      if ((x1 - x0) * pg.cssW < 12 || (y1 - y0) * pg.cssH < 12) return;
      show({ pageId: pg.n, rects: [[x0, y0, x1, y1]], quote: '', kind: 'region' });
    }
  });
  M.on('overlay', ({ pg, ctx }) => {
    if (!region || region.pg !== pg) return; const k = pg.ink.width / pg.totW, a = pg.px(Math.min(region.a[0], region.b[0]), Math.min(region.a[1], region.b[1])), b = pg.px(Math.max(region.a[0], region.b[0]), Math.max(region.a[1], region.b[1]));
    ctx.save(); ctx.setLineDash([6 * k, 4 * k]); ctx.strokeStyle = '#168c8c'; ctx.lineWidth = 2 * k; ctx.fillStyle = 'rgba(22,140,140,.12)'; ctx.fillRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.strokeRect(a[0], a[1], b[0] - a[0], b[1] - a[1]); ctx.restore();
  });
  M.on('tool', t => {
    if (t !== 'select' && t !== 'hand') { hlClose(true); tsClear(); }
    if (cur && cur.kind === 'region' && t !== 'region') hide();
    if (t === 'select') { selectHint(); checkNoText(); if (M.reader) M.reader.pages.forEach(p => { if (p.near && p.hasText) loadModel(p.id); }); }
  });
  function selectHint() { try { if (localStorage.getItem('medixa.studio.selhint')) return; localStorage.setItem('medixa.studio.selhint', '1'); } catch { return; } M.banner('اضغط على كلمة لتحديدها، ثم اسحب الدائرتين الزرقاوين لتوسيع التحديد. بالقلم: اضغط واسحب فوق النص. بالإصبع: اضغط مطولاً ثم اسحب.', [['حسناً', () => {}]]); }
  function checkNoText() {
    const R = M.reader; if (!R) return; const vis = R.pages.filter(p => p.kind === 'src' && p.near);
    if (R.raster && !window.pdfjsLib) { M.banner('النص غير متاح الآن لأن مكتبة عرض PDF لم تُحمَّل. استعمل أداة «منطقة من الصفحة» لإنشاء بطاقة أو قناع.', [['حسناً', () => {}]]); return; }
    if (vis.length && vis.every(p => p.rendered && p.hasText === false)) M.banner('هذه الصفحات بلا نص قابل للتحديد (ملف ممسوح ضوئياً). لا نخمّن النص: استعمل أداة «منطقة من الصفحة» لإنشاء بطاقة أو قناع من الصورة.', [['حسناً', () => {}]]);
  }

  /* =====================================================================================================
     Our own text selection (2026-10-21, طلب محمد 2 و8: «اجعل تحديد النص يعمل بهذا النظام تماماً» — Notewise).
     - Geometry: pdf.js getTextContent of the page (asked once per page, cached), turned into characters with their x span
       and lines with their ascender..descender band, all in page fractions (u, v), so zoom and scroll change nothing.
     - Look: one light-blue band per line + two iOS-style handles (ring knob above the start, below the end), drawn by us
       inside the page (div.st-tsel); the invisible pdf.js text layer stays pointer-events:none and unselectable.
     - Gestures: see the select tool above and «gestures» below. Handles extend by character across lines; the two ends
       swap when they cross; at least one character stays selected.
     - One dark bar, anchored above the start of the selection; it does not move while a handle is dragged.
     ===================================================================================================== */
  const WORD = /[\p{L}\p{N}'’\-]/u, SPACE = /\s/;
  const models = new Map(), loading = new Map();
  const rpage = id => M.reader && M.reader.byId && M.reader.byId.get(id);
  const pageRect = id => { const p = rpage(id); if (!p || !p.pdf) return null; const q = p.pdf.getBoundingClientRect(); return q.width > 1 && q.height > 1 ? q : null; };
  const reducedMotion = () => (window.matchMedia && matchMedia('(prefers-reduced-motion: reduce)').matches) || document.documentElement.classList.contains('reduced-motion') || document.body.classList.contains('reduced-motion');
  let mctx = null; const widths = new Map();
  /* advance of one character in the fallback font pdf.js uses for its text layer (only the proportions matter) */
  function charW(fam, c) {
    let m = widths.get(fam); if (!m) { if (widths.size > 16) widths.clear(); widths.set(fam, m = new Map()); }
    let w = m.get(c);
    if (w === undefined) { if (!mctx) mctx = document.createElement('canvas').getContext('2d'); mctx.font = '40px ' + fam; w = mctx.measureText(c).width || 0; if (m.size > 4000) m.clear(); m.set(c, w); }
    return w;
  }
  function loadModel(id) {
    if (models.has(id)) return Promise.resolve(models.get(id));
    if (loading.has(id)) return loading.get(id);
    const p = rpage(id); if (!p || p.kind !== 'src' || !p.proxy || !p.proxy.getTextContent || !window.pdfjsLib || !pdfjsLib.Util) return Promise.resolve(null);
    const pr = p.proxy.getTextContent().then(tc => {
      let m = null; try { m = build(p, tc); } catch (e) { console.warn('text model failed', id, e); }
      loading.delete(id); if (!m) return null;
      models.set(id, m);
      if (models.size > 40) for (const k of models.keys()) { if (models.size <= 40) break; if (!ts || k !== ts.pageId) models.delete(k); }
      return m;
    }, () => { loading.delete(id); return null; });
    loading.set(id, pr); return pr;
  }
  function build(p, tc) {
    const vp = p.proxy.getViewport({ scale: 1 }), W = vp.width, H = vp.height, U = pdfjsLib.Util;
    const ch = [], u0 = [], u1 = [], dir = [], raw = [];
    const push = (c, a, b, d) => { ch.push(c); u0.push(a / W); u1.push(b / W); dir.push(d); };
    let cur = null, eol = true;
    for (const it of (tc && tc.items) || []) {
      if (!it || typeof it.str !== 'string') continue;                 /* marked-content entries carry no text */
      if (!it.str) { if (it.hasEOL) eol = true; continue; }
      const st = (tc.styles && tc.styles[it.fontName]) || {};
      const tx = U.transform(vp.transform, it.transform), fh = Math.hypot(tx[2], tx[3]);
      if (st.vertical || !(fh > 0) || !(tx[0] > 0) || Math.abs(Math.atan2(tx[1], tx[0])) > 0.05) { eol = true; continue; }   /* rotated / vertical text is not selectable */
      const x = tx[4], base = tx[5], w = it.width > 0 ? it.width : 0, em = Math.max(fh, cur ? cur.fh : 0);
      const same = !!cur && !eol && Math.abs(base - cur.base) < 0.4 * em && x > cur.x1 - 2 * em && x < cur.x1 + 2.5 * em;
      if (!/\S/.test(it.str)) {                                        /* a space item: kept only inside a line */
        if (same && w > 0) { push(' ', x, x + w, 1); cur.x1 = Math.max(cur.x1, x + w); cur.c1 = ch.length; }
        if (it.hasEOL) eol = true; continue;
      }
      const asc = st.ascent > 0.5 && st.ascent < 1.3 ? st.ascent : (st.descent < 0 && st.descent > -0.6 ? 1 + st.descent : 0.85);
      const desc = st.descent < 0 && st.descent > -0.6 ? st.descent : -0.22;
      const top = (base - asc * fh) / H, bot = (base - desc * fh) / H;
      if (!same) {
        const prev = cur; if (prev) raw.push(prev);
        cur = { base, fh, x1: x, v0: top, v1: bot, c0: ch.length, c1: ch.length, sep: prev && Math.abs(base - prev.base) < 0.4 * Math.max(fh, prev.fh) ? ' ' : '\n' };
      } else if (x - cur.x1 > 0.15 * fh && !SPACE.test(ch[ch.length - 1] || ' ') && !SPACE.test(it.str[0])) push(' ', cur.x1, x, 1);   /* words placed apart without a space */
      const cs = Array.from(it.str), fam = st.fontFamily || 'sans-serif', ws = cs.map(c => charW(fam, c)), sum = ws.reduce((s, v) => s + v, 0);
      const use = sum > 0 ? ws : cs.map(() => 1), T = sum > 0 ? sum : cs.length, rtl = it.dir === 'rtl';
      let acc = 0;
      for (let k = 0; k < cs.length; k++) {
        const a = acc / T * w, b = (acc + use[k]) / T * w; acc += use[k];
        if (rtl) push(cs[k], x + w - b, x + w - a, -1); else push(cs[k], x + a, x + b, 1);
      }
      cur.x1 = Math.max(cur.x1, x + w); cur.c1 = ch.length; cur.v0 = Math.min(cur.v0, top); cur.v1 = Math.max(cur.v1, bot); cur.fh = Math.max(cur.fh, fh);
      eol = !!it.hasEOL;
    }
    if (cur) raw.push(cur);
    const lines = raw.filter(L => L.c1 > L.c0).map(L => {
      let a = Infinity, b = -Infinity; for (let k = L.c0; k < L.c1; k++) { if (u0[k] < a) a = u0[k]; if (u1[k] > b) b = u1[k]; }
      return { c0: L.c0, c1: L.c1, v0: L.v0, v1: L.v1, u0: a, u1: b, em: L.fh / W, sep: L.sep };
    });
    lines.forEach(L => { L.v0 = Math.max(-0.05, L.v0); L.v1 = Math.min(1.05, L.v1); });
    const lineOf = new Int32Array(ch.length); lines.forEach((L, i) => { for (let k = L.c0; k < L.c1; k++) lineOf[k] = i; });
    return { id: p.id, ch, u0: Float32Array.from(u0), u1: Float32Array.from(u1), dir: Int8Array.from(dir), lines, lineOf, N: ch.length, k: H / W };
  }
  /* the line under (u, v), or -1; loose (drags): the nearest line */
  function lineAt(m, u, v, loose) {
    let best = -1, bs = Infinity;
    for (let i = 0; i < m.lines.length; i++) {
      const L = m.lines[i], tol = 0.15 * (L.v1 - L.v0);
      const dx = u < L.u0 ? L.u0 - u : u > L.u1 ? u - L.u1 : 0, dy = v < L.v0 - tol ? L.v0 - tol - v : v > L.v1 + tol ? v - L.v1 - tol : 0;
      if (!loose && (dy > 0 || dx > 0.6 * L.em)) continue;
      const s = Math.hypot(dx, dy * m.k * 1.5) + Math.abs(v - (L.v0 + L.v1) / 2) * m.k * 0.001;
      if (s < bs) { bs = s; best = i; }
    }
    return best;
  }
  /* the caret (0..N, the boundary before character k) nearest to u on line i */
  function caretOn(m, i, u) {
    const L = m.lines[i]; let best = L.c0, bd = Infinity;
    for (let k = L.c0; k < L.c1; k++) { const d = u < m.u0[k] ? m.u0[k] - u : u > m.u1[k] ? u - m.u1[k] : 0; if (d < bd) { bd = d; best = k; if (!d) break; } }
    const mid = (m.u0[best] + m.u1[best]) / 2;
    return best + ((m.dir[best] > 0 ? u > mid : u < mid) ? 1 : 0);
  }
  function caretAt(m, u, v, loose) { const i = lineAt(m, u, v, loose); return i < 0 ? -1 : caretOn(m, i, u); }
  /* the character under a tap; a tap on a space takes the nearest letter of that line (pdf.js x positions drift a little) */
  function charAt(m, u, v) {
    const i = lineAt(m, u, v, false); if (i < 0) return -1; const L = m.lines[i];
    let best = -1, bd = Infinity;
    for (let k = L.c0; k < L.c1; k++) { if (SPACE.test(m.ch[k])) continue; const d = u < m.u0[k] ? m.u0[k] - u : u > m.u1[k] ? u - m.u1[k] : 0; if (d < bd) { bd = d; best = k; } }
    return best >= 0 && bd <= 0.6 * L.em ? best : -1;
  }
  /* [a, b) of the word around character k, within its line (a lone sign is selected on its own) */
  function wordAt(m, k) {
    const L = m.lines[m.lineOf[k]]; if (!WORD.test(m.ch[k])) return [k, k + 1];
    let a = k, b = k + 1; while (a > L.c0 && WORD.test(m.ch[a - 1])) a--; while (b < L.c1 && WORD.test(m.ch[b])) b++;
    return [a, b];
  }
  /* one rectangle per line: first line from the start character, middle lines whole, last line to the end character */
  function rectsOf(m, a, b) {
    const out = [];
    for (let i = m.lineOf[a], n = m.lineOf[b - 1]; i <= n; i++) {
      const L = m.lines[i], s = Math.max(a, L.c0), e = Math.min(b, L.c1); let x0 = Infinity, x1 = -Infinity;
      for (let k = s; k < e; k++) { if (m.u0[k] < x0) x0 = m.u0[k]; if (m.u1[k] > x1) x1 = m.u1[k]; }
      if (x1 > x0) out.push([x0, L.v0, x1, L.v1]);
    }
    /* tightly set lines: neighbouring bands never touch (a small gap, as in Notewise) */
    for (let i = 1; i < out.length; i++) {
      const p = out[i - 1], r = out[i], g = 0.05 * Math.min(p[3] - p[1], r[3] - r[1]);
      if (r[1] > p[1] && r[1] < p[3] + g && r[0] < p[2] && r[2] > p[0]) { const mid = (p[3] + r[1]) / 2; p[3] = Math.min(p[3], mid - g / 2); r[1] = Math.max(r[1], mid + g / 2); }
    }
    return out;
  }
  function textIn(m, a, b) { let s = ''; for (let k = a; k < b; k++) { const L = m.lines[m.lineOf[k]]; if (k > a && L.c0 === k) s += L.sep; s += m.ch[k]; } return s; }

  /* ----- state, events ----- */
  let ts = null;                                                     /* { pageId, a, b }: characters a..b-1 of that page */
  const tsL = {};
  const tsEmit = (n, d) => (tsL[n] || []).forEach(f => { try { f(d); } catch (e) { console.warn(e); } });
  function tsSet(pageId, a, b) {
    const m = models.get(pageId); if (!m || !m.N) return false;
    a = Math.max(0, Math.min(m.N - 1, a | 0)); b = Math.max(a + 1, Math.min(m.N, b | 0));
    if (ts && ts.pageId === pageId && ts.a === a && ts.b === b) return true;
    if (ts && ts.pageId !== pageId) dropOverlay(ts.pageId);
    ts = { pageId, a, b }; paintSel(); tsEmit('change', tsGet()); return true;
  }
  function tsClear() {
    if (!ts) return; const id = ts.pageId; ts = null;
    if (hd) { hd = null; document.documentElement.classList.remove('st-tsel-dragging'); }
    dropOverlay(id); hide(); tsEmit('clear');
  }
  function tsGet() {
    if (!ts) return null; const m = models.get(ts.pageId); if (!m) return null;
    const rects = rectsOf(m, ts.a, ts.b), text = textIn(m, ts.a, ts.b);
    return { pageId: ts.pageId, a: ts.a, b: ts.b, rects, text, quote: text.replace(/\s+/g, ' ').trim().slice(0, 600), kind: 'text', firstLine: rects[0] || null, lastLine: rects[rects.length - 1] || null };
  }
  /* where the bar hangs: x of the start handle, top of the first line, bottom of the last line (page fractions) */
  function tsGeo() {
    const m = ts && models.get(ts.pageId); if (!m) return null;
    const La = m.lines[m.lineOf[ts.a]], Lb = m.lines[m.lineOf[ts.b - 1]];
    return { pageId: ts.pageId, u: m.dir[ts.a] > 0 ? m.u0[ts.a] : m.u1[ts.a], v0: La.v0, v1: Lb.v1 };
  }

  /* ----- drawing: bands + handles inside the page (in % of the page area, so zoom / scroll need nothing) ----- */
  const pc = n => (n * 100).toFixed(4) + '%';
  let hS = null, hE = null;                                          /* kept while dragged: pointer capture survives re-renders */
  function makeHandle(cls) {
    const h = el('div', 'st-tsel-h ' + cls); h.append(el('i'), el('b'));
    h.addEventListener('pointerdown', hDown); h.addEventListener('pointermove', hMove);
    h.addEventListener('pointerup', hUp); h.addEventListener('pointercancel', hUp); h.addEventListener('lostpointercapture', hUp);
    h.addEventListener('contextmenu', e => e.preventDefault());
    return h;
  }
  function dropOverlay(id) { const p = rpage(id), o = p && p.el.querySelector(':scope > .st-tsel'); if (o) o.remove(); }
  function paintSel() {
    const p = rpage(ts.pageId), m = models.get(ts.pageId); if (!p || !m) return;
    let o = p.el.querySelector(':scope > .st-tsel'); if (!o) { o = el('div', 'st-tsel'); o.setAttribute('aria-hidden', 'true'); p.el.append(o); }
    if (!hS) { hS = makeHandle('st-s'); hE = makeHandle('st-e'); }
    const rects = rectsOf(m, ts.a, ts.b), rs = o.getElementsByClassName('st-tsel-r');
    while (rs.length > rects.length) rs[rs.length - 1].remove();
    while (rs.length < rects.length) o.insertBefore(el('div', 'st-tsel-r'), o.firstChild);
    rects.forEach((r, i) => { const s = rs[i].style; s.left = pc(r[0]); s.top = pc(r[1]); s.width = pc(r[2] - r[0]); s.height = pc(r[3] - r[1]); });
    if (hS.parentNode !== o) o.append(hS); if (hE.parentNode !== o) o.append(hE);
    if (!rects.length) return;
    const put = (h, u, r, start) => { const s = h.style; s.left = pc(u); s.top = start ? 'calc(' + pc(r[1]) + ' - 30px)' : pc(r[1]); s.height = 'calc(' + pc(r[3] - r[1]) + ' + 30px)'; };
    put(hS, m.dir[ts.a] > 0 ? m.u0[ts.a] : m.u1[ts.a], rects[0], true);                           /* stems span the band of their line */
    put(hE, m.dir[ts.b - 1] > 0 ? m.u1[ts.b - 1] : m.u0[ts.b - 1], rects[rects.length - 1], false);
  }

  /* ----- handles: drag by character; the bar stays where it is ----- */
  let hd = null;
  function hDown(e) {
    if (!ts || (e.pointerType === 'mouse' && e.button !== 0)) return;
    e.preventDefault(); e.stopPropagation();                         /* never ink, never a pan */
    const m = models.get(ts.pageId), q = pageRect(ts.pageId); if (!m || !q) return;
    const h = e.currentTarget, role = h === hS ? 's' : 'e', L = m.lines[m.lineOf[role === 's' ? ts.a : ts.b - 1]];
    hd = { id: e.pointerId, role, dy: e.clientY - (q.top + (L.v0 + L.v1) / 2 * q.height), a0: ts.a };
    try { h.setPointerCapture(e.pointerId); } catch {}
    h.classList.add('is-drag'); document.documentElement.classList.add('st-tsel-dragging');
    menuClose(true); moreClose(true); tsEmit('drag-start', tsGet());
  }
  function hMove(e) {
    if (!hd || e.pointerId !== hd.id) return; e.preventDefault(); e.stopPropagation();
    if (!ts) return; const m = models.get(ts.pageId), q = pageRect(ts.pageId); if (!m || !q) return;
    const c = caretAt(m, (e.clientX - q.left) / q.width, (e.clientY - hd.dy - q.top) / q.height, true); if (c < 0) return;
    const fixed = hd.role === 's' ? ts.b : ts.a; let a, b, role;
    if (c > fixed) { a = fixed; b = c; role = 'e'; }
    else if (c < fixed) { a = c; b = fixed; role = 's'; }
    else if (hd.role === 'e') { a = fixed; b = Math.min(m.N, fixed + 1); role = 'e'; }   /* never empty: one character stays */
    else { a = Math.max(0, fixed - 1); b = fixed; role = 's'; }
    if (role !== hd.role) {                                          /* the ends crossed: the dragged knob becomes the other end */
      [hS, hE] = [hE, hS]; hS.classList.replace('st-e', 'st-s'); hE.classList.replace('st-s', 'st-e'); hd.role = role;
    }
    if (a !== ts.a || b !== ts.b) { ts.a = a; ts.b = b; paintSel(); tsEmit('change', tsGet()); }
  }
  function hUp(e) {
    if (!hd || e.pointerId !== hd.id) return; if (e.type !== 'lostpointercapture') e.stopPropagation();
    const d = hd; hd = null;
    if (hS) hS.classList.remove('is-drag'); if (hE) hE.classList.remove('is-drag'); document.documentElement.classList.remove('st-tsel-dragging');
    tsEmit('drag-end', tsGet()); if (!ts) return;
    if (!bar || bar.hidden || !cur || cur.kind !== 'text') showSel();
    else if (ts.a !== d.a0) { barAt = tsGeo(); placeBar(); }       /* the start moved: the bar follows it once, on release */
  }

  /* ----- gestures of the pointers the ink engine does NOT give to the select tool (it scrolls with them) ----- */
  const BLOCK = 'button,a,input,textarea,select,label,[contenteditable],dialog,.st-editor,.study-mask,.mx-mask,.mx-occlusion-draw';
  const touches = new Set(); let tp = null, synth = false;
  /* what the ink engine made of a pointer: a palm it rejected, or a finger of a pinch, is never a tap or a long press */
  const engineRole = id => { const g = M.gesture, r = g && g.pointers.find(x => x.id === id); return r ? r.role : null; };
  const notMine = id => { const r = engineRole(id); return r === 'rejected' || r === 'ignored' || r === 'nav'; };
  const penBusy = () => !!(M.gesture && M.gesture.pointers.some(x => x.type === 'pen'));
  const at = (p, x, y) => { const q = p && p.pdf && p.pdf.getBoundingClientRect(); return q && q.width > 1 ? [(x - q.left) / q.width, (y - q.top) / q.height] : null; };
  async function wordSelect(pageId, u, v) {
    const m = models.get(pageId) || await loadModel(pageId); if (!m || !m.N) return false;
    const k = charAt(m, u, v); if (k < 0) return false;
    const w = wordAt(m, k); tsSet(pageId, w[0], w[1]); showSel(); return true;
  }
  document.addEventListener('pointerdown', e => {
    if (synth) return;
    if (e.pointerType === 'touch') { if (e.isPrimary) touches.clear(); touches.add(e.pointerId); }   /* a first finger starts afresh (a lost pointerup never sticks) */
    const t = e.target; if (!t || !t.closest || t.closest('.st-tsel-h')) return;
    if (tp && tp.id !== e.pointerId && (tp.mode !== 'extend' || e.isPrimary)) { clearTimeout(tp.lpT); tp = null; }   /* a second finger: zoom / pan, not a tap */
    if (!t.closest('#pages') || t.closest(BLOCK)) return;
    if (cur && cur.kind === 'region') hide(true);
    const touch = e.pointerType === 'touch'; if (touch && touches.size > 1) return;
    const sec = t.closest('section'), p = sec && sec.__p; if (p && p.kind === 'src') loadModel(p.id);
    const onInk = !!t.closest('canvas.ink'), pm = !!(M.penMode && M.penMode()), tool = S.tool;
    if (tool === 'select' && onInk && (!touch || !pm)) return;        /* the select tool itself (above) */
    const nav = tool === 'hand' || !onInk || (touch && pm);
    if (!nav && !touch) { tsClear(); return; }                       /* the Pencil / mouse draws, erases or picks objects */
    tp = { id: e.pointerId, type: e.pointerType, p, x0: e.clientX, y0: e.clientY, t0: performance.now(), moved: false, draw: !nav, lpT: 0, mode: null };
    if (touch && nav && onInk && p) { const t0 = tp; t0.lpT = setTimeout(() => longPress(t0), 480); }
  }, true);
  document.addEventListener('pointermove', e => {
    if (!tp || e.pointerId !== tp.id || synth) return;
    if (tp.mode === 'extend') { extendTo(tp, e.clientX, e.clientY); return; }
    if (!tp.moved && Math.hypot(e.clientX - tp.x0, e.clientY - tp.y0) > 8) { tp.moved = true; clearTimeout(tp.lpT); if (tp.draw) tsClear(); }
  }, true);
  for (const ev of ['pointerup', 'pointercancel']) document.addEventListener(ev, e => {
    if (synth) return;
    touches.delete(e.pointerId);
    if (!tp || e.pointerId !== tp.id) return;
    const t = tp; tp = null; clearTimeout(t.lpT);
    if (t.mode === 'extend') { if (ts) showSel(); return; }
    if (t.moved || e.type !== 'pointerup' || notMine(e.pointerId)) return;
    tap(t, e);
  }, true);
  /* a tap: dismisses a selection (and selects nothing); else a saved highlight's popover (select / hand); else, in the
     select tool, the word under the finger */
  function tap(t, e) {
    if (t.draw || ts) { tsClear(); return; }
    if (S.tool === 'select' || S.tool === 'hand') { const h = hlAt(e.clientX, e.clientY); if (h) { hide(true); hlOpen(h); return; } }
    if (S.tool === 'select' && t.type === 'touch' && t.p && performance.now() - t.t0 < 350) { const uv = at(t.p, e.clientX, e.clientY); if (uv) wordSelect(t.p.id, uv[0], uv[1]); }
  }
  /* a finger held still for 480 ms on a word (select / hand tools, or any tool while the finger scrolls): that word;
     the same finger then extends the selection by character until it lifts */
  function longPress(t) {
    if (tp !== t || t.moved || notMine(t.id) || penBusy()) return;   /* a resting palm while the Pencil writes is not a long press */
    const m = models.get(t.p.id), uv = at(t.p, t.x0, t.y0); if (!m || !uv) return;
    const k = charAt(m, uv[0], uv[1]); if (k < 0) return;
    const w = wordAt(m, k);
    /* stop the pan this finger started (nothing moved yet) */
    synth = true; try { document.dispatchEvent(new PointerEvent('pointercancel', { pointerId: t.id, pointerType: 'touch', bubbles: true, clientX: t.x0, clientY: t.y0 })); } catch {} synth = false;
    t.mode = 'extend'; t.wa = w[0]; t.wb = w[1];
    hlClose(true); hide(true); tsSet(t.p.id, w[0], w[1]);
    if (navigator.vibrate) try { navigator.vibrate(8); } catch {}
  }
  function extendTo(t, x, y) {
    const m = models.get(t.p.id), uv = at(t.p, x, y); if (!m || !uv) return;
    const c = caretAt(m, uv[0], uv[1], true); if (c < 0) return;
    tsSet(t.p.id, Math.min(c, t.wa), Math.max(c, t.wb));
  }
  if (M.reader && M.reader.on) {
    M.reader.on('text', p => { if (p && p.hasText) setTimeout(() => { if (p.near) loadModel(p.id); }, 300); });   /* ready before the first tap */
    M.reader.on('zoom', () => requestAnimationFrame(placeBar));
    M.reader.on('zoompreview', () => requestAnimationFrame(placeBar));
  }
  /* keyboard: Cmd/Ctrl+C copies the selection (desktop) */
  addEventListener('keydown', e => {
    if (!ts || !(e.ctrlKey || e.metaKey) || (e.key || '').toLowerCase() !== 'c') return;
    const t = e.target; if (t && t.closest && t.closest('input,textarea,select,[contenteditable]')) return;
    const a = selectionAnchor(); if (!a) return; e.preventDefault(); e.stopImmediatePropagation(); copyText(textOf(a));
  }, true);

  /* ---------- the selection as a source anchor (what a highlight / card / question stores) ---------- */
  /* quote: what a highlight / card stores (600 chars); text: the whole selection, for translate / explain / copy */
  function selectionAnchor() {
    const g = tsGet(); if (!g) return null;
    const rects = g.rects.slice(0, 60).map(r => [C.clamp01(r[0]), C.clamp01(r[1]), C.clamp01(r[2]), C.clamp01(r[3])]).filter(r => r[2] - r[0] > 0.0005 && r[3] - r[1] > 0.0005);
    if (!rects.length) return null;
    const text = g.text.replace(/[ \t]+/g, ' ').trim(), q = pageRect(g.pageId), f = g.rects[0];
    const bbox = q ? { left: q.left + f[0] * q.width, right: q.left + f[2] * q.width, top: q.top + f[1] * q.height, bottom: q.top + f[3] * q.height } : null;
    return { pageId: g.pageId, rects, quote: g.quote, text: text.slice(0, 20000), kind: 'text', bbox };
  }
  const sourceOf = a => ({ documentId: docId, documentVersion: M.S.docHash || '', pageId: a.pageId, rects: a.rects.map(r => r.map(n => +n.toFixed(5))), quote: a.quote || '' });
  const textOf = a => (a.text || a.quote || '').trim();

  /* ---------- the action bar (Notewise): نسخ · تظليل · تسطير · شطب · ترجمة · بحث · مشاركة · ⋯ (أدوات الدراسة) ----------
     Dark pill, icons only, anchored 5 px right of the selection start and 17 px above its first line (below the last
     line when the header is in the way). It fades in ~60 ms after the selection appears and never moves while a handle
     is dragged; it follows the page when scrolling. */
  let bar = null, cur = null, barAt = null, barT = 0;
  const curA = () => (cur && cur.kind === 'text' ? (ts && selectionAnchor()) || cur : cur);
  const hlColor = () => { const s = M.style && M.style('highlight'); return (s && s.color) || HL[0][0]; };
  const penColor = () => { const s = M.style && M.style('pen'); return (s && s.color) || '#e43d56'; };
  function ensureBar() { if (bar) return bar; bar = el('div', 'st-seltools'); bar.id = 'st-seltools'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'إجراءات النص المحدد'); bar.dir = 'ltr'; bar.hidden = true; bar.addEventListener('keydown', barKeys); bar.addEventListener('contextmenu', e => e.preventDefault()); document.body.append(bar); return bar; }
  /* buttons keep the focus where it is (no focus steal on mouse down); fn gets the button, for focus return */
  function actBtn(host, cls, label, text, fn, icon) {
    const x = el('button', 'st-sel-btn ' + cls); x.type = 'button'; x.setAttribute('aria-label', label); x.title = label;
    if (icon) x.innerHTML = svg(ICON[icon]); if (text) x.append(el('span', 'st-sel-lb', text));
    x.onmousedown = e => e.preventDefault(); x.onclick = () => fn(x); host.append(x); return x;
  }
  const showSel = () => { const a = selectionAnchor(); if (a) show(a); };
  function show(a) {
    const b = ensureBar(), same = !b.hidden && b.classList.contains('is-in') && cur && cur.kind === a.kind && a.kind === 'text';
    cur = a; menuClose(true); moreClose(true);
    if (!same) {
      b.replaceChildren(); b.classList.toggle('st-sel-region', a.kind !== 'text');
      const mk = (cls, label, fn, icon) => actBtn(b, cls, label, '', fn, icon);
      if (a.kind === 'text') {
        mk('st-sel-copy', 'نسخ', () => { const x = curA(); if (!x) return; copyText(textOf(x)); tsClear(); }, 'copy');
        mk('st-sel-hl', 'تظليل', () => highlight(curA(), hlColor()), 'hl');
        mk('st-sel-ul', 'تسطير', () => highlight(curA(), penColor(), 'underline'), 'ul');
        mk('st-sel-st', 'شطب', () => highlight(curA(), penColor(), 'strike'), 'st');
        mk('st-sel-tr', 'ترجمة', x => { const y = curA(); if (y) openTranslate(y, x); }, 'tr');
        const f = mk('st-sel-find', 'بحث', x => { const y = curA(); if (y) menuToggle(y, x); }, 'web'); f.setAttribute('aria-haspopup', 'menu'); f.setAttribute('aria-expanded', 'false');
        mk('st-sel-share', 'مشاركة', () => { const x = curA(); if (!x) return; const t = textOf(x); tsClear(); shareText(t); }, 'share');
        const o = mk('st-sel-more', 'المزيد: أدوات الدراسة', x => moreToggle(x), 'more'); o.setAttribute('aria-haspopup', 'menu'); o.setAttribute('aria-expanded', 'false');
      } else {
        mk('st-sel-card', 'بطاقة مراجعة', () => draft('card', cur), 'card');
        mk('st-sel-mcq', 'سؤال اختيار من متعدد', () => draft('mcq', cur), 'mcq');
        if (a.pageId < C.BLANK_ID0) mk('st-sel-mask', 'قناع دراسة على هذا الجزء', () => mask(cur), 'mask');
      }
    }
    barAt = a.kind === 'text' && ts ? tsGeo() : { pageId: a.pageId, u: Math.min(...a.rects.map(r => r[0])), v0: Math.min(...a.rects.map(r => r[1])), v1: Math.max(...a.rects.map(r => r[3])) };
    clearTimeout(barT); b.hidden = false; placeBar();
    if (!same) {
      b.classList.remove('is-in');
      if (reducedMotion()) b.classList.add('is-in'); else barT = setTimeout(() => { if (cur && !b.hidden) b.classList.add('is-in'); }, 60);
    }
  }
  /* hide the bar (a short fade; at once with reduced motion or when asked) */
  function hide(now) {
    cur = null; menuClose(true); moreClose(true);
    if (!bar || bar.hidden) return;
    clearTimeout(barT); bar.classList.remove('is-in');
    if (now || reducedMotion()) { bar.hidden = true; return; }
    barT = setTimeout(() => { if (!bar.classList.contains('is-in')) bar.hidden = true; }, 110);
  }
  function placeBar() {
    if (!bar || bar.hidden || !barAt) return;
    const q = pageRect(barAt.pageId); if (!q) { bar.classList.add('is-off'); return; }
    const lim = limits(), w = bar.offsetWidth || 256, h = bar.offsetHeight || 40;
    const left = q.left + barAt.u * q.width, top = q.top + barAt.v0 * q.height, bottom = q.top + barAt.v1 * q.height;
    const x = Math.max(8, Math.min(innerWidth - w - 8, left + 5)); let y = top - 17 - h, below = false;
    if (y < lim.top) { y = bottom + 17; below = true; }
    if (y + h > innerHeight - lim.bottom) y = Math.max(lim.top, innerHeight - lim.bottom - h);
    bar.style.left = Math.round(x) + 'px'; bar.style.top = Math.round(y) + 'px';
    bar.classList.toggle('is-below', below);
    bar.classList.toggle('is-off', bottom < lim.top || top > innerHeight - lim.bottom);   /* the selection scrolled away */
    if (more && !more.hidden && more._from) placeMore();
  }
  /* arrow keys move along the toolbar (one Tab stop is enough for a row this long) */
  function barKeys(e) {
    if (e.key !== 'ArrowLeft' && e.key !== 'ArrowRight' && e.key !== 'Home' && e.key !== 'End') return;
    const list = [...bar.querySelectorAll('button')], i = list.indexOf(document.activeElement); if (i < 0) return;
    const j = e.key === 'Home' ? 0 : e.key === 'End' ? list.length - 1 : (i + (e.key === 'ArrowRight' ? 1 : -1) + list.length) % list.length;   /* the row reads left to right */
    e.preventDefault(); list[j].focus();
  }
  /* «المزيد»: the study actions (شرح، بطاقة، سؤال، قناع) in a small dark menu above the bar (below it when there is no room) */
  let more = null;
  function moreToggle(from) {
    if (more && !more.hidden) return moreClose();
    const a = curA(); if (!a) return;
    if (!more) {
      more = el('div', 'st-sel-menu'); more.id = 'st-sel-more'; more.dir = 'rtl'; more.hidden = true; more.setAttribute('role', 'menu'); more.setAttribute('aria-label', 'أدوات الدراسة للنص المحدد');
      more.addEventListener('keydown', e => {
        const list = [...more.querySelectorAll('[role=menuitem]')], i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus(); }
        else if (e.key === 'Tab') moreClose(true);
      });
      document.body.append(more);
    }
    const item = (cls, icon, text, fn) => { const b = el('button', 'st-sel-mi ' + cls); b.type = 'button'; b.setAttribute('role', 'menuitem'); b.innerHTML = svg(ICON[icon]); b.append(el('span', '', text)); b.onmousedown = e => e.preventDefault(); b.onclick = () => { moreClose(true); fn(); }; return b; };
    const items = [];
    if (explainShown()) items.push(item('st-sel-ex', 'ex', 'شرح', () => openExplain(curA() || a, from)));
    items.push(item('st-sel-card', 'card', 'بطاقة مراجعة', () => draft('card', curA() || a)));
    items.push(item('st-sel-mcq', 'mcq', 'سؤال اختيار من متعدد', () => draft('mcq', curA() || a)));
    if (a.pageId < C.BLANK_ID0) items.push(item('st-sel-mask', 'mask', 'قناع دراسة', () => mask(curA() || a)));
    const kbd = document.activeElement === from;                     /* opened from the keyboard: focus goes into the menu */
    more.replaceChildren(...items); more._from = from; from.setAttribute('aria-expanded', 'true'); more.hidden = false; placeMore();
    if (kbd) try { more.querySelector('[role=menuitem]').focus({ preventScroll: true }); } catch {}
  }
  function placeMore() {
    const r = bar.getBoundingClientRect(), fr = more._from.getBoundingClientRect(), w = more.offsetWidth, h = more.offsetHeight, lim = limits();
    const x = Math.max(8, Math.min(innerWidth - w - 8, fr.right - w)); let y = r.top - h - 6;
    if (y < lim.top) y = r.bottom + 6;
    if (y + h > innerHeight - lim.bottom) y = Math.max(lim.top, innerHeight - lim.bottom - h);
    more.style.left = Math.round(x) + 'px'; more.style.top = Math.round(y) + 'px';
  }
  function moreClose(quiet) {
    if (!more || more.hidden) return; more.hidden = true; const f = more._from; more._from = null;
    if (f) { f.setAttribute('aria-expanded', 'false'); if (!quiet && f.isConnected && f.getClientRects().length) try { f.focus({ preventScroll: true }); } catch {} }
  }
  /* screen rectangle of page-area rects (a highlight / region) */
  function areaRect(pageId, rects) {
    const p = M.reader && M.reader.byId.get(pageId); if (!p || !p.pdf) return { left: innerWidth / 2, right: innerWidth / 2, top: innerHeight / 2, bottom: innerHeight / 2 };
    const q = p.pdf.getBoundingClientRect(), xs = rects.flatMap(r => [r[0], r[2]]), ys = rects.flatMap(r => [r[1], r[3]]);
    return { left: q.left + Math.min(...xs) * q.width, right: q.left + Math.max(...xs) * q.width, top: q.top + Math.min(...ys) * q.height, bottom: q.top + Math.max(...ys) * q.height };
  }
  /* room the floating parts must leave free: the header (+ the toolbar under it on wide screens, the page bar on phones)
     and, on phones, the drawing bar at the bottom */
  function limits() {
    const v = n => parseFloat(getComputedStyle(document.documentElement).getPropertyValue(n)) || 0;
    const hdr = document.body.classList.contains('medixa-focus') ? 0 : (v('--st-hdr-h') || 56), tb = v('--st-tb-h');
    return PHONE.matches ? { top: hdr + (v('--st-pbar') || 0) + 8, bottom: tb + 8 } : { top: hdr + tb + 8, bottom: 8 };
  }
  /* a press outside the page, the bar and our menus / panels dismisses the selection (inside the page the gestures above
     decide: a tap dismisses, a scroll or a pinch keeps it) */
  const OWN = '#st-seltools,#st-sel-more,.st-ta-panel,.st-ta-menu,.st-ta-pop,#st-ta-toast,.st-tsel-h';
  document.addEventListener('pointerdown', e => {
    if (synth) return;
    const t = e.target, inside = s => !!(t && t.closest && t.closest(s));
    if (!inside(OWN + ',#pages')) { if (ts) tsClear(); else if (bar && !bar.hidden) hide(); }
    if (menu && !menu.hidden && !inside('.st-ta-menu') && !(menu._from && menu._from.contains(t))) menuClose(true);
    if (more && !more.hidden && !inside('#st-sel-more') && !(more._from && more._from.contains(t))) moreClose(true);
    if (hp && !hp.hidden && !inside('#st-hlpop,.st-ta-menu')) hlClose(true);
  }, true);

  /* ---------- text actions: shared helpers ---------- */
  function shareText(text) {
    hide();
    if (navigator.share) { navigator.share({ text }).catch(() => {}); return; }
    copyText(text);
  }
  /* external pages open in a new tab through a real link (window.open with noopener returns null, which looks like a
     blocked popup); the reader itself never navigates away */
  function openExternal(u) { const a = el('a'); a.href = u; a.target = '_blank'; a.rel = 'noopener noreferrer'; document.body.append(a); a.click(); a.remove(); }
  const gtUrl = (text, to) => 'https://translate.google.com/?sl=auto&tl=' + to + '&op=translate&text=' + encodeURIComponent(text.slice(0, 4500));
  const loginHref = () => 'login.html?next=' + encodeURIComponent((location.pathname.split('/').pop() || 'pdf-notes.html') + location.search);
  /* same rule as the server (functions/_lib/ai.js detectLang): Arabic when more than 30 % of the letters are Arabic */
  function langOf(s) { const l = String(s).match(/\p{L}/gu) || []; return l.length && l.filter(c => /\p{Script=Arabic}/u.test(c)).length / l.length > 0.3 ? 'ar' : 'en'; }
  /* first MAX characters, ending on a word when one ends near the cut */
  function cut(s) { if (s.length <= MAX) return s; const t = s.slice(0, MAX), i = t.lastIndexOf(' '); return i > MAX - 200 ? t.slice(0, i) : t; }

  async function copyText(t, done) {
    let ok = false; const back = document.activeElement;
    try { if (navigator.clipboard && window.isSecureContext) { await navigator.clipboard.writeText(t); ok = true; } } catch {}
    if (!ok) {   /* older Safari / no permission: the classic hidden textarea */
      const ta = el('textarea', 'st-ta-clip'); ta.value = t; ta.setAttribute('readonly', ''); ta.setAttribute('aria-hidden', 'true'); document.body.append(ta); ta.select();
      try { ok = document.execCommand('copy'); } catch {} ta.remove(); if (back && back.focus) try { back.focus({ preventScroll: true }); } catch {}
    }
    toast(ok ? (done || 'نُسخ النص') : 'تعذّر النسخ. حدّد النص وانسخه يدوياً.');
    return ok;
  }
  let toastEl = null, toastT = 0;
  function toast(t, action) {
    if (!toastEl) { toastEl = el('div'); toastEl.id = 'st-ta-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); toastEl.hidden = true; document.body.append(toastEl); }
    toastEl.replaceChildren(el('span', '', t));
    if (action) { const b = el('button', 'st-ta-toast-b', action[0]); b.type = 'button'; b.onclick = () => { toastEl.hidden = true; action[1](); }; toastEl.append(b); }
    toastEl.hidden = false; clearTimeout(toastT); toastT = setTimeout(() => { toastEl.hidden = true; }, action ? 5000 : 2200);
  }

  /* ---------- MEDIXA AI service (functions/_lib/ai.js) ---------- */
  let aiP = null, ai = null;     /* GET api/ai/status: asked once per page load, and only after a press */
  const NONE = () => ({ translate: false, explain: false, signedIn: false });
  function aiStatus() {
    if (aiP) return aiP;
    aiP = fetch('api/ai/status', { credentials: 'same-origin', cache: 'no-store' })
      .then(r => r.status === 404 ? NONE() : r.ok ? r.json().then(j => j && typeof j === 'object' && 'translate' in j ? { translate: j.translate === true, explain: j.explain === true, signedIn: j.signedIn === true } : NONE(), NONE) : Promise.reject(r.status))
      .then(v => (ai = v), () => { aiP = null; return null; });   /* offline / server error: not cached, the next press asks again */
    return aiP;
  }
  /* the شرح button is hidden once the server said it has no AI (status explain:false is never about signing in) */
  const explainShown = () => !(ai && ai.explain === false);
  async function aiPost(P, task, body) {
    if (P.ctl) P.ctl.abort(); const ctl = P.ctl = new AbortController(), t = setTimeout(() => ctl.abort(), 45000);
    try {
      const r = await fetch('api/ai/' + task, { method: 'POST', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': 'application/json' }, body: JSON.stringify(body), signal: ctl.signal });
      let j = null; try { j = await r.json(); } catch {}
      return { status: r.status, j: j && typeof j === 'object' ? j : {} };
    } catch { return { status: 0, j: {} }; } finally { clearTimeout(t); if (P.ctl === ctl) P.ctl = null; }
  }
  /* one honest message per failure; again(first2000) repeats the request */
  function failure(P, r, again, first2000, extra) {
    const tx = P.kind === 'tx', s = r.status, e = r.j.error;
    if (s === 401) { if (ai) ai.signedIn = false; return { msg: tx ? 'سجّل الدخول لاستعمال الترجمة داخل MEDIXA.' : 'سجّل الدخول لاستعمال الشرح داخل MEDIXA.', acts: [loginLink(P), ...extra] }; }
    if (s === 503) { if (ai) ai.translate = ai.explain = false; return { msg: tx ? 'الترجمة الآلية غير مفعّلة على الموقع بعد.' : 'الشرح الآلي غير مفعّل على الموقع بعد.', acts: extra }; }
    if (s === 413) return { msg: 'النص المحدد أطول من حدّ الخدمة (2000 حرف في كل مرة).', acts: first2000 ? extra : [btn(P.pre + '-more', tx ? 'ترجم أول 2000 حرف فقط' : 'اشرح أول 2000 حرف فقط', () => again(true), true), ...extra] };
    if (s === 429) return { msg: 'كثرت الطلبات، حاول بعد دقائق.', acts: extra };
    if (s === 400 && e === 'empty') return { msg: 'لا يوجد في التحديد نص يمكن إرساله.', acts: extra };
    if (s === 502 && r.j.reason === 'quota') return { msg: 'انتهت حصة الخدمة لهذا اليوم على الموقع. حاول غداً.', acts: extra };
    return { msg: tx ? 'تعذّرت الترجمة الآن.' : 'تعذّر الشرح الآن.', acts: [btn(P.pre + '-retry', 'إعادة المحاولة', () => again(first2000), true), ...extra] };
  }

  /* ---------- panels (#st-tx, #st-explain): non-modal dialogs inside the viewport; bottom sheets on phones ---------- */
  function btn(id, text, fn, primary) { const b = el('button', 'st-ta-btn' + (primary ? ' st-ta-primary' : ''), text); b.type = 'button'; if (id) b.id = id; b.onmousedown = e => e.preventDefault(); b.onclick = fn; return b; }
  function loginLink(P) { const a = el('a', 'st-ta-btn st-ta-primary', 'تسجيل الدخول'); a.id = P.pre + '-login'; a.href = loginHref(); return a; }
  function seg(label, key, opts, val, onPick) {
    const g = el('div', 'st-ta-seg'); g.setAttribute('role', 'group'); g.setAttribute('aria-label', label);
    for (const [v, t] of opts) {
      const b = el('button', 'st-ta-chip', t); b.type = 'button'; b.dataset[key] = v; b.setAttribute('aria-pressed', String(v === val)); b.onmousedown = e => e.preventDefault();
      b.onclick = () => { if (b.getAttribute('aria-pressed') === 'true') return; g.querySelectorAll('button').forEach(x => x.setAttribute('aria-pressed', String(x === b))); onPick(v); }; g.append(b);
    }
    return g;
  }
  function panel(P, title) {
    let d = $(P.id);
    if (!d) {
      d = el('div', 'st-ta-panel'); d.id = P.id; d.dir = 'rtl'; d.hidden = true; d.tabIndex = -1; d.setAttribute('role', 'dialog'); d.setAttribute('aria-labelledby', P.pre + '-t');
      document.body.append(d);
    }
    const head = el('div', 'st-ta-head'), h = el('h2', 'st-ta-title', title); h.id = P.pre + '-t';
    const x = el('button', 'st-ta-x'); x.type = 'button'; x.innerHTML = svg(ICON.x); x.setAttribute('aria-label', 'إغلاق ' + title); x.title = 'إغلاق'; x.onclick = () => closePanel(P);
    head.append(h, x); d.replaceChildren(head); P.el = d; return d;
  }
  /* «نطق»: يقرأ النص أو الترجمة بصوت الجهاز عند الضغط فقط. lang: 'ar' أو 'en' */
  function speak(text, lang) {
    const t = String(text || '').trim().slice(0, 2000), code = lang === 'ar' ? 'ar' : 'en';
    if (!t) return;
    try {
      const sy = window.speechSynthesis; if (!sy || !window.SpeechSynthesisUtterance) return;
      sy.cancel();
      const u = new SpeechSynthesisUtterance(t);
      u.lang = code === 'ar' ? 'ar-SA' : 'en-US'; u.rate = 0.8;
      sy.speak(u);
    } catch {}
  }
  function quoteView(text) { const q = el('p', 'st-ta-quote', text.length > 240 ? text.slice(0, 240) + '…' : text); q.dir = 'auto'; return q; }
  function slots(P, d) {
    P.msg = el('p', 'st-ta-msg'); P.msg.id = P.pre + '-msg'; P.msg.setAttribute('role', 'status'); P.msg.setAttribute('aria-live', 'polite');
    P.out = el('div', 'st-ta-out'); P.out.id = P.pre + '-out'; P.out.dir = 'auto'; P.out.hidden = true;
    P.acts = el('div', 'st-ta-acts'); P.acts.id = P.pre + '-acts'; d.append(P.msg, P.out, P.acts);
  }
  function render(P, s) {
    P.msg.textContent = s.msg || ''; P.msg.classList.toggle('st-ta-busy', !!s.busy); P.el.setAttribute('aria-busy', String(!!s.busy));
    P.out.hidden = !s.out; P.out.textContent = s.out || '';
    P.acts.replaceChildren(...(s.acts || []));
    if (P.go) P.go.disabled = !!s.busy;
    placeAgain(P.el);
  }
  const panels = [];
  function openPanel(P, from, a) {
    for (const o of panels) if (o !== P) closePanel(o, true);
    menuClose(true); hlClose(true);
    const d = P.el, was = !d.hidden; d.hidden = false;
    if (!was || (from && from.isConnected)) d._from = from && from.isConnected ? from : (document.activeElement !== document.body ? document.activeElement : null);
    const r = areaRect(a.pageId, a.rects);   /* from the page rects, so a scroll since the selection does not matter */
    d._rect = bar && !bar.hidden ? union(r, bar.getBoundingClientRect()) : r; place(d, d._rect);
    try { d.focus({ preventScroll: true }); } catch { d.focus(); }
  }
  function closePanel(P, quiet) {
    P.tok++; if (P.ctl) { P.ctl.abort(); P.ctl = null; }
    const d = P.el; if (!d || d.hidden) return; d.hidden = true; const f = d._from; d._from = null;
    if (!quiet && f && f.isConnected && f.getClientRects().length && f.closest && !f.closest('[hidden]')) try { f.focus({ preventScroll: true }); } catch {}
  }
  const union = (a, b) => ({ left: Math.min(a.left, b.left), right: Math.max(a.right, b.right), top: Math.min(a.top, b.top), bottom: Math.max(a.bottom, b.bottom) });
  /* beside the anchor (below, else above), clamped to the viewport; phones: CSS bottom sheet, so no inline position */
  function place(d, r) {
    if (PHONE.matches || !r) { d.style.left = d.style.top = ''; return; }
    const w = d.offsetWidth, h = d.offsetHeight, lim = limits();
    const x = Math.max(8, Math.min(innerWidth - w - 8, (r.left + r.right) / 2 - w / 2));
    let y = r.bottom + 10; if (y + h > innerHeight - lim.bottom) y = r.top - h - 10;
    if (y < lim.top) y = Math.max(8, Math.min(lim.top, innerHeight - lim.bottom - h));
    d.style.left = x + 'px'; d.style.top = y + 'px';
  }
  /* content changed (a result came in): stay put while the card still fits, so it does not jump under the student's eyes */
  function placeAgain(d) {
    if (!d || d.hidden) return; const top = parseFloat(d.style.top);
    if (!PHONE.matches && top >= 0 && top + d.offsetHeight <= innerHeight - limits().bottom) return;
    place(d, d._rect);
  }
  const placeAll = () => { for (const P of panels) if (P.el && !P.el.hidden) place(P.el, P.el._rect); };
  addEventListener('resize', () => { placeAll(); if (hp && !hp.hidden) hlPlace(); if (menu && !menu.hidden && menu._from) place(menu, menu._from.getBoundingClientRect()); });
  PHONE.addEventListener && PHONE.addEventListener('change', placeAll);

  /* ----- ترجمة ----- */
  const TX = { id: 'st-tx', pre: 'st-tx', kind: 'tx', tok: 0, ctl: null, a: null, to: 'ar' }; panels.push(TX);
  function openTranslate(a, from) {
    TX.a = a; TX.to = langOf(textOf(a)) === 'ar' ? 'en' : 'ar';
    const d = panel(TX, 'ترجمة');
    d.append(quoteView(textOf(a)), btn('st-tx-speak-src', 'نطق النص', () => speak(textOf(a), langOf(textOf(a)))), seg('اتجاه الترجمة', 'to', [['ar', 'إلى العربية'], ['en', 'إلى الإنجليزية']], TX.to, v => { TX.to = v; runTranslate(false); }));
    slots(TX, d);
    TX.note = el('p', 'st-ta-note', 'يُرسل النص المحدد فقط إلى خدمة الترجمة في MEDIXA.'); TX.gnote = el('p', 'st-ta-note', 'زر Google يفتح موقع Google في تبويب جديد ويرسل إليه النص المحدد.'); TX.gnote.hidden = true;
    d.append(TX.note, TX.gnote);
    openPanel(TX, from, a); runTranslate(false);
  }
  async function runTranslate(first2000) {
    const P = TX, tok = ++P.tok, text = textOf(P.a);
    if (P.ctl) { P.ctl.abort(); P.ctl = null; }
    const google = () => btn('st-tx-google', 'افتح في Google Translate', () => openExternal(gtUrl(text, P.to)));
    const show_ = s => { if (tok !== P.tok) return; P.gnote.hidden = !(s.acts || []).some(b => b.id === 'st-tx-google'); render(P, s); };
    show_({ busy: true, msg: 'جارٍ التحقق من خدمة الترجمة…' });
    const sv = await aiStatus(); if (tok !== P.tok) return;
    if (!sv) return show_({ msg: 'تعذّر الاتصال بخادم MEDIXA الآن. تحقّق من الإنترنت ثم أعد المحاولة.', acts: [btn('st-tx-retry', 'إعادة المحاولة', () => runTranslate(first2000), true), google()] });
    if (!sv.translate) return show_({ msg: 'الترجمة الآلية غير مفعّلة على الموقع بعد.', acts: [google()] });
    if (!sv.signedIn) return show_({ msg: 'سجّل الدخول لاستعمال الترجمة داخل MEDIXA.', acts: [loginLink(P), google()] });
    if (text.length > MAX && !first2000) return show_({ msg: 'النص المحدد طويل (' + text.length + ' حرفاً)، والخدمة تترجم 2000 حرف في كل مرة.', acts: [btn('st-tx-more', 'ترجم أول 2000 حرف فقط', () => runTranslate(true), true)] });
    show_({ busy: true, msg: 'جارٍ الترجمة…' });
    const r = await aiPost(P, 'translate', { text: cut(text), to: P.to }); if (tok !== P.tok) return;
    const out = r.status === 200 && r.j.ok === true && typeof r.j.text === 'string' ? r.j.text.trim() : '';
    if (out) return show_({ msg: 'ترجمة آلية ' + ((r.j.to || P.to) === 'en' ? 'إلى الإنجليزية' : 'إلى العربية') + (first2000 ? ' لأول 2000 حرف' : '') + '؛ راجعها مع المحاضرة.', out, acts: [btn('st-tx-speak', 'نطق الترجمة', () => speak(out, (r.j.to || P.to) === 'en' ? 'en' : 'ar')), btn('st-tx-copy', 'نسخ الترجمة', () => copyText(out, 'نُسخت الترجمة'))] });
    const f = failure(P, r, runTranslate, first2000, []);
    if (r.status === 401 || r.status === 503 || r.status === 0 || r.status >= 500) f.acts.push(google());
    show_(f);
  }

  /* ----- شرح ----- */
  const EX = { id: 'st-explain', pre: 'st-ex', kind: 'ex', tok: 0, ctl: null, a: null, mode: 'short', go: null }; panels.push(EX);
  function openExplain(a, from) {
    EX.a = a; const d = panel(EX, 'شرح');
    const row = el('div', 'st-ta-row');
    EX.go = btn('st-ex-go', 'اشرح', () => runExplain(false), true);
    row.append(seg('طول الشرح', 'mode', [['short', 'مختصر'], ['detailed', 'مفصّل']], EX.mode, v => { EX.mode = v; }), EX.go);
    d.append(quoteView(textOf(a)), row); slots(EX, d);
    d.append(el('p', 'st-ta-note', 'الشرح آلي وقد يخطئ؛ راجع المحاضرة.'), el('p', 'st-ta-note', 'يُرسل النص المحدد فقط.'));
    /* nothing is sent before «اشرح»; a status already known this page load is said straight away */
    render(EX, ai && !ai.explain ? { msg: 'الشرح الآلي غير مفعّل على الموقع بعد.' } : ai && !ai.signedIn ? { msg: 'سجّل الدخول لاستعمال الشرح داخل MEDIXA.', acts: [loginLink(EX)] } : {});
    openPanel(EX, from, a);
  }
  async function runExplain(first2000) {
    const P = EX, tok = ++P.tok, text = textOf(P.a), mode = P.mode;
    if (P.ctl) { P.ctl.abort(); P.ctl = null; }
    const show_ = s => { if (tok === P.tok) render(P, s); };
    show_({ busy: true, msg: 'جارٍ التحقق من خدمة الشرح…' });
    const sv = await aiStatus(); if (tok !== P.tok) return;
    if (!sv) return show_({ msg: 'تعذّر الاتصال بخادم MEDIXA الآن. تحقّق من الإنترنت ثم أعد المحاولة.', acts: [btn('st-ex-retry', 'إعادة المحاولة', () => runExplain(first2000), true)] });
    if (!sv.explain) return show_({ msg: 'الشرح الآلي غير مفعّل على الموقع بعد.' });
    if (!sv.signedIn) return show_({ msg: 'سجّل الدخول لاستعمال الشرح داخل MEDIXA.', acts: [loginLink(P)] });
    if (text.length > MAX && !first2000) return show_({ msg: 'النص المحدد طويل (' + text.length + ' حرفاً)، والخدمة تشرح 2000 حرف في كل مرة.', acts: [btn('st-ex-more', 'اشرح أول 2000 حرف فقط', () => runExplain(true), true)] });
    show_({ busy: true, msg: mode === 'detailed' ? 'جارٍ إعداد شرح مفصّل…' : 'جارٍ إعداد شرح مختصر…' });
    const r = await aiPost(P, 'explain', { text: cut(text), mode }); if (tok !== P.tok) return;
    const out = r.status === 200 && r.j.ok === true && typeof r.j.text === 'string' ? r.j.text.trim() : '';
    if (out) return show_({ msg: ((r.j.mode || mode) === 'detailed' ? 'شرح مفصّل' : 'شرح مختصر') + (first2000 ? ' لأول 2000 حرف' : '') + ':', out, acts: [btn('st-ex-copy', 'نسخ', () => copyText(out, 'نُسخ الشرح'))] });
    show_(failure(P, r, runExplain, first2000, []));
  }

  /* ----- بحث: in this file (the find card) or on the web ----- */
  let menu = null;
  function menuToggle(a, from) {
    if (menu && !menu.hidden && menu._from === from) return menuClose();
    if (!menu) {
      menu = el('div', 'st-ta-menu'); menu.id = 'st-ta-findmenu'; menu.dir = 'rtl'; menu.hidden = true; menu.setAttribute('role', 'menu'); menu.setAttribute('aria-label', 'بحث عن النص المحدد');
      menu.addEventListener('keydown', e => {
        const list = [...menu.querySelectorAll('[role=menuitem]')], i = list.indexOf(document.activeElement);
        if (e.key === 'ArrowDown' || e.key === 'ArrowUp') { e.preventDefault(); list[(i + (e.key === 'ArrowDown' ? 1 : -1) + list.length) % list.length].focus(); }
        else if (e.key === 'Tab') menuClose(true);
      });
      document.body.append(menu);
    }
    const q = textOf(a), item = (id, icon, text, fn) => { const b = el('button', 'st-ta-mi'); b.type = 'button'; b.id = id; b.setAttribute('role', 'menuitem'); b.innerHTML = svg(ICON[icon]); b.append(el('span', '', text)); b.onmousedown = e => e.preventDefault(); b.onclick = fn; return b; };
    const note = el('p', 'st-ta-note', 'بحث الإنترنت يفتح Google في تبويب جديد بالنص المحدد.'); note.setAttribute('role', 'presentation');
    menu.replaceChildren(
      item('st-ta-find-file', 'doc', 'بحث في الملف', () => { menuClose(true); tsClear(); hide(); hlClose(true); findInFile(q); }),
      item('st-ta-find-web', 'web', 'بحث في الإنترنت', () => { menuClose(); openExternal('https://www.google.com/search?q=' + encodeURIComponent(q.slice(0, 300))); }),
      note);
    if (menu._from && menu._from !== from) menu._from.setAttribute('aria-expanded', 'false');
    menu._from = from; from.setAttribute('aria-expanded', 'true'); menu.hidden = false; place(menu, from.getBoundingClientRect());
    try { menu.querySelector('[role=menuitem]').focus({ preventScroll: true }); } catch {}
  }
  function menuClose(quiet) {
    if (!menu || menu.hidden) return; menu.hidden = true; const f = menu._from; menu._from = null;
    if (f) { f.setAttribute('aria-expanded', 'false'); if (!quiet && f.isConnected && f.getClientRects().length) try { f.focus({ preventScroll: true }); } catch {} }
  }
  /* the find card searches the PDF's own text; a long quote is cut to <= 80 characters, on a word when possible */
  function findInFile(q) {
    const F = M.search || window.MedixaSearch; if (!F || !F.open) { M.banner('البحث في الملف غير متاح الآن.', [['حسناً', () => {}]]); return; }
    let s = q.replace(/\s+/g, ' ').trim(); if (s.length > 80) { const t = s.slice(0, 80), i = t.lastIndexOf(' '); s = i >= 40 ? t.slice(0, i) : t; }
    F.open(s);
  }

  /* ---------- a saved text highlight: tap it (select / hand tools) for colour, strength, delete and its text actions ---------- */
  function pageAt(x, y) {
    const R = M.reader; if (!R) return null;
    for (const p of R.pages) { if (p.kind !== 'src' || !p.pdf) continue; const q = p.pdf.getBoundingClientRect(); if (x >= q.left && x <= q.right && y >= q.top && y <= q.bottom) return { p, q }; }
    return null;
  }
  function hlAt(x, y) {
    const at = pageAt(x, y); if (!at) return null; const { p, q } = at; if (q.width < 2) return null;
    const u = (x - q.left) / q.width, v = (y - q.top) / q.height, pu = 3 / q.width, pv = 3 / q.height;
    for (let i = S.items.length - 1; i >= 0; i--) {   /* the topmost wins */
      const s = S.items[i]; if (!s || s.tool !== 'texthl' || s.page !== p.id || !Array.isArray(s.rects)) continue;
      if (s.rects.some(r => u >= r[0] - pu && u <= r[2] + pu && v >= r[1] - pv && v <= r[3] + pv)) return s;
    }
    return null;
  }
  const itemById = id => S.items.find(x => x && x.id === id);
  /* one undoable step, the same edit op as studio-tools.js (absent fields recorded as null so undo removes them again) */
  function editHl(id, props) {
    const i = S.items.findIndex(x => x && x.id === id); if (i < 0) return false;
    const s = S.items[i], p = {}; for (const k of Object.keys(props)) if (s[k] !== props[k]) p[k] = props[k];
    if (!Object.keys(p).length) return false; p.rev = (s.rev || 1) + 1;
    const before = {}; for (const k of Object.keys(p)) before[k] = s[k] === undefined ? null : s[k];
    const n = Object.assign({}, s, p); if (!C.validStroke(n)) return false;
    S.items[i] = n; M.rebuildIndexPage(s.page); M.invalidate(s.page); M.commit([{ k: 'edit', id, before, after: p }]); return true;
  }
  let hp = null, hpId = null, hpOrig = null;
  const opOf = s => (typeof s.op === 'number' ? s.op : 0.35);
  function hlOpen(s) {
    hlClose(true); menuClose(true);
    if (!hp) {
      hp = el('div', 'st-ta-pop'); hp.id = 'st-hlpop'; hp.dir = 'rtl'; hp.hidden = true; hp.tabIndex = -1; hp.setAttribute('role', 'dialog'); hp.setAttribute('aria-labelledby', 'st-hlpop-t');
      document.body.append(hp);
    }
    hpId = s.id; hpOrig = null; hp.replaceChildren();
    const head = el('div', 'st-ta-head'), h = el('h2', 'st-ta-title', 'تظليل محفوظ'); h.id = 'st-hlpop-t';
    const x = el('button', 'st-ta-x'); x.type = 'button'; x.innerHTML = svg(ICON.x); x.setAttribute('aria-label', 'إغلاق'); x.title = 'إغلاق'; x.onclick = () => hlClose();
    head.append(h, x);
    const sw = el('div', 'st-hp-colors'); sw.setAttribute('role', 'group'); sw.setAttribute('aria-label', 'لون التظليل');
    for (const [c, n] of HL) { const b = el('button', 'st-hp-sw'); b.type = 'button'; b.dataset.color = c; b.style.setProperty('--c', c); b.setAttribute('aria-label', 'لون ' + n); b.title = n; b.onclick = () => { editHl(hpId, { color: c }); }; sw.append(b); }
    const lab = el('label', 'st-hp-op'), range = el('input'), outv = el('output', 'st-hp-opv');
    lab.append(el('span', '', 'شدة التظليل')); range.type = 'range'; range.id = 'st-hp-op'; range.min = '0.1'; range.max = '0.9'; range.step = '0.05'; outv.id = 'st-hp-opv'; outv.setAttribute('for', 'st-hp-op');
    range.oninput = () => {   /* live preview while dragging; the release is one undo step */
      const i = S.items.findIndex(q => q && q.id === hpId); if (i < 0) return; if (!hpOrig) hpOrig = S.items[i];
      const v = Math.round(+range.value * 100) / 100; S.items[i] = Object.assign({}, hpOrig, { op: v }); M.invalidate(hpOrig.page); outv.textContent = Math.round(v * 100) + '%';
    };
    range.onchange = () => { const v = Math.round(+range.value * 100) / 100; restorePreview(); editHl(hpId, { op: v }); };
    lab.append(range, outv);
    const acts = el('div', 'st-hp-acts'), q = (s.quote || '').trim();
    const anchor = () => { const it = itemById(hpId); return it && { pageId: it.page, rects: it.rects, quote: it.quote || '', text: it.quote || '', kind: 'text', saved: true }; };
    if (q) {
      actBtn(acts, 'st-hp-tr', 'ترجمة نص التظليل', 'ترجمة', () => { const a = anchor(); if (a) openTranslate(a, null); }, 'tr').id = 'st-hp-tr';
      if (explainShown()) actBtn(acts, 'st-hp-ex', 'شرح نص التظليل', 'شرح', () => { const a = anchor(); if (a) openExplain(a, null); }, 'ex').id = 'st-hp-ex';
      const f = actBtn(acts, 'st-hp-find', 'بحث عن نص التظليل', 'بحث', b => { const a = anchor(); if (a) menuToggle(a, b); }, 'find'); f.id = 'st-hp-find'; f.setAttribute('aria-haspopup', 'menu'); f.setAttribute('aria-expanded', 'false');
    }
    actBtn(acts, 'st-hp-del', 'حذف التظليل', 'حذف', () => { const id = hpId; hlClose(true); const ops = M.removeItems([id]); if (ops.length) { M.commit(ops); toast('حُذف التظليل.', ['تراجع', () => M.undo()]); } }, 'del').id = 'st-hp-del';
    hp.append(head, sw, lab, acts);
    hlSync(); hp.hidden = false; hp._from = document.activeElement !== document.body ? document.activeElement : null; hlPlace();
    try { hp.focus({ preventScroll: true }); } catch {}
  }
  function hlSync() {
    if (!hp || !hpId) return; const s = itemById(hpId); if (!s) return hlClose(true);
    hp.querySelectorAll('.st-hp-sw').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === s.color)));
    const v = opOf(s), r = $('st-hp-op'), o = $('st-hp-opv'); if (r && !hpOrig) r.value = String(v); if (o && !hpOrig) o.textContent = Math.round(v * 100) + '%';
  }
  function hlPlace() {
    const s = itemById(hpId); if (!s || !hp) return; const r = areaRect(s.page, s.rects);
    if (!PHONE.matches && (r.bottom < 0 || r.top > innerHeight)) return hlClose(true);   /* scrolled away */
    hp._rect = r; place(hp, r);
  }
  function restorePreview() { if (!hpOrig) return; const i = S.items.findIndex(q => q && q.id === hpOrig.id); if (i >= 0) S.items[i] = hpOrig; M.invalidate(hpOrig.page); hpOrig = null; }
  function hlClose(quiet) {
    if (!hp || hp.hidden) return; restorePreview(); hp.hidden = true; hpId = null; menuClose(true);
    const f = hp._from; hp._from = null; if (!quiet && f && f.isConnected && f.getClientRects().length) try { f.focus({ preventScroll: true }); } catch {}
  }
  M.on('change', hlSync); M.on('select-refresh', hlSync);
  let scrollRaf = 0;
  /* the popover (not on phones: a bottom sheet) and the selection bar follow the page while it scrolls */
  addEventListener('scroll', () => {
    const pop = hp && !hp.hidden && !PHONE.matches, sb = bar && !bar.hidden;
    if ((!pop && !sb) || scrollRaf) return;
    scrollRaf = requestAnimationFrame(() => { scrollRaf = 0; if (hp && !hp.hidden && !PHONE.matches) hlPlace(); placeBar(); });
  }, { passive: true, capture: true });
  addEventListener('resize', () => requestAnimationFrame(placeBar));

  /* Escape closes the topmost of ours (menu, highlight popover, panel, then the action bar) and gives focus back */
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const t = e.target, mine = t === document.body || t === document.documentElement || !!(t && t.closest && t.closest(OWN));
    if (!mine) return;
    if (menu && !menu.hidden) menuClose();
    else if (more && !more.hidden) moreClose();
    else if (hp && !hp.hidden) hlClose();
    else { const P = panels.find(x => x.el && !x.el.hidden && (x.el.contains(t) || !panels.some(y => y.el && !y.el.hidden && y.el.contains(t)))); if (P) closePanel(P); else if (ts) { tsClear(); return; } else if (bar && !bar.hidden) { hide(); return; } else return; }
    e.preventDefault(); e.stopPropagation();
  }, true);

  /* ---------- actions ---------- */
  /* saved exactly as before (medixa.pdf.annotations.v1 'texthl': rects per line in page fractions + quote [+ mark]);
     a highlight now also keeps the highlighter's own strength (op), so it looks like the student's marker */
  function highlight(a, color, mark) {
    if (!a || !Array.isArray(a.rects)) return;
    const rects = a.rects.map(r => r.map(n => +C.clamp01(n).toFixed(5))).filter(r => r[2] > r[0] && r[3] > r[1]).slice(0, 60); if (!rects.length) return;
    const xs = rects.flatMap(r => [r[0], r[2]]), ys = rects.flatMap(r => [r[1], r[3]]);
    const s = { id: C.newId(), v: 2, rev: 1, page: a.pageId, tool: 'texthl', color, width: 3, points: [[Math.min(...xs), Math.min(...ys)], [Math.max(...xs), Math.max(...ys)]], rects, quote: String(a.quote || '').slice(0, 600) };
    if (mark === 'underline' || mark === 'strike') s.mark = mark;
    else { const st = M.style && M.style('highlight'); if (st && typeof st.op === 'number' && st.op >= 0.02 && st.op <= 1) s.op = Math.round(st.op * 100) / 100; }
    M.commit([M.addItem(s)]); tsClear(); hide();
  }
  function mask(a) {
    const api = window.medixaOcclusion; if (!api) { M.banner('أداة الأقنعة غير جاهزة بعد. أعد المحاولة بعد لحظات.', [['حسناً', () => {}]]); return; }
    let n = 0, bad = 0; for (const r of a.rects.slice(0, 8)) { const pad = 0.004, x = Math.max(0, r[0] - pad), y = Math.max(0, r[1] - pad), w = Math.min(1 - x, r[2] - r[0] + 2 * pad), h = Math.min(1 - y, r[3] - r[1] + 2 * pad); if (api.add({ page: a.pageId, x, y, w, h })) n++; else bad++; }
    tsClear(); hide();
    M.banner(n ? 'أُضيف ' + n + ' قناع دراسة. اضغط على القناع لكشفه، أو Alt + نقر للحذف. (القناع للتدريب فقط وليس حجباً آمناً للمحتوى.)' : 'تعذر حفظ القناع (راجع حالة الحفظ).', [['حسناً', () => {}]]);
  }

  /* ---------- draft dialog (card / question) ---------- */
  const DKEY = 'medixa.studio.draft.v1:' + docId;
  const saveDraftState = d => { try { sessionStorage.setItem(DKEY, JSON.stringify(d)); } catch {} };
  const clearDraftState = () => { try { sessionStorage.removeItem(DKEY); } catch {} };
  function draft(kind, a, restore) {
    hide(); const old = $('st-draft'); if (old) old.remove();
    const d = el('dialog', 'st-dlg st-draft'); d.id = 'st-draft'; d.setAttribute('aria-labelledby', 'st-draft-t');
    const h = el('h2', '', kind === 'card' ? 'بطاقة مراجعة جديدة' : 'سؤال اختيار من متعدد'); h.id = 'st-draft-t'; d.append(h);
    const cite = el('p', 'st-cite'); cite.append(el('strong', '', 'المصدر: '), document.createTextNode(a.pageId >= C.BLANK_ID0 ? 'صفحة فارغة' : 'صفحة ' + a.pageId)); if (a.quote) cite.append(document.createTextNode(' — «' + a.quote.slice(0, 160) + (a.quote.length > 160 ? '…' : '') + '»')); else cite.append(document.createTextNode(' — منطقة من الصورة'));
    d.append(cite);
    const field = (id, label, tag, val, rows) => { const l = el('label', 'st-field'); l.append(label); const i = document.createElement(tag); i.id = id; if (rows) i.rows = rows; i.maxLength = 2000; i.value = val || ''; i.dir = 'auto'; l.append(i); d.append(l); return i; };
    const R = restore || {}; let f;
    if (kind === 'card') {
      f = { q: field('st-d-q', 'الأمام (السؤال)', 'textarea', R.q, 3), a: field('st-d-a', 'الخلف (الإجابة)', 'textarea', R.a !== undefined ? R.a : a.quote, 3) };
      if (a.quote && window.MedixaTextCards) { const cz = el('button', 'st-btn', 'املأ بنمط الحذف (Cloze)'); cz.type = 'button'; cz.id = 'st-d-cloze'; cz.onclick = () => { const c = MedixaTextCards.cloze(a.quote); if (c) { f.q.value = c.question; f.a.value = c.answer; touch(); } else err('لا توجد كلمة طويلة تكفي لنمط الحذف في هذا النص.'); }; d.append(cz); }
    } else {
      f = { q: field('st-d-q', 'نص السؤال', 'textarea', R.q, 3), opts: [], x: null };
      const fs = el('fieldset', 'st-opts-set'); fs.append(el('legend', '', 'الخيارات (اختر الصحيح)'));
      ['A', 'B', 'C', 'D'].forEach((L, i) => { const row = el('div', 'st-opt-row'); const rd = document.createElement('input'); rd.type = 'radio'; rd.name = 'st-correct'; rd.value = i; rd.id = 'st-d-c' + i; rd.setAttribute('aria-label', 'الخيار ' + L + ' هو الصحيح'); if (R.c === i) rd.checked = true; const t = document.createElement('input'); t.type = 'text'; t.id = 'st-d-o' + i; t.maxLength = 500; t.dir = 'auto'; t.placeholder = 'الخيار ' + L; t.value = (R.o && R.o[i]) || ''; t.setAttribute('aria-label', 'نص الخيار ' + L); row.append(rd, t); fs.append(row); f.opts.push({ rd, t }); });
      d.append(fs); f.x = field('st-d-x', 'الشرح (اختياري، يظهر بعد الإجابة)', 'textarea', R.x !== undefined ? R.x : a.quote, 2);
      const ai = el('p', 'st-ai-note', 'توليد الأسئلة بالذكاء الاصطناعي غير متاح حالياً (لا خادم مُعَدّ له)، لذلك تكتب السؤال بنفسك. لا يُرسَل شيء من المحاضرة إلى أي جهة.'); ai.id = 'st-ai-note'; d.append(ai);
    }
    d.append(el('p', 'st-note-line', kind === 'card' ? 'تُحفظ البطاقة في مراجعتك الخاصة وتدخل جدول التكرار المتباعد.' : 'يُحفظ السؤال في اختباراتك الخاصة (للنشر العام يلزم مسار النشر المعتمد للمشرفين).'));
    const msg = el('p', 'st-err'); msg.setAttribute('role', 'alert'); msg.id = 'st-d-err'; d.append(msg);
    const err = t => { msg.textContent = t; };
    const row = el('div', 'st-cust-row'); const ok = el('button', 'st-btn st-ok', 'حفظ'); ok.type = 'button'; ok.id = 'st-d-save'; const no = el('button', 'st-btn', 'إلغاء'); no.type = 'button'; no.id = 'st-d-cancel'; row.append(ok, no); d.append(row);
    const state = () => kind === 'card' ? { kind, a, q: f.q.value, a2: f.a.value } : { kind, a, q: f.q.value, o: f.opts.map(x => x.t.value), c: f.opts.findIndex(x => x.rd.checked), x: f.x.value };
    function touch() { const s = state(); saveDraftState({ kind, anchor: stripBBox(a), fields: kind === 'card' ? { q: s.q, a: s.a2 } : { q: s.q, o: s.o, c: s.c, x: s.x } }); }
    d.addEventListener('input', touch); d.addEventListener('change', touch);
    no.onclick = () => { clearDraftState(); d.close(); };
    ok.onclick = () => {
      err(''); const page = a.pageId, source = sourceOf(a);
      if (kind === 'card') {
        const q = f.q.value.trim(), an = f.a.value.trim(); if (!q || !an) return err('اكتب الأمام والخلف قبل الحفظ.');
        const card = window.MedixaStudyStore && MedixaStudyStore.addCard({ question: q, answer: an, page, source }); if (!card) return err('تعذر حفظ البطاقة (راجع حالة الحفظ في الأعلى).');
        clearDraftState(); d.close(); M.banner('حُفظت البطاقة وأُضيفت إلى المراجعة.', [['فتح البطاقات', () => MedixaStudyStore.open('cards')], ['حسناً', () => {}]]);
      } else {
        const q = f.q.value.trim(), opts = f.opts.map(x => x.t.value.trim()), c = f.opts.findIndex(x => x.rd.checked);
        if (!q || q.length < 3) return err('اكتب نص السؤال.'); if (opts.some(o => !o)) return err('املأ الخيارات الأربعة.');
        if (new Set(opts.map(o => o.toLowerCase())).size !== 4) return err('الخيارات يجب أن تكون مختلفة.'); if (c < 0) return err('اختر خياراً واحداً صحيحاً.');
        const item = window.MedixaStudyStore && MedixaStudyStore.addQuiz({ question: q, options: opts, correct: c, page, explanation: f.x.value.trim(), source }); if (!item) return err('تعذر حفظ السؤال (راجع حالة الحفظ في الأعلى).');
        clearDraftState(); d.close(); M.banner('حُفظ السؤال في اختباراتك.', [['فتح الاختبارات', () => MedixaStudyStore.open('quiz')], ['حسناً', () => {}]]);
      }
    };
    document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal(); touch(); tsClear();
  }
  const stripBBox = a => ({ pageId: a.pageId, rects: a.rects, quote: a.quote, kind: a.kind });
  /* an unfinished draft survives a reload */
  M.on('init', () => { try { const v = JSON.parse(sessionStorage.getItem(DKEY) || 'null'); if (v && v.anchor && Array.isArray(v.anchor.rects)) setTimeout(() => M.banner('لديك مسودة ' + (v.kind === 'card' ? 'بطاقة' : 'سؤال') + ' غير محفوظة.', [['متابعة', () => draft(v.kind, v.anchor, v.fields ? (v.kind === 'card' ? { q: v.fields.q, a: v.fields.a } : v.fields) : null)], ['حذفها', clearDraftState]]), 1500); } catch {} });

  /* ---------- go back to the exact source ---------- */
  function flash(p, rects) {
    p.el.querySelectorAll('.st-src-flash').forEach(x => x.remove());
    rects.forEach(r => { const f = el('div', 'st-src-flash'); f.style.setProperty('--x', r[0]); f.style.setProperty('--y', r[1]); f.style.setProperty('--w', r[2] - r[0]); f.style.setProperty('--h', r[3] - r[1]); p.el.append(f); setTimeout(() => f.remove(), 2600); });
  }
  function openSource(source) {
    const R = M.reader, note = t => M.banner(t, [['حسناً', () => {}]]);
    if (!source || typeof source !== 'object') return note('لا يوجد مصدر محفوظ لهذا العنصر.');
    if (source.documentId && source.documentId !== docId) return note('هذا العنصر يخص ملفاً آخر. افتح ذلك الملف من علامات التبويب.');
    const p = R.byId.get(source.pageId), q = source.quote ? ' المقتطف المحفوظ: «' + source.quote.slice(0, 200) + '»' : '';
    if (!p) return note('الصفحة ' + source.pageId + ' لم تعد موجودة في هذا الملف، فغالباً حُدِّث ملف المحاضرة.' + q);
    R.goto(p.id);
    const rects = Array.isArray(source.rects) ? source.rects.filter(r => Array.isArray(r) && r.length === 4 && r.every(n => typeof n === 'number')) : [];
    setTimeout(() => { if (rects.length) flash(p, rects); }, 600);
    if (source.documentVersion && M.S.docHash && source.documentVersion !== M.S.docHash) note('تغيّر ملف المحاضرة منذ إنشاء هذا العنصر، لذلك قد لا يطابق الموضع تماماً.' + q);
  }
  /* add a "المنطقة" button next to the panel's own "المصدر" button for items that carry an anchor */
  function decorate() {
    const c = $('study-content'); if (!c || !window.MedixaStudyStore) return;
    c.querySelectorAll('.study-item').forEach(item => {
      if (item.querySelector('[data-st-src]')) return; const del = item.querySelector('[data-delete]'); if (!del) return;
      const [kind, idv] = del.dataset.delete.split(':'), it = MedixaStudyStore.find(kind, idv); if (!it || !it.source) return;
      const b = el('button', '', 'المنطقة'); b.type = 'button'; b.dataset.stSrc = kind + ':' + idv; b.title = 'افتح مكان المصدر في الصفحة'; b.onclick = e => { e.stopPropagation(); $('study-panel').classList.remove('open'); openSource(it.source); }; del.before(b);
    });
  }
  const sc = $('study-content'); if (sc) new MutationObserver(decorate).observe(sc, { childList: true });
  M.smart = { openSource, selectionAnchor, highlight, draft, show, hide, translate: openTranslate, explain: openExplain, copy: copyText, find: findInFile, highlightAt: hlAt, openHighlight: hlOpen, closeHighlight: hlClose, aiStatus };
  /* our text selection, for other modules and tests: get() -> {pageId, a, b, rects, text, quote, kind:'text', firstLine,
     lastLine} | null; set(pageId, a, b) by character index; selectWordAt(pageId, u, v) in page fractions; on('change' |
     'clear' | 'drag-start' | 'drag-end', fn) */
  M.textsel = {
    get: tsGet, clear: tsClear, set: (pageId, a, b) => { const ok = tsSet(pageId, a, b); if (ok) showSel(); return ok; },
    selectWordAt: wordSelect, load: loadModel, model: id => models.get(id) || null,
    hit: (pageId, u, v, loose) => { const m = models.get(pageId); return m ? caretAt(m, u, v, !!loose) : -1; },
    wordAt: (pageId, k) => { const m = models.get(pageId); return m && k >= 0 && k < m.N && !SPACE.test(m.ch[k]) ? wordAt(m, k) : null; },
    on: (n, f) => { (tsL[n] = tsL[n] || []).push(f); }
  };
})();
