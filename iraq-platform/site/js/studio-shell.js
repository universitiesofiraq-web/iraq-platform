/* MEDIXA Study Studio — shell. Layout only: relocates the existing reader controls (their handlers stay attached) so
   there is one slim header (brand · tabs · save state · study tools · «المزيد»), one drawing toolbar and one bottom bar
   (pages · page navigation · zoom · other study tools · notes). Nothing here saves or draws. */
(function () {
  'use strict';
  const $ = id => document.getElementById(id);
  const hdr = document.querySelector('header'); if (!hdr) return;
  /* way back to the site (iPad home-screen app has no browser back button): the page that opened the reader, else home */
  if (!$('st-back')) {
    let back = 'index.html', label = 'الرئيسية';
    try { const r = document.referrer && new URL(document.referrer); if (r && r.origin === location.origin && !/pdf-notes/.test(r.pathname)) { back = r.pathname + r.search + r.hash; label = 'رجوع'; } } catch {}
    const a = document.createElement('a'); a.id = 'st-back'; a.className = 'st-hdr-btn st-back'; a.href = back; a.setAttribute('aria-label', label === 'رجوع' ? 'رجوع إلى المادة' : 'الصفحة الرئيسية');
    a.innerHTML = '<span>‹ <span class="st-lab"></span></span>'; a.querySelector('.st-lab').textContent = label; a.title = a.getAttribute('aria-label'); hdr.prepend(a);
    if (label === 'رجوع') { const h = document.createElement('a'); h.id = 'st-home'; h.className = 'st-hdr-btn st-back'; h.href = 'index.html'; h.setAttribute('aria-label', 'الصفحة الرئيسية'); h.title = 'الصفحة الرئيسية'; h.innerHTML = '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="m3 10 9-7 9 7v10a1 1 0 0 1-1 1h-5v-6H9v6H4a1 1 0 0 1-1-1z"/></svg>'; a.after(h); }
  }
  const M = window.MedixaStudio;
  const svg = d => '<svg viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON = {
    more: '<circle cx="5" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="12" cy="12" r="1.8" fill="currentColor" stroke="none"/><circle cx="19" cy="12" r="1.8" fill="currentColor" stroke="none"/>',   /* three solid dots (Notewise) */
    download: '<path d="M12 3v12"/><path d="m7 10 5 5 5-5"/><path d="M5 21h14"/>',
    dark: '<path d="M21 12.8A9 9 0 1 1 11.2 3a7 7 0 0 0 9.8 9.8z"/>',
    focus: '<path d="M8 3H5a2 2 0 0 0-2 2v3M21 8V5a2 2 0 0 0-2-2h-3M3 16v3a2 2 0 0 0 2 2h3M16 21h3a2 2 0 0 0 2-2v-3"/>',
    split: '<rect x="3" y="4" width="18" height="16" rx="2"/><path d="M12 4v16"/>',
    suite: '<rect x="3" y="3" width="7" height="7" rx="1"/><rect x="14" y="3" width="7" height="7" rx="1"/><rect x="3" y="14" width="7" height="7" rx="1"/><path d="M17.5 14v7M14 17.5h7"/>',
    study: '<path d="M12 7v14"/><path d="M3 18a1 1 0 0 1-1-1V4a1 1 0 0 1 1-1h5a4 4 0 0 1 4 4 4 4 0 0 1 4-4h5a1 1 0 0 1 1 1v13a1 1 0 0 1-1 1h-6a3 3 0 0 0-3 3 3 3 0 0 0-3-3z"/>',
    pages: '<rect x="4" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="4" width="6.5" height="6.5" rx="1.6"/><rect x="4" y="13.5" width="6.5" height="6.5" rx="1.6"/><rect x="13.5" y="13.5" width="6.5" height="6.5" rx="1.6"/>',   /* 2×2 equal squares (Notewise) */
    tools: '<path d="M4 21v-7M4 10V3M12 21v-9M12 8V3M20 21v-5M20 12V3M1 14h6M9 8h6M17 16h6"/>',
    prev: '<path d="m9 18 6-6-6-6"/>', next: '<path d="m15 18-6-6 6-6"/>'
  };
  const label = (b, icon, text) => { b.innerHTML = svg(ICON[icon]) + '<span class="st-lab">' + text + '</span>'; b.setAttribute('aria-label', text); b.title = text; };

  /* ---- header ---- */
  let acts = $('studio-hdr-actions');
  if (!acts) { acts = document.createElement('div'); acts.id = 'studio-hdr-actions'; acts.className = 'st-hdr-actions'; hdr.append(acts); }
  const status = $('status'); if (status) { status.setAttribute('role', 'status'); acts.before(status); }
  const launch = $('study-launch'); if (launch) { label(launch, 'study', 'أدوات الدراسة'); launch.classList.add('st-hdr-btn', 'st-primary'); acts.append(launch); }
  const menuBtn = document.createElement('button'); menuBtn.type = 'button'; menuBtn.id = 'st-docmenu-btn'; menuBtn.className = 'st-hdr-btn'; menuBtn.innerHTML = svg(ICON.more); menuBtn.setAttribute('aria-label', 'المزيد'); menuBtn.title = 'المزيد';
  menuBtn.setAttribute('aria-haspopup', 'true'); menuBtn.setAttribute('aria-expanded', 'false');
  const menu = document.createElement('div'); menu.id = 'st-docmenu'; menu.className = 'st-pop st-docmenu'; menu.hidden = true; menu.setAttribute('role', 'group'); menu.setAttribute('aria-label', 'خيارات المستند');
  menuBtn.onclick = () => { const open = menu.hidden; if (M && M.closePops) M.closePops(); menu.hidden = !open; menuBtn.setAttribute('aria-expanded', String(open)); };
  menu.addEventListener('click', e => { if (e.target.closest('button')) { menu.hidden = true; menuBtn.setAttribute('aria-expanded', 'false'); } });
  acts.append(menuBtn, menu);
  const dl = $('download'); if (dl) { label(dl, 'download', 'تنزيل PDF بالتعليقات'); menu.append(dl); }
  /* v5 / v85 buttons: static labels get an SVG icon; the bookmark keeps the label v5 updates (☆ / ★) */
  const MENU = [['medixa-bookmark', null, ''], ['medixa-dark', 'dark', 'الوضع الليلي'], ['medixa-split-toggle', 'split', 'تقسيم الشاشة'], ['medixa-focus', 'focus', 'وضع التركيز'], ['medixa-suite-toggle', 'suite', 'مساحة الدراسة']];
  function adoptMenu() {
    for (const [id, icon, text] of MENU) { const b = $(id); if (!b || b.parentElement === menu) continue; if (icon) label(b, icon, text); else b.setAttribute('aria-label', 'حفظ الصفحة'); menu.append(b); }
  }

  /* ---- bottom bar: the v9.1 dock keeps its own items (and their order); we add the panel toggles and zoom ---- */
  let more = null;
  function adoptDock() {
    const dock = $('mx-dock'); if (!dock) return false;
    const th = $('medixa-thumbs-toggle'); if (th && th.parentElement !== dock) { label(th, 'pages', 'الصفحات'); th.classList.add('st-dock-btn'); dock.append(th); }
    if (!more) {
      more = document.createElement('button'); more.type = 'button'; more.id = 'st-dock-more'; more.className = 'st-dock-btn'; label(more, 'tools', 'أدوات أخرى');
      more.setAttribute('aria-expanded', 'false'); more.onclick = () => { const open = !dock.classList.contains('st-dock-open'); dock.classList.toggle('st-dock-open', open); more.setAttribute('aria-expanded', String(open)); };
      const br = document.createElement('span'); br.id = 'st-dock-break'; br.setAttribute('aria-hidden', 'true');
      dock.append(more, br);
    }
    const nav = $('mx-reader-nav'); if (nav && !nav.dataset.stIcons) { nav.dataset.stIcons = '1'; const p = nav.querySelector('[data-mx-prev]'), n = nav.querySelector('[data-mx-next]'); if (p) p.innerHTML = svg(ICON.prev); if (n) n.innerHTML = svg(ICON.next); }
    return true;
  }
  function adopt() {
    const bar = $('medixa-reader-bar'); if (!bar) return false;
    adoptMenu(); if (!adoptDock()) return false;
    bar.hidden = true; document.body.classList.add('studio-shell'); return true;
  }
  /* zoom cluster (CSS-only zoom; stored coordinates never change) */
  function zoomUi() {
    if ($('st-zoom') || !M || !M.reader) return;
    const z = document.createElement('div'); z.id = 'st-zoom'; z.setAttribute('role', 'group'); z.setAttribute('aria-label', 'التكبير');
    const mk = (id, lab, text, fn) => { const b = document.createElement('button'); b.type = 'button'; b.id = id; b.setAttribute('aria-label', lab); b.title = lab; b.textContent = text; b.onclick = fn; z.append(b); return b; };
    mk('st-zoom-out', 'تصغير', '−', () => M.reader.zoomBy(1 / 1.15)); const lab = mk('st-zoom-label', 'ملاءمة العرض', '100%', () => M.reader.fit()); mk('st-zoom-in', 'تكبير', '+', () => M.reader.zoomBy(1.15));
    ($('mx-dock') || document.body).append(z); M.reader.on('zoom', v => { lab.textContent = Math.round(v * 100) + '%'; }); M.reader.on('zoompreview', v => { lab.textContent = Math.round(v * 100) + '%'; });
  }
  /* focus mode: keep the save status visible (the header is hidden) */
  (function () {
    const st = document.createElement('div'); st.id = 'st-focus-status'; st.setAttribute('role', 'status'); document.body.append(st);
    const src = $('status'); if (!src) return; const mirror = () => { st.textContent = src.textContent; };
    new MutationObserver(mirror).observe(src, { childList: true, characterData: true, subtree: true }); mirror();
  })();
  const done = () => { adoptMenu(); zoomUi(); };
  if (adopt()) done(); else { const mo = new MutationObserver(() => { if (adopt()) { mo.disconnect(); done(); } }); mo.observe(document.body, { childList: true }); setTimeout(() => { mo.disconnect(); done(); }, 8000); }
})();
