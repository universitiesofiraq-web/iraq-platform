/* reader-pro.js — طبقة «اكتب وظلّل» الاحترافية (2026-11-19، بطلب محمد). لا تغيّر محرّك الكتابة ولا التخزين.
   1) الوضع الليلي واحد مع المنصة: body.medixa-dark (ما تقرؤه أوراق القارئ ومحرّك الحبر) يتبع html[data-theme]
      من theme.js، وزر «الوضع الليلي» في قائمة «المزيد» صار يبدّل وضع المنصة نفسه (ms.theme).
   2) زر «المرشد الذكي» لا يغطي أشرطة الأدوات: يُحسب ارتفاع الأشرطة السفلية على الهاتف، ويخفت أثناء الكتابة. */
(function () {
  'use strict';
  var body = document.body, root = document.documentElement, DARK = 'medixa-dark';
  body.classList.add('st-pro');

  /* ---------- 1) الوضع الليلي ---------- */
  function isDark() { return root.getAttribute('data-theme') === 'dark'; }
  function sync() {
    var d = isDark();
    if (body.classList.contains(DARK) !== d) body.classList.toggle(DARK, d);
    var b = document.getElementById('medixa-dark');
    if (b) { var t = d ? 'الوضع النهاري' : 'الوضع الليلي'; b.setAttribute('aria-label', t); b.title = t; b.setAttribute('aria-pressed', String(d)); var l = b.querySelector('.st-lab'); if (l) l.textContent = t; }
  }
  /* زر القائمة القديم (study-mode-v5) كان يحفظ وضعاً خاصاً بالقارئ: نلتقط الضغطة قبله ونبدّل وضع المنصة */
  document.addEventListener('click', function (e) {
    var b = e.target && e.target.closest && e.target.closest('#medixa-dark'); if (!b) return;
    e.preventDefault(); e.stopImmediatePropagation();
    if (window.DSTheme) DSTheme.toggle(); else root.setAttribute('data-theme', isDark() ? 'light' : 'dark');
    var m = document.getElementById('st-docmenu'), mb = document.getElementById('st-docmenu-btn');
    if (m) m.hidden = true; if (mb) mb.setAttribute('aria-expanded', 'false');
    sync();
  }, true);
  document.addEventListener('ds:theme', sync);
  new MutationObserver(sync).observe(root, { attributes: true, attributeFilter: ['data-theme'] });
  new MutationObserver(sync).observe(body, { attributes: true, attributeFilter: ['class'] });
  sync();

  /* ---------- 2) زر المرشد الذكي ---------- */
  var phone = window.matchMedia ? matchMedia('(max-width: 720px)') : { matches: false };
  function bottomBars() {
    /* أعلى نقطة لأي شريط ثابت في أسفل الشاشة (شريط الرسم على الهاتف، شريط الصفحة) */
    var top = innerHeight, sel = ['#studio-toolbar', '#mx-dock', '#st-quickbar', '.st-quick'];
    sel.forEach(function (s) {
      var el = document.querySelector(s); if (!el || el.hidden) return;
      var r = el.getBoundingClientRect(); if (!r.height || r.top < innerHeight * 0.5) return;
      top = Math.min(top, r.top);
    });
    return Math.max(0, innerHeight - top);
  }
  function placeFab() {
    var fab = document.querySelector('.sab-fab'); if (!fab) return;
    if (!fab.dataset.rp) {
      fab.dataset.rp = '1';
      var label = (fab.textContent || '').replace(/^\s*🤖\s*/, '').trim() || 'المرشد الذكي';
      fab.textContent = '';
      var ic = document.createElement('span'); ic.setAttribute('aria-hidden', 'true'); ic.textContent = '🤖';
      var lab = document.createElement('span'); lab.className = 'rp-lab'; lab.textContent = ' ' + label;
      fab.append(ic, lab); fab.setAttribute('aria-label', label); fab.title = label;
    }
    root.style.setProperty('--rp-bottom', (phone.matches ? bottomBars() + 12 : 0) + 'px');
  }
  var pt = 0; function soon() { clearTimeout(pt); pt = setTimeout(placeFab, 120); }
  addEventListener('resize', soon);
  if (phone.addEventListener) phone.addEventListener('change', soon);
  new MutationObserver(soon).observe(body, { childList: true });
  setTimeout(placeFab, 600); setTimeout(placeFab, 2500);

  /* يخفت الزر أثناء الكتابة بالقلم أو الإصبع على الصفحة */
  var inkT = 0;
  addEventListener('pointerdown', function (e) {
    if (!e.target || !e.target.closest || !e.target.closest('canvas.ink, canvas.over')) return;
    body.classList.add('rp-inking'); clearTimeout(inkT);
  }, true);
  addEventListener('pointerup', function () { clearTimeout(inkT); inkT = setTimeout(function () { body.classList.remove('rp-inking'); }, 1500); }, true);
})();
