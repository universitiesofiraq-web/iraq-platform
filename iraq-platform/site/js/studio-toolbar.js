/* MEDIXA Study Studio — the one task toolbar. Built from a config (order, visibility, handedness) persisted per device.
   Buttons keep data-tool / #undo / #redo / #color / #width so older tests and modules still find them.
   Tool settings: tapping the ACTIVE tool again (or holding any tool) opens #st-toolset with that tool's own style
   (pen type, smoothing, pressure range, marker opacity, eraser mode, arrow heads, text size …). Every control writes
   straight through M.setStyle / M.setInput / M.setSnap, so the engine sanitizes and persists it; nothing is kept here.
   Tablets (body.st-compact, wider than a phone): the Notewise bar (طلب محمد 4، 2026-10-21) — undo · redo · finger |
   pen · brush · highlighter · eraser · lasso · select · image · text · note · (laser) · settings | ⌄. The brush is not an
   engine tool: it is the pen with pen:'brush' (activate()); each keeps its own colour / width (medixa.studio.vpen.v1). */
(function () {
  'use strict';
  const M = window.MedixaStudio; if (!M) return;
  const S = M.S, C = M.C || window.MedixaStudioCore || {}, $ = id => document.getElementById(id);
  const svg = (d, n) => '<svg viewBox="0 0 24 24" width="' + (n || 22) + '" height="' + (n || 22) + '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';
  const TOOLS = [
    { id: 'pen', name: 'قلم', icon: '<path d="M21.2 6.8a2.8 2.8 0 0 0-4-4L3.8 16.2a2 2 0 0 0-.5.8l-1.3 4.4a.5.5 0 0 0 .6.6l4.4-1.3a2 2 0 0 0 .8-.5z"/><path d="m15 5 4 4"/>' },
    { id: 'brush', name: 'فرشاة', virtual: true, icon: '<path d="m9.06 11.9 8.07-8.06a2.85 2.85 0 1 1 4.03 4.03l-8.06 8.08"/><path d="M7.07 14.94c-1.66 0-3 1.35-3 3.02 0 1.33-2.5 1.52-2 2.02 1.08 1.1 2.49 2.02 4 2.02 2.2 0 4-1.8 4-4.04a3.01 3.01 0 0 0-3-3.02z"/>' },
    { id: 'highlight', name: 'تظليل', icon: '<path d="m9 11-6 6v3h9l3-3"/><path d="m22 12-4.6 4.6a2 2 0 0 1-2.8 0l-5.2-5.2a2 2 0 0 1 0-2.8L14 4"/>' },
    { id: 'eraser', name: 'ممحاة', icon: '<path d="M7 21 2.7 16.7a2.4 2.4 0 0 1 0-3.4l9.6-9.6a2.4 2.4 0 0 1 3.4 0l5.6 5.6a2.4 2.4 0 0 1 0 3.4L13 21z"/><path d="m5.5 10.5 8 8"/>' },
    { id: 'lasso', name: 'تحديد حر', icon: '<circle cx="13.5" cy="9.5" r="6.5" stroke-dasharray="3 2.6"/><path d="M8.6 13.8c-2.3-.2-4.3.9-4.1 2.5.2 1.4 2.3 1.7 3.1.5.6-.9 0-2-1.1-2.3"/><path d="M5.8 17.6c.2 1.5-.5 2.7-1.8 3.4"/>' },
    { id: 'select', name: 'تحديد نص', icon: '<path d="M17 22h-1a4 4 0 0 1-4-4V6a4 4 0 0 1 4-4h1"/><path d="M7 22h1a4 4 0 0 0 4-4v-1"/><path d="M7 2h1a4 4 0 0 1 4 4v1"/>' },
    { id: 'region', name: 'منطقة من الصفحة', icon: '<path d="M5 3a2 2 0 0 0-2 2"/><path d="M19 3a2 2 0 0 1 2 2"/><path d="M21 19a2 2 0 0 1-2 2"/><path d="M5 21a2 2 0 0 1-2-2"/><path d="M9 3h1M9 21h1M14 3h1M14 21h1M3 9v1M21 9v1M3 14v1M21 14v1"/>' },
    { id: 'text', name: 'نص', icon: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><path d="M8 8h8M12 8v8.5M10.3 16.5h3.4"/>' },
    { id: 'sticky', name: 'ملاحظة لاصقة', icon: '<path d="M5 3.5h14a1.5 1.5 0 0 1 1.5 1.5v9.5l-6 6H5A1.5 1.5 0 0 1 3.5 19V5A1.5 1.5 0 0 1 5 3.5z"/><path d="M20.5 14.5H16a1.5 1.5 0 0 0-1.5 1.5v4.5"/>' },
    { id: 'line', name: 'خط', icon: '<path d="M5 19 19 5"/>' },
    { id: 'rectangle', name: 'مستطيل', icon: '<rect x="4" y="6" width="16" height="12" rx="1"/>' },
    { id: 'ellipse', name: 'دائرة', icon: '<ellipse cx="12" cy="12" rx="9" ry="6"/>' },
    { id: 'arrow', name: 'سهم', icon: '<path d="M5 19 19 5"/><path d="M9 5h10v10"/>' },
    { id: 'zoom', name: 'كتابة مكبرة', icon: '<circle cx="11" cy="11" r="7"/><path d="m21 21-4.3-4.3M8 11h6M11 8v6"/>' },
    { id: 'hand', name: 'تحريك الصفحة', icon: '<path d="M18 11V6a2 2 0 0 0-4 0"/><path d="M14 10V4a2 2 0 0 0-4 0v2"/><path d="M10 10.5V6a2 2 0 0 0-4 0v8"/><path d="M18 8a2 2 0 1 1 4 0v6a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.9-6-2.3l-3.6-3.6a2 2 0 0 1 2.8-2.8L7 15"/>' }
  ];
  /* other icons of the bar and of the settings sheets */
  const I = {
    undo: '<path d="M9 14 4 9l5-5"/><path d="M4 9h10.5a5.5 5.5 0 0 1 0 11H11"/>',
    redo: '<path d="m15 14 5-5-5-5"/><path d="M20 9H9.5a5.5 5.5 0 0 0 0 11H13"/>',
    /* a vertical double arrow beside a pointing hand (Notewise's touch toggle) */
    finger: '<path d="M4 4v15M2 6l2-2 2 2M2 17l2 2 2-2"/><g transform="translate(6.5 3.5) scale(.72)" stroke-width="2.2"><path d="M22 14a8 8 0 0 1-8 8"/><path d="M18 11v-1a2 2 0 0 0-2-2a2 2 0 0 0-2 2"/><path d="M14 10V9a2 2 0 0 0-2-2a2 2 0 0 0-2 2v1"/><path d="M10 9.5V4a2 2 0 0 0-2-2a2 2 0 0 0-2 2v10"/><path d="M18 11a2 2 0 1 1 4 0v3a8 8 0 0 1-8 8h-2c-2.8 0-4.5-.86-5.99-2.34l-3.6-3.6a2 2 0 0 1 2.83-2.82L7 15"/></g>',
    image: '<rect x="3.5" y="3.5" width="17" height="17" rx="3"/><circle cx="9" cy="9" r="1.8"/><path d="m20.5 15-4.2-4.2a1.5 1.5 0 0 0-2.1 0L5 20"/>',
    gear: '<path d="M12.22 2h-.44a2 2 0 0 0-2 2v.18a2 2 0 0 1-1 1.73l-.43.25a2 2 0 0 1-2 0l-.15-.08a2 2 0 0 0-2.73.73l-.22.38a2 2 0 0 0 .73 2.73l.15.1a2 2 0 0 1 1 1.72v.51a2 2 0 0 1-1 1.74l-.15.09a2 2 0 0 0-.73 2.73l.22.38a2 2 0 0 0 2.73.73l.15-.08a2 2 0 0 1 2 0l.43.25a2 2 0 0 1 1 1.73V20a2 2 0 0 0 2 2h.44a2 2 0 0 0 2-2v-.18a2 2 0 0 1 1-1.73l.43-.25a2 2 0 0 1 2 0l.15.08a2 2 0 0 0 2.73-.73l.22-.39a2 2 0 0 0-.73-2.73l-.15-.08a2 2 0 0 1-1-1.74v-.5a2 2 0 0 1 1-1.74l.15-.09a2 2 0 0 0 .73-2.73l-.22-.38a2 2 0 0 0-2.73-.73l-.15.08a2 2 0 0 1-2 0l-.43-.25a2 2 0 0 1-1-1.73V4a2 2 0 0 0-2-2z"/><circle cx="12" cy="12" r="3"/>',
    chevron: '<path d="m6 9 6 6 6-6"/>',
    curve: '<path d="M5 19c6 0 8-14 14-14"/>',
    dplus: '<circle cx="12" cy="12" r="9" stroke-dasharray="3.2 2.6"/><path d="M12 8v8M8 12h8"/>',
    sliders: '<path d="M4 7h9M17 7h3M4 17h3M11 17h9"/><circle cx="15" cy="7" r="2.2"/><circle cx="9" cy="17" r="2.2"/>',
    x: '<path d="M18 6 6 18M6 6l12 12"/>',
    plus: '<path d="M12 5v14M5 12h14"/>',
    minus: '<path d="M5 12h14"/>',
    list: '<path d="M5 7h14M5 11h14M5 15h14M5 19h14"/>',
    info: '<circle cx="12" cy="12" r="9"/><path d="M12 11v5.5M12 7.6h.01"/>',
    solid: '<path d="M3 12h18"/>',
    dashed: '<path d="M3 12h4M10 12h4M17 12h4"/>',
    dotted: '<path d="M4 12h.01M9 12h.01M14 12h.01M19 12h.01" stroke-width="3"/>',
    tipFlat: '<path d="M18 6H6v12h12"/>',
    tipRound: '<path d="M18 6h-6a6 6 0 0 0 0 12h6"/>',
    hold: '<path d="M4 20 13 11"/><circle cx="16" cy="8" r="3" fill="currentColor"/>',
    line: '<path d="M5 19 19 5"/>',
    free: '<path d="M5 19c6 0 8-14 14-14"/>'
  };
  const KEY = 'medixa.studio.toolbar.v1', DEFAULT = { order: TOOLS.map(t => t.id), hidden: [], side: 'start', quick: true };
  const byId = Object.fromEntries(TOOLS.map(t => [t.id, t]));
  function load() {
    try {
      const v = JSON.parse(localStorage.getItem(KEY) || 'null'); if (!v || typeof v !== 'object') return structuredClone(DEFAULT);
      const order = Array.isArray(v.order) ? v.order.filter(id => byId[id]) : []; for (const t of TOOLS) if (!order.includes(t.id)) order.push(t.id);
      return { order, hidden: Array.isArray(v.hidden) ? v.hidden.filter(id => byId[id]) : [], side: v.side === 'end' ? 'end' : 'start', quick: v.quick !== false };
    } catch { return structuredClone(DEFAULT); }
  }
  let cfg = load();
  const save = () => { try { localStorage.setItem(KEY, JSON.stringify(cfg)); } catch {} };
  const mqStyle = window.matchMedia ? matchMedia('(max-width: 899px)') : { matches: false, addEventListener() {} };
  const mqPhone = window.matchMedia ? matchMedia('(max-width: 720px)') : { matches: false };
  const COMPACT = document.body.classList.contains('st-compact');
  const tablet = () => COMPACT && !mqPhone.matches;
  const PRIMARY = 3;                                       /* phones / old layout: the first tools of the configured order stay on the bar */
  /* tablets: Notewise's slot order; '@image' is the insert-picture button, 'laser' shows once a module adds it to TOOLS */
  const NW = ['pen', 'brush', 'highlight', 'eraser', 'lasso', 'select', '@image', 'text', 'sticky', 'laser'];
  const COLORS = [['#168c8c', 'تركوازي'], ['#e43d56', 'أحمر'], ['#2f6fed', 'أزرق'], ['#f2c230', 'أصفر']];
  const PEN_COLORS = [['#18334b', 'كحلي'], ['#e43d56', 'أحمر'], ['#2f6fed', 'أزرق'], ['#168c8c', 'تركوازي'], ['#1f9d6a', 'أخضر'], ['#f2c230', 'أصفر'], ['#e67e22', 'برتقالي'], ['#7c4dff', 'بنفسجي'], ['#5b7382', 'رمادي']];
  const MARKERS = [['#f2c230', 'أصفر'], ['#7bd88f', 'أخضر'], ['#6fb1ff', 'أزرق'], ['#ff8fa3', 'وردي'], ['#ffb347', 'برتقالي'], ['#c39bff', 'بنفسجي'], ['#5ce1e6', 'فيروزي'], ['#d4fc79', 'ليموني']];
  const INKS = [['#18334b', 'كحلي'], ['#e43d56', 'أحمر'], ['#2f6fed', 'أزرق'], ['#168c8c', 'تركوازي'], ['#1f9d6a', 'أخضر'], ['#7c4dff', 'بنفسجي']];
  const SIZES = [[2, 'خط رفيع'], [3, 'خط متوسط'], [6, 'خط عريض']];
  const QUICK_COLORS = [['#18334b', 'كحلي'], ['#e43d56', 'أحمر'], ['#2f6fed', 'أزرق'], ['#e67e22', 'برتقالي'], ['#7c4dff', 'بنفسجي']];
  const PENS = [['ballpoint', 'حبر جاف'], ['fountain', 'قلم حبر'], ['brush', 'فرشاة'], ['pencil', 'رصاص'], ['technical', 'تقني']];
  /* «حساسية الضغط» 0–5: the pen's width range under pressure / speed (engine field wr); 4 is the engine default */
  const WR_LEVELS = [[1, 1], [0.8, 1.25], [0.6, 1.5], [0.4, 1.85], [0.25, 2.2], [0.1, 3]];
  const wrLevel = wr => { let best = 4, bd = Infinity; if (!Array.isArray(wr)) return best; WR_LEVELS.forEach((L, i) => { const d = Math.abs(wr[0] - L[0]) + Math.abs(wr[1] - L[1]) / 2; if (d < bd) { bd = d; best = i; } }); return best; };
  /* tools that have a settings sheet, and the engine style group behind each (shapes share one, text and sticky share one) */
  const SETG = { pen: 'pen', brush: 'pen', highlight: 'highlight', eraser: 'eraser', line: 'shape', rectangle: 'shape', ellipse: 'shape', arrow: 'shape', text: 'text', sticky: 'text' };
  const TITLES = { pen: 'إعدادات القلم', brush: 'إعدادات الفرشاة', highlight: 'إعدادات التظليل', eraser: 'إعدادات الممحاة', line: 'إعدادات الخط', rectangle: 'إعدادات المستطيل', ellipse: 'إعدادات الدائرة', arrow: 'إعدادات السهم', text: 'إعدادات النص', sticky: 'إعدادات الملاحظة اللاصقة', lasso: 'إعدادات التحديد' };
  const SHORT = { pen: 'القلم', brush: 'الفرشاة', highlight: 'التظليل' };   /* the sheet's visible title (Notewise: «Pen») */
  const HOLD = 500, HEX6 = /^#[0-9a-f]{6}$/i;
  /* lp: a long press that just opened a tool. Its trailing click is dropped once, wherever it lands (the bar re-renders and,
     on phones, the sheet can open under the finger); the short window starts when the finger lifts, however long the hold */
  const LP0 = { id: '', at: 0, pid: null, x: 0, y: 0 };
  let lp = LP0, ts = null, upd = [];
  const lpFresh = id => lp.at && Date.now() - lp.at < 700 && (id == null || lp.id === id);
  /* the lasso sheet appears only once the selection module offers modes (it is developed separately) */
  const selModes = () => !!(M.selection && typeof M.selection.setMode === 'function' && typeof M.selection.mode === 'function');
  const hasSet = id => id === 'lasso' ? selModes() : !!SETG[id];
  const groupFor = id => id === 'lasso' ? 'lasso' : SETG[id];

  /* ---- the brush: the pen tool with the 'brush' pen type. Pen and brush each remember their own colour / width / opacity /
     line style on this device, so switching between the two buttons feels like two tools (no engine change). ---- */
  const VKEY = 'medixa.studio.vpen.v1';
  const vRead = () => { try { const v = JSON.parse(localStorage.getItem(VKEY) || 'null'); return v && typeof v === 'object' ? v : {}; } catch { return {}; } };
  const vWrite = v => { try { localStorage.setItem(VKEY, JSON.stringify(v)); } catch {} };
  const vSnap = s => { const o = {}; for (const k of ['color', 'width', 'op', 'dash']) if (s[k] != null) o[k] = s[k]; return o; };
  const isBrush = () => S.tool === 'pen' && ((M.style && M.style('pen')) || {}).pen === 'brush';
  const isOn = id => id === 'brush' ? isBrush() : id === 'pen' ? S.tool === 'pen' && !isBrush() : S.tool === id;
  const curId = () => isBrush() ? 'brush' : S.tool;
  function activate(id) {
    if (id !== 'pen' && id !== 'brush') return M.setTool(id);
    const s = (M.style && M.style('pen')) || {}, was = s.pen === 'brush';
    if (M.setStyle && id === 'brush' && !was) {
      const v = vRead(); v.pen = vSnap(s); v.lastPen = s.pen || 'ballpoint'; vWrite(v);
      M.setStyle('pen', Object.assign({ width: 4.5 }, v.brush || {}, { pen: 'brush' }));
    } else if (M.setStyle && id === 'pen' && was) {
      const v = vRead(); v.brush = vSnap(s); vWrite(v);
      M.setStyle('pen', Object.assign({}, v.pen || {}, { pen: v.lastPen && v.lastPen !== 'brush' ? v.lastPen : 'ballpoint' }));
    }
    M.setTool('pen');
  }

  const root = $('studio-toolbar'); if (!root) return;
  const btn = (cls, label, inner, id) => { const b = document.createElement('button'); b.type = 'button'; b.className = cls; b.setAttribute('aria-label', label); b.title = label; b.innerHTML = inner; if (id) b.id = id; return b; };
  const div = (cls) => { const d = document.createElement('div'); d.className = cls; return d; };
  const txt = (tag, cls, t) => { const e = document.createElement(tag); if (cls) e.className = cls; e.textContent = t; return e; };
  function toolButton(t) {
    const on = isOn(t.id), b = btn('st-btn', t.name, svg(t.icon) + '<span class="st-lab">' + t.name + '</span>'); b.dataset.tool = t.id; b.setAttribute('aria-pressed', String(on)); if (on) b.classList.add('active');
    if (hasSet(t.id)) { b.classList.add('st-has-set'); if (on) { b.title = t.name + ' — اضغط مرة أخرى للإعدادات'; b.setAttribute('aria-haspopup', 'dialog'); b.setAttribute('aria-expanded', 'false'); } }
    b.onclick = e => {
      if (isOn(t.id) && hasSet(t.id)) return toggleSet(e && e.detail === 0);   /* second tap on the active tool = its settings */
      closePops(); activate(t.id);
    };
    holdable(b, t.id); return b;
  }
  /* hold a tool button (500 ms) = choose it and open its settings, the usual tablet gesture */
  function holdable(b, id) {
    let tm = 0, x0 = 0, y0 = 0; const stop = () => { clearTimeout(tm); tm = 0; };
    b.addEventListener('pointerdown', e => {
      if (e.button > 0) return; x0 = e.clientX; y0 = e.clientY; stop();
      tm = setTimeout(() => { tm = 0; lp = { id, at: 0, pid: e.pointerId, x: 0, y: 0 }; try { navigator.vibrate && navigator.vibrate(8); } catch {} if (!isOn(id)) { closePops(); activate(id); } if (hasSet(id)) openSet(); }, HOLD);
    });
    b.addEventListener('pointermove', e => { if (tm && Math.hypot(e.clientX - x0, e.clientY - y0) > 10) stop(); });
    for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
    b.addEventListener('contextmenu', e => e.preventDefault());             /* Android shows a menu on long press */
  }
  /* one popover pattern for the whole reader: the panel sits right after its button; one outside click closes all */
  function closePops() { document.querySelectorAll('.st-pop').forEach(p => { if (p.hidden) return; p.hidden = true; const b = p._anchor || p.previousElementSibling; if (b) b.setAttribute('aria-expanded', 'false'); }); }
  function popFor(button, cls, label) {
    const p = div('st-pop ' + cls); p.hidden = true; p.setAttribute('role', 'group'); p.setAttribute('aria-label', label);
    button.setAttribute('aria-haspopup', 'true'); button.setAttribute('aria-expanded', 'false');
    button.onclick = () => { const open = p.hidden; closePops(); p.hidden = !open; button.setAttribute('aria-expanded', String(open)); };
    return p;
  }
  /* lasso with a selection: the quick colours / sizes restyle the selection instead of the next stroke */
  const selOn = () => { const sel = M.selection; return S.tool === 'lasso' && !!sel && typeof sel.count === 'function' && typeof sel.applyStyle === 'function' && sel.count() > 0; };
  function selStyle(props) { if (!selOn()) return false; M.selection.applyStyle(props); return true; }
  const check = (id, label, on, fn) => { const l = document.createElement('label'); l.className = 'st-check'; const i = document.createElement('input'); i.type = 'checkbox'; i.id = id; i.checked = !!on; i.onchange = () => fn(i.checked); l.append(i, ' ' + label); return l; };
  /* the quick bar (sizes · colours · custom · settings) is for tools that draw with a colour, on screens wider than a phone */
  const quickFor = () => tablet() && !!SETG[S.tool] && SETG[S.tool] !== 'eraser';
  const quickOn = () => quickFor() && cfg.quick !== false;   /* the chevron at the end of the bar hides / shows it (Notewise) */
  /* the quick bar's first button shows what is drawing: the line for the pen, the brush, or the tool itself */
  const kindKey = () => S.tool === 'pen' ? (isBrush() ? 'brush' : 'pen') : S.tool;
  const kindSvg = k => k === 'pen' ? svg(I.curve) : svg((byId[k] || byId.pen).icon);
  function render() {
    root.replaceChildren(); root.dataset.side = cfg.side; document.body.classList.remove('st-has-quick');
    const tab = tablet(), shown = cfg.order.filter(id => !cfg.hidden.includes(id));
    const primary = tab ? NW.filter(id => byId[id] && shown.includes(id)) : shown.filter(id => id !== 'brush').slice(0, PRIMARY);
    const rest = shown.filter(id => !primary.includes(id));
    const tools = div('st-tools'); tools.setAttribute('role', 'toolbar'); tools.setAttribute('aria-label', 'أدوات الرسم');
    const img = btn('st-row-btn st-row-ic', 'إدراج صورة', svg(I.image) + '<span>إدراج صورة</span>', 'studio-insert-image');
    img.onclick = () => { closePops(); if (M.images && typeof M.images.pick === 'function') M.images.pick(); else if (M.banner) M.banner('إدراج الصور غير متاح الآن.', [['حسناً', () => {}]]); };
    if (tab) { img.className = 'st-btn st-insert'; for (const id of NW) { if (id === '@image') tools.append(img); else if (primary.includes(id)) tools.append(toolButton(byId[id])); } }
    else primary.forEach(id => tools.append(toolButton(byId[id])));
    const cur = curId();
    if (byId[cur] && !primary.includes(cur)) { const b = toolButton(byId[cur]); b.classList.add('st-extra'); tools.append(b); }   /* the active tool is never hidden */
    /* colour and thickness: the highlighter offers marker colours, everything else the ink colours */
    const colors = div('st-colors'); colors.setAttribute('role', 'group'); colors.setAttribute('aria-label', 'اللون');
    for (const [c, n] of (S.tool === 'highlight' ? MARKERS.slice(0, 4) : COLORS)) { const b = btn('st-swatch', n, ''); b.dataset.color = c; b.style.setProperty('--sw', c); b.onclick = () => { if (selStyle({ color: c })) return; S.color = c; const ci = $('color'); if (ci) ci.value = c; M.emit('style'); sync(); }; colors.append(b); }
    const sizes = div('st-sizes'); sizes.setAttribute('role', 'group'); sizes.setAttribute('aria-label', 'السُمك');
    for (const [w, n] of SIZES) { const b = btn('st-size', n, '<span></span>'); b.dataset.w = w; b.style.setProperty('--d', (4 + w * 2) + 'px'); b.onclick = () => { if (selStyle({ width: w })) return; S.width = w; const wi = $('width'); if (wi) wi.value = w; M.emit('style'); sync(); }; sizes.append(b); }
    const custom = div('st-custom');
    const ci = document.createElement('input'); ci.type = 'color'; ci.id = 'color'; ci.value = HEX6.test(S.color) ? S.color : '#168c8c'; ci.setAttribute('aria-label', 'لون مخصص'); ci.oninput = e => { if (selOn()) return; S.color = e.target.value; M.emit('style'); sync(); };
    ci.onchange = e => selStyle({ color: e.target.value });                       /* a selection is restyled once, when the picker settles */
    const wl = document.createElement('label'); wl.className = 'st-width'; wl.append('السُمك '); const wi = document.createElement('input'); wi.type = 'range'; wi.id = 'width'; wi.min = 1; wi.max = 20; wi.value = S.width; wi.oninput = e => { if (selOn()) return; S.width = +e.target.value; M.emit('style'); sync(); }; wi.onchange = e => selStyle({ width: +e.target.value }); wl.append(wi);
    const cl = document.createElement('label'); cl.className = 'st-colorlab'; cl.append(ci, 'لون آخر'); custom.append(cl, wl);
    if (SETG[S.tool] === 'text') sizes.hidden = wl.hidden = true;   /* text and notes have no stroke width (their size is in the sheet) */
    const style = div('st-style'), wrap = div('st-stylewrap');
    if (quickOn()) {                                                   /* tablets and computers: a thin bar under the toolbar (Notewise) */
      const q = div('st-quick'); q.id = 'st-quickbar'; q.setAttribute('role', 'toolbar'); q.setAttribute('aria-label', 'خيارات سريعة'); q.dataset.for = S.tool;
      const kind = btn('st-qbtn st-qkind', 'نوع الأداة وإعداداتها', kindSvg(kindKey())); kind.dataset.k = kindKey();
      kind.onclick = () => toggleSet(false);
      const qc = div('st-colors st-qcolors'); qc.setAttribute('role', 'group'); qc.setAttribute('aria-label', 'اللون');
      for (const [c, n] of (S.tool === 'highlight' ? MARKERS.slice(0, 5) : QUICK_COLORS)) { const b = btn('st-swatch', n, ''); b.dataset.color = c; b.style.setProperty('--sw', c); b.onclick = () => { if (selStyle({ color: c })) return; S.color = c; const ci = $('color'); if (ci) ci.value = c; M.emit('style'); sync(); }; qc.append(b); }
      const plus = btn('st-qbtn st-qplus', 'لون وسُمك مخصصان', svg(I.dplus)), pp = popFor(plus, 'st-stylepop st-qpop', 'لون وسُمك مخصصان');
      pp.append(custom); const pw = div('st-stylewrap'); pw.append(plus, pp);
      const gear = btn('st-qbtn st-qset', 'كل إعدادات الأداة', svg(I.sliders));
      gear.onclick = () => toggleSet(false);
      q.append(kind, div('st-qsep'), sizes, div('st-qsep'), qc, pw, div('st-qsep'), gear);
      if (SETG[S.tool] === 'text') q.querySelectorAll('.st-qsep')[0].hidden = true;
      style.append(q); document.body.classList.add('st-has-quick');
    } else if (quickFor()) {
      /* quick bar hidden with the chevron: colour and size from a second tap / long press on the tool (its settings) */
    } else if (COMPACT || mqStyle.matches) {                                  /* tablets in portrait and phones: one colour dot opens everything */
      const sb = btn('st-btn st-stylebtn', 'اللون والسُمك', '<span class="st-dot"></span>'), p = popFor(sb, 'st-stylepop', 'اللون والسُمك');
      p.append(colors, sizes, custom); wrap.append(sb, p); style.append(wrap);
    } else {
      const sb = btn('st-btn st-stylebtn st-custombtn', 'لون وسُمك مخصصان', '<span class="st-dot st-dot-any"></span>'), p = popFor(sb, 'st-stylepop', 'لون وسُمك مخصصان');
      p.append(custom); wrap.append(sb, p); style.append(colors, sizes, wrap);
    }
    const hist = div('st-hist');
    const un = btn('st-btn', 'تراجع', svg(I.undo), 'undo'), re = btn('st-btn', 'إعادة', svg(I.redo), 'redo');
    un.onclick = () => M.undo(); re.onclick = () => M.redo(); hist.append(un, re);
    /* القلم والإصبع (2026-10-21، طلب محمد 11): pressed = the finger writes too; released = the pen writes and the finger
       scrolls / zooms. Automatic until the student chooses; the choice stays on this device. */
    if (M.setFingerMode) {
      const fb = btn('st-btn st-fingerbtn', 'الكتابة بالإصبع', svg(I.finger), 'st-finger-toggle');
      fb.onclick = () => { const draw = M.penMode(); M.setFingerMode(draw ? 'draw' : 'nav'); toast(draw ? 'الإصبع يكتب الآن مثل القلم' : 'القلم يكتب، والإصبع يحرّك الصفحة ويكبّرها'); };
      hist.append(fb);
    }
    /* «الإعدادات» (the gear): the remaining tools, inserting a picture (phones), touch & stylus input, the reader settings */
    const opts = div('st-settings');
    const more = btn('st-btn st-more', 'الإعدادات', svg(I.gear), 'studio-settings');
    const gp = popFor(more, 'st-morepop', 'الإعدادات');
    if (rest.length) { const grid = div('st-grid'); rest.forEach(id => grid.append(toolButton(byId[id]))); gp.append(txt('p', 'st-pop-h', 'أدوات أخرى'), grid); }
    if (!tab) gp.append(img);
    gp.append(inputSection());
    const sn = check('studio-snap', 'محاذاة الزاوية', S.snap, v => { M.setSnap(v); refreshSet(); });
    const cs = btn('st-row-btn', 'تخصيص الشريط', 'تخصيص الشريط', 'studio-customize'); cs.onclick = () => { closePops(); openCustomize(); };
    const mg = btn('st-row-btn', 'هوامش الكتابة', 'هوامش الكتابة', 'studio-margins-btn'); mg.onclick = () => { closePops(); openMargins(); };
    gp.append(txt('p', 'st-pop-h', 'الإعدادات'), sn, mg, cs); opts.append(more, gp);
    ts = div('st-pop st-toolset'); ts.id = 'st-toolset'; ts.hidden = true; ts.setAttribute('role', 'dialog');
    let col = null;
    if (tab) {                                                       /* ⌄ / ⌃ : hide or show the tool options bar */
      col = div('st-collapse');
      const qt = btn('st-btn st-quick-toggle', quickOn() ? 'إخفاء خيارات الأداة' : 'إظهار خيارات الأداة', svg(I.chevron), 'st-quick-toggle');
      qt.setAttribute('aria-controls', 'st-quickbar'); qt.setAttribute('aria-expanded', String(quickOn()));
      if (!quickFor()) qt.setAttribute('aria-disabled', 'true');
      qt.onclick = () => { if (!quickFor()) return; cfg.quick = !(cfg.quick !== false); save(); closePops(); render(); };
      col.append(qt);
    }
    /* compact: undo · redo · finger | tools · (colour dot on phones) · settings | ⌄ — the old layout keeps its order */
    if (COMPACT) root.append(hist, tools, style, opts); else root.append(tools, style, hist, opts);
    if (col) root.append(col); root.append(ts); sync(); hs(); syncInput();
    root.dispatchEvent(new CustomEvent('st-rendered'));
  }
  /* «الكتابة باللمس والقلم»: what a finger does, palm rejection, two-finger navigation, stylus auto-detection */
  function inputSection() {
    const sec = div('st-inputset'), I = M.input ? M.input() : {}, set = p => M.setInput ? M.setInput(p) : (p.stylusOnly != null && M.setPenOnly(p.stylusOnly));
    sec.append(txt('p', 'st-pop-h', 'الكتابة باللمس والقلم'));
    if (M.setFingerMode) {
      const fm = div('ts-seg st-fingermode'); fm.id = 'studio-fingermode'; fm.setAttribute('role', 'group'); fm.setAttribute('aria-label', 'القلم والإصبع');
      for (const [v, t] of [['auto', 'تلقائي'], ['nav', 'القلم يكتب والإصبع يحرّك'], ['draw', 'الإصبع يكتب أيضاً']]) {
        const b = document.createElement('button'); b.type = 'button'; b.dataset.fm = v; b.textContent = t;
        b.setAttribute('aria-pressed', String((I.fingerMode || 'auto') === v)); b.onclick = () => M.setFingerMode(v); fm.append(b);
      }
      sec.append(fm, txt('p', 'st-note-line', 'تلقائي: بعد أول استعمال لقلم Apple يكتب القلم فقط، والإصبع يحرّك الصفحة ويكبّرها بإصبعين.'));
    } else {
      sec.append(check('studio-finger', 'الكتابة بالإصبع', I.fingerDraw, v => set({ fingerDraw: v })));
      sec.append(check('medixa-pen-only', 'القلم الإلكتروني فقط', S.penOnly, v => set({ stylusOnly: v })));
    }
    sec.append(check('studio-palm', 'تجاهل راحة اليد', I.palm, v => set({ palm: v })));
    const palm = div('st-subrow'), pl = txt('label', '', 'حساسية الرصد'), ps = document.createElement('select'); ps.id = 'studio-palm-sens'; pl.htmlFor = ps.id; ps.setAttribute('aria-label', 'حساسية تجاهل راحة اليد');
    for (const [v, n] of [['low', 'منخفضة'], ['medium', 'متوسطة'], ['high', 'عالية']]) { const o = document.createElement('option'); o.value = v; o.textContent = n; ps.append(o); }
    ps.value = I.palmSens || 'medium'; ps.onchange = () => set({ palmSens: ps.value });
    palm.append(pl, ps); sec.append(palm);
    sec.append(check('studio-twofinger', 'التنقل بإصبعين', I.twoFinger, v => set({ twoFinger: v })));
    sec.append(check('studio-autostylus', 'التبديل تلقائياً عند استعمال القلم', I.autoStylus, v => set({ autoStylus: v })));
    const st = div('st-penstat'), line = txt('span', '', ''); line.id = 'studio-pen-status'; line.setAttribute('role', 'status');
    const fg = btn('st-row-btn st-forget', 'نسيان القلم', 'نسيان القلم', 'studio-forget-pen'); fg.onclick = () => { if (M.gesture && M.gesture.forgetPen) M.gesture.forgetPen(); syncInput(); };
    st.append(line, fg); sec.append(st, txt('p', 'st-note-line st-input-note', 'تجاهل راحة اليد في المتصفح تقديري ويعتمد على ما يرسله الجهاز.'));
    return sec;
  }
  function syncInput() {
    const fb = $('st-finger-toggle');
    if (fb && M.penMode) { const draw = !M.penMode(); fb.setAttribute('aria-pressed', String(draw)); fb.classList.toggle('active', draw); fb.title = draw ? 'الإصبع يكتب — اضغط ليحرّك الإصبع الصفحة' : 'الإصبع يحرّك الصفحة — اضغط ليكتب الإصبع'; }
    document.querySelectorAll('#studio-fingermode button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.fm === ((M.input && M.input().fingerMode) || 'auto'))));
    const I = M.input ? M.input() : {}, put = (id, v) => { const e = $(id); if (e && e.checked !== !!v) e.checked = !!v; };
    put('studio-finger', I.fingerDraw); put('medixa-pen-only', I.stylusOnly); put('studio-palm', I.palm); put('studio-twofinger', I.twoFinger); put('studio-autostylus', I.autoStylus); put('studio-snap', S.snap);
    const f = $('studio-finger'); if (f) f.disabled = !!I.stylusOnly;                 /* «القلم فقط» already decides what a finger does */
    const ps = $('studio-palm-sens'); if (ps) { if (ps.value !== I.palmSens) ps.value = I.palmSens || 'medium'; ps.disabled = !I.palm; }
    const seen = !!(M.gesture && M.gesture.penSeen > 0), line = $('studio-pen-status'), fg = $('studio-forget-pen');
    if (line) { line.textContent = seen ? 'اكتُشف قلم على هذا الجهاز' : 'لم يُكتشف قلم بعد'; line.parentNode.dataset.seen = String(seen); }
    if (fg) fg.disabled = !seen;
  }
  /* The toolbar floats over the page (under the header; at the bottom on phones); pages reserve its measured height. */
  function reserve() { const h = Math.ceil(root.getBoundingClientRect().height); document.documentElement.style.setProperty('--st-tb-h', h + 'px'); const hd = document.querySelector('header'); if (hd) document.documentElement.style.setProperty('--st-hdr-h', Math.ceil(hd.getBoundingClientRect().height) + 'px'); }
  if (window.ResizeObserver) { new ResizeObserver(reserve).observe(root); const hd = document.querySelector('header'); if (hd) new ResizeObserver(reserve).observe(hd); }
  /* the hand that held a tool lifts: its click (same spot, right after) must not close or press what is now under it */
  addEventListener('pointerup', e => { if (lp.pid === e.pointerId) lp = { id: lp.id, at: Date.now(), pid: null, x: e.clientX, y: e.clientY }; }, true);
  addEventListener('pointercancel', e => { if (lp.pid === e.pointerId) lp = LP0; }, true);
  addEventListener('click', e => { if (lp.pid == null && lpFresh() && Math.hypot(e.clientX - lp.x, e.clientY - lp.y) < 32) { lp = LP0; e.stopPropagation(); e.preventDefault(); } }, true);
  addEventListener('click', e => {
    const t = e.target; if (!t.closest || t.closest('.st-pop')) return;
    if (t.closest('#studio-toolbar [data-tool], #st-quickbar .st-qkind, #st-quickbar .st-qset')) return;   /* tool buttons (and the quick bar's settings) open / close their own sheet */
    const own = t.closest('[aria-haspopup="true"]'); if (own && own.nextElementSibling && own.nextElementSibling.classList.contains('st-pop')) return; closePops();
  });
  /* Escape closes the open popover and gives focus back to the button that opened it */
  addEventListener('keydown', e => {
    if (e.key !== 'Escape') return;
    const open = [...document.querySelectorAll('.st-pop')].filter(p => !p.hidden); if (!open.length) return;
    const p = open.find(x => x.contains(document.activeElement)), a = p && (p._anchor || p.previousElementSibling);
    closePops(); e.stopPropagation(); if (a && a.isConnected && a.focus) a.focus();
  }, true);
  addEventListener('resize', () => { if (ts && !ts.hidden) place(); });
  /* the iPad keyboard and Safari's bars change the visible height: keep the open sheet inside it */
  if (window.visualViewport) visualViewport.addEventListener('resize', () => { if (ts && !ts.hidden) place(); });
  addEventListener('orientationchange', () => setTimeout(() => { if (ts && !ts.hidden) place(); }, 250));
  function sync() {
    root.querySelectorAll('[data-tool]').forEach(b => {
      const on = isOn(b.dataset.tool);
      b.classList.toggle('active', on); b.setAttribute('aria-pressed', String(on));
    });
    root.querySelectorAll('.st-swatch').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === S.color)));
    root.querySelectorAll('.st-size').forEach(b => b.setAttribute('aria-pressed', String(+b.dataset.w === S.width)));
    root.style.setProperty('--st-cur', HEX6.test(S.color) ? S.color : '#168c8c');
    const ci = $('color'); if (ci && ci.value !== S.color && HEX6.test(S.color)) ci.value = S.color;
    const wi = $('width'); if (wi && +wi.value !== S.width) wi.value = S.width;
    const k = root.querySelector('#st-quickbar .st-qkind'); if (k && k.dataset.k !== kindKey()) { k.dataset.k = kindKey(); k.innerHTML = kindSvg(k.dataset.k); }   /* pen ⇄ brush from the sheet */
  }
  function hs() { if (!S.hist) return; const u = $('undo'), r = $('redo'); if (u) u.disabled = !S.hist.canUndo; if (r) r.disabled = !S.hist.canRedo; }
  /* a short message at the top of the page (pen / finger switching) */
  let toastEl = null, toastT = 0;
  function toast(text) {
    if (!toastEl) { toastEl = document.createElement('div'); toastEl.id = 'st-toast'; toastEl.setAttribute('role', 'status'); toastEl.setAttribute('aria-live', 'polite'); document.body.append(toastEl); }
    toastEl.textContent = text; toastEl.classList.add('on'); clearTimeout(toastT); toastT = setTimeout(() => toastEl.classList.remove('on'), 2600);
  }
  M.toast = M.toast || toast;
  M.on('pen-detected', () => { syncInput(); toast('اكتُشف القلم: القلم يكتب، والإصبع يحرّك الصفحة ويكبّرها'); });
  M.on('tool', render); M.on('history', hs); M.on('style', () => { sync(); refreshSet(); }); M.on('input', () => { syncInput(); refreshSet(); });
  mqStyle.addEventListener && mqStyle.addEventListener('change', render);
  if (COMPACT && mqPhone.addEventListener) mqPhone.addEventListener('change', render);
  M.closePops = closePops;

  /* =============================== tool settings sheet (#st-toolset) =============================== */
  const sty = () => (M.style && M.style(S.tool)) || {};
  const put = props => { if (M.setStyle) M.setStyle(S.tool, props); };      /* emits 'style' -> refreshSet() */
  const anchor = () => root.querySelector('.st-tools .st-btn.active[data-tool]') || root.querySelector('.st-tools [data-tool="' + S.tool + '"]');
  function toggleSet(kbd) { const open = ts && !ts.hidden; closePops(); if (!open) openSet(kbd); }
  function openSet(kbd) {
    if (!ts || !hasSet(S.tool)) return;
    closePops(); build(groupFor(S.tool)); ts.hidden = false;
    const a = anchor(); ts._anchor = a || null; if (a) a.setAttribute('aria-expanded', 'true');
    place(); refreshSet();
    if (kbd) { const f = ts.querySelector('button:not(.ts-x),input,select'); if (f) f.focus(); }
  }
  /* desktop / tablet: under the toolbar (and its quick bar), centred on the tool and kept on screen. Its height is what is
     really left down to the bottom of the visible screen (or to the page pill when it sits under the sheet), so the whole
     sheet shows on an iPad. Phones: a bottom sheet (CSS). */
  function place() {
    ts.style.left = ''; ts.style.right = ''; ts.style.maxHeight = '';
    if (mqPhone.matches) return;
    const a = anchor(), r = root.getBoundingClientRect(), w = ts.offsetWidth; if (!w) return;
    if (a) {
      const ar = a.getBoundingClientRect(); let x = ar.left + ar.width / 2 - w / 2;
      x = Math.max(8, Math.min(innerWidth - 8 - w, x));
      ts.style.left = Math.round(x - r.left) + 'px'; ts.style.right = 'auto';
    }
    const vv = window.visualViewport, sr = ts.getBoundingClientRect();
    let bottom = (vv ? vv.height + (vv.offsetTop || 0) : innerHeight) - 12;
    const dock = $('mx-dock');
    if (dock) { const d = dock.getBoundingClientRect(); if (d.width && d.height && d.left < sr.right && d.right > sr.left && d.top < bottom) bottom = d.top - 8; }
    ts.style.maxHeight = Math.round(Math.max(240, bottom - sr.top)) + 'px';
  }
  function refreshSet() { if (!ts || ts.hidden) return; for (const f of upd) f(); paintPreview(); }
  /* ---- small builders; each control registers how to re-read its value from the engine ---- */
  function sec(title, cls) { const s = div('ts-sec' + (cls ? ' ' + cls : '')); if (title) s.append(txt('p', 'ts-h', title)); ts.append(s); return s; }
  function range(id, label, min, max, step, get, set, fmt) {
    const row = document.createElement('div'); row.className = 'ts-row';
    const l = txt('label', '', label); l.htmlFor = id;
    const r = document.createElement('input'); r.type = 'range'; r.id = id; r.min = min; r.max = max; r.step = step; r.value = get();
    const o = document.createElement('output'); o.htmlFor = id; o.textContent = fmt(get());
    r.oninput = () => { set(+r.value); o.textContent = fmt(get()); };
    upd.push(() => { const v = get(); if (Math.abs(+r.value - v) > 1e-9) r.value = v; o.textContent = fmt(v); });
    row.append(l, r, o); return row;
  }
  function toggle(id, label, get, set) {
    const l = check(id, label, get(), v => set(v)); l.classList.add('ts-switch');
    upd.push(() => { const i = l.querySelector('input'); if (i.checked !== !!get()) i.checked = !!get(); });
    return l;
  }
  function colors(list) {
    const wrap = div('ts-colors'); wrap.setAttribute('role', 'group'); wrap.setAttribute('aria-label', 'اللون');
    for (const [c, n] of list) { const b = btn('ts-sw', n, ''); b.dataset.color = c; b.style.setProperty('--sw', c); b.onclick = () => put({ color: c }); wrap.append(b); }
    const lab = document.createElement('label'); lab.className = 'ts-custom'; lab.title = 'لون آخر';
    const ci = document.createElement('input'); ci.type = 'color'; ci.id = 'ts-color'; ci.setAttribute('aria-label', 'لون آخر'); ci.oninput = () => put({ color: ci.value }); lab.append(ci); wrap.append(lab);
    upd.push(() => { const c = String(sty().color || '').toLowerCase(); wrap.querySelectorAll('.ts-sw').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.color === c))); if (HEX6.test(c) && ci.value !== c) ci.value = c; });
    return wrap;
  }
  function seg(label, attr, list, get, set) {
    const s = div('ts-seg'); s.setAttribute('role', 'group'); s.setAttribute('aria-label', label);
    for (const [v, t, hint] of list) { const b = document.createElement('button'); b.type = 'button'; b.dataset[attr] = v; b.append(txt('span', '', t)); if (hint) b.append(txt('small', '', hint)); b.onclick = () => set(v); s.append(b); }
    upd.push(() => s.querySelectorAll('button').forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(get())))));
    return s;
  }
  const PEN_LABELS = Object.fromEntries(PENS);

  /* ---- Notewise sheet rows (pen, brush, highlighter): one compact line each, label at the start, control at the end ---- */
  const hr = () => { const d = div('ts-hr'); d.setAttribute('aria-hidden', 'true'); return d; };
  const fmtW = v => String(+(+v).toFixed(1));
  /* «السُمك» / «الشفافية»: label + value pill, then − slider + (Material). Safari on iPad moves a native range only when its
     thumb is dragged, so a finger anywhere on the track sets the value (pointer capture; touch-action:none in CSS). */
  function slider(id, label, min, max, step, get, set, fmt, o) {
    o = o || {};
    const box = div('ts-slider' + (o.alpha ? ' ts-sl-alpha' : ''));
    const head = div('ts-vrow'), l = txt('label', 'ts-ct', label); l.htmlFor = id;
    const out = document.createElement('output'); out.className = 'ts-pill'; out.htmlFor = id; head.append(l, out);
    const row = div('ts-slrow');
    const r = document.createElement('input'); r.type = 'range'; r.className = 'ts-range'; r.id = id; r.min = min; r.max = max; r.step = step; r.dir = 'ltr';
    const half = o.alpha ? 14 : 12;                                    /* half of the thumb's hit box (CSS) */
    const q = v => Math.min(max, Math.max(min, +(Math.round((v - min) / step) * step + min).toFixed(3)));
    const show = () => {
      const v = +get(); if (Math.abs(+r.value - v) > 1e-9) r.value = v;
      r.style.setProperty('--f', String(Math.min(1, Math.max(0, (v - min) / (max - min))))); out.textContent = fmt(v);
      if (o.alpha) { const c = sty().color; r.style.setProperty('--sw', HEX6.test(c || '') ? c : '#f2c230'); }
    };
    const apply = v => { v = q(v); if (Math.abs(v - +get()) > 1e-9) set(v); show(); };
    r.oninput = () => apply(+r.value);
    r.addEventListener('pointerdown', e => {
      if (e.pointerType === 'mouse' || e.button > 0) return;
      e.preventDefault(); try { r.setPointerCapture(e.pointerId); } catch {}
      const at = ev => { const b = r.getBoundingClientRect(); apply(min + Math.min(1, Math.max(0, (ev.clientX - b.left - half) / Math.max(1, b.width - 2 * half))) * (max - min)); };
      const mv = ev => { if (ev.pointerId === e.pointerId) at(ev); };
      const up = ev => { if (ev.pointerId !== e.pointerId) return; r.removeEventListener('pointermove', mv); r.removeEventListener('pointerup', up); r.removeEventListener('pointercancel', up); };
      at(e); r.addEventListener('pointermove', mv); r.addEventListener('pointerup', up); r.addEventListener('pointercancel', up);
    });
    if (o.steppers) {
      /* − / + : one step per tap; held, it repeats every 120 ms after 400 ms */
      const stp = (sign, aria, icon) => {
        const b = btn('ts-stp', aria, svg(icon, 20)); let t1 = 0, t2 = 0;
        const stop = () => { clearTimeout(t1); clearInterval(t2); t1 = t2 = 0; }, go = () => { if (!b.isConnected) return stop(); apply(+get() + sign * step); };
        b.addEventListener('pointerdown', e => { if (e.button > 0) return; e.preventDefault(); stop(); go(); t1 = setTimeout(() => { t2 = setInterval(go, 120); }, 400); });
        for (const ev of ['pointerup', 'pointercancel', 'pointerleave']) b.addEventListener(ev, stop);
        b.addEventListener('contextmenu', e => e.preventDefault());
        b.onclick = e => { if (e.detail === 0) go(); };                 /* keyboard */
        return b;
      };
      row.append(stp(-1, 'إنقاص ' + label, I.minus), r, stp(1, 'زيادة ' + label, I.plus));
    } else row.append(r);
    upd.push(show); box.append(head, row); return box;
  }
  /* a settings line: title (+ ⓘ that opens a one-line explanation under it) and an optional current value under the title */
  let hintN = 0;
  function crow(label, control, o) {
    o = o || {};
    const g = div('ts-cgroup'), row = div('ts-crow'), lb = div('ts-clab'), line = div('ts-cline');
    const t = txt(o.forId ? 'label' : 'span', 'ts-ct', label); if (o.forId) t.htmlFor = o.forId; line.append(t);
    let hint = null;
    if (o.info) {
      const ib = btn('ts-info', 'معلومات: ' + label, svg(I.info, 18)); hint = txt('p', 'ts-ihint', o.info); hint.hidden = true; hint.id = 'ts-hint-' + (++hintN);
      ib.setAttribute('aria-expanded', 'false'); ib.setAttribute('aria-controls', hint.id);
      ib.onclick = () => {
        const open = hint.hidden;
        ts.querySelectorAll('.ts-ihint').forEach(h => { h.hidden = true; }); ts.querySelectorAll('.ts-info').forEach(b => b.setAttribute('aria-expanded', 'false'));
        hint.hidden = !open; ib.setAttribute('aria-expanded', String(open));
      };
      line.append(ib);
    }
    lb.append(line);
    if (o.sub) { const s = txt('span', 'ts-cs', ''); lb.append(s); row.classList.add('ts-crow-2l'); upd.push(() => { s.textContent = o.sub(); }); }
    row.append(lb, control); g.append(row); if (hint) g.append(hint);
    return g;
  }
  function iconSeg(label, attr, list, get, set) {
    const s = div('ts-isg'); s.setAttribute('role', 'group'); s.setAttribute('aria-label', label);
    for (const [v, icon, name] of list) { const b = btn('ts-isb', name, svg(icon)); b.dataset[attr] = v; b.onclick = () => set(v); s.append(b); }
    upd.push(() => s.querySelectorAll('.ts-isb').forEach(b => b.setAttribute('aria-pressed', String(b.dataset[attr] === String(get())))));
    return s;
  }
  /* a value pill that opens the system list (iPad shows its own picker); why(): a reason to disable it, or '' */
  function pillSelect(id, label, opts, get, set, why) {
    const s = document.createElement('select'); s.id = id; s.className = 'ts-pill ts-pillsel'; s.setAttribute('aria-label', label);
    for (const [v, t] of opts) { const o = document.createElement('option'); o.value = String(v); o.textContent = t; s.append(o); }
    s.onchange = () => set(s.value);
    upd.push(() => { const v = String(get()); if (s.value !== v) s.value = v; if (why) { const w = why(); s.disabled = !!w; s.title = w || ''; } });
    return s;
  }
  function sw(id, label, get, set, info) {
    const i = document.createElement('input'); i.type = 'checkbox'; i.id = id; i.className = 'ts-sw2'; i.setAttribute('role', 'switch');
    i.onchange = () => set(i.checked);
    upd.push(() => { const v = !!get(); if (i.checked !== v) i.checked = v; });
    return crow(label, i, { forId: id, info });
  }
  /* «اللون»: one scrolling row of colours and a rainbow for any colour; ≡ swaps the row for the saved favourites, + saves
     the current pen / marker as a favourite (the engine keeps up to 6 in the style's presets) */
  function colorArea(list, kind) {
    const box = div('ts-carea'), head = div('ts-chead'), lab = txt('span', 'ts-ct', 'اللون'), act = div('ts-cact');
    const add = btn('ts-cbtn', kind === 'pen' ? 'حفظ القلم الحالي في المفضلة' : 'حفظ التظليل الحالي في المفضلة', svg(I.plus, 22));
    const favB = btn('ts-cbtn', 'الأنماط المفضلة', svg(I.list, 22)); favB.setAttribute('aria-pressed', 'false');
    act.append(add, favB); head.append(lab, act);
    const row = div('ts-crow2'), sc = div('ts-cscroll'), dv = div('ts-cdiv'); sc.setAttribute('role', 'group'); dv.setAttribute('aria-hidden', 'true');
    const cust = document.createElement('label'); cust.className = 'ts-custom'; cust.title = 'لون آخر';
    const ci = document.createElement('input'); ci.type = 'color'; ci.id = 'ts-color'; ci.setAttribute('aria-label', 'لون آخر'); ci.oninput = () => put({ color: ci.value }); cust.append(ci);
    row.append(sc, dv, cust); box.append(head, row);
    let favView = false, sig = '';
    const lc = c => String(c || '').toLowerCase();
    const presets = () => Array.isArray(sty().presets) ? sty().presets : [];
    const name = p => kind === 'pen' ? (PEN_LABELS[p.pen] || 'قلم') + ' · ' + p.width : (p.tip === 'flat' ? 'مسطح' : 'دائري') + ' · ' + p.width;
    const same = (s, p) => lc(s.color) === lc(p.color) && Math.abs((s.width || 3) - p.width) < 0.2 &&
      (kind === 'pen' ? s.pen === p.pen && (s.dash || 'solid') === (p.dash || 'solid') : (s.tip || 'round') === (p.tip || 'round'));
    const current = () => { const c = sty(); return kind === 'pen'
      ? { pen: c.pen || 'ballpoint', color: c.color || '#e43d56', width: c.width || 3, op: c.op || 1, dash: c.dash || 'solid' }
      : { color: c.color || '#f2c230', width: c.width || 3, op: c.op || 0.3, tip: c.tip || 'round' }; };
    function draw() {
      sc.replaceChildren(); const ps = presets(); sig = JSON.stringify(ps);
      if (!favView) {
        sc.setAttribute('aria-label', 'اللون');
        for (const [c, n] of list) { const b = btn('ts-sw', n, ''); b.dataset.color = c; b.style.setProperty('--sw', c); b.onclick = () => put({ color: c }); sc.append(b); }
        return;
      }
      sc.setAttribute('aria-label', 'الأنماط المفضلة');
      ps.forEach((p, idx) => {
        const b = document.createElement('button'); b.type = 'button'; b.className = 'ts-fav'; b.dataset.i = String(idx);
        const nm = name(p); b.title = nm; b.setAttribute('aria-label', 'تطبيق ' + nm);
        const dot = document.createElement('span'); dot.className = 'ts-fav-dot'; dot.style.setProperty('--fc', p.color);
        b.append(dot, txt('span', 'ts-fav-meta', nm));
        b.onclick = () => put(kind === 'pen' ? { pen: p.pen, color: p.color, width: p.width, op: p.op || 1, dash: p.dash || 'solid' } : { color: p.color, width: p.width, op: p.op || 0.3, tip: p.tip || 'round' });
        if (ps.length > 1) {
          const rm = txt('span', 'ts-fav-rm', '×'); rm.title = 'حذف النمط'; rm.setAttribute('aria-hidden', 'true');
          rm.onclick = e => { e.stopPropagation(); put({ presets: ps.filter((_, i) => i !== idx) }); };
          b.append(rm);
        }
        sc.append(b);
      });
    }
    add.onclick = () => {
      const ps = presets(), cur = current(), at = ps.findIndex(p => same(cur, p));
      favView = true;
      if (at < 0 && ps.length < 6) put({ presets: ps.concat([cur]).slice(0, 6) }); else draw();
      refreshSet();
      const b = sc.querySelector('.ts-fav[data-i="' + (at < 0 ? presets().length - 1 : at) + '"]'); if (b && b.scrollIntoView) b.scrollIntoView({ block: 'nearest', inline: 'nearest' });
    };
    favB.onclick = () => { favView = !favView; draw(); refreshSet(); };
    upd.push(() => {
      if (JSON.stringify(presets()) !== sig) draw();               /* only when the favourites changed: a slider drag keeps the scroll */
      lab.textContent = favView ? 'الأنماط المفضلة' : 'اللون'; favB.setAttribute('aria-pressed', String(favView));
      const ps = presets(), full = ps.length >= 6; add.disabled = full; add.title = full ? 'المفضلة ممتلئة — احذف نمطاً أولاً' : add.getAttribute('aria-label');
      const s = sty(), c = lc(s.color); let known = false;
      sc.querySelectorAll('.ts-sw').forEach(b => { const on = b.dataset.color === c; known = known || on; b.setAttribute('aria-pressed', String(on)); });
      sc.querySelectorAll('.ts-fav').forEach(b => { const p = ps[+b.dataset.i]; b.setAttribute('aria-pressed', String(!!p && same(s, p))); });
      cust.classList.toggle('on', !favView && !known);
      if (HEX6.test(c) && ci.value !== c) ci.value = c;
    });
    draw(); return box;
  }
  const DASH_N = { solid: 'متصل', dashed: 'متقطع', dotted: 'منقط' };
  const hlMode = () => { const s = sty(); return s.alwaysStraight ? 'line' : s.straight !== false ? 'hold' : 'free'; };
  const HL_N = { hold: 'ثبّت للاستقامة', line: 'مستقيم دائماً', free: 'حر' };
  function build(g) {
    ts.replaceChildren(); upd = []; const id = byId[curId()] ? curId() : S.tool;
    ts.setAttribute('aria-label', TITLES[id] || TITLES[S.tool] || 'الإعدادات'); ts.dataset.group = g;
    const head = div('ts-head'), sp = document.createElement('span'); sp.setAttribute('aria-hidden', 'true');
    head.append(sp, txt('p', 'ts-title', SHORT[id] || TITLES[id] || TITLES[S.tool] || ''));
    const x = btn('ts-x', 'إغلاق', svg(I.x, 16), 'ts-close'); x.onclick = () => { const a = ts._anchor; closePops(); if (a && a.isConnected) a.focus(); };
    head.append(x); ts.append(head);
    if (g !== 'eraser' && g !== 'lasso') { const cv = document.createElement('canvas'); cv.id = 'ts-preview'; cv.className = 'ts-preview'; cv.setAttribute('role', 'img'); cv.setAttribute('aria-label', 'معاينة'); ts.append(cv); }
    if (g === 'pen') {
      /* Notewise's «Pen» sheet with our five real pen types (each card shows how that pen writes) */
      const pr = div('ts-presets'); pr.setAttribute('role', 'group'); pr.setAttribute('aria-label', 'نوع القلم');
      for (const [pid, nm] of PENS) { const b = btn('ts-preset', nm, '<canvas class="ts-chip" aria-hidden="true"></canvas><span>' + nm + '</span>'); b.dataset.pen = pid; b.onclick = () => put({ pen: pid }); pr.append(b); }
      upd.push(() => pr.querySelectorAll('.ts-preset').forEach(b => b.setAttribute('aria-pressed', String(b.dataset.pen === sty().pen))));
      ts.append(pr,
        slider('ts-width', 'السُمك', 1, 20, 0.5, () => sty().width || 3, v => put({ width: v }), fmtW, { steppers: true }),
        hr(),
        crow('نمط الخط', iconSeg('نمط الخط', 'dash', [['solid', I.solid, 'متصل'], ['dashed', I.dashed, 'متقطع'], ['dotted', I.dotted, 'منقط']], () => sty().dash || 'solid', v => put({ dash: v })), { sub: () => DASH_N[sty().dash || 'solid'] || 'متصل' }),
        sw('ts-shapesnap', 'ثبّت القلم لرسم شكل', () => (M.input ? M.input() : {}).shapeSnap, v => M.setInput && M.setInput({ shapeSnap: v }),
          'ارسم ثم أبقِ القلم ثابتاً لحظة ليتحوّل الرسم إلى خط أو دائرة أو مستطيل مرتّب.'),
        crow('حساسية الضغط', pillSelect('ts-pressure', 'حساسية الضغط', WR_LEVELS.map((_, n) => [n, String(n)]), () => wrLevel(sty().wr || [0.25, 2.2]), v => put({ wr: WR_LEVELS[+v].slice() }),
          () => sty().pen === 'technical' ? 'القلم التقني بسُمك ثابت' : ''), { forId: 'ts-pressure' }),
        crow('ثبات الخط', pillSelect('ts-smooth', 'ثبات الخط', Array.from({ length: 11 }, (_, n) => [n, String(n)]), () => Math.round((sty().smooth || 0) * 10), v => put({ smooth: +v / 10 })),
          { forId: 'ts-smooth', info: 'رقم أعلى = خط أنعم وأقل اهتزازاً، مع تأخر بسيط خلف القلم.' }),
        crow('الشفافية', pillSelect('ts-op', 'الشفافية', [100, 90, 80, 70, 60, 50, 40, 30, 20].map(n => [n, n + '%']), () => Math.min(100, Math.max(20, Math.round((sty().op == null ? 1 : sty().op) * 10) * 10)), v => put({ op: +v / 100 })), { forId: 'ts-op' }),
        hr(),
        colorArea(PEN_COLORS, 'pen'));
    } else if (g === 'highlight') {
      const hsRow = sw('ts-hsnap', 'محاذاة أفقية للسطور', () => sty().hsnap, v => put({ hsnap: v }));
      upd.push(() => { hsRow.hidden = hlMode() === 'free'; });
      ts.append(
        slider('ts-width', 'السُمك', 1, 10, 0.5, () => sty().width || 3, v => put({ width: v }), fmtW, { steppers: true }),
        slider('ts-op', 'الشفافية', 10, 80, 5, () => Math.round((sty().op || 0.3) * 100), v => put({ op: v / 100 }), v => v + '%', { alpha: true }),
        hr(),
        crow('شكل الطرف', iconSeg('شكل الطرف', 'tip', [['flat', I.tipFlat, 'مسطح'], ['round', I.tipRound, 'دائري']], () => sty().tip || 'round', v => put({ tip: v })), { sub: () => sty().tip === 'flat' ? 'مسطح' : 'دائري' }),
        crow('رسم خط مستقيم', iconSeg('رسم خط مستقيم', 'hlmode', [['hold', I.hold, 'ثبّت للاستقامة'], ['line', I.line, 'مستقيم دائماً'], ['free', I.free, 'حر']], hlMode,
          v => put(v === 'line' ? { alwaysStraight: true, straight: true } : v === 'hold' ? { straight: true, alwaysStraight: false } : { straight: false, alwaysStraight: false })), { sub: () => HL_N[hlMode()] }),
        hsRow,
        sw('ts-hl-shapesnap', 'ثبّت لرسم مستطيل أو دائرة', () => sty().shapeSnap !== false, v => put({ shapeSnap: v })),
        sw('ts-hl-blend', 'دمج خلف النص', () => sty().blend !== 'normal', v => { put({ blend: v ? 'multiply' : 'normal' }); M.redraw && M.redraw(); },
          'يبقى النص والكتابة تحت التظليل واضحين، كقلم التظليل على الورق.'),
        hr(),
        colorArea(MARKERS, 'highlight'));
    } else if (g === 'eraser') {
      sec('نوع الممحاة').append(seg('نوع الممحاة', 'mode', [
        ['stroke', 'ممحاة كاملة', 'تمسح الخط بلمسة'],
        ['precise', 'ممحاة دقيقة', 'تمسح جزءاً من الخط'],
        ['lasso', 'ممحاة إحاطة', 'تمسح ما تحيط به']
      ], () => sty().mode || 'stroke', v => put({ mode: v })));
      sec('نطاق المسح').append(seg('نطاق المسح', 'target', [
        ['all', 'الكل', 'حبر وتظليل'],
        ['highlight', 'التظليل فقط', 'يحافظ على الكتابة'],
        ['ink', 'الحبر فقط', 'يحافظ على التظليل']
      ], () => sty().target || 'all', v => put({ target: v })));
      const pv = div('ts-eprev'), dot = document.createElement('span'); dot.id = 'ts-edot'; pv.setAttribute('aria-hidden', 'true'); pv.append(dot);
      const qRow = div('ts-qsizes'); qRow.setAttribute('role', 'group'); qRow.setAttribute('aria-label', 'أحجام الممحاة');
      for (const [sz, lb] of [[8, 'صغير'], [16, 'متوسط'], [28, 'كبير'], [44, 'عريض']]) {
        const b = btn('ts-qsize', lb, '<small>' + lb + '</small>'); b.dataset.esz = sz;
        b.onclick = () => put({ size: sz }); qRow.append(b);
      }
      const sizeSec = sec('حجم الممحاة', 'ts-tight');
      sizeSec.append(qRow, range('ts-esize', 'الحجم', 4, 60, 1, () => sty().size || 12, v => put({ size: v }), v => String(Math.round(v))), pv);
      upd.push(() => {
        const d = Math.round((sty().size || 12) * 2), isLasso = sty().mode === 'lasso';
        dot.style.width = dot.style.height = d + 'px';
        sizeSec.hidden = isLasso;
        qRow.querySelectorAll('.ts-qsize').forEach(b => b.setAttribute('aria-pressed', String(Math.abs(+b.dataset.esz - (sty().size || 12)) <= 2)));
      });
      sec('خيارات متقدمة').append(
        toggle('ts-e-keepshapes', 'حماية الأشكال والصور والنصوص من المسح', () => !!sty().keepShapes, v => put({ keepShapes: v })),
        toggle('ts-e-autosize', 'تكبير تلقائي مع سرعة حركة اليد', () => sty().autoSize !== false, v => put({ autoSize: v })),
        toggle('ts-e-autoback', 'العودة التلقائية للقلم بعد المسح', () => !!sty().autoBack, v => put({ autoBack: v }))
      );
      const clrSec = sec('');
      const clrBtn = btn('st-row-btn ts-danger-btn', 'مسح تعليقات هذه الصفحة', 'مسح تعليقات هذه الصفحة', 'ts-clear-page');
      clrBtn.onclick = () => {
        const n = M.clearPage ? M.clearPage(null, false) : 0;
        closePops();
        if (n && M.banner) M.banner('مُسحت تعليقات هذه الصفحة (' + n + '). يمكنك التراجع بلمسة واحدة.', [['تراجع', () => M.undo()], ['حسناً', () => {}]]);
      };
      clrSec.append(clrBtn);
    } else if (g === 'shape') {
      ts.append(txt('p', 'ts-hint ts-shared', 'تنطبق على الخط والمستطيل والدائرة والسهم.'));
      sec('اللون').append(colors(PEN_COLORS));
      sec('نمط الخط').append(seg('نمط الخط', 'dash', [['solid', 'متصل'], ['dashed', 'متقطع'], ['dotted', 'منقط']], () => sty().dash || 'solid', v => put({ dash: v })));
      sec('', 'ts-tight').append(range('ts-width', 'السُمك', 1, 20, 1, () => sty().width, v => put({ width: v }), v => String(+(+v).toFixed(1))),
        toggle('ts-snap', 'محاذاة الزاوية (15°)', () => S.snap, v => { M.setSnap(v); const s2 = $('studio-snap'); if (s2) s2.checked = !!v; refreshSet(); }));
      if (S.tool === 'arrow') sec('رأس السهم').append(seg('رأس السهم', 'head', [['end', 'طرف واحد'], ['both', 'طرفان']], () => sty().head || 'end', v => put({ head: v })));
    } else if (g === 'text') {
      ts.append(txt('p', 'ts-hint ts-shared', 'تنطبق على النص والملاحظة اللاصقة.'));
      const row = div('ts-line'), lab = txt('label', '', 'الحجم'), sel = document.createElement('select'); sel.id = 'ts-size'; lab.htmlFor = 'ts-size';
      const SZ = [12, 14, 16, 18, 20, 24, 28, 32, 40];
      const fill = cur => { sel.replaceChildren(); for (const v of SZ.includes(cur) ? SZ : SZ.concat(cur).sort((a, b) => a - b)) { const o = document.createElement('option'); o.value = v; o.textContent = v; sel.append(o); } sel.value = String(cur); };
      sel.onchange = () => put({ size: +sel.value });
      const B = btn('ts-tog', 'عريض', '<b>B</b>', 'ts-bold'), It = btn('ts-tog', 'مائل', '<i>I</i>', 'ts-italic');
      B.onclick = () => put({ bold: !sty().bold }); It.onclick = () => put({ italic: !sty().italic });
      upd.push(() => { const s = sty(), cur = Math.round(s.size || 18); if (sel.value !== String(cur)) fill(cur); B.setAttribute('aria-pressed', String(!!s.bold)); It.setAttribute('aria-pressed', String(!!s.italic)); });
      fill(Math.round(sty().size || 18)); row.append(lab, sel, B, It); sec('النص').append(row);
      sec('اللون').append(colors(INKS));
    } else if (g === 'lasso') {
      sec('طريقة التحديد').append(seg('طريقة التحديد', 'smode', [['free', 'تحديد حر', 'ارسم حول ما تريد'], ['rect', 'تحديد مستطيل', 'اسحب مستطيلاً حوله']], selMode, setSelMode));
      if (M.selection && typeof M.selection.hitMode === 'function') {
        sec('حساسية التحديد').append(seg('حساسية التحديد', 'hitmode', [
          ['inside', 'احتواء العنصر', 'نصف العنصر داخل التحديد'],
          ['touch', 'بمجرد اللمس', 'أي تقاطع مع خط التحديد']
        ], () => M.selection.hitMode(), v => { M.selection.setHitMode(v); refreshSet(); }));
      }
      if (M.selection && M.selection.types) {
        const tSec = sec('العناصر القابلة للتحديد');
        for (const [k, label] of [['ink', 'الكتابة الحرة (القلم)'], ['hl', 'التظليل (الحر والنصي)'], ['shape', 'الأشكال والخطوط'], ['text', 'النصوص والملاحظات'], ['img', 'الصور المضافة']]) {
          tSec.append(toggle('ts-lasso-type-' + k, label, () => !!M.selection.types[k], v => {
            if (M.selection.setType) M.selection.setType(k, v);
            else M.selection.types[k] = v;
            refreshSet();
          }));
        }
      }
      const actSec = sec('إجراءات سريعة');
      const selAllBtn = btn('st-row-btn', 'تحديد كل عناصر هذه الصفحة', 'تحديد كل عناصر هذه الصفحة', 'ts-lasso-all');
      selAllBtn.onclick = () => { closePops(); if (M.selection && M.selection.selectAll) M.selection.selectAll(); };
      actSec.append(selAllBtn);
      if (M.selection && M.selection.hasClip && M.selection.hasClip()) {
        const pstBtn = btn('st-row-btn', 'لصق العناصر المنسوخة هنا', 'لصق العناصر المنسوخة هنا', 'ts-lasso-paste');
        pstBtn.onclick = () => { closePops(); M.selection.paste(); };
        actSec.append(pstBtn);
      }
    }
  }
  /* the selection module's own names may differ ('free' / 'lasso', 'rect' / 'rectangle'): read loosely, try each */
  function selMode() { let m = ''; try { m = String(M.selection.mode() || ''); } catch {} return /rect|box/i.test(m) ? 'rect' : 'free'; }
  function setSelMode(v) {
    for (const c of v === 'rect' ? ['rect', 'rectangle', 'box'] : ['free', 'lasso', 'freehand']) { try { M.selection.setMode(c); } catch {} if (selMode() === v) break; }
    refreshSet();
  }
  /* ---- live preview: the engine's own renderer draws a sample, so what you see is exactly what you will write ---- */
  function surface(cv, fw, fh) {
    const r = cv.getBoundingClientRect(), d = Math.min(3, window.devicePixelRatio || 1), cw = r.width || fw, ch = r.height || fh;
    const W = Math.max(1, Math.round(cw * d)), H = Math.max(1, Math.round(ch * d)); if (cv.width !== W || cv.height !== H) { cv.width = W; cv.height = H; }
    const ctx = cv.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, W, H);
    return { ctx, cw, ch, d, PW: 800 * d, H };                /* a virtual 800 px page: stroke widths show at true size */
  }
  /* sample points in CSS px -> page fractions of that virtual page (u = x / 800, v = y / height) */
  const uv = (x, y, ch) => [x / 800, y / ch];
  /* Notewise's sample gesture: up to a hump, a sharp drop and a small hook (fractions of its box), as a Catmull-Rom curve */
  const GEST = [[0.30, 0.72], [0.37, 0.56], [0.44, 0.38], [0.50, 0.27], [0.535, 0.30], [0.555, 0.45], [0.57, 0.66], [0.59, 0.78], [0.625, 0.80], [0.67, 0.72], [0.70, 0.66]];
  function gesture(n, x0, x1, y0, y1) {
    const P = GEST.map(([x, y]) => [x0 + (x - 0.30) / 0.40 * (x1 - x0), y0 + (y - 0.27) / 0.53 * (y1 - y0)]), segs = P.length - 1, out = [];
    for (let i = 0; i < n; i++) {
      const t = i / (n - 1) * segs, k = Math.min(segs - 1, Math.floor(t)), u = t - k;
      const a = P[Math.max(0, k - 1)], b = P[k], c = P[k + 1], e = P[Math.min(segs, k + 2)];
      const f = j => 0.5 * (2 * b[j] + (c[j] - a[j]) * u + (2 * a[j] - 5 * b[j] + 4 * c[j] - e[j]) * u * u + (3 * b[j] - a[j] - 3 * c[j] + e[j]) * u * u * u);
      out.push([f(0), f(1)]);
    }
    return out;
  }
  const pressure = t => t < 0.4 ? 0.15 + 0.85 * t / 0.4 : t < 0.75 ? 1 : 1 - 0.65 * (t - 0.75) / 0.25;   /* light, firm, lifting */
  function penItem(cw, ch, s, jit, box) {
    const pts = box ? gesture(48, box[0], box[1], box[2], box[3]) : gesture(48, cw * 0.30, cw * 0.70, ch * 0.27, ch * 0.80);
    let seed = 7; const rnd = () => (seed = (seed * 16807) % 2147483647) / 2147483647 - 0.5;
    const pr = pts.map((_, i) => pressure(i / (pts.length - 1)));
    const f = s.smooth > 0 && C.InkFilter ? new C.InkFilter(s.smooth, ch / 800) : null;   /* the same input filter the engine uses */
    const points = pts.map((p, i) => { const q = uv(p[0] + rnd() * jit, p[1] + rnd() * jit, ch); return f ? f.push(q, i * 8) : q; });
    const out = { id: 'ts-sample', page: 1, tool: 'pen', color: s.color || '#e43d56', width: s.width || 3, pen: s.pen || 'ballpoint', wr: (s.wr || [0.25, 2.2]).slice(), op: s.op || 1, pr, points };
    if (s.dash && s.dash !== 'solid') out.dash = s.dash;
    return out;
  }
  function paintPreview() {
    if (!ts || ts.hidden || !M.drawStroke) return;
    const g = groupFor(S.tool), s = sty(), cv = $('ts-preview');
    try {
      if (cv) {
        const { ctx, cw, ch, PW, H } = surface(cv, 312, 72); let item = null;
        if (g === 'pen') item = penItem(cw, ch, s, 1.2);
        else if (g === 'highlight') {
          const pts = s.alwaysStraight ? [[cw * 0.3, ch * 0.5], [cw * 0.7, ch * 0.5]] : gesture(32, cw * 0.30, cw * 0.70, ch * 0.27, ch * 0.80);
          item = { id: 'ts-sample', page: 1, tool: 'highlight', color: s.color, width: s.width, op: s.op, tip: s.tip || 'round', points: pts.map(p => uv(p[0], p[1], ch)) };
        } else if (g === 'shape') {
          const T = S.tool, a = T === 'line' || T === 'arrow' ? [cw * 0.22, ch * 0.74] : [cw * 0.3, ch * 0.2], b = T === 'line' || T === 'arrow' ? [cw * 0.78, ch * 0.26] : [cw * 0.7, ch * 0.8];
          item = { id: 'ts-sample', page: 1, tool: T, color: s.color, width: s.width, points: [uv(a[0], a[1], ch), uv(b[0], b[1], ch)], k: ch / 800 };
          if (s.dash && s.dash !== 'solid') item.dash = s.dash;
          if (T === 'arrow' && s.head === 'both') item.head = 'both';
        } else if (g === 'text') item = { id: 'ts-sample', page: 1, tool: S.tool, text: 'ملاحظتي Aa', color: s.color, size: s.size, bold: s.bold, italic: s.italic, points: [uv(10, 6, ch)], w: (cw - 20) / 800, h: (ch - 12) / ch };
        if (item) M.drawStroke(ctx, item, PW, H);
      }
      if (g === 'pen') {
        /* type cards: the same gesture in one ink colour (blue on the chosen card), so only the pen's character differs */
        const cs = getComputedStyle(ts), acc = cs.getPropertyValue('--ts-acc').trim(), ink = cs.getPropertyValue('--ts-ink').trim();
        ts.querySelectorAll('.ts-preset').forEach(b => {
          const c = b.querySelector('canvas'), o = surface(c, 34, 16), on = b.getAttribute('aria-pressed') === 'true';
          const col = (on ? acc : ink) || (on ? '#2f6fed' : '#1f2328');
          M.drawStroke(o.ctx, penItem(o.cw, o.ch, { pen: b.dataset.pen, color: HEX6.test(col) ? col : '#1f2328', width: Math.min(s.width || 3, 3), wr: s.wr, smooth: 0.5, op: 1 }, 0, [2, o.cw - 2, 2, o.ch - 2]), o.PW, o.H);
        });
      }
    } catch (e) { console.warn(e); }
  }
  M.toolbar = { render, cfg: () => cfg, TOOLS, activate, isOn, openSettings: () => openSet(), closeSettings: closePops };

  /* ---- customize dialog: order, visibility, handedness, reset ---- */
  function openCustomize() {
    let d = $('studio-cust'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'studio-cust'; d.setAttribute('aria-labelledby', 'studio-cust-t');
    const draw = () => {
      d.replaceChildren(); const h = document.createElement('h2'); h.id = 'studio-cust-t'; h.textContent = 'تخصيص شريط الأدوات'; d.append(h);
      const ul = document.createElement('ul'); ul.className = 'st-cust-list';
      cfg.order.forEach((id, i) => {
        const li = document.createElement('li'), cb = document.createElement('input'); cb.type = 'checkbox'; cb.checked = !cfg.hidden.includes(id); cb.id = 'cust-' + id; cb.onchange = () => { cfg.hidden = cb.checked ? cfg.hidden.filter(x => x !== id) : cfg.hidden.concat(id); if (cfg.order.length - cfg.hidden.length < 1) { cfg.hidden = cfg.hidden.filter(x => x !== id); cb.checked = true; } save(); render(); };
        const lab = document.createElement('label'); lab.htmlFor = cb.id; lab.textContent = byId[id].name;
        const up = btn('st-mini', 'تقديم ' + byId[id].name, '▲'), dn = btn('st-mini', 'تأخير ' + byId[id].name, '▼'); up.disabled = i === 0; dn.disabled = i === cfg.order.length - 1;
        up.onclick = () => { [cfg.order[i - 1], cfg.order[i]] = [cfg.order[i], cfg.order[i - 1]]; save(); render(); draw(); }; dn.onclick = () => { [cfg.order[i + 1], cfg.order[i]] = [cfg.order[i], cfg.order[i + 1]]; save(); render(); draw(); };
        li.append(cb, lab, up, dn); ul.append(li);
      });
      d.append(ul);
      const side = document.createElement('label'); side.className = 'st-check'; side.innerHTML = '<input type="checkbox" id="cust-side"> وضع اليد اليسرى (نقل الشريط للطرف الآخر)'; side.querySelector('input').checked = cfg.side === 'end'; side.querySelector('input').onchange = e => { cfg.side = e.target.checked ? 'end' : 'start'; save(); render(); }; d.append(side);
      const row = document.createElement('div'); row.className = 'st-cust-row';
      const rs = btn('st-btn', 'إعادة الضبط', 'إعادة الضبط'); rs.onclick = () => { cfg = structuredClone(DEFAULT); save(); render(); draw(); };
      const cl = btn('st-btn', 'إغلاق', 'إغلاق'); cl.onclick = () => d.close(); row.append(rs, cl); d.append(row);
    };
    draw(); document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
  }
  /* ---- margins dialog: virtual writing room around the page; export chooser ---- */
  function openMargins() {
    let d = $('studio-margins'); if (d) d.remove();
    d = document.createElement('dialog'); d.id = 'studio-margins'; d.setAttribute('aria-labelledby', 'studio-margins-t');
    const cur = M.reader ? M.reader.current() : 1, e0 = M.marginsOf(cur);
    const h = document.createElement('h2'); h.id = 'studio-margins-t'; h.textContent = 'هوامش الكتابة (الصفحة ' + cur + ')'; d.append(h);
    const note = document.createElement('p'); note.className = 'st-note-line'; note.textContent = 'الهامش مساحة كتابة إضافية حول الصفحة. لا يغيّر ملف PDF الأصلي ولا يمدّد رسوماتك.'; d.append(note);
    const sel = {};
    for (const [k, label] of [['l', 'اليسار'], ['r', 'اليمين'], ['t', 'الأعلى'], ['b', 'الأسفل']]) {
      const row = document.createElement('label'); row.className = 'st-margin-row'; row.append(label + ' ');
      const s = document.createElement('select'); s.id = 'margin-' + k; for (const v of [0, 0.25, 0.5, 1]) { const o = document.createElement('option'); o.value = v; o.textContent = v === 0 ? 'بلا' : Math.round(v * 100) + '% من الصفحة'; if (Math.abs(e0[k] - v) < 0.001) o.selected = true; s.append(o); }
      sel[k] = s; row.append(s); d.append(row);
    }
    const all = document.createElement('label'); all.className = 'st-check'; all.innerHTML = '<input type="checkbox" id="margin-all"> تطبيق على كل الصفحات'; d.append(all);
    const msg = document.createElement('p'); msg.id = 'margin-msg'; msg.setAttribute('role', 'status'); d.append(msg);
    const row = document.createElement('div'); row.className = 'st-cust-row';
    const ok = btn('st-btn', 'تطبيق', 'تطبيق'); ok.id = 'margin-apply'; ok.onclick = () => {
      const ext = {}; for (const k of Object.keys(sel)) ext[k] = +sel[k].value; let clamped = 0;
      const targets = all.querySelector('input').checked ? M.reader.pages.map(p => p.n) : [cur];
      for (const n of targets) { const r = M.setMargins(n, ext, { defer: true }); if (r && r.clamped) clamped++; }
      M.saveLayout(); msg.textContent = clamped ? 'بعض الهوامش لم تصغر لأن فيها كتابة؛ احذف الكتابة أولاً.' : 'تم تطبيق الهوامش.'; if (!clamped) setTimeout(() => d.close(), 400);
    };
    const cl = btn('st-btn', 'إغلاق', 'إغلاق'); cl.onclick = () => d.close(); row.append(ok, cl); d.append(row);
    document.body.append(d); d.addEventListener('close', () => d.remove()); d.showModal();
  }
  M.chooseMargins = function () {
    const r = M.marginReport(); if (!r.hasMargins) return Promise.resolve('clip');
    return new Promise(res => {
      const d = document.createElement('dialog'); d.id = 'studio-export-dlg'; d.setAttribute('aria-labelledby', 'studio-export-t');
      d.innerHTML = '<h2 id="studio-export-t">تنزيل PDF بالتعليقات</h2><p></p><label class="st-check"><input type="radio" name="expmode" value="clip" checked> الصفحة الأصلية فقط</label><label class="st-check"><input type="radio" name="expmode" value="expand"> مع الهوامش (صفحات أكبر)</label><div class="st-cust-row"><button type="button" class="st-btn" id="exp-go">تنزيل</button><button type="button" class="st-btn" id="exp-cancel">إلغاء</button></div>';
      d.querySelector('p').textContent = r.strokes ? 'يوجد ' + r.strokes + ' عنصراً مكتوباً في الهوامش (صفحات: ' + r.pages.join('، ') + '). اختيار «الصفحة الأصلية فقط» سيقصّها من الملف.' : 'لا توجد كتابة في الهوامش.';
      let out = null; d.querySelector('#exp-go').onclick = () => { out = d.querySelector('input[name=expmode]:checked').value; d.close(); }; d.querySelector('#exp-cancel').onclick = () => d.close();
      d.addEventListener('close', () => { d.remove(); res(out); }); document.body.append(d); d.showModal();
    });
  };
  if (S.hist) render(); else M.on('init', render);
})();
