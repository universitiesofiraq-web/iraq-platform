/* MEDIXA Study Studio — find in document. Searches the PDF's own text (pdf.js getTextContent), indexed lazily page by
   page in the background, and marks the matches over the page in page-area percentages (so zoom never moves them).
   Matching is forgiving: NFKC, case, soft hyphens/zero-width marks, spacing, and Arabic letter forms / harakat.
   No pointer listeners: drawing is never touched. Scans have no text, so nothing is guessed there. */
(function () {
  'use strict';
  const M = window.MedixaStudio; if (!M || window.MedixaSearch) return;
  const $ = id => document.getElementById(id);
  const el = (t, id, x) => { const e = document.createElement(t); if (id) e.id = id; if (x != null) e.textContent = x; return e; };
  const RD = () => M.reader;
  const T = {
    label: 'ابحث في الملف', none: 'لا نتائج', busy: 'جارٍ البحث… ', loading: 'جارٍ تحميل الملف…',
    scan: 'هذا الملف بلا نص قابل للبحث (ممسوح ضوئياً).', partial: 'بعض صفحات هذا الملف صور بلا نص (ممسوحة ضوئياً)، فلا يشملها البحث.', raster: 'البحث في النص غير متاح في وضع الصور.', notebook: 'هذا الدفتر بلا نص للبحث فيه.'
  };

  /* ---------- normalisation (one engine for the query and the page, so offsets map back exactly) ---------- */
  const AR = { 'أ': 'ا', 'إ': 'ا', 'آ': 'ا', 'ٱ': 'ا', 'ة': 'ه', 'ى': 'ي', 'ς': 'σ' };
  /* soft hyphen, zero-width / direction marks, harakat (064B–0652), superscript alef, tatweel */
  const drop = c => c === 0xad || (c >= 0x200b && c <= 0x200f) || c === 0x2060 || c === 0xfeff || (c >= 0x64b && c <= 0x652) || c === 0x670 || c === 0x640;
  const WS = /\s/, CLUSTER = /\P{M}\p{M}*|\p{M}+/gu;   /* a base letter with its marks normalises as one unit */
  /* Calls put(ch, a, b) for every output UTF-16 unit with the raw [a, b) it came from; whitespace collapses across
     calls through `sp` (was the last output a space). Returns the new `sp`. */
  function walk(s, put, sp) {
    CLUSTER.lastIndex = 0; let m;
    while ((m = CLUSTER.exec(s))) {
      const a = m.index, b = a + m[0].length;
      const c0 = m[0].charCodeAt(0), one = m[0].length === 1 && c0 < 128;   /* ASCII fast path: most of a lecture */
      for (const ch of one ? (c0 > 64 && c0 < 91 ? String.fromCharCode(c0 + 32) : m[0]) : m[0].normalize('NFKC').toLowerCase()) {
        if (drop(ch.codePointAt(0))) continue;
        if (WS.test(ch)) { if (!sp) { put(' ', a, b); sp = true; } continue; }
        const o = AR[ch] || ch; for (let k = 0; k < o.length; k++) put(o[k], a, b); sp = false;
      }
    }
    return sp;
  }
  function norm(s) { let out = ''; walk(String(s == null ? '' : s), ch => { out += ch; }, true); return out.replace(/ $/, ''); }

  /* ---------- page model: normalised text + where each character came from ---------- */
  /* Separator between two text items: a line end, another line, rotated text or a visible gap means two words;
     touching items on one baseline are one word that pdf.js split (font change, kerning). 0.1em mirrors pdf.js. */
  function gap(a, b) {
    const ta = a.transform, tb = b.transform; if (!ta || !tb) return true;
    if (Math.abs(ta[1]) > 1e-3 || Math.abs(ta[2]) > 1e-3 || Math.abs(tb[1]) > 1e-3 || Math.abs(tb[2]) > 1e-3) return true;
    const size = Math.max(1e-3, Math.abs(a.height || ta[3] || 0), Math.abs(b.height || tb[3] || 0));
    if (Math.abs(ta[5] - tb[5]) > size * 0.5) return true;
    return Math.max(tb[4] - (ta[4] + (a.width || 0)), ta[4] - (tb[4] + (b.width || 0))) > size * 0.1;
  }
  /* Non-empty items only: they are exactly the spans the text layer draws (pdf.js skips empty strings). */
  function segsOf(items) {
    const out = []; let prev = null, eol = false;
    for (const it of items) {
      if (typeof it.str !== 'string') continue;
      if (!it.str) { eol = eol || !!it.hasEOL; continue; }
      out.push({ str: it.str, sp: !!prev && (eol || gap(prev, it)), t: it.transform, w: it.width || 0, h: it.height || 0, dir: it.dir }); prev = it; eol = !!it.hasEOL;
    }
    return out;
  }
  /* The page's normalised text; with `map`, also where each character came from (segment, raw start/end). The map is
     only built for pages being marked (see mapFor), so a long book costs little memory. */
  function model(segs, map) {
    let s = ''; const seg = [], st = [], en = []; let sp = true;
    const put = map ? (ch, a, b, i) => { s += ch; seg.push(i); st.push(a); en.push(b); } : ch => { s += ch; };
    segs.forEach((g, i) => {
      if (g.sp && !sp) { put(' ', 0, 0, -1); sp = true; }
      sp = walk(g.str, (ch, a, b) => put(ch, a, b, i), sp);
    });
    return map ? { norm: s, seg: Int32Array.from(seg), st: Int32Array.from(st), en: Int32Array.from(en) } : { segs, norm: s };
  }
  const maps = new Map();   /* small LRU: page id -> character map */
  function mapFor(id, mdl) {
    let m = maps.get(id); if (m && m.src === mdl) { maps.delete(id); maps.set(id, m); return m; }
    m = model(mdl.segs, true); m.src = mdl; maps.set(id, m); if (maps.size > 8) maps.delete(maps.keys().next().value); return m;
  }
  function matches(text, q) { const out = []; if (!q) return out; for (let i = text.indexOf(q); i >= 0; i = text.indexOf(q, i + q.length)) out.push([i, i + q.length]); return out; }

  const cache = new Map();   /* page id -> Promise<model> (source page ids never change) */
  function indexPage(p) {
    if (cache.has(p.id)) return cache.get(p.id);
    const pr = (p.proxy && p.proxy.getTextContent ? p.proxy.getTextContent() : Promise.resolve({ items: [] }))
      .then(tc => model(segsOf(tc.items || [])))
      .catch(e => { console.warn('MEDIXA search: page text unavailable', p.id, e); cache.delete(p.id); return model([]); });
    cache.set(p.id, pr); return pr;
  }
  const tick = () => new Promise(r => setTimeout(r, 0));

  /* ---------- state ---------- */
  let card, input, count, msgEl, prevB, nextB, btn;
  let q = '', per = [], hits = [], cur = -1, busy = null, noText = false, textless = 0, findTok = 0, navTok = 0, primed = null, deb = 0;
  const posMap = () => new Map(RD().pages.map((p, i) => [p.id, i]));
  function reorder() {
    if (!RD()) return; const pos = posMap(), at = hits[cur];
    per = per.filter(x => pos.has(x.id)).sort((a, b) => pos.get(a.id) - pos.get(b.id));
    hits = per.flatMap(x => x.m.map((_, k) => ({ id: x.id, k })));
    cur = at ? hits.findIndex(h => h.id === at.id && h.k === at.k) : -1;
  }

  /* ---------- UI ---------- */
  const svg = d => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON = { up: '<path d="m6 15 6-6 6 6"/>', down: '<path d="m6 9 6 6 6-6"/>', x: '<path d="M6 6l12 12M18 6 6 18"/>', find: '<circle cx="11" cy="11" r="7"/><path d="m20 20-3.6-3.6"/>' };
  function mkBtn(id, label, icon) { const b = el('button', id); b.type = 'button'; b.innerHTML = svg(ICON[icon]); b.setAttribute('aria-label', label); b.title = label; return b; }
  function build() {
    if (card) return;
    card = el('div', 'st-find'); card.setAttribute('role', 'search'); card.setAttribute('aria-label', 'البحث في الملف'); card.dir = 'rtl'; card.hidden = true;
    input = el('input', 'st-find-q'); input.type = 'search'; input.dir = 'auto'; input.placeholder = T.label; input.setAttribute('aria-label', T.label);
    input.autocomplete = 'off'; input.spellcheck = false; input.maxLength = 200; input.setAttribute('enterkeyhint', 'search'); input.setAttribute('autocapitalize', 'off');
    count = el('span', 'st-find-n'); count.setAttribute('role', 'status'); count.setAttribute('aria-live', 'polite'); count.setAttribute('aria-atomic', 'true');
    prevB = mkBtn('st-find-prev', 'النتيجة السابقة', 'up'); nextB = mkBtn('st-find-next', 'النتيجة التالية', 'down');
    const x = mkBtn('st-find-x', 'إغلاق البحث', 'x');
    msgEl = el('p', 'st-find-msg');
    card.append(input, count, prevB, nextB, x, msgEl); document.body.append(card);
    prevB.onclick = () => prev(); nextB.onclick = () => next(); x.onclick = () => close();
    input.addEventListener('input', () => { clearTimeout(deb); deb = setTimeout(() => search(true), 300); });
    input.addEventListener('keydown', e => {
      if (e.key === 'Escape') { e.preventDefault(); e.stopPropagation(); close(); }
      else if (e.key === 'Enter' && !e.isComposing) {
        e.preventDefault(); clearTimeout(deb);
        if (norm(input.value) !== q || busy) search(true); else if (e.shiftKey) prev(); else next();
      }
    });
    ui();
  }
  /* A note about the document itself: image mode, notebook, a scan (instead of a count), or scanned pages that a
     search cannot see (beside the count, so a short result list is not mistaken for a complete one). */
  function note() {
    const R = RD(); if (!R || !(R.pages.length || R.notebook)) return '';
    if (R.notebook && !R.doc) return T.notebook; if (!R.doc) return T.raster; if (noText) return T.scan;
    return q && textless && !busy ? T.partial : '';
  }
  function ui() {
    if (!card) return; let t = '', ltr = false; const n = note();
    if (busy) t = busy; else if (n && n !== T.partial) t = ''; else if (q && !hits.length) t = T.none; else if (hits.length) { t = (cur >= 0 ? cur + 1 : '–') + ' / ' + hits.length; ltr = true; }
    count.textContent = t; count.dir = ltr ? 'ltr' : 'rtl'; if (msgEl.textContent !== n) msgEl.textContent = n;
    prevB.disabled = nextB.disabled = !hits.length;
  }
  function addButton() {
    if (btn) return true; let b = $('st-find-btn');
    if (!b) { const acts = $('studio-hdr-actions'); if (!acts) return false; b = el('button', 'st-find-btn'); b.type = 'button'; b.className = 'st-hdr-btn'; b.innerHTML = svg(ICON.find); b.setAttribute('aria-label', 'بحث في الملف'); b.title = 'بحث في الملف'; acts.prepend(b); }
    b.setAttribute('aria-controls', 'st-find'); b.setAttribute('aria-expanded', 'false');
    b.addEventListener('click', () => { if (card && !card.hidden) close(); else open(); }); btn = b;
    /* phones: the header has no room left (the document tab would lose its title), so search lives in «المزيد» */
    const menu = $('st-docmenu');
    if (menu && !$('st-find-menu')) {
      const m = el('button', 'st-find-menu'); m.type = 'button'; m.innerHTML = svg(ICON.find) + '<span class="st-lab">بحث في الملف</span>'; m.setAttribute('aria-label', 'بحث في الملف');
      m.addEventListener('click', () => open()); menu.prepend(m); document.documentElement.classList.add('st-find-in-menu');
    }
    return true;
  }

  /* ---------- marks ---------- */
  function clearMarks(p) { (p ? p.el : document).querySelectorAll('.st-find-hit').forEach(m => m.remove()); }
  /* The text layer's spans, in item order — only when they are exactly the indexed segments (not mid-render). */
  function spansFor(p, mdl) {
    if (!p.text) return null;
    const sp = [...p.text.querySelectorAll('span')].filter(s => !s.classList.contains('markedContent') && s.firstChild && s.firstChild.nodeType === 3);
    if (sp.length !== mdl.segs.length) return null;
    for (let i = 0; i < sp.length; i++) if (sp[i].firstChild.data !== mdl.segs[i].str) return null;
    return sp;
  }
  /* Page-area rectangles [x0, y0, x1, y1] (0..1) of match [s, e): from DOM ranges over the text layer's spans, or —
     with no spans — from the PDF's own text geometry. The geometry goes through the page viewport, so /Rotate and the
     CropBox are right even where the text layer is not; it assumes equal character widths, so it is a little looser. */
  function rectsOf(p, mdl, spans, s, e) {
    const area = p.pdf.getBoundingClientRect(); if (spans && (area.width < 2 || area.height < 2)) return [];
    const mp = mapFor(p.id, mdl);
    const out = [], put = (x0, y0, x1, y1) => { x0 = Math.max(0, x0); y0 = Math.max(0, y0); x1 = Math.min(1, x1); y1 = Math.min(1, y1); if (x1 > x0 && y1 > y0) out.push([x0, y0, x1, y1]); };
    for (let i = s; i < e;) {
      const g = mp.seg[i]; if (g < 0) { i++; continue; }
      let a = mp.st[i], b = mp.en[i], j = i + 1;
      while (j < e && mp.seg[j] === g) { a = Math.min(a, mp.st[j]); b = Math.max(b, mp.en[j]); j++; }
      if (spans) {
        const node = spans[g].firstChild, r = document.createRange();
        r.setStart(node, Math.min(a, node.length)); r.setEnd(node, Math.min(b, node.length));
        for (const c of r.getClientRects()) if (c.width >= 0.5 && c.height >= 0.5) put((c.left - area.left) / area.width, (c.top - area.top) / area.height, (c.right - area.left) / area.width, (c.bottom - area.top) / area.height);
      } else geoRect(p, mdl.segs[g], a, b, put);
      i = j;
    }
    return out;
  }
  const vts = new Map();
  function geoRect(p, g, a, b, put) {
    if (!g.t || !p.proxy || !p.proxy.getViewport || !p.w || !p.h) return;
    if (!vts.has(p.id)) vts.set(p.id, p.proxy.getViewport({ scale: 1 }).transform);
    const vt = vts.get(p.id), [ta, tb, tc, td, te, tf] = g.t, nb = Math.hypot(ta, tb) || 1, nu = Math.hypot(tc, td) || 1, h = g.h || nu, n = g.str.length || 1;
    let f0 = a / n, f1 = b / n; if (g.dir === 'rtl') [f0, f1] = [1 - f1, 1 - f0];
    const xs = [], ys = [];
    for (const d of [f0 * g.w, f1 * g.w]) for (const u of [-0.2 * h, 0.85 * h]) {   /* along the baseline × descent..ascent */
      const x = te + ta / nb * d + tc / nu * u, y = tf + tb / nb * d + td / nu * u;
      xs.push((vt[0] * x + vt[2] * y + vt[4]) / p.w); ys.push((vt[1] * x + vt[3] * y + vt[5]) / p.h);
    }
    put(Math.min(...xs), Math.min(...ys), Math.max(...xs), Math.max(...ys));
  }
  /* pdf.js lays its text layer out unrotated; on a /Rotate page the spans are not over the words, so use geometry */
  const rotated = p => !!(p.proxy && p.proxy.rotate % 360);
  /* Marks every match on page p (the current one stronger). Without a ready text layer it waits (returns false),
     unless `geo` asks for the geometric fallback; rotated pages always use geometry. */
  function paint(p, geo) {
    const entry = per.find(x => x.id === p.id); if (!entry || !card || card.hidden) return false;
    const spans = rotated(p) ? null : spansFor(p, entry.mdl); if (!spans && !geo && !rotated(p)) return false;
    clearMarks(p); const h = hits[cur];
    entry.m.forEach(([s, e], k) => {
      for (const r of rectsOf(p, entry.mdl, spans, s, e)) {
        const d = document.createElement('div'); d.className = 'st-find-hit' + (h && h.id === p.id && h.k === k ? ' st-find-cur' : ''); d.dataset.k = k; d.setAttribute('aria-hidden', 'true');
        d.style.setProperty('--x', r[0].toFixed(5)); d.style.setProperty('--y', r[1].toFixed(5)); d.style.setProperty('--w', (r[2] - r[0]).toFixed(5)); d.style.setProperty('--h', (r[3] - r[1]).toFixed(5));
        p.el.append(d);
      }
    });
    return true;
  }
  function paintAll() { const R = RD(); for (const x of per) { const p = R.byId.get(x.id); if (p && (p.text || rotated(p))) paint(p); } }
  /* Bring the current mark into view: at least 150px below the top and clear of the search card. */
  function reveal(p) {
    const m = p.el.querySelector('.st-find-cur'); if (!m) return;
    const r = m.getBoundingClientRect(), cb = card && !card.hidden ? card.getBoundingClientRect().bottom : 0, top = Math.max(150, cb + 24), bottom = innerHeight - 96;
    if (r.top < top || r.bottom > bottom) scrollBy(0, r.top - top);
    const root = RD().root; if (root && (r.left < 8 || r.right > innerWidth - 8)) root.scrollBy(r.left + r.width / 2 - innerWidth / 2, 0);
  }
  /* Resolves once page p's text layer matches the index (rendered by the reader's lazy queue), or after 4 s. */
  const waiters = [];
  function waitText(p, mdl) {
    if (spansFor(p, mdl)) return Promise.resolve(true);
    return new Promise(res => {
      const w = { p, mdl, res, t0: Date.now() }; waiters.push(w);
      const poll = () => { if (!waiters.includes(w)) return; if (spansFor(p, mdl) || Date.now() - w.t0 > 4000) { waiters.splice(waiters.indexOf(w), 1); res(!!spansFor(p, mdl)); } else setTimeout(poll, 100); };
      setTimeout(poll, 100);
    });
  }
  function onText(p) {
    for (const w of waiters.slice()) if (w.p === p && spansFor(p, w.mdl)) { waiters.splice(waiters.indexOf(w), 1); w.res(true); }
    if (card && !card.hidden && per.some(x => x.id === p.id)) paint(p);   /* re-applied after zoom / re-render */
  }

  /* ---------- search + navigation ---------- */
  function whenOpened() {
    const R = RD(); if (!R) return Promise.resolve(null);
    if (R.pages.length || R.nSources || R.notebook) return Promise.resolve(R);
    return new Promise(res => R.on('opened', () => res(R)));
  }
  async function find(query) {
    const my = ++findTok, nq = norm(query); navTok++;
    q = nq; per = []; hits = []; cur = -1; busy = null; clearMarks(); ui();
    const empty = { total: 0, pages: [] }; if (!nq) return empty;
    let R = RD(); if (R && !R.pages.length && !R.notebook) { busy = T.loading; ui(); R = await whenOpened(); if (my !== findTok) return empty; }
    if (!R) return empty;
    if (!R.doc) { busy = null; ui(); return empty; }      /* image mode or notebook: note() explains */
    const src = R.pages.filter(p => p.kind === 'src'), found = []; let any = false, n = 0, bare = 0;
    for (const p of src) {
      const fresh = !cache.has(p.id), mdl = await indexPage(p); n++;
      if (fresh) { if (my === findTok) { busy = T.busy + n + '/' + src.length; ui(); } await tick(); }
      if (mdl.norm.trim()) any = true; else bare++;
      const m = matches(mdl.norm, nq); if (m.length) found.push({ id: p.id, m, mdl });
    }
    const res = { total: found.reduce((s, x) => s + x.m.length, 0), pages: found.map(x => ({ id: x.id, count: x.m.length })) };
    if (my !== findTok) return res;            /* a newer search took over */
    per = found; reorder(); busy = null; noText = !any; textless = bare; ui(); paintAll();
    return res;
  }
  function firstFromHere() {
    const R = RD(), pos = posMap(), here = pos.get(R.current()) || 0, i = hits.findIndex(h => (pos.get(h.id) || 0) >= here);
    return i < 0 ? 0 : i;
  }
  async function go(i) {
    if (!hits.length) return null;
    show(); cur = ((i % hits.length) + hits.length) % hits.length; ui();
    const my = ++navTok, h = hits[cur], R = RD(), p = R.byId.get(h.id), entry = per.find(x => x.id === h.id); if (!p || !entry) return null;
    document.querySelectorAll('.st-find-cur').forEach(m => m.classList.remove('st-find-cur'));
    const r = p.el.getBoundingClientRect(); if (r.bottom < 0 || r.top > innerHeight) R.goto(h.id, false);
    const res = { index: cur, id: h.id, k: h.k }, ok = rotated(p) || await waitText(p, entry.mdl); if (my !== navTok) return res;
    if (paint(p, !ok)) reveal(p);   /* text layer never came (4 s): geometric marks; the 'text' event refines them later */
    return res;
  }
  const next = () => go(cur < 0 ? firstFromHere() : cur + 1);
  const prev = () => { if (cur >= 0) return go(cur - 1); const i = firstFromHere(); return go(hits[i] && posMap().get(hits[i].id) === posMap().get(RD().current()) ? i : i - 1); };
  async function search(jump) { const t = findTok + 1, res = await find(input.value); if (jump && t === findTok && hits.length) await go(firstFromHere()); return res; }

  /* Index every page quietly the first time the card opens, so typing is quick and scans are flagged early. */
  function prime() {
    if (primed) return primed;
    primed = (async () => {
      const R = await whenOpened(); if (!R || !R.doc) { ui(); return; }
      let any = false, bare = 0; for (const p of R.pages.filter(x => x.kind === 'src')) { const fresh = !cache.has(p.id), mdl = await indexPage(p); if (mdl.norm.trim()) any = true; else bare++; if (fresh) await tick(); }
      noText = !any; textless = bare; ui();
    })();
    return primed;
  }
  function show() {
    build(); if (!card.hidden) return; card.hidden = false; if (btn) btn.setAttribute('aria-expanded', 'true');
    ui(); if (hits.length) paintAll();
  }
  function open(query) {
    show(); prime();
    try { input.focus({ preventScroll: true }); } catch { input.focus(); }
    if (typeof query === 'string') { input.value = query; return search(true); }
    input.select();
    if (input.value && norm(input.value) !== q) return search(false);
    return Promise.resolve();
  }
  function close() {
    if (!card || card.hidden) return; clearTimeout(deb); navTok++;
    const inside = card.contains(document.activeElement); card.hidden = true; clearMarks(); cur = -1; ui();
    if (btn) { btn.setAttribute('aria-expanded', 'false'); if (inside) btn.focus(); }
  }

  /* ---------- wiring ---------- */
  addEventListener('keydown', e => {
    if ((e.ctrlKey || e.metaKey) && !e.altKey && !e.shiftKey && (e.code === 'KeyF' || (e.key || '').toLowerCase() === 'f')) {
      const t = e.target; if (t !== input && t && t.closest && t.closest('input,textarea,select,[contenteditable]:not([contenteditable=false])')) return;
      e.preventDefault(); open();
    } else if (e.key === 'Escape' && card && !card.hidden && (e.target === document.body || e.target === document.documentElement || card.contains(e.target))) close();
  });
  function hook() { const R = RD(); if (!R || R.__stSearch) return; R.__stSearch = true; R.on('text', onText); R.on('pages', () => { if (per.length) { reorder(); ui(); } }); }
  build(); hook(); if (!RD()) addEventListener('load', hook, { once: true });
  if (!addButton()) addEventListener('load', addButton, { once: true });
  M.search = window.MedixaSearch = { open, close, find, next, prev, _norm: norm, _state: () => ({ query: q, total: hits.length, index: cur, id: hits[cur] ? hits[cur].id : null, busy: !!busy, message: note() }) };
})();
