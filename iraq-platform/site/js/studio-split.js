/* MEDIXA Study Studio — split view. The second pane is an independent reader (iframe, ?embed=1): its own document, scroll,
   zoom, toolbar, history and storage. A draggable divider (pointer + keyboard) sets the width; on narrow screens a pane
   switcher shows one pane at a time instead of two unreadable columns. */
(function () {
  'use strict';
  const M = window.MedixaStudio; if (!M) return;
  const params = new URLSearchParams(location.search), src = params.get('file');
  if (!src || params.get('embed') === '1') return;
  const $ = id => document.getElementById(id);
  const el = (t, c, x) => { const e = document.createElement(t); if (c) e.className = c; if (x != null) e.textContent = x; return e; };
  const KEY = 'medixa.studio.split.v1', MIN = 280, narrow = () => matchMedia('(max-width: 899px)').matches;
  const rd = () => { try { const v = JSON.parse(localStorage.getItem(KEY)); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const wr = o => { try { localStorage.setItem(KEY, JSON.stringify(o)); } catch {} };
  let st = Object.assign({ on: false, src: '', w: 0 }, rd()), host = null, frame = null, divider = null, savedY = 0;
  const maxW = () => Math.max(MIN, innerWidth - MIN);
  const clampW = w => Math.min(maxW(), Math.max(MIN, Math.round(w)));
  const rtl = () => getComputedStyle(document.documentElement).direction === 'rtl';
  function setW(w, persist) { st.w = clampW(w); document.documentElement.style.setProperty('--st-split-w', st.w + 'px'); if (divider) { divider.setAttribute('aria-valuenow', String(st.w)); divider.setAttribute('aria-valuemax', String(maxW())); } if (persist) wr(st); }
  function build() {
    host = el('aside', 'st-split'); host.id = 'st-split'; host.setAttribute('aria-label', 'المستند الثاني');
    const sw = el('div', 'st-split-switch'); sw.id = 'st-split-switch'; sw.setAttribute('role', 'tablist'); sw.setAttribute('aria-label', 'تبديل المستند');
    const a = el('button', 'st-sw-b', 'المستند الأول'); a.type = 'button'; a.id = 'st-sw-main'; a.setAttribute('role', 'tab'); const b = el('button', 'st-sw-b', 'المستند الثاني'); b.type = 'button'; b.id = 'st-sw-second'; b.setAttribute('role', 'tab');
    a.onclick = () => showPane('main'); b.onclick = () => showPane('second'); sw.append(a, b);
    divider = el('div', 'st-divider'); divider.id = 'st-divider'; divider.tabIndex = 0; divider.setAttribute('role', 'separator'); divider.setAttribute('aria-orientation', 'vertical'); divider.setAttribute('aria-label', 'تغيير عرض المستند الثاني'); divider.setAttribute('aria-valuemin', String(MIN));
    const x = el('button', 'st-split-x', '✕ إغلاق العرض الثاني'); x.type = 'button'; x.id = 'st-split-close'; x.onclick = close;
    frame = document.createElement('iframe'); frame.className = 'st-pane2'; frame.id = 'st-pane2';
    host.append(divider, x, frame); document.body.append(host, sw);
    divider.addEventListener('pointerdown', e => { e.preventDefault(); divider.setPointerCapture(e.pointerId); document.body.classList.add('st-dragging'); });
    divider.addEventListener('pointermove', e => { if (!divider.hasPointerCapture(e.pointerId)) return; setW(rtl() ? e.clientX : innerWidth - e.clientX); });
    const end = e => { if (divider.hasPointerCapture(e.pointerId)) { divider.releasePointerCapture(e.pointerId); document.body.classList.remove('st-dragging'); wr(st); } };
    divider.addEventListener('pointerup', end); divider.addEventListener('pointercancel', end);
    divider.addEventListener('keydown', e => {
      const step = e.shiftKey ? 96 : 24, sign = rtl() ? 1 : -1;     /* RTL: the pane sits at the left edge, so moving the divider right widens it */
      let w = st.w;
      if (e.key === 'ArrowRight') w += sign * step; else if (e.key === 'ArrowLeft') w -= sign * step;
      else if (e.key === 'Home') w = MIN; else if (e.key === 'End') w = maxW(); else return;
      e.preventDefault(); setW(w, true);
    });
    addEventListener('resize', () => { if (st.on) { setW(st.w); applyMode(); } });
  }
  function applyMode() {
    document.body.classList.toggle('st-split-narrow', st.on && narrow());
    if (st.on && narrow() && !document.body.classList.contains('st-show-second') && !document.body.classList.contains('st-show-main')) showPane('main');
  }
  function showPane(which) {
    if (which === 'second') { savedY = scrollY; document.body.classList.add('st-show-second'); document.body.classList.remove('st-show-main'); }
    else { document.body.classList.remove('st-show-second'); document.body.classList.add('st-show-main'); setTimeout(() => scrollTo(0, savedY), 0); }
    $('st-sw-main').setAttribute('aria-selected', String(which === 'main')); $('st-sw-second').setAttribute('aria-selected', String(which === 'second'));
  }
  function open(second) {
    if (!second) return; if (second === src) { alert('هذا هو المستند المفتوح هنا. اختر مستنداً آخر أو دفتراً.'); return; }
    if (!host) build();
    st.on = true; st.src = second; if (!st.w) st.w = Math.round(innerWidth * 0.42); wr(st);
    frame.src = 'pdf-notes.html?file=' + encodeURIComponent(second) + '&embed=1'; frame.title = M.tabs ? M.tabs.titleFor(second) : second;
    host.classList.add('open'); document.body.classList.add('st-split-on'); setW(st.w); applyMode();
    if (narrow()) showPane('second');
  }
  function close() {
    st.on = false; wr(st); if (host) { host.classList.remove('open'); frame.src = 'about:blank'; }
    document.body.classList.remove('st-split-on', 'st-split-narrow', 'st-show-second', 'st-show-main'); document.documentElement.style.removeProperty('--st-split-w');
  }
  function choose() {
    if (st.on) return close();
    if (M.tabs && M.tabs.openMenu) M.tabs.openMenu(open);
  }
  function adopt() {
    const b = $('medixa-split-toggle'); if (!b) return false;
    b.onclick = choose; b.setAttribute('aria-label', 'تقسيم الشاشة');
    return true;
  }
  if (!adopt()) { const mo = new MutationObserver(() => { if (adopt()) mo.disconnect(); }); mo.observe(document.body, { childList: true, subtree: true }); setTimeout(() => mo.disconnect(), 10000); }
  if (st.on && st.src) setTimeout(() => open(st.src), 0);
  M.split = { open, close, choose, state: () => Object.assign({}, st), setW };
})();
