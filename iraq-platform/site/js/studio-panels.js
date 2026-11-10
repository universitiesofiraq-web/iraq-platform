/* MEDIXA Study Studio — side panels. Pages (lazy thumbnails with a per-page annotation count + the existing bookmarks
   list) and «ملاحظاتي»: a navigator over what the student put on this file (notes, highlights, handwriting, shapes,
   images), read from the single annotation store; nothing is copied or invented. */
(function () {
  'use strict';
  const M = window.MedixaStudio; if (!M) return;
  const C = M.C;
  const $ = id => document.getElementById(id);
  const norm = s => (window.MS && MS.norm) ? MS.norm(s) : String(s || '').toLowerCase();
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const isOpen = p => !!(p && p.classList.contains('open'));
  const svg = (d, n) => '<svg viewBox="0 0 24 24" width="' + n + '" height="' + n + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    ink: '<path d="M12 20h9"/><path d="M16.5 3.5a2.12 2.12 0 0 1 3 3L7 19l-4 1 1-4z"/>',
    hl: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>',
    shape: '<rect x="3" y="12" width="9" height="9" rx="1.5"/><circle cx="16.5" cy="7.5" r="4.5"/>',
    img: '<rect x="3" y="3" width="18" height="18" rx="2"/><circle cx="9" cy="9" r="2"/><path d="m21 15-3.1-3.1a2 2 0 0 0-2.8 0L6 21"/>'
  };
  /* Arabic counted nouns: 1 and 2 have their own forms, 3–10 plural, 11+ singular accusative */
  const count = (n, f) => n === 1 ? f[0] : n === 2 ? f[1] : n + ' ' + (n <= 10 ? f[2] : f[3]);
  const ITEMS = ['عنصر واحد', 'عنصران', 'عناصر', 'عنصراً'], MARKS = ['تعليق واحد', 'تعليقان', 'تعليقات', 'تعليقاً'];
  const pageName = n => n >= C.BLANK_ID0 ? 'صفحة فارغة' : 'صفحة ' + n;
  /* wide screens remember which panels are open (a device setting, like the toolbar layout) */
  const PREF = 'medixa.studio.panels.v1', WIDE = '(min-width:1360px)';
  const pref = () => { try { const v = JSON.parse(localStorage.getItem(PREF)); return v && typeof v === 'object' ? v : null; } catch { return null; } };
  const remember = () => { if (!matchMedia(WIDE).matches) return; try { localStorage.setItem(PREF, JSON.stringify({ pages: isOpen(pg), notes: isOpen(np) })); } catch {} };
  const mark = (name, open) => { const b = $(name === 'pages' ? 'medixa-thumbs-toggle' : 'st-notes-toggle'); if (b) b.setAttribute('aria-expanded', String(open)); };
  const close = (name) => { document.body.classList.remove('st-' + name + '-open'); const p = $('st-' + name); if (p) p.classList.remove('open'); mark(name, false); };
  function toggle(name, force) {
    const p = $('st-' + name), open = typeof force === 'boolean' ? force : !p.classList.contains('open');
    const wide = matchMedia('(min-width:1100px)').matches;
    ['pages', 'notes'].forEach(n => { if (n !== name && open && !wide) close(n); });
    p.classList.toggle('open', open); document.body.classList.toggle('st-' + name + '-open', open); mark(name, open);
    if (open && name === 'pages') pagesRefresh(); if (open && name === 'notes') notesRender();
    if (typeof force !== 'boolean') remember();
  }
  /* every valid annotation, of any kind (invalid entries stay in the store untouched but are never listed) */
  const valid = () => M.S.items.filter(s => s && C.validStroke(s));

  /* ================= pages ================= */
  let pg = null, thumbIO = null, thumbs = [];
  function buildPages() {
    pg = el('aside', 'st-panel'); pg.id = 'st-pages'; pg.setAttribute('aria-label', 'الصفحات والإشارات المرجعية');
    const head = el('div', 'st-panel-head'); head.append(el('strong', '', 'الصفحات')); const x = el('button', 'st-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'إغلاق لوحة الصفحات'); x.onclick = () => { close('pages'); remember(); }; head.append(x);
    const add = el('div', 'st-add'); const tpl = document.createElement('select'); tpl.id = 'st-blank-tpl'; tpl.setAttribute('aria-label', 'نوع الصفحة الفارغة');
    for (const [v, l] of [['lined', 'مسطّرة'], ['blank', 'فارغة'], ['grid', 'مربعات'], ['dots', 'نقاط']]) { const o = document.createElement('option'); o.value = v; o.textContent = l; tpl.append(o); }
    const ab = el('button', 'st-add-btn', '＋ صفحة بعد الحالية'); ab.type = 'button'; ab.id = 'st-add-blank'; ab.onclick = addBlankHere; add.append(tpl, ab);
    const list = el('div', 'st-thumbs'); list.id = 'st-thumbs'; list.setAttribute('role', 'list');
    const bm = el('div', 'st-bm'); bm.append(el('strong', '', 'الإشارات المرجعية'));
    const foot = el('button', 'st-focus-btn', 'وضع التركيز'); foot.type = 'button'; foot.id = 'st-focus-btn'; foot.onclick = () => { const f = $('medixa-focus'); if (f) f.click(); };
    pg.append(head, add, list, bm, foot); document.body.append(pg);
    const bmList = $('medixa-bookmarks'); if (bmList) bm.append(bmList);          /* relocate: v5 keeps updating it */
    thumbIO = new IntersectionObserver(es => { for (const e of es) if (e.isIntersecting && !e.target.dataset.done) { e.target.dataset.done = '1'; M.reader.thumb(+e.target.dataset.page, e.target.querySelector('canvas'), 150).catch(() => { e.target.dataset.done = ''; }); } }, { root: list, rootMargin: '300px' });
  }
  let sig = '';
  function addBlankHere() {
    const R = M.reader, cur = R.current(), curP = R.byId.get(cur), ref = R.pages.find(p => p.kind === 'src') || curP || { w: 595, h: 842 };
    const rec = M.addBlank(cur, $('st-blank-tpl').value, { w: ref.w, h: ref.h }); setTimeout(() => R.goto(rec.id), 150);
  }
  function pagesRefresh() {
    const R = M.reader; if (!R || !R.pages.length) return markCurrent();
    const now = R.pages.map(p => p.id).join(','); if (now === sig && thumbs.length === R.pages.length) { if (isOpen(pg)) badges(); return markCurrent(); } sig = now;
    const list = $('st-thumbs'); list.replaceChildren(); thumbs = [];
    R.pages.forEach((p, k) => {
      const row = el('div', 'st-row'); row.dataset.kind = p.kind;
      const b = el('button', 'st-th'); b.type = 'button'; b.dataset.page = p.id; b.setAttribute('role', 'listitem'); b.dataset.label = p.kind === 'blank' ? 'صفحة فارغة' : 'الصفحة ' + p.id; b.setAttribute('aria-label', b.dataset.label);
      const c = document.createElement('canvas'); c.width = 150; c.height = Math.round(150 * p.h / p.w); c.className = 'st-th-c'; b.append(c, el('span', 'st-th-n', p.kind === 'blank' ? '＋' : String(p.id)));
      b.onclick = () => { R.goto(p.id); if (matchMedia('(max-width:1099px)').matches) close('pages'); };
      row.append(b);
      if (p.kind === 'blank') {
        const tools = el('div', 'st-th-tools'); const mk = (cls, label, text, fn) => { const x = el('button', 'st-mini ' + cls, text); x.type = 'button'; x.setAttribute('aria-label', label); x.onclick = fn; tools.append(x); };
        mk('st-up', 'نقل الصفحة الفارغة للأعلى', '▲', () => M.moveBlank(p.id, -1)); mk('st-dn', 'نقل الصفحة الفارغة للأسفل', '▼', () => M.moveBlank(p.id, 1));
        mk('st-rm', 'حذف الصفحة الفارغة', '✕', () => { const has = M.S.items.some(s => s && s.page === p.id); if (!has || confirm('سيُحذف كل ما كُتب في هذه الصفحة الفارغة ولا يمكن التراجع عنه. متابعة؟')) M.removeBlank(p.id); });
        row.append(tools);
      }
      list.append(row); thumbs.push(b); thumbIO.observe(b);
    });
    if (isOpen(pg)) badges();
    markCurrent();
  }
  /* a small teal pill on each thumbnail: how many annotations that page carries, so pages with work are easy to spot */
  function badges() {
    if (!thumbs.length) return;
    const per = new Map(); for (const s of valid()) per.set(s.page, (per.get(s.page) || 0) + 1);
    for (const b of thumbs) {
      const n = per.get(+b.dataset.page) || 0; let t = b.querySelector('.st-th-b');
      b.setAttribute('aria-label', n ? b.dataset.label + ' — ' + count(n, MARKS) : b.dataset.label);
      if (!n) { if (t) t.hidden = true; continue; }
      if (!t) { t = el('span', 'st-th-b'); t.setAttribute('aria-hidden', 'true'); t.innerHTML = svg(ICON.ink, 12); t.append(el('b')); b.append(t); }
      t.hidden = false; t.lastChild.textContent = String(n);
    }
  }
  function markCurrent() { const n = M.reader && M.reader.current(); thumbs.forEach(b => b.classList.toggle('current', +b.dataset.page === n)); }
  let tick = 0; addEventListener('scroll', () => { if (tick) return; tick = requestAnimationFrame(() => { tick = 0; if (isOpen(pg)) markCurrent(); }); }, { passive: true });

  /* ================= «ملاحظاتي»: one list for everything on the file ================= */
  /* Notes and text highlights are one card each (they carry words); freehand highlights, handwriting and shapes become
     ONE card per page per kind, so a page full of strokes does not bury the notes. */
  const KIND = { text: 'note', sticky: 'note', texthl: 'hl', highlight: 'hl', pen: 'ink', line: 'shape', rectangle: 'shape', ellipse: 'shape', arrow: 'shape', image: 'img' };
  const FILTERS = [['all', 'الكل'], ['notes', 'ملاحظات'], ['hl', 'تظليل'], ['ink', 'كتابة'], ['shape', 'أشكال'], ['img', 'صور']];
  const FK = { notes: 'note', hl: 'hl', ink: 'ink', shape: 'shape', img: 'img' };
  /* 'sticky' and 'text' were the earlier chips; still accepted through M.panels.setFilter, no longer shown */
  const pass = (f, s) => f === 'all' || (f === 'sticky' || f === 'text' ? s.tool === f : KIND[s.tool] === FK[f]);
  const GROUP = { pen: ['كتابة بخط اليد', 'ink'], highlight: ['تظليل حر', 'hl'], shape: ['أشكال', 'shape'] };
  const SUM = [['note', 'ملاحظة'], ['hl', 'تظليل'], ['ink', 'كتابة'], ['shape', 'شكل'], ['img', 'صورة']];
  let np = null, filter = 'all', q = '';
  function buildNotes() {
    np = el('aside', 'st-panel st-notes'); np.id = 'st-notes'; np.setAttribute('aria-label', 'ملاحظاتي');
    const head = el('div', 'st-panel-head'); head.append(el('strong', '', 'ملاحظاتي')); const x = el('button', 'st-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'إغلاق ملاحظاتي'); x.onclick = () => { close('notes'); remember(); }; head.append(x);
    const sum = el('p', 'st-ann-sum'); sum.id = 'st-notes-sum'; sum.hidden = true;
    const search = document.createElement('input'); search.type = 'search'; search.id = 'st-notes-q'; search.placeholder = 'ابحث في الملاحظات والتظليل…'; search.setAttribute('aria-label', 'البحث في الملاحظات والتظليل'); search.oninput = () => { q = norm(search.value.trim()); notesRender(); };
    const chips = el('div', 'st-chips'); chips.setAttribute('role', 'group'); chips.setAttribute('aria-label', 'تصفية حسب النوع');
    for (const [k, label] of FILTERS) { const c = el('button', 'st-chip', label); c.type = 'button'; c.dataset.f = k; c.setAttribute('aria-pressed', String(k === filter)); c.onclick = () => setFilter(k); chips.append(c); }
    const list = el('div', 'st-notes-list'); list.id = 'st-notes-list';
    np.append(head, sum, search, chips, list); document.body.append(np);
  }
  function setFilter(k) {
    if (k !== 'all' && k !== 'sticky' && k !== 'text' && !FK[k]) return;
    filter = k; np.querySelectorAll('.st-chip').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.f === k))); notesRender();
  }
  /* entries in reading order: display order of pages (blank pages sit where the student put them), then top to bottom */
  function entries() {
    const R = M.reader, at = new Map(); if (R) R.pages.forEach((p, i) => at.set(p.id, i));
    const pos = n => at.has(n) ? at.get(n) : 1e6 + n, tally = { note: 0, hl: 0, ink: 0, shape: 0, img: 0 }, groups = new Map(), out = [];
    for (const s of valid()) {
      const k = KIND[s.tool]; if (!k) continue; tally[k]++;
      const y = C.bounds(s)[1], g = s.tool === 'pen' || s.tool === 'highlight' ? s.tool : k === 'shape' ? 'shape' : null;
      if (g) {
        let e = groups.get(g + '|' + s.page);
        if (!e) { groups.set(g + '|' + s.page, e = { type: 'group', g, page: s.page, y, items: [] }); out.push(e); }
        e.items.push(s); if (y < e.y) e.y = y;
      } else out.push({ type: s.tool === 'texthl' ? 'quote' : k === 'img' ? 'img' : 'note', page: s.page, y, items: [s] });
    }
    out.sort((a, b) => pos(a.page) - pos(b.page) || a.y - b.y);
    return { out, tally };
  }
  const words = e => e.type === 'note' ? e.items[0].text : e.type === 'quote' ? String(e.items[0].quote || '') : null;
  function notesRender() {
    if (!np) return; const list = $('st-notes-list'), top = list.scrollTop; list.replaceChildren();
    const { out, tally } = entries(), sum = $('st-notes-sum'), parts = SUM.filter(([k]) => tally[k]).map(([k, w]) => tally[k] + ' ' + w);
    sum.hidden = !parts.length; sum.textContent = parts.length ? 'المجموع: ' + parts.join(' · ') : '';
    /* a kind the file does not have is not offered (the active chip stays, so the student can step back) */
    np.querySelectorAll('.st-chip').forEach(b => { const k = FK[b.dataset.f]; b.hidden = !!k && !tally[k] && b.dataset.f !== filter; });
    const shown = out.filter(e => pass(filter, e.items[0]) && (!q || (words(e) != null && norm(words(e)).includes(q))));
    if (!shown.length) { list.append(el('p', 'st-empty', out.length ? 'لا توجد نتائج مطابقة.' : 'لا شيء هنا بعد. ما تكتبه أو تظلّله على الصفحات يظهر هنا.')); return; }
    for (const e of shown) list.append(card(e));
    list.scrollTop = top;
  }
  function card(e) {
    const s = e.items[0], c = el('button', 'st-note st-ann'); c.type = 'button'; c.dataset.kind = e.type === 'group' ? e.g : s.tool; c.dataset.page = e.page;
    if (e.type === 'note') {
      const lines = s.text.split('\n'); c.dataset.id = s.id; if (s.tool === 'sticky') c.style.setProperty('--note-fill', s.fill || '#fff3a3');
      const t = el('strong', 'st-note-t', lines[0].slice(0, 80) || '—'); t.dir = 'auto'; c.append(t);
      if (lines.length > 1) { const b = el('span', 'st-note-b', lines.slice(1).join('\n').slice(0, 240)); b.dir = 'auto'; c.append(b); }
      c.append(el('span', 'st-note-p', pageName(e.page)));
    } else if (e.type === 'quote') {
      c.dataset.id = s.id; c.style.setProperty('--note-fill', s.color || '#f2c230');
      const t = String(s.quote || '').replace(/\s+/g, ' ').trim(), qb = el('span', 'st-ann-q'); qb.dir = 'auto';
      qb.append(el('mark', '', t ? (t.length > 140 ? t.slice(0, 140).trimEnd() + '…' : t) : 'نص مظلَّل'));
      c.append(qb, el('span', 'st-note-p', 'تظليل · ' + pageName(e.page)));
    } else {
      c.classList.add('st-ann-row'); if (e.type === 'img') c.dataset.id = s.id;
      c.style.setProperty('--note-fill', e.type === 'img' ? '#9db6bf' : s.color || '#2fd0d0');
      let lead;
      if (e.type === 'img') lead = thumb(s); else { lead = el('span', 'st-ann-ic'); lead.innerHTML = svg(ICON[GROUP[e.g][1]], 20); }
      const tx = el('span', 'st-ann-tx');
      tx.append(el('strong', 'st-note-t', e.type === 'img' ? 'صورة' : GROUP[e.g][0] + ' · ' + count(e.items.length, ITEMS)), el('span', 'st-note-p', pageName(e.page)));
      c.append(lead, tx);
    }
    c.onclick = () => reveal(e);
    return c;
  }
  /* 44px preview from the on-device image store; a neutral tile when the picture is not on this device */
  function thumb(s) {
    const w = el('span', 'st-ann-img'); w.innerHTML = svg(ICON.img, 20);
    const cv = document.createElement('canvas'), d = Math.min(3, window.devicePixelRatio || 1); cv.width = cv.height = Math.round(44 * d); w.append(cv);
    const A = window.MedixaAssets, paint = im => { if (im && drawThumb(cv, im, s)) w.classList.add('has-img'); };
    const hit = A && A.peek ? A.peek(s.asset) : null;
    if (hit) paint(hit); else if (A && A.bitmap) A.bitmap(s.asset).then(paint, () => {});
    return w;
  }
  function drawThumb(cv, im, s) {
    try {
      const iw = im.naturalWidth || im.width, ih = im.naturalHeight || im.height; if (!iw || !ih) return false;
      const c = Array.isArray(s.crop) && s.crop.length === 4 ? s.crop : [0, 0, 1, 1], sw = (c[2] - c[0]) * iw, sh = (c[3] - c[1]) * ih;
      const W = cv.width, k = Math.min(W / sw, W / sh), dw = sw * k, dh = sh * k, ctx = cv.getContext('2d');
      ctx.clearRect(0, 0, W, W); ctx.imageSmoothingQuality = 'high'; ctx.drawImage(im, c[0] * iw, c[1] * ih, sw, sh, (W - dw) / 2, (W - dh) / 2, dw, dh);
      return true;
    } catch { return false; }
  }
  /* go to the page, then outline exactly what the card stands for (same page-fraction flashes as the source links) */
  const PAD = 0.006;
  function boxesOf(e) {
    if (e.type === 'quote') return e.items[0].rects;
    let bs = e.items.map(s => C.bounds(s));
    if (bs.length > 60) bs = [bs.reduce((u, b) => [Math.min(u[0], b[0]), Math.min(u[1], b[1]), Math.max(u[2], b[2]), Math.max(u[3], b[3])])];   /* a page of strokes: one outline, not hundreds */
    return bs.map(b => [b[0] - PAD, b[1] - PAD, Math.max(b[2], b[0] + 0.01) + PAD, Math.max(b[3], b[1] + 0.01) + PAD]);
  }
  function flash(pel, boxes) {
    pel.querySelectorAll('.st-src-flash').forEach(x => x.remove());
    for (const r of boxes) { const f = el('div', 'st-src-flash'); f.style.setProperty('--x', r[0]); f.style.setProperty('--y', r[1]); f.style.setProperty('--w', r[2] - r[0]); f.style.setProperty('--h', r[3] - r[1]); pel.append(f); setTimeout(() => f.remove(), 2600); }
  }
  function reveal(e) {
    const R = M.reader; if (!R) return;
    R.goto(e.page); const pel = R.pageEl(e.page);
    if (pel) {
      pel.classList.add('st-pulse'); setTimeout(() => pel.classList.remove('st-pulse'), 1400);
      const boxes = boxesOf(e); setTimeout(() => flash(pel, boxes), 450);   /* after the smooth scroll has mostly landed */
    }
    if (matchMedia('(max-width:1099px)').matches) close('notes');
  }
  /* edits arrive in bursts (a drag saves many times): one debounced pass, and only for the panels that are open */
  let rt = 0;
  const soon = () => { clearTimeout(rt); rt = setTimeout(() => { if (isOpen(np)) notesRender(); if (isOpen(pg)) badges(); }, 200); };
  M.on('change', soon); M.on('history', soon);

  /* ================= header buttons ================= */
  function addButtons() {
    const dock = $('mx-dock'); if (!dock || $('st-notes-toggle')) return false;
    const b = el('button', 'st-dock-btn'); b.type = 'button'; b.id = 'st-notes-toggle'; b.setAttribute('aria-controls', 'st-notes'); b.setAttribute('aria-label', 'ملاحظاتي'); b.title = 'ملاحظاتي';
    b.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M15.5 3H5a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h14a2 2 0 0 0 2-2V8.5L15.5 3z"/><path d="M15 3v6h6"/><path d="M7 13h8M7 17h5"/></svg><span class="st-lab">ملاحظاتي</span>';
    b.onclick = () => toggle('notes'); dock.append(b);
    const t = $('medixa-thumbs-toggle'); if (t) { t.setAttribute('aria-controls', 'st-pages'); t.addEventListener('click', () => toggle('pages'), true); }
    mark('pages', false); mark('notes', false);
    const p = pref(); if (matchMedia(WIDE).matches && !document.documentElement.classList.contains('st-embed')) { if (p ? p.pages : !document.body.classList.contains('st-compact')) toggle('pages', true); if (p ? p.notes : !document.body.classList.contains('st-compact')) toggle('notes', true); }
    return true;
  }
  buildPages(); buildNotes();
  if (M.reader) { M.reader.on('opened', () => { pagesRefresh(); if (isOpen(np)) notesRender(); }); M.reader.on('pages', () => { sig = ''; pagesRefresh(); if (isOpen(np)) notesRender(); }); }
  if (!addButtons()) { const mo = new MutationObserver(() => { if (addButtons()) { mo.disconnect(); } }); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 10000); }
  addEventListener('keydown', e => { if (e.key === 'Escape') { close('pages'); close('notes'); } });
  M.panels = { toggle, close, pagesRefresh, notesRender, badges, setFilter };
})();
