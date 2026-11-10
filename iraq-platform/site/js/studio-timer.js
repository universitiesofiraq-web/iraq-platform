/* MEDIXA Study Studio — study timer (طلب محمد 5، 2026-10-21، كما في فيديو Notewise).
   A ⏱ button on the toolbar opens a small panel: «25 / 5» or «50 / 10» (focus then break, cycling by itself) or «وقت
   مفتوح» (counts up). «جاهز» puts a floating bar on the page (ابدأ / إيقاف / إعادة / إنهاء) that shrinks to a round
   badge. A setting makes it see-through. Time is kept as timestamps in medixa.studytimer.v1 (one per device, not per
   file), so it survives switching files and never drifts. Nothing is synced or added to the document. */
(function () {
  'use strict';
  const M = window.MedixaStudio;
  const $ = id => document.getElementById(id);
  const KEY = 'medixa.studytimer.v1';
  const PRESETS = { p25: { f: 25, b: 5, label: '25 / 5' }, p50: { f: 50, b: 10, label: '50 / 10' }, open: { label: 'وقت مفتوح' } };
  const svg = (d, n) => '<svg viewBox="0 0 24 24" width="' + (n || 22) + '" height="' + (n || 22) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const ICON = '<path d="M9.5 3h5"/><circle cx="12" cy="13.5" r="7.5"/><path d="M12 13.5V9.5"/>';
  const el = (tag, cls, text) => { const e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; };
  const now = () => Date.now();

  /* ---------------- state ---------------- */
  const DEF = { v: 1, preset: 'p25', name: '', view: 'bar', ghost: false, op: 0.4, sound: true, seen: 0, hist: [], s: null };
  let mem = null;
  function read() {
    let v = null; try { v = JSON.parse(localStorage.getItem(KEY) || 'null'); } catch {}
    if (!v || typeof v !== 'object') return mem ? JSON.parse(JSON.stringify(mem)) : JSON.parse(JSON.stringify(DEF));
    const o = Object.assign({}, DEF, v);
    if (!PRESETS[o.preset]) o.preset = 'p25'; if (o.view !== 'badge') o.view = 'bar';
    o.op = Math.min(0.9, Math.max(0.2, +o.op || 0.4)); o.hist = Array.isArray(o.hist) ? o.hist.slice(-100) : [];
    return o;
  }
  function write() { mem = state; try { localStorage.setItem(KEY, JSON.stringify(state)); } catch {} }
  let state = read();
  const durs = s => { const p = PRESETS[s.preset] || PRESETS.p25; return { f: (p.f || 25) * 60000, b: (p.b || 5) * 60000 }; };
  function log(min, preset) {
    if (min < 1) return;
    state.hist.push({ at: new Date().toISOString(), preset, min: Math.round(min), name: state.name || '' }); state.hist = state.hist.slice(-100);
  }
  /* how much time is left (countdown) or has passed (open) */
  function value(s, t) {
    if (s.preset === 'open') return s.running ? t - s.t0 : s.elapsed || 0;
    return s.running ? Math.max(0, s.phaseEnd - t) : s.left;
  }
  /* advance through the phases that ended (automatic cycle); returns the cue to give (or null) */
  function advance(silent) {
    const s = state.s; if (!s || !s.running || s.preset === 'open') return null;
    const t = now(); if (t < s.phaseEnd) return null;
    const d = durs(s), cycle = d.f + d.b; let cue = null, steps = 0;
    if (t - s.phaseEnd > cycle) {                                      /* away for long: stop at the next focus round */
      while (s.phaseEnd <= t && steps < 4) { if (s.phase === 'focus') log(d.f / 60000, s.preset); s.phase = s.phase === 'focus' ? 'break' : 'focus'; if (s.phase === 'focus') s.round++; s.phaseEnd += s.phase === 'focus' ? d.f : d.b; steps++; }
      s.phase = 'focus'; s.running = false; s.left = d.f; s.away = true; write(); return null;
    }
    while (s.phaseEnd <= t && steps < 4) {
      if (s.phase === 'focus') { log(d.f / 60000, s.preset); s.phase = 'break'; s.phaseEnd += d.b; cue = 'break'; }
      else { s.phase = 'focus'; s.round++; s.phaseEnd += d.f; cue = 'focus'; }
      steps++;
    }
    write(); return silent ? null : cue;
  }

  /* ---------------- sound ---------------- */
  let ac = null;
  const unlock = () => { try { if (!ac) { const A = window.AudioContext || window.webkitAudioContext; if (A) ac = new A(); } if (ac && ac.state === 'suspended') ac.resume(); } catch {} };
  addEventListener('pointerdown', unlock, { passive: true, capture: true });
  function beep(freqs) {
    if (!state.sound || document.hidden || !ac) return;
    try {
      let t = ac.currentTime + 0.02;
      for (const f of freqs) { const o = ac.createOscillator(), g = ac.createGain(); o.type = 'sine'; o.frequency.value = f; g.gain.setValueAtTime(0, t); g.gain.linearRampToValueAtTime(0.25, t + 0.02); g.gain.exponentialRampToValueAtTime(0.001, t + 0.32); o.connect(g).connect(ac.destination); o.start(t); o.stop(t + 0.34); t += 0.45; }
    } catch {}
    try { navigator.vibrate && navigator.vibrate([200, 100, 200]); } catch {}
  }

  /* ---------------- formatting ---------------- */
  const two = n => String(n).padStart(2, '0');
  function fmt(ms, up) { const sec = up ? Math.floor(ms / 1000) : Math.ceil(ms / 1000), h = Math.floor(sec / 3600), m = Math.floor(sec % 3600 / 60), s = sec % 60; return h ? h + ':' + two(m) + ':' + two(s) : two(m) + ':' + two(s); }
  function caption(s) {
    const pre = state.name ? state.name + ' · ' : '';
    if (s.away && !s.running) return pre + 'توقّف المؤقت أثناء غيابك — اضغط ابدأ';
    if (s.preset === 'open') return pre + 'وقت مفتوح';
    const d = durs(s);
    return s.phase === 'break' ? pre + 'استراحة · ' + d.b / 60000 + ' د' : pre + 'تركيز · الجولة ' + s.round + ' · ' + d.f / 60000 + ' د';
  }

  /* ---------------- floating widget ---------------- */
  let fl = null, tick = 0, wakeT = 0;
  const parts = {};
  function buildFloat() {
    fl = el('div', 'st-tm-float'); fl.id = 'st-timer-float'; fl.dir = 'rtl';
    const col = el('button', 'tm-col'); col.type = 'button'; col.setAttribute('aria-label', 'تصغير المؤقت'); col.innerHTML = svg('<path d="M4 14h6v6M20 10h-6V4M14 10l7-7M3 21l7-7"/>', 20);
    col.onclick = () => { state.view = 'badge'; write(); render(true); };
    const sep = el('span', 'tm-sep'); sep.setAttribute('aria-hidden', 'true');
    const txt = el('div', 'tm-txt'); parts.cap = el('span', 'tm-cap'); parts.time = el('span', 'tm-time'); parts.time.setAttribute('role', 'timer'); parts.time.dir = 'ltr'; txt.append(parts.cap, parts.time);
    const sp = el('span', 'tm-sp');
    parts.end = el('button', 'tm-end', 'إنهاء'); parts.end.type = 'button'; parts.end.onclick = endSession;
    parts.reset = el('button', 'tm-reset', 'إعادة'); parts.reset.type = 'button'; parts.reset.onclick = resetSession;
    parts.main = el('button', 'tm-main', 'ابدأ'); parts.main.type = 'button'; parts.main.onclick = () => { const s = state.s; if (!s) return; if (s.running) pause(); else startRun(); };
    const bar = el('div', 'tm-bar'); bar.append(col, sep, txt, sp, parts.end, parts.reset, parts.main);
    /* the badge: a ring with the time inside; tap to expand */
    const badge = el('button', 'tm-badge'); badge.type = 'button';
    badge.innerHTML = '<svg viewBox="0 0 48 48" aria-hidden="true"><circle class="tm-trk" cx="24" cy="24" r="21"/><circle class="tm-prog" cx="24" cy="24" r="21"/></svg>';
    parts.btime = el('span', 'tm-btime'); parts.btime.dir = 'ltr'; badge.append(parts.btime); parts.badge = badge; parts.ring = badge.querySelector('.tm-prog');
    badge.onclick = () => { state.view = 'bar'; write(); render(true); };
    parts.live = el('span', 'tm-live'); parts.live.setAttribute('role', 'status');
    fl.append(bar, badge, parts.live);
    fl.addEventListener('pointerdown', () => { fl.classList.add('is-awake'); clearTimeout(wakeT); wakeT = setTimeout(() => fl && fl.classList.remove('is-awake'), 3000); });
    document.body.append(fl);
  }
  function place() {
    if (!fl) return;
    const tb = $('studio-toolbar'), qb = $('st-quickbar'), en = $('st-edge-nav');
    let bottom = 60;
    const vis = e => e && e.offsetParent !== null && getComputedStyle(e).visibility !== 'hidden' && getComputedStyle(e).opacity !== '0';
    if (tb && vis(tb)) { const r = tb.getBoundingClientRect(); if (r.top < innerHeight / 2) bottom = Math.max(bottom, r.bottom); }
    if (qb && vis(qb)) bottom = Math.max(bottom, qb.getBoundingClientRect().bottom);
    const hdr = document.querySelector('header'); if (hdr && innerWidth <= 720) bottom = Math.max(bottom, hdr.getBoundingClientRect().bottom);
    let right = 8; if (en && vis(en)) right = innerWidth - en.getBoundingClientRect().left + 8;
    fl.style.top = Math.round(bottom + 10) + 'px'; fl.style.right = Math.round(right) + 'px';
  }
  function render(animate) {
    const s = state.s;
    if (!s) { if (fl) { fl.remove(); fl = null; } clearInterval(tick); tick = 0; syncBtn(); return; }
    if (!fl) buildFloat();
    fl.classList.toggle('is-bar', state.view !== 'badge'); fl.classList.toggle('is-badge', state.view === 'badge');
    fl.classList.toggle('is-ghost', !!state.ghost); fl.style.setProperty('--tm-op', state.op);
    fl.classList.toggle('is-break', s.phase === 'break');
    if (animate) { fl.classList.remove('tm-anim'); void fl.offsetWidth; fl.classList.add('tm-anim'); }
    update(); place();
    if (!tick) tick = setInterval(onTick, 1000);
    syncBtn();
  }
  function update() {
    const s = state.s; if (!s || !fl) return;
    const t = now(), v = value(s, t), up = s.preset === 'open';
    parts.time.textContent = fmt(v, up); parts.btime.textContent = fmt(v, up);
    fl.classList.toggle('tm-hour', v >= 3600000);
    parts.cap.textContent = caption(s);
    const started = up ? v > 0 : v < durs(s)[s.phase === 'break' ? 'b' : 'f'] || s.round > 1;
    parts.reset.classList.toggle('is-off', !started && !s.running);
    parts.main.textContent = s.running ? 'إيقاف' : (started ? 'تابع' : 'ابدأ');
    parts.main.classList.toggle('is-run', !!s.running);
    parts.badge.setAttribute('aria-label', 'مؤقت الدراسة ' + fmt(v, up) + ' — اضغط للتكبير');
    const C = 2 * Math.PI * 21, full = up ? 1 : v / Math.max(1, durs(s)[s.phase === 'break' ? 'b' : 'f']);
    parts.ring.style.strokeDasharray = C; parts.ring.style.strokeDashoffset = String(C * (1 - full));
  }
  function onTick() {
    const cue = advance(false);
    if (cue) phaseCue(cue);
    update(); place();
  }
  function phaseCue(cue) {
    const s = state.s, d = durs(s);
    const msg = cue === 'break' ? 'انتهى التركيز — استراحة ' + d.b / 60000 + ' د' : 'انتهت الاستراحة — الجولة ' + s.round;
    beep(cue === 'break' ? [880, 880, 1175] : [660, 990]);
    parts.live.textContent = msg; if (M && M.toast) M.toast(msg);
    if (state.view === 'badge') { fl.classList.add('is-peek'); setTimeout(() => fl && fl.classList.remove('is-peek'), 5000); }
    fl.classList.remove('tm-pulse'); void fl.offsetWidth; fl.classList.add('tm-pulse');
    fl.classList.toggle('is-break', s.phase === 'break');
  }
  function newSession() {
    const p = state.preset, d = durs({ preset: p });
    state.s = p === 'open' ? { preset: p, phase: 'open', round: 1, running: false, elapsed: 0, t0: 0, startedAt: now() } : { preset: p, phase: 'focus', round: 1, running: false, left: d.f, phaseEnd: 0, startedAt: now() };
    state.view = 'bar'; write(); render(true);
  }
  function startRun() {
    const s = state.s; unlock(); s.away = false;
    if (s.preset === 'open') s.t0 = now() - (s.elapsed || 0); else s.phaseEnd = now() + s.left;
    s.running = true; write(); update();
  }
  function pause() {
    const s = state.s; if (!s.running) return;
    advance(true);
    if (s.preset === 'open') s.elapsed = now() - s.t0; else s.left = Math.max(0, s.phaseEnd - now());
    s.running = false; write(); update();
  }
  function focusDone(s) {   /* minutes of focus in the current (unfinished) phase */
    if (s.preset === 'open') return value(s, now()) / 60000;
    return s.phase === 'focus' ? (durs(s).f - value(s, now())) / 60000 : 0;
  }
  function resetSession() {
    const s = state.s; if (!s) return;
    const m = focusDone(s); if (m >= 1) log(m, s.preset);
    const p = state.preset; state.preset = s.preset; newSession(); state.preset = p; write(); render(false);
  }
  function endSession() {
    const s = state.s; if (!s) return;
    const m = focusDone(s); if (m >= 1) log(m, s.preset);
    state.s = null; write();
    if (fl) { fl.classList.add('tm-out'); setTimeout(() => render(false), 200); } else render(false);
  }

  /* ---------------- panel ---------------- */
  let pop = null, view = 'main';
  function buildPop() {
    pop = el('div', 'st-pop st-timerpop'); pop.id = 'st-timer-pop'; pop.hidden = true; pop.dir = 'rtl';
    pop.setAttribute('role', 'dialog'); pop.setAttribute('aria-label', 'مؤقت الدراسة');
    drawPop();
  }
  function drawPop() {
    if (!pop) return;
    pop.replaceChildren();
    const head = el('div', 'tm-head');
    const side = el('button', 'tm-hbtn'); side.type = 'button';
    if (view === 'main') { side.setAttribute('aria-label', 'إعدادات المؤقت'); side.innerHTML = svg('<path d="M4 6h10M18 6h2M4 12h4M12 12h8M4 18h12M20 18h0"/><circle cx="16" cy="6" r="2"/><circle cx="10" cy="12" r="2"/><circle cx="18" cy="18" r="2"/>', 20); side.onclick = () => { view = 'settings'; drawPop(); }; }
    else { side.setAttribute('aria-label', 'رجوع'); side.innerHTML = svg('<path d="m9 18 6-6-6-6"/>', 20); side.onclick = () => { view = 'main'; drawPop(); }; }
    const title = el('p', 'tm-title', view === 'settings' ? 'إعدادات المؤقت' : view === 'history' ? 'سجل الجلسات' : 'مؤقت الدراسة');
    const x = el('button', 'tm-hbtn'); x.type = 'button'; x.setAttribute('aria-label', 'إغلاق'); x.innerHTML = svg('<path d="M18 6 6 18M6 6l12 12"/>', 18); x.onclick = closePop;
    head.append(side, title, x); pop.append(head);
    if (view === 'settings') return drawSettings();
    if (view === 'history') return drawHistory();
    const segw = el('div', 'tm-seg'); segw.setAttribute('role', 'group'); segw.setAttribute('aria-label', 'نوع الجلسة');
    for (const k of ['p25', 'p50', 'open']) { const b = el('button', '', PRESETS[k].label); b.type = 'button'; b.dataset.p = k; b.setAttribute('aria-pressed', String(state.preset === k)); b.onclick = () => { state.preset = k; write(); drawPop(); }; segw.append(b); }
    const pv = el('div', 'tm-prev');
    const big = el('p', 'tm-big', state.preset === 'open' ? '00:00' : two(PRESETS[state.preset].f) + ':00'); big.dir = 'ltr';
    const sub = el('p', 'tm-sub');
    if (state.preset === 'open') sub.textContent = 'يعدّ الوقت تصاعدياً حتى تُنهيه';
    else { const p = PRESETS[state.preset]; sub.append(el('i', 'tm-dot tm-dot-f'), 'تركيز ' + p.f + ' دقيقة ← ', el('i', 'tm-dot tm-dot-b'), 'استراحة ' + p.b + ' دقائق · تتكرر تلقائياً'); }
    pv.append(big, sub);
    const ready = el('button', 'tm-ready', state.s ? 'جلسة جديدة' : 'جاهز'); ready.type = 'button';
    ready.onclick = () => { if (state.s) { const m = focusDone(state.s); if (m >= 1) log(m, state.s.preset); } newSession(); closePop(); };
    const list = el('div', 'tm-list');
    const nr = el('label', 'tm-li'); nr.append(el('span', '', 'الاسم'));
    const ni = el('input', 'tm-name'); ni.type = 'text'; ni.maxLength = 40; ni.placeholder = 'اضغط لكتابة اسم'; ni.value = state.name || ''; ni.dir = 'auto';
    ni.oninput = () => { state.name = ni.value.trim().slice(0, 40); write(); update(); };
    nr.append(ni);
    const hr = el('button', 'tm-li'); hr.type = 'button'; const hl = el('span', '', 'سجل الجلسات'); hr.append(hl);
    if (state.hist.length > (state.seen || 0)) hl.append(el('i', 'tm-new'));
    hr.append(el('span', 'tm-chev', '‹')); hr.onclick = () => { view = 'history'; state.seen = state.hist.length; write(); drawPop(); };
    list.append(nr, hr);
    pop.append(segw, pv, ready, list);
  }
  function sw(label, on, fn, id) {
    const r = el('label', 'tm-li tm-swrow'); r.append(el('span', '', label));
    const i = el('input', 'tm-switch'); i.type = 'checkbox'; i.setAttribute('role', 'switch'); i.checked = !!on; if (id) i.id = id; i.onchange = () => fn(i.checked);
    r.append(i); return r;
  }
  function drawSettings() {
    const list = el('div', 'tm-list');
    const opRow = el('div', 'tm-li tm-oprow'); const ol = el('label', '', 'درجة الشفافية'); ol.htmlFor = 'tm-op';
    const rg = el('input', 'tm-range'); rg.type = 'range'; rg.id = 'tm-op'; rg.min = 20; rg.max = 90; rg.step = 5; rg.value = Math.round(state.op * 100); rg.dir = 'ltr'; rg.disabled = !state.ghost;
    const out = el('output', 'tm-pill', Math.round(state.op * 100) + '%');
    rg.oninput = () => { state.op = +rg.value / 100; out.textContent = rg.value + '%'; write(); if (fl) fl.style.setProperty('--tm-op', state.op); };
    touchRange(rg);
    opRow.append(ol, rg, out);
    list.append(
      sw('مؤقت شفاف', state.ghost, v => { state.ghost = v; write(); rg.disabled = !v; render(false); }, 'tm-ghost'),
      opRow,
      sw('صوت التنبيه', state.sound, v => { state.sound = v; write(); }, 'tm-sound'));
    pop.append(list, el('p', 'tm-hint', 'المؤقت الشفاف يصبح واضحاً عند لمسه ثم يعود شفافاً بعد 3 ثوانٍ. على iPad لا يوجد اهتزاز، ولا يُسمع الصوت إذا كان الجهاز صامتاً أو الصفحة في الخلفية.'));
  }
  function drawHistory() {
    const today = new Date().toDateString(), yest = new Date(Date.now() - 864e5).toDateString();
    const todays = state.hist.filter(h => new Date(h.at).toDateString() === today);
    const card = el('p', 'tm-card', 'اليوم: ' + todays.reduce((a, h) => a + (h.min || 0), 0) + ' دقيقة تركيز · ' + todays.length + ' جلسات');
    const box = el('div', 'tm-hist');
    if (!state.hist.length) box.append(el('p', 'tm-hint', 'لا جلسات بعد. تُسجّل كل جلسة تركيز تنتهي (دقيقة فأكثر).'));
    let last = '';
    for (const h of state.hist.slice().reverse()) {
      const d = new Date(h.at), ds = d.toDateString(), g = ds === today ? 'اليوم' : ds === yest ? 'أمس' : d.toLocaleDateString('ar', { day: 'numeric', month: 'long' });
      if (g !== last) { box.append(el('p', 'tm-grp', g)); last = g; }
      const t = d.toLocaleTimeString('ar', { hour: 'numeric', minute: '2-digit' });
      box.append(el('p', 'tm-hrow', (h.preset === 'open' ? 'وقت مفتوح ' : 'تركيز ') + h.min + ' د — ' + t + (h.name ? ' · ' + h.name : '')));
    }
    const clr = el('button', 'tm-clear', 'مسح السجل'); clr.type = 'button'; let armed = 0;
    clr.onclick = () => { if (!armed) { clr.textContent = 'اضغط مرة أخرى للمسح'; armed = setTimeout(() => { armed = 0; clr.textContent = 'مسح السجل'; }, 3000); return; } clearTimeout(armed); state.hist = []; state.seen = 0; write(); drawPop(); };
    pop.append(card, box); if (state.hist.length) pop.append(clr);
  }
  function touchRange(rg) {
    rg.style.touchAction = 'none';
    const at = e => { const r = rg.getBoundingClientRect(), min = +rg.min, max = +rg.max, step = +rg.step || 1; let f = (e.clientX - r.left - 12) / Math.max(1, r.width - 24); f = Math.min(1, Math.max(0, f)); const v = Math.round((min + f * (max - min)) / step) * step; if (+rg.value !== v) { rg.value = v; rg.dispatchEvent(new Event('input', { bubbles: true })); } };
    rg.addEventListener('pointerdown', e => { if (e.pointerType === 'mouse' || rg.disabled) return; e.preventDefault(); try { rg.setPointerCapture(e.pointerId); } catch {} at(e); const mv = ev => at(ev), up = () => { rg.removeEventListener('pointermove', mv); rg.removeEventListener('pointerup', up); rg.removeEventListener('pointercancel', up); }; rg.addEventListener('pointermove', mv); rg.addEventListener('pointerup', up); rg.addEventListener('pointercancel', up); });
  }
  const root = $('studio-toolbar');
  function btnEl() { return root && root.querySelector('#st-timer-btn'); }
  function syncBtn() { const b = btnEl(); if (!b) return; b.classList.toggle('tm-running', !!(state.s && state.s.running)); b.setAttribute('aria-expanded', String(!!(pop && !pop.hidden))); }
  function openPop() {
    if (!pop) buildPop();
    if (M && M.closePops) M.closePops();
    view = 'main'; drawPop();
    const b = btnEl(); if (b && b.nextSibling !== pop) b.after(pop);
    pop._anchor = b || null; pop.hidden = false; syncBtn(); placePop();
  }
  function closePop() { if (pop) pop.hidden = true; syncBtn(); }
  function placePop() {
    if (!pop || pop.hidden || !root) return; pop.style.left = ''; pop.style.right = '';
    if (innerWidth <= 720) return;
    const b = btnEl(), r = (pop.offsetParent || root).getBoundingClientRect(), w = pop.offsetWidth; if (!b || !w) return;
    const br = b.getBoundingClientRect(); let x = br.left + br.width / 2 - w / 2; x = Math.max(8, Math.min(innerWidth - 8 - w, x));
    pop.style.left = Math.round(x - r.left) + 'px'; pop.style.right = 'auto';
  }
  function makeBtn() {
    const b = el('button', 'st-btn st-timerbtn'); b.type = 'button'; b.id = 'st-timer-btn'; b.setAttribute('aria-label', 'مؤقت الدراسة'); b.title = 'مؤقت الدراسة';
    b.setAttribute('aria-haspopup', 'true'); b.setAttribute('aria-expanded', 'false'); b.innerHTML = svg(ICON);
    b.onclick = () => { if (pop && !pop.hidden) closePop(); else openPop(); };
    return b;
  }
  /* the toolbar re-renders often: put the button back each time, just before the settings / «المزيد» button */
  function inject() {
    if (!root) return;
    const old = root.querySelector('#st-timer-btn'); if (old) old.remove();
    const b = makeBtn(), more = root.querySelector('#studio-settings');
    if (more && more.parentNode) more.parentNode.insertBefore(b, more); else root.append(b);
    if (pop && !pop.hidden) { b.after(pop); placePop(); } else if (pop) b.after(pop);
    syncBtn(); place();
  }
  if (root) {
    root.addEventListener('st-rendered', inject);
    let q = false; new MutationObserver(() => { if (q) return; q = true; queueMicrotask(() => { q = false; if (!root.querySelector('#st-timer-btn')) inject(); }); }).observe(root, { childList: true });
    inject();
  }
  addEventListener('resize', () => { placePop(); place(); });
  /* another tab / file changed the timer; coming back after the iPad slept */
  addEventListener('storage', e => { if (e.key === KEY) { state = read(); render(false); } });
  const resume = () => { if (document.hidden) return; state = read(); advance(true); render(false); };
  document.addEventListener('visibilitychange', resume); addEventListener('pageshow', resume);
  state = read(); advance(true); render(false);
  if (M) M.studyTimer = { open: openPop, state: () => JSON.parse(JSON.stringify(state)) };
})();
