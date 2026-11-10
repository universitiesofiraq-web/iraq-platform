/* Compact reader presentation. Moves existing controls; never writes document data.
   Load last, after shell/panels/search. Remove body.st-compact to use the old layout.
   Left pill as in Notewise (طلب محمد 4): رجوع · الصفحات · إضافة صفحة · بحث · المستندات. «ملاحظاتي» lives in «المزيد». */
(() => {
  'use strict';
  if (!document.body.classList.contains('st-compact') || document.documentElement.classList.contains('st-embed')) return;
  const $ = id => document.getElementById(id);
  const svg = path => '<svg viewBox="0 0 24 24" width="22" height="22" fill="none" stroke="currentColor" stroke-width="1.6" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + path + '</svg>';
  const ICON = {
    back: '<path d="M19 12H5"/><path d="m11 18-6-6 6-6"/>',
    addPage: '<rect x="4" y="4" width="16" height="16" rx="3"/><path d="M12 8.5v7M8.5 12h7"/>',
    find: '<circle cx="10.5" cy="10.5" r="6.5"/><path d="m15.5 15.5 4.5 4.5"/>',
    files: '<rect x="4" y="9.5" width="16" height="10.5" rx="2.5"/><path d="M6 6.5h12M8 3.5h8"/>'
  };
  /* blank page templates (studio-core TEMPLATES) with a small picture of each */
  const PAGE = '<rect x="5" y="3" width="14" height="18" rx="2"/>';
  const TPL = [
    ['lined', 'مسطّرة', PAGE + '<path d="M8 8h8M8 12h8M8 16h8"/>'],
    ['blank', 'فارغة', PAGE],
    ['grid', 'مربعات', PAGE + '<path d="M5 9h14M5 15h14M9.7 3v18M14.3 3v18"/>'],
    ['dots', 'نقاط', PAGE + '<path d="M9 8h.01M15 8h.01M9 12h.01M15 12h.01M9 16h.01M15 16h.01" stroke-width="2.6"/>']
  ];
  const TPL_KEY = 'medixa.studio.blanktpl';
  const readTpl = () => { try { const v = localStorage.getItem(TPL_KEY); return TPL.some(t => t[0] === v) ? v : 'lined'; } catch { return 'lined'; } };
  function init() {
    const header = document.querySelector('header'), menu = $('st-docmenu'), actions = $('studio-hdr-actions');
    if (!header || !menu || !actions) return;
    const M = window.MedixaStudio;
    const make = (id, label, path, action) => {
      const b = document.createElement('button'); b.id = id; b.type = 'button'; b.className = 'st-hdr-btn';
      b.title = label; b.setAttribute('aria-label', label); b.innerHTML = svg(path); b.onclick = action; return b;
    };
    const nav = document.createElement('nav'); nav.id = 'st-compact-nav'; nav.setAttribute('aria-label', 'تنقل المستند');
    const move = (id, target) => { const n = $(id); if (n) target.append(n); };
    const back = $('st-back');
    if (back) { const lab = back.querySelector('.st-lab'), t = lab ? lab.textContent : ''; back.innerHTML = svg(ICON.back) + '<span class="st-lab"></span>'; back.querySelector('.st-lab').textContent = t; nav.append(back); }
    move('medixa-thumbs-toggle', nav);
    if (M && M.addBlank && M.reader) nav.append(addPage(M));
    const find = $('st-find-btn'); if (find) { find.innerHTML = svg(ICON.find); nav.append(find); }
    const files = make('st-compact-files', 'المستندات وأدوات الدراسة', ICON.files, e => { e.stopPropagation(); $('st-docmenu-btn').click(); });
    files.setAttribute('aria-controls', 'st-docmenu'); files.setAttribute('aria-expanded', 'false'); nav.append(files);
    header.prepend(nav);
    // the bar starts right after this pill on wide screens (CSS --st-nav-w)
    const navW = () => document.documentElement.style.setProperty('--st-nav-w', Math.ceil(nav.getBoundingClientRect().width) + 'px');
    if (window.ResizeObserver) new ResizeObserver(navW).observe(nav); navW();
    // Tabs keep their original handlers and storage; only their location changes.
    const docs = document.createElement('section'); docs.id = 'st-compact-documents'; docs.setAttribute('aria-label', 'المستندات المفتوحة');
    const brand = header.querySelector('.st-brand'); if (brand) docs.append(brand);
    move('st-tabs', docs); move('st-home', docs); menu.prepend(docs);
    move('study-launch', menu); move('st-dock-more', menu);
    const status = $('status'); if (status) actions.prepend(status);
    // «ملاحظاتي» becomes the first row of «المزيد» (Notewise's right pill holds only the eye and more); panels.js may add it later
    const notes = () => { const n = $('st-notes-toggle'); if (!n) return false; if (n.parentElement !== menu) docs.after(n); return true; };
    if (!notes()) { const mo = new MutationObserver(() => { if (notes()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 10000); }
    header.append(actions);
    const dock = $('mx-dock');
    if (dock) {
      const close = make('st-compact-dock-close', 'إغلاق الأدوات الأخرى', '<path d="m6 6 12 12M18 6 6 18"/>', () => {
        dock.classList.remove('st-dock-open'); $('st-dock-more')?.setAttribute('aria-expanded', 'false');
      });
      dock.append(close);
    }
    // Page up / down on the right edge (as in Notewise); they press the dock's own previous / next buttons.
    const edge = document.createElement('div'); edge.id = 'st-edge-nav'; edge.setAttribute('role', 'group'); edge.setAttribute('aria-label', 'تقليب الصفحات');
    const step = sel => () => document.querySelector('#mx-reader-nav ' + sel)?.click();
    edge.append(make('st-edge-prev', 'الصفحة السابقة', '<path d="m6 15 6-6 6 6"/>', step('[data-mx-prev]')), make('st-edge-next', 'الصفحة التالية', '<path d="m6 9 6 6 6-6"/>', step('[data-mx-next]')));
    document.body.append(edge);
    const expanded = () => files.setAttribute('aria-expanded', String(!menu.hidden));
    new MutationObserver(expanded).observe(menu, { attributes: true, attributeFilter: ['hidden'] });
    // Keep the secondary dock dismissible without closing document/ink dialogs.
    document.addEventListener('keydown', e => {
      if (e.key !== 'Escape') return;
      $('mx-dock')?.classList.remove('st-dock-open'); $('st-dock-more')?.setAttribute('aria-expanded', 'false');
    });
  }
  /* ＋ in the left pill: a blank page after the current one (lined / blank / grid / dots), the same as the pages panel's
     button; the last choice is remembered on this device. The list sits right after its button, so the shared
     «tap outside closes» rule of the toolbar leaves it alone. */
  function addPage(M) {
    const wrap = document.createElement('span'); wrap.className = 'st-addwrap';
    const b = document.createElement('button'); b.type = 'button'; b.id = 'st-add-page'; b.className = 'st-hdr-btn';
    b.title = 'إضافة صفحة'; b.setAttribute('aria-label', 'إضافة صفحة'); b.innerHTML = svg(ICON.addPage);
    b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false'); b.setAttribute('aria-controls', 'st-addpage-pop');
    const pop = document.createElement('div'); pop.id = 'st-addpage-pop'; pop.className = 'st-pop st-addpage'; pop.hidden = true;
    pop.setAttribute('role', 'group'); pop.setAttribute('aria-label', 'إضافة صفحة بعد الحالية');
    const h = document.createElement('p'); h.className = 'st-pop-h'; h.textContent = 'إضافة صفحة بعد الحالية'; pop.append(h);
    for (const [v, name, icon] of TPL) {
      const o = document.createElement('button'); o.type = 'button'; o.dataset.tpl = v; o.innerHTML = svg(icon);
      const s = document.createElement('span'); s.textContent = name; o.append(s); o.setAttribute('aria-label', 'صفحة ' + name);
      o.onclick = () => {
        pop.hidden = true; b.setAttribute('aria-expanded', 'false');
        try { localStorage.setItem(TPL_KEY, v); } catch {}
        const sel = $('st-blank-tpl'); if (sel) sel.value = v;              /* the pages panel's own choice follows */
        const R = M.reader; if (!R || !R.pages) return;
        const cur = R.current(), ref = R.pages.find(p => p.kind === 'src') || { w: 595, h: 842 };
        const rec = M.addBlank(cur, v, { w: ref.w, h: ref.h }); if (!rec) return;
        setTimeout(() => R.goto(rec.id), 150);
        if (M.toast) M.toast('أُضيفت صفحة ' + name + ' بعد الحالية');
      };
      pop.append(o);
    }
    b.onclick = () => {
      const open = pop.hidden; if (M.closePops) M.closePops(); else document.querySelectorAll('.st-pop').forEach(p => { p.hidden = true; });
      if (open) { const cur = readTpl(); pop.querySelectorAll('[data-tpl]').forEach(o => o.setAttribute('aria-pressed', String(o.dataset.tpl === cur))); }
      pop.hidden = !open; b.setAttribute('aria-expanded', String(open));
    };
    wrap.append(b, pop); return wrap;
  }
  if (document.readyState === 'loading') document.addEventListener('DOMContentLoaded', init, { once: true }); else init();
})();
