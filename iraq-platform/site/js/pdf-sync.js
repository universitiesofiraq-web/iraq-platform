/* js/pdf-sync.js — يحفظ كتابة الطالب وتظليله وبطاقاته على ملف PDF في حسابه، ويُظهرها على أي جهاز (Step 63، بطلب محمد 2026-10-19).
   لا يلمس محرّك الكتابة ولا حراس التخزين: يقرأ ويكتب في localStorage كما يفعل الاستعادة من نسخة احتياطية.
   - عند فتح الصفحة: يجلب نسخة الحساب ويدمجها (دمج ثلاثي بالمعرّف، لا يضيع شيء). إن تغيّر شيء محلياً أُعيد تحميل الصفحة مرة واحدة ليقرأها المحرّك.
   - أثناء الكتابة: كل 6 ثوانٍ (وعند مغادرة الصفحة) يرفع الصفحات التي تغيّرت فقط. إن تغيّر الصف من جهاز آخر لا يدمج في منتصف الكتابة؛ ينبّه الطالب ليحدّث الصفحة فيُدمج عند الفتح.
   - الزائر (بلا حساب): لا شيء يُرفع، وتبقى ملاحظاته على الجهاز. أخطاء الشبكة لا تمسّ ما هو محفوظ محلياً.
   المنطق في pdf-sync-core.js (يفحصه tests/pdf_sync_core_check.cjs). الخادم: functions/_lib/pdfnotes.js. */
