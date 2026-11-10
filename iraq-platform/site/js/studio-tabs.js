/* MEDIXA Study Studio — document tabs. Each tab is one document (a lecture PDF or a notebook) with its own annotation
   store, undo history and reading position; switching saves first, then opens the other document. Closing a tab only
   removes it from the strip: nothing is deleted and it can be reopened from the "+" menu. */
(function () {
  'use strict';
  const M = window.MedixaStudio; if (!M) return;
  const params = new URLSearchParams(location.search), src = params.get('file');
  if (!src || params.get('embed') === '1') return;                       /* embedded panes are not tabs */
  const $ = id => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const KEY = 'medixa.studio.tabs.v1', NBKEY = 'medixa.notebooks.v1';
  const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const clean = s => { const t = { v: 1, open: [], closed: [], pos: {} }; if (s && typeof s === 'object') { for (const x of Array.isArray(s.open) ? s.open : []) if (x && typeof x.src === 'string' && x.src.length < 600) t.open.push({ src: x.src, title: String(x.title || '').slice(0, 120), at: +x.at || 0 }); for (const x of Array.isArray(s.closed) ? s.closed : []) if (x && typeof x.src === 'string') t.closed.push({ src: x.src, title: String(x.title || '').slice(0, 120), at: +x.at || 0 }); if (s.pos && typeof s.pos === 'object') for (const [k, v] of Object.entries(s.pos)) if (v && Number.isInteger(v.id) && typeof v.frac === 'number') t.pos[k] = { id: v.id, frac: Math.max(0, Math.min(1, v.frac)) }; } t.closed = t.closed.slice(-12); return t; };
  const load = () => clean(rd(KEY, null)), save = t => wr(KEY, t);
  const notebooks = () => (Array.isArray(rd(NBKEY, [])) ? rd(NBKEY, []) : []).filter(n => n && typeof n.id === 'string' && /^[a-z0-9]{3,20}$/.test(n.id));
  function titleFor(s) {
    if (/^notebook:/.test(s)) { const n = notebooks().find(x => 'notebook:' + x.id === s); return n ? n.title : 'دفتر'; }
    try {
      const path = decodeURIComponent(new URL(s, location.href).pathname.replace(/^\/+/, ''));
      if (typeof COURSES !== 'undefined') for (const c of COURSES) for (const l of (c.lectures || [])) for (const f of (l.files || [])) if (f.path && path.endsWith(f.path)) return String(l.titleAr || l.title || 'ملف');   /* the real lecture title beats a file name */
      const f = path.split('/').pop().replace(/\.pdf$/i, '').replace(/^المحاضرة-\d+-/, '').replace(/[-_]+/g, ' ');
      return /^[0-9a-f]{6,}( [0-9a-f]{3,})*$/i.test(f) ? 'ملف' : (f || 'ملف');   /* uploaded files are named by an id: not a title */
    } catch { return 'ملف'; }
  }
  const href = s => 'pdf-notes.html?file=' + encodeURIComponent(s);
  let T = load();
  if (!T.open.some(t => t.src === src)) T.open.push({ src, title: titleFor(src), at: Date.now() });
  T.closed = T.closed.filter(t => t.src !== src); save(T);

  async function go(target) { try { M.flush(); } catch {} savePos(); location.href = href(target); }
  function savePos() { try { const R = M.reader; if (!R || !R.pages.length) return; const id = R.current(), p = R.byId.get(id), r = p.el.getBoundingClientRect(); const t = load(); t.pos[src] = { id, frac: Math.max(0, Math.min(1, (140 - r.top) / Math.max(1, r.height))) }; if (!t.open.some(x => x.src === src)) t.open.push({ src, title: titleFor(src), at: Date.now() }); save(t); } catch {} }
  let st = 0; addEventListener('scroll', () => { clearTimeout(st); st = setTimeout(savePos, 500); }, { passive: true }); addEventListener('pagehide', savePos);

  function close(s) {
    const t = load(), i = t.open.findIndex(x => x.src === s); if (i < 0) return; const [gone] = t.open.splice(i, 1);
    t.closed = t.closed.filter(x => x.src !== s).concat([{ src: s, title: gone.title, at: Date.now() }]).slice(-12); save(t);
    if (s !== src) { render(); return; }
    try { M.flush(); } catch {}
    const next = t.open[Math.min(i, t.open.length - 1)]; if (next) location.href = href(next.src); else location.href = 'index.html';
  }

  /* ---- strip ---- */
  let nav = null;
  function build() {
    const hdr = document.querySelector('header'); if (!hdr) return;
    nav = el('nav', 'st-tabs'); nav.id = 'st-tabs'; nav.setAttribute('aria-label', 'المستندات المفتوحة'); (hdr.querySelector('.st-brand') || hdr.querySelector('strong') || hdr.firstChild).after(nav);
    render();
  }
  async function dirtyKeys() { try { return await M.draftKeys(); } catch { return new Set(); } }
  async function render() {
    if (!nav) return; T = load(); const drafts = await dirtyKeys(); nav.replaceChildren();
    const list = el('div', 'st-tablist'); list.setAttribute('role', 'tablist');
    for (const t of T.open) {
      const cur = t.src === src, row = el('div', 'st-tab' + (cur ? ' current' : '')); row.dataset.src = t.src;
      const b = el('button', 'st-tab-b'); b.type = 'button'; b.setAttribute('role', 'tab'); b.setAttribute('aria-selected', String(cur)); const nm = /^[0-9a-f]{6,}( [0-9a-f]{3,})*$/i.test(t.title || '') ? titleFor(t.src) : t.title; b.title = nm;
      b.append(el('span', 'st-tab-t', (nm || '').slice(0, 24)));
      const key = 'medixa.pdf.annotations.v1:' + new URL(t.src, location.href).href;
      const bad = cur ? ['pending', 'editing', 'failed', 'conflict'].includes(M.S.state) : drafts.has(key);
      if (bad) { const d = el('span', 'st-dirty', '●'); d.setAttribute('role', 'img'); d.setAttribute('aria-label', 'تغييرات غير محفوظة'); b.append(d); }
      b.onclick = () => { if (!cur) go(t.src); };
      const x = el('button', 'st-tab-x', '✕'); x.type = 'button'; x.setAttribute('aria-label', 'إغلاق ' + t.title); x.onclick = e => { e.stopPropagation(); if (bad && !confirm('في هذا المستند تغييرات غير محفوظة (توجد مسودة احتياطية). إغلاق التبويب لن يحذفها ويمكنك إعادة فتحه. متابعة؟')) return; close(t.src); };
      row.append(b, x); list.append(row);
    }
    const plus = el('button', 'st-tab-plus', '＋'); plus.type = 'button'; plus.id = 'st-tab-plus'; plus.setAttribute('aria-label', 'فتح مستند أو دفتر'); plus.setAttribute('aria-haspopup', 'dialog'); plus.onclick = openMenu; if (T.open.length > 1) plus.dataset.n = T.open.length - 1;
    nav.append(list, plus);
  }
  M.on('state', () => { clearTimeout(render.t); render.t = setTimeout(render, 120); });

  /* ---- "+" menu: closed tabs, notebooks, lecture picker ---- */
  function openMenu(onPick) {
    const pick = typeof onPick === 'function' ? onPick : go;
    let d = $('st-tabmenu'); if (d) d.remove();
    d = el('dialog', 'st-dlg'); d.id = 'st-tabmenu'; d.setAttribute('aria-labelledby', 'st-tabmenu-t');
    d.append(el('h2', '', 'فتح مستند')); d.querySelector('h2').id = 'st-tabmenu-t';
    const sec = (title) => { const h = el('h3', '', title); const ul = el('ul', 'st-menu-list'); d.append(h, ul); return ul; };
    const item = (ul, label, fn, cls) => { const li = el('li'), b = el('button', 'st-menu-b' + (cls ? ' ' + cls : ''), label); b.type = 'button'; b.onclick = () => { d.close(); fn(); }; li.append(b); ul.append(li); };
    const t = load();
    const ul0 = sec('دفاتري'); item(ul0, '＋ دفتر جديد', () => newNotebook(pick), 'st-new-nb'); for (const n of notebooks()) item(ul0, n.title, () => pick('notebook:' + n.id));
    if (t.closed.length) { const ul1 = sec('أُغلقت مؤخراً (ما زالت محفوظة)'); for (const c of t.closed.slice().reverse()) item(ul1, c.title, () => pick(c.src)); }
    const others = t.open.filter(x => x.src !== src); if (others.length && (pick !== go || matchMedia('(max-width:720px)').matches)) {   /* phones show only the current tab in the strip */ const ul3 = sec('التبويبات المفتوحة'); for (const o of others) item(ul3, o.title, () => pick(o.src)); }
    const ul2 = sec('محاضرات الموقع'); const q = el('input'); q.type = 'search'; q.placeholder = 'ابحث عن محاضرة…'; q.setAttribute('aria-label', 'بحث في المحاضرات'); ul2.before(q);
    const fill = () => {
      ul2.replaceChildren(); const needle = q.value.trim().toLowerCase(); let n = 0;
      if (typeof COURSES === 'undefined') { ul2.append(el('li', '', 'جارٍ التحميل…')); return; }
      for (const c of COURSES) for (const l of (c.lectures || [])) { if (l.draft) continue; for (const f of (l.files || [])) { if (f.draft) continue; const label = (c.nameAr || c.name) + ' — محاضرة ' + l.number + ': ' + (l.titleAr || l.title) + ' (' + f.label + ')'; if (needle && !label.toLowerCase().includes(needle)) continue; if (n++ < 60) item(ul2, label, () => pick('files/' + f.path)); } }
      if (!n) ul2.append(el('li', '', 'لا توجد نتائج.'));
    };
    q.oninput = fill;
    if (typeof COURSES === 'undefined') { const s = document.createElement('script'); s.src = './data/courses.js'; s.onload = fill; s.onerror = () => { ul2.replaceChildren(el('li', '', 'تعذر تحميل قائمة المحاضرات.')); }; document.head.append(s); fill(); } else fill();
    const row = el('div', 'st-cust-row'); const cl = el('button', 'st-btn', 'إغلاق'); cl.type = 'button'; cl.onclick = () => d.close(); row.append(cl); d.append(row);
    document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
  }
  function newNotebook(pick) {
    pick = typeof pick === 'function' ? pick : go;
    const d = el('dialog', 'st-dlg'); d.id = 'st-nbdlg'; d.setAttribute('aria-labelledby', 'st-nbdlg-t'); const h = el('h2', '', 'دفتر جديد'); h.id = 'st-nbdlg-t';
    const inp = el('input'); inp.id = 'st-nb-title'; inp.maxLength = 60; inp.placeholder = 'اسم الدفتر'; inp.setAttribute('aria-label', 'اسم الدفتر'); inp.value = 'دفتر ' + (notebooks().length + 1);
    const row = el('div', 'st-cust-row'); const ok = el('button', 'st-btn', 'إنشاء'); ok.type = 'button'; ok.id = 'st-nb-create'; const no = el('button', 'st-btn', 'إلغاء'); no.type = 'button'; row.append(ok, no); d.append(h, inp, row);
    no.onclick = () => d.close();
    ok.onclick = () => { const title = inp.value.trim().slice(0, 60) || 'دفتر'; const id = 'n' + Math.random().toString(36).slice(2, 9); const list = notebooks(); list.push({ id, title, created: Date.now() }); if (wr(NBKEY, list)) { d.close(); pick('notebook:' + id); } };
    document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
  }
  M.tabs = { render, openMenu, go, close, notebooks, titleFor, state: () => load(), newNotebook };

  /* ---- restore reading position ---- */
  /* Restore the exact reading position after the reader's own resume modules (which only know whole pages) have run.
     Skipped if the reader already interacted (wheel / touch / key / pointer) so we never hijack someone who moved. */
  let moved = false; for (const ev of ['wheel', 'touchstart', 'keydown', 'pointerdown']) addEventListener(ev, () => { moved = true; }, { capture: true, passive: true, once: true });
  if (M.reader) M.reader.on('opened', () => { const p = load().pos[src]; if (!p || location.hash) return; setTimeout(() => { if (moved) return; const pg = M.reader.byId.get(p.id); if (!pg) return; const r = pg.el.getBoundingClientRect(); scrollBy({ top: r.top + p.frac * r.height - 140, behavior: 'instant' }); }, 1500); });
  build();
})();