(function () {
  'use strict';
  const Core = window.MedixaPdfSyncCore;
  const src = new URLSearchParams(location.search).get('file');
  if (!Core || !src) return;

  let abs, doc;
  try {
    const u = new URL(src, location.href); abs = u.href;
    let path = u.pathname; try { path = decodeURIComponent(path); } catch (e) { /* يبقى كما هو */ }
    doc = Core.docId(path + u.search);        /* لا يتغير بين medixa.pages.dev وmain.medixa.pages.dev */
  } catch (e) { return; }

  const KEYS = { ink: 'medixa.pdf.annotations.v1:' + abs, study: 'medixa.study.v1:' + abs, layout: 'medixa.studio.layout.v1:' + abs };
  const STATE_KEY = 'medixa.sync.pdf.v1:' + doc;
  const TICK_MS = 6000;
  const SHAPE = { ink: Array.isArray, study: v => v && typeof v === 'object' && !Array.isArray(v), layout: v => v && typeof v === 'object' && !Array.isArray(v) };
  const kindOf = k => k.indexOf('ink:') === 0 ? 'ink' : k;

  /* ---------- حالة المزامنة المحلية ---------- */
  function loadState() { try { const s = JSON.parse(localStorage.getItem(STATE_KEY)); if (s && s.rows && typeof s.rows === 'object') { if (!s.assets || typeof s.assets !== 'object') s.assets = {}; return s; } } catch (e) { /* جديد */ } return { v: 1, rows: {}, assets: {} }; }
  function saveState() { try { localStorage.setItem(STATE_KEY, JSON.stringify(state)); } catch (e) { /* الامتلاء: نعيد المحاولة لاحقاً */ } }
  let state = loadState();
  const conflicts = new Set(), failed = {};     /* صفوف عليها تعارض أو رفضها الخادم (لا نكرر المحاولة حتى تتغير) */

  /* ---------- الشبكة ---------- */
  function call(method, path, body, keepalive) {
    return fetch(path, { method, credentials: 'same-origin', cache: 'no-store', keepalive: !!keepalive, headers: body ? { 'content-type': 'application/json' } : undefined, body: body ? JSON.stringify(body) : undefined })
      .then(r => r.json().catch(() => ({})).then(d => { d.__status = r.status; return d; }), () => ({ __status: 0 }));
  }

  /* ---------- شارة الحالة في الرأس ---------- */
  let badge;
  /* Small cloud in the header: the words go in its tooltip / label, and are shown only when the student must act
     (a conflict, a full account). It never pushes the floating header pills around. */
  const LOUD = { conflict: 1, warn: 1 };
  function ui(text, cls, action) {
    if (!badge) {
      const hdr = document.querySelector('header'); if (!hdr) return;
      badge = document.createElement('span'); badge.id = 'acct-sync'; badge.setAttribute('role', 'status'); badge.setAttribute('aria-live', 'polite');
      const pill = document.getElementById('studio-hdr-actions');   /* the right header pill, beside the save status */
      badge.style.cssText = 'display:inline-flex;gap:6px;align-items:center;max-width:min(60vw,420px);font:600 12px system-ui;color:#163;background:#fff;border-radius:999px;padding:5px 9px;pointer-events:auto' +
        (pill ? ';margin-inline:2px' : ';position:fixed;z-index:30;right:10px;bottom:10px;box-shadow:0 2px 10px #0002');
      if (pill) pill.prepend(badge); else document.body.appendChild(badge);
    }
    badge.replaceChildren(); badge.dataset.state = cls || ''; badge.hidden = !text;
    if (!text) return;
    badge.title = text; badge.setAttribute('aria-label', text);
    const icon = document.createElement('span'); icon.setAttribute('aria-hidden', 'true');
    icon.textContent = cls === 'conflict' || cls === 'warn' ? '⚠' : cls === 'offline' ? '☁︎' : cls === 'guest' ? '☁︎' : cls === 'saving' ? '☁︎…' : '☁︎✓';
    icon.style.color = cls === 'conflict' || cls === 'warn' ? '#b45309' : cls === 'saved' ? '#0f766e' : '#64748b';
    badge.appendChild(icon);
    if (LOUD[cls]) { const t = document.createElement('span'); t.textContent = text.replace(/^[⚠☁]\S*\s*/, ''); badge.appendChild(t); }
    if (action) {
      const b = document.createElement(action.href ? 'a' : 'button'); b.textContent = action.label;
      if (action.href) b.href = action.href; else { b.type = 'button'; b.onclick = action.run; }
      b.style.cssText = 'color:#fff;background:#122c47;border:0;border-radius:999px;padding:4px 10px;font:inherit;text-decoration:none;cursor:pointer';
      badge.appendChild(b);
    }
  }
  const reload = () => location.reload();
  function note() {   /* الجملة التي تشرح مكان الحفظ داخل لوحة أدوات الدراسة */
    const p = document.querySelector('#study-panel p.muted');
    if (p && /محفوظة محلياً/.test(p.textContent)) p.textContent = 'ملاحظاتك وبطاقاتك محفوظة على هذا الجهاز وفي حسابك. أقنعة الصور تبقى على هذا الجهاز فقط.';
  }

  /* ---------- قراءة وكتابة المحلي (بالطريقة نفسها التي يفعلها المحرّك) ---------- */
  function readLocal() {
    const local = {}, bad = {};
    for (const name of Object.keys(KEYS)) {
      let raw = null;
      try { raw = localStorage.getItem(KEYS[name]); } catch (e) { bad[name] = true; continue; }
      if (raw === null) { local[name] = null; continue; }
      let v; try { v = JSON.parse(raw); } catch (e) { bad[name] = true; continue; }
      if (!SHAPE[name](v)) { bad[name] = true; continue; }       /* تالف أو بصيغة غريبة: لا نقرأه ولا نكتب فوقه أبداً */
      local[name] = v;
    }
    return { local, bad };
  }
  function writeLocal(name, value) {
    const payload = JSON.stringify(value);
    try { localStorage.setItem(KEYS[name], payload); return localStorage.getItem(KEYS[name]) === payload; } catch (e) { return false; }
  }
  function editorBusy() {
    try { const S = window.MedixaStudio && window.MedixaStudio.S; return !!S && (['editing', 'pending', 'failed', 'conflict'].indexOf(S.state) >= 0 || S.dirty === true); } catch (e) { return false; }
  }

  /* ---------- الصور التي يُدرجها الطالب (Step 66، بطلب محمد 2026-10-22) ----------
     الصفحة تحفظ موضع الصورة فقط، والصورة نفسها تُرفع إلى الحساب قبل الصف الذي يشير إليها، فلا يصل إلى جهاز آخر
     صف يشير إلى صورة غير موجودة في الحساب. عند فتح الصفحة تُجلب الصور الناقصة على هذا الجهاز. */
  const IMG_ID = /^img_[0-9a-f]{32}$/;
  const ASSET_TEXT = {
    asset_held: '⚠ صورة لم تُرفع إلى حسابك بعد، فلن تظهر على أجهزتك الأخرى حتى ترتفع. سنعيد المحاولة.',
    asset_big: '⚠ إحدى الصور أكبر من 3 ميغابايت فلم تُرفع إلى حسابك. صغّرها ثم أعد إدراجها.',
    asset_quota: '⚠ امتلأت مساحة الصور في حسابك (20 ميغابايت). الصور محفوظة على هذا الجهاز.',
    asset_off: '⚠ خدمة الصور في الحساب لم تُفعَّل بعد. الصور محفوظة على هذا الجهاز.',
    asset_net: '☁ بانتظار الاتصال لرفع الصور إلى حسابك.',
    asset_missing: '⚠ بعض صور هذا الملف لم تصل إلى هذا الجهاز بعد. أعد فتح الصفحة بعد لحظات.'
  };
  const assetsOf = d => { try { const a = JSON.parse(d); if (!Array.isArray(a)) return []; const out = []; for (const it of a) if (it && IMG_ID.test(it.asset)) out.push(it.asset); return out; } catch (e) { return []; } };
  const imgStore = () => window.MedixaAssets || null;
  /* يرفع الصور التي تشير إليها الصفوف المتغيرة ولم تُرفع بعد. يعيد الصفوف التي يجب تأجيلها والسبب */
  async function uploadAssets(rows) {
    const A = imgStore(), hold = new Set(); let problem = null;
    if (!A) return { hold, problem };
    for (const r of rows) {
      if (kindOf(r.k) !== 'ink') continue;
      for (const id of assetsOf(r.d)) {
        if (state.assets[id]) continue;
        let got = null; try { got = await A.bytes(id); } catch (e) { got = null; }
        if (!got) { hold.add(r.k); problem = problem || 'asset_held'; continue; }
        let res;
        try {
          res = await fetch('api/pdfnotes/asset?id=' + id, { method: 'PUT', credentials: 'same-origin', cache: 'no-store', headers: { 'content-type': got.type }, body: got.bytes });
        } catch (e) { res = { status: 0 }; }
        const st = res.status;
        if (st === 200) { state.assets[id] = true; continue; }
        hold.add(r.k);
        if (st === 401) problem = 'unauthorized';
        else if (st === 503 || st === 404) problem = 'asset_off';
        else if (st === 413) { let why = 'too_large'; try { why = (await res.json()).error || why; } catch (e) { /* يبقى الافتراضي */ } problem = why === 'quota' ? 'asset_quota' : 'asset_big'; }
        else problem = 'asset_net';
      }
    }
    saveState();
    return { hold, problem };
  }
  /* يجلب من الحساب الصور التي تشير إليها الصفوف البعيدة ولا توجد على هذا الجهاز */
  async function downloadAssets(remote) {
    const A = imgStore(); let missing = false;
    if (!A) return false;
    for (const k of Object.keys(remote)) {
      if (kindOf(k) !== 'ink') continue;
      for (const id of assetsOf(remote[k].d)) {
        let has = false; try { has = await A.has(id); } catch (e) { has = false; }
        if (has) continue;
        try {
          const res = await fetch('api/pdfnotes/asset?id=' + id, { credentials: 'same-origin', cache: 'no-store' });
          if (res.status !== 200) { missing = true; continue; }
          const u = new Uint8Array(await res.arrayBuffer());
          await A.putRaw(id, u, (res.headers.get('content-type') || 'image/jpeg').split(';')[0]);
          state.assets[id] = true;
        } catch (e) { missing = true; }
      }
    }
    saveState();
    return missing;
  }

  /* ---------- رفع الصفوف ---------- */
  const ERR_TEXT = {
    quota: ['⚠ امتلأت مساحة ملاحظاتك في الحساب (5 ميغابايت). ما زالت محفوظة على هذا الجهاز.', 'warn'],
    too_large: ['⚠ إحدى الصفحات كبيرة جداً لتُحفظ في الحساب. ما زالت محفوظة على هذا الجهاز.', 'warn']
  };
  async function push(rows, keepalive) {   /* rows: [{k, d, base, data}] */
    let anyOk = false, problem = null;
    for (let i = 0; i < rows.length; i += 40) {
      const chunk = rows.slice(i, i + 40);
      const res = await call('PUT', 'api/pdfnotes', { doc, rows: chunk.map(r => ({ k: r.k, d: r.d, base: r.base })) }, keepalive);
      if (res.__status === 401) { ui('سجّل الدخول لحفظ ملاحظاتك في حسابك', 'guest', { label: 'دخول', href: 'login.html?next=' + encodeURIComponent('pdf-notes.html' + location.search) }); return { stop: true }; }
      if (res.__status !== 200 || !Array.isArray(res.results)) return { offline: res.__status === 0 || res.__status >= 500, disabled: res.__status === 503 };
      for (const r of res.results) {
        const row = chunk.find(c => c.k === r.k); if (!row) continue;
        if (r.ok) { state.rows[r.k] = Core.stateAfterPush(r.k, row.data, r.t); delete failed[r.k]; conflicts.delete(r.k); anyOk = true; }
        else if (r.conflict) { conflicts.add(r.k); }
        else if (r.error) { failed[r.k] = Core.hashOf(row.data); problem = r.error; }
      }
    }
    saveState();
    return { anyOk, problem };
  }
  function report(r) {
    if (r.stop) return;
    if (conflicts.size) return ui('⚠ تغيّرت ملاحظاتك من جهاز آخر', 'conflict', { label: 'حدّث للدمج', run: reload });
    if (r.assetProblem === 'unauthorized') return ui('سجّل الدخول لحفظ ملاحظاتك في حسابك', 'guest', { label: 'دخول', href: 'login.html?next=' + encodeURIComponent('pdf-notes.html' + location.search) });
    if (r.assetProblem && ASSET_TEXT[r.assetProblem]) return ui(ASSET_TEXT[r.assetProblem], r.assetProblem === 'asset_net' ? 'offline' : 'warn');
    if (r.problem && ERR_TEXT[r.problem]) return ui(ERR_TEXT[r.problem][0], ERR_TEXT[r.problem][1]);
    if (r.disabled) return ui('', 'off');
    if (r.offline) return ui('☁ بانتظار الاتصال — ملاحظاتك محفوظة على الجهاز', 'offline');
    ui('☁ محفوظة في حسابك ✓', 'saved');
  }

  /* ---------- أثناء الجلسة ---------- */
  let running = false, enabled = false;
  async function tick(keepalive) {
    if (!enabled || running) return;
    running = true;
    try {
      const { local, bad } = readLocal();
      const dirty = Core.dirtyRows(local, state).filter(r => !bad[kindOf(r.k)] && !conflicts.has(r.k) && failed[r.k] !== Core.hashOf(r.data));
      if (!dirty.length) return;
      ui('☁ جارٍ الحفظ في حسابك…', 'saving');
      const assets = await uploadAssets(dirty);
      if (assets.problem === 'unauthorized') return report({ stop: false, assetProblem: 'unauthorized' });
      const ready = dirty.filter(r => !assets.hold.has(r.k));
      const out = ready.length ? await push(ready, keepalive) : {};
      out.assetProblem = assets.problem; report(out);
    } finally { running = false; }
  }

  /* ---------- عند فتح الصفحة ---------- */
  async function start() {
    ui('☁ جارٍ مزامنة ملاحظاتك…', 'saving');
    const res = await call('GET', 'api/pdfnotes?doc=' + doc);
    if (res.__status === 401) return ui('سجّل الدخول لحفظ ملاحظاتك في حسابك', 'guest', { label: 'دخول', href: 'login.html?next=' + encodeURIComponent('pdf-notes.html' + location.search) });
    if (res.__status === 503 || res.__status === 404) return ui('', 'off');                     /* الميزة غير مفعّلة بعد في الخادم */
    if (res.__status !== 200 || !Array.isArray(res.rows)) { ui('☁ بانتظار الاتصال — ملاحظاتك محفوظة على الجهاز', 'offline'); enabled = true; return; }
    enabled = true;
    note();
    const remote = {}; for (const r of res.rows) remote[r.k] = { d: r.d, t: r.t };
    const { local, bad } = readLocal();
    const plan = Core.plan(local, remote, state);
    for (const k of Object.keys(plan.rows)) if (bad[kindOf(k)]) { delete plan.rows[k]; delete plan.writeLocal[kindOf(k)]; }
    for (const name of Object.keys(plan.writeLocal)) if (bad[name]) delete plan.writeLocal[name];

    /* 0) الصور التي يشير إليها ما في الحساب ولا توجد على هذا الجهاز */
    const imgMissing = await downloadAssets(remote);
    /* 1) ما يلزم كتابته محلياً (من الحساب إلى الجهاز) */
    const names = Object.keys(plan.writeLocal);
    if (names.length) {
      if (editorBusy()) return ui('⚠ في حسابك ملاحظات جديدة من جهاز آخر', 'conflict', { label: 'حدّث للدمج', run: reload });
      for (const name of names) if (!writeLocal(name, plan.writeLocal[name])) return ui('⚠ تعذّر تحديث الملاحظات على هذا الجهاز (مساحة التخزين)', 'warn');
    }
    /* 2) حالة الصفوف التي لم تحتج رفعاً، ثم رفع ما يلزم */
    const uploads = [];
    for (const k of Object.keys(plan.rows)) {
      const r = plan.rows[k]; if (r.skip) continue;
      if (r.state) state.rows[k] = r.state;
      if (r.push) uploads.push({ k, d: r.push.d, base: r.push.base, data: r.data });
    }
    saveState();
    let outcome = { anyOk: false };
    const assets = await uploadAssets(uploads);
    if (assets.problem === 'unauthorized') return report({ stop: false, assetProblem: 'unauthorized' });
    const ready = uploads.filter(r => !assets.hold.has(r.k));
    if (ready.length) outcome = await push(ready, false);
    outcome.assetProblem = assets.problem || (imgMissing ? 'asset_missing' : null);
    report(outcome);
    /* 3) إن تغيّر المحلي نعيد تحميل الصفحة مرة واحدة ليقرأها المحرّك (مرة كل 30 ثانية على الأكثر لمنع التكرار) */
    if (names.length) {
      let last = 0; try { last = Number(sessionStorage.getItem('medixa.sync.reload')) || 0; } catch (e) { /* بلا */ }
      if (Date.now() - last > 30000) { try { sessionStorage.setItem('medixa.sync.reload', String(Date.now())); } catch (e) { /* بلا */ } ui('☁ حُدّثت ملاحظاتك من حسابك…', 'saving'); reload(); return; }
      ui('☁ حُدّثت ملاحظاتك من حسابك', 'saved', { label: 'عرضها', run: reload });
    }
  }

  start().then(() => {
    setInterval(() => tick(false), TICK_MS);
    document.addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') tick(true); });
    window.addEventListener('pagehide', () => tick(true));
    window.addEventListener('online', () => tick(false));
  });
  window.MedixaPdfSync = { tick: () => tick(false), doc, state: () => state };   /* للفحص */
})();
