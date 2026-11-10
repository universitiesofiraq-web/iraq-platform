/* MEDIXA Study Studio — the single ink engine for pdf-notes.html.
   Owns: tools and per-tool styles, the input state machine (stylus / finger / two-finger navigation / palm rejection),
   rendering (a committed ink layer and a live overlay layer per page), undo/redo, persistence and export.
   Pure logic lives in studio-core.js; image pixels live in studio-assets.js (IndexedDB), never in the stroke list.
   Storage: same key and v1-compatible stroke shape as before ('medixa.pdf.annotations.v1:<abs url>'). */
(function () {
  'use strict';
  const C = window.MedixaStudioCore;
  if (!C) return;
  const Assets = () => window.MedixaAssets || null;
  const DPR = () => Math.min(3, window.devicePixelRatio || 1);
  const TOUCH = (navigator.maxTouchPoints || 0) > 0 || /iP(hone|ad|od)/.test(navigator.userAgent);
  const MAX_PX = TOUCH ? 4e6 : 12e6;   /* per canvas; Safari blanks canvases past its memory budget */
  const $ = id => document.getElementById(id);
  const now = () => performance.now();
  const rd = (k, d) => { try { const v = JSON.parse(localStorage.getItem(k)); return v == null ? d : v; } catch { return d; } };
  const wr = (k, v) => { try { localStorage.setItem(k, JSON.stringify(v)); return true; } catch { return false; } };
  const HEX6 = /^#[0-9a-f]{6}$/i;

  /* ---------- per-tool styles and input preferences (device settings, not part of the document) ---------- */
  const STYLE_KEY = 'medixa.studio.styles.v1', INPUT_KEY = 'medixa.studio.input.v1', PEN_SEEN_KEY = 'medixa.studio.penSeen';
  const DEF_PEN_PRESETS = [
    { pen: 'ballpoint', color: '#18334b', width: 2.5, op: 1, dash: 'solid' },
    { pen: 'fountain', color: '#2f6fed', width: 3, op: 1, dash: 'solid' },
    { pen: 'brush', color: '#e43d56', width: 4.5, op: 1, dash: 'solid' },
    { pen: 'technical', color: '#168c8c', width: 2, op: 1, dash: 'solid' }
  ];
  const DEF_HL_PRESETS = [
    { color: '#f2c230', width: 3, op: 0.3, tip: 'round' },
    { color: '#7bd88f', width: 4, op: 0.3, tip: 'flat' },
    { color: '#6fb1ff', width: 3.5, op: 0.28, tip: 'round' },
    { color: '#ff8fa3', width: 4, op: 0.3, tip: 'flat' }
  ];
  const DEF_STYLES = {
    pen: { color: '#e43d56', width: 3, pen: 'ballpoint', smooth: 0.45, wr: [0.25, 2.2], op: 1, dash: 'solid', presets: DEF_PEN_PRESETS },
    highlight: { color: '#f2c230', width: 3, op: 0.3, straight: true, hsnap: true, alwaysStraight: false, tip: 'round', blend: 'multiply', shapeSnap: true, presets: DEF_HL_PRESETS },
    shape: { color: '#2f6fed', width: 3, head: 'end', dash: 'solid' },
    text: { color: '#18334b', width: 3, size: 18, bold: false, italic: false },
    eraser: { mode: 'stroke', size: 12, target: 'all', keepShapes: false, autoSize: true, autoBack: false }
  };
  const DEF_INPUT = { fingerDraw: true, stylusOnly: false, palm: true, palmSens: 'medium', twoFinger: true, autoStylus: true, shapeSnap: true, fingerMode: 'auto' };
  const num = (v, a, b, d) => (typeof v === 'number' && Number.isFinite(v) && v >= a && v <= b ? v : d);
  function cleanStyle(g, v) {
    const d = DEF_STYLES[g], o = Object.assign({}, d);
    if (d.presets) o.presets = d.presets.map(p => Object.assign({}, p));
    if (!v || typeof v !== 'object') return o;
    if ('color' in d && typeof v.color === 'string' && HEX6.test(v.color)) o.color = v.color;
    if ('width' in d) o.width = num(v.width, 0.5, 40, d.width);
    if (g === 'pen') {
      if ((C.PENS || []).includes(v.pen)) o.pen = v.pen;
      o.smooth = num(v.smooth, 0, 1, d.smooth);
      o.op = num(v.op, 0.1, 1, d.op);
      o.dash = (C.DASHES || ['solid', 'dashed', 'dotted']).includes(v.dash) ? v.dash : 'solid';
      if (Array.isArray(v.wr) && v.wr.length === 2 && v.wr[0] >= 0.1 && v.wr[0] <= v.wr[1] && v.wr[1] <= 4) o.wr = [v.wr[0], v.wr[1]];
      if (Array.isArray(v.presets) && v.presets.length) {
        o.presets = v.presets.slice(0, 6).filter(p => p && typeof p === 'object' && HEX6.test(p.color || '')).map(p => ({
          pen: (C.PENS || []).includes(p.pen) ? p.pen : 'ballpoint',
          color: p.color,
          width: num(p.width, 0.5, 20, 3),
          op: num(p.op, 0.1, 1, 1),
          dash: (C.DASHES || ['solid', 'dashed', 'dotted']).includes(p.dash) ? p.dash : 'solid'
        }));
        if (!o.presets.length) o.presets = d.presets.map(p => Object.assign({}, p));
      }
    }
    if (g === 'highlight') {
      o.op = num(v.op, 0.05, 1, d.op);
      o.straight = v.straight !== false;
      o.hsnap = v.hsnap !== false;
      o.alwaysStraight = !!v.alwaysStraight;
      o.tip = v.tip === 'flat' ? 'flat' : 'round';
      o.blend = v.blend === 'normal' ? 'normal' : 'multiply';
      o.shapeSnap = v.shapeSnap !== false;
      if (Array.isArray(v.presets) && v.presets.length) {
        o.presets = v.presets.slice(0, 6).filter(p => p && typeof p === 'object' && HEX6.test(p.color || '')).map(p => ({
          color: p.color,
          width: num(p.width, 1, 10, 3),
          op: num(p.op, 0.05, 1, 0.3),
          tip: p.tip === 'flat' ? 'flat' : 'round'
        }));
        if (!o.presets.length) o.presets = d.presets.map(p => Object.assign({}, p));
      }
    }
    if (g === 'shape') {
      o.head = v.head === 'both' ? 'both' : 'end';
      o.dash = (C.DASHES || ['solid', 'dashed', 'dotted']).includes(v.dash) ? v.dash : 'solid';
    }
    if (g === 'text') { o.size = num(v.size, 6, 96, d.size); o.bold = !!v.bold; o.italic = !!v.italic; }
    if (g === 'eraser') {
      o.mode = ['stroke', 'precise', 'lasso'].includes(v.mode) ? v.mode : 'stroke';
      o.size = num(v.size, 4, 60, d.size);
      o.target = ['all', 'highlight', 'ink'].includes(v.target) ? v.target : 'all';
      o.keepShapes = !!v.keepShapes;
      o.autoSize = v.autoSize !== false;
      o.autoBack = !!v.autoBack;
    }
    return o;
  }
  /* التظليل المستقيم افتراضياً (طلب محمد 2026-10-22): شريط نظيف على السطر بدل بقع متراكبة. يُطبَّق مرة واحدة على
     التفضيل المحفوظ عند الفتح، ثم يبقى اختيار الطالب. */
  const HL_STRAIGHT_KEY = 'medixa.studio.hlfree.v1';
  function loadStyles() {
    const v = rd(STYLE_KEY, {}), out = {}; for (const g of Object.keys(DEF_STYLES)) out[g] = cleanStyle(g, v && v[g]);
    if (!rd(HL_STRAIGHT_KEY, 0)) { out.highlight.alwaysStraight = false; wr(STYLE_KEY, out); wr(HL_STRAIGHT_KEY, 1); }
    return out;
  }
  function loadInput() {
    const v = rd(INPUT_KEY, null), o = Object.assign({}, DEF_INPUT);
    if (v && typeof v === 'object') { for (const k of Object.keys(DEF_INPUT)) if (typeof v[k] === typeof DEF_INPUT[k]) o[k] = v[k]; }
    else { try { o.stylusOnly = localStorage.getItem('medixa.penOnly') === 'true'; } catch {} }   /* one-time migration of the old setting */
    if (!['low', 'medium', 'high'].includes(o.palmSens)) o.palmSens = 'medium';
    if (!['auto', 'nav', 'draw'].includes(o.fingerMode)) o.fingerMode = 'auto';
    return o;
  }

  const S = {
    layout: { v: 1, margins: {}, blanks: [], order: null }, nSources: 0,
    tool: 'pen', snap: false, styles: loadStyles(), input: loadInput(),
    items: [], hist: null, pages: new Map(), deleted: new Set(),
    guard: null, key: '', src: '', docHash: '', raf: 0, saveTimer: 0, state: 'idle', listeners: {}
  };
  const GROUPS = { pen: 'pen', highlight: 'highlight', line: 'shape', rectangle: 'shape', ellipse: 'shape', arrow: 'shape', text: 'text', sticky: 'text', eraser: 'eraser' };
  const groupOf = t => GROUPS[t] || GROUPS[S.lastDrawTool] || 'pen';
  const colorGroup = t => { const g = groupOf(t); return g === 'eraser' ? (GROUPS[S.lastDrawTool] || 'pen') : g; };
  let styleT = 0;
  const saveStyles = () => { clearTimeout(styleT); styleT = setTimeout(() => wr(STYLE_KEY, S.styles), 250); };
  /* S.color / S.width keep their old meaning (the colour/width of what the current tool draws), now per tool. */
  Object.defineProperty(S, 'color', { enumerable: true, get() { return S.styles[colorGroup(S.tool)].color || '#e43d56'; }, set(v) { if (typeof v === 'string' && HEX6.test(v)) { S.styles[colorGroup(S.tool)].color = v; saveStyles(); } } });
  Object.defineProperty(S, 'width', { enumerable: true, get() { return S.styles[colorGroup(S.tool)].width || 3; }, set(v) { v = +v; if (Number.isFinite(v) && v > 0) { S.styles[colorGroup(S.tool)].width = Math.min(40, v); saveStyles(); } } });
  Object.defineProperty(S, 'penOnly', { enumerable: true, get() { return !!S.input.stylusOnly; } });

  const TOOLS = {};   /* name -> {down,move,up}; used by lasso / text / sticky / zoom writing / select / region */
  const emit = (n, d) => (S.listeners[n] || []).forEach(f => { try { f(d); } catch (e) { console.warn(e); } });
  const on = (n, f) => (S.listeners[n] = S.listeners[n] || []).push(f);

  /* ---------- status / persistence ---------- */
  const MSG = {
    editing: 'يجري التحرير…', pending: 'بانتظار الحفظ…', saved: 'محفوظ على هذا الجهاز ✓',
    failed: 'تعذر الحفظ — حُفظت مسودة احتياطية ويمكنك تنزيل نسخة', conflict: 'تغيّرت البيانات في تبويب آخر — اضغط «دمج وحفظ»'
  };
  function setState(st, extra) {
    S.state = st;
    const el = $('status');
    if (el) el.textContent = (MSG[st] || (window.MedixaGuard && MedixaGuard.MSG && MedixaGuard.MSG[st]) || st) + (extra || '');
    document.documentElement.dataset.saveState = st;
    emit('state', st);
  }
  function openGuard() { return MedixaGuard.open(localStorage, S.key, { fallback: () => [], valid: Array.isArray }); }
  function scheduleSave() { setState('pending'); clearTimeout(S.saveTimer); S.saveTimer = setTimeout(flush, 250); }
  /* A failed write (quota, private mode) is retried a few times with back-off; the draft in IndexedDB covers the gap. */
  const RETRY = [2000, 5000, 15000, 30000];
  function flush() {
    clearTimeout(S.saveTimer); S.saveTimer = 0;
    if (!S.dirty) return S.state;
    const r = S.guard.write(S.items);
    if (r === 'saved') { S.dirty = false; S.retries = 0; clearTimeout(S.retryT); setState('saved'); try { clearDraft(); } catch {} return r; }
    saveDraft();
    if (r !== 'conflict' && (S.retries || 0) < RETRY.length) { clearTimeout(S.retryT); S.retryT = setTimeout(() => { if (S.dirty) flush(); }, RETRY[S.retries || 0]); S.retries = (S.retries || 0) + 1; }
    setState(r === 'conflict' ? 'conflict' : 'failed', r !== 'conflict' && S.retries <= RETRY.length ? ' — ستُعاد المحاولة تلقائياً' : '');
    emit('savefail', r);
    return r;
  }
  /* A finished gesture is one write; continuous edits (drags) pass delay=true to coalesce. */
  function markDirty(delay) { S.dirty = true; emit('change'); if (delay) scheduleSave(); else flush(); }
  /* Failed writes also go to IndexedDB so a quota error or conflict never leaves the only copy in memory. */
  function idb() {
    return new Promise((res, rej) => {
      if (!window.indexedDB) return rej(new Error('no idb'));
      const rq = indexedDB.open('medixa-studio', 1);
      rq.onupgradeneeded = () => rq.result.createObjectStore('drafts');
      rq.onsuccess = () => res(rq.result); rq.onerror = () => rej(rq.error);
    });
  }
  async function saveDraft() { try { const d = await idb(); d.transaction('drafts', 'readwrite').objectStore('drafts').put({ at: Date.now(), items: S.items }, S.key); } catch {} }
  async function clearDraft() { try { const d = await idb(); d.transaction('drafts', 'readwrite').objectStore('drafts').delete(S.key); } catch {} }
  /* Keys of every document that currently has an unsaved draft (used by the tab strip's dirty marker). */
  async function draftKeys() { try { const d = await idb(); return await new Promise(r => { const q = d.transaction('drafts').objectStore('drafts').getAllKeys(); q.onsuccess = () => r(new Set(q.result)); q.onerror = () => r(new Set()); }); } catch { return new Set(); } }
  async function readDraft() { try { const d = await idb(); return await new Promise(r => { const q = d.transaction('drafts').objectStore('drafts').get(S.key); q.onsuccess = () => r(q.result || null); q.onerror = () => r(null); }); } catch { return null; } }
  function mergeAndSave() {
    const fresh = openGuard();
    if (fresh.state === 'corrupt' || fresh.state === 'unreadable') { setState(fresh.state); return fresh.state; }
    const migrated = C.migrate(fresh.value).list;
    const merged = C.mergeById(S.items, migrated, S.deleted);
    S.items.length = 0; S.items.push(...merged);
    S.guard = fresh; S.dirty = true; S.hist.setItems(S.items);
    rebuildAll(); return flush();
  }

  /* ---------- rendering ---------- */
  const hex = c => { const m = /^#([0-9a-f]{6}|[0-9a-f]{3})(?![0-9a-f])/i.exec(c || '#e43d56'); let h = m ? m[1] : 'e43d56'; if (h.length === 3) h = h.split('').map(x => x + x).join(''); return [parseInt(h.slice(0, 2), 16) / 255, parseInt(h.slice(2, 4), 16) / 255, parseInt(h.slice(4), 16) / 255]; };
  const isHl = s => s.tool === 'highlight' || s.tool === 'texthl';
  const fontOf = (s, size) => (s.italic ? 'italic ' : '') + (s.bold ? '700 ' : '') + size + 'px system-ui, "Noto Naskh Arabic", sans-serif';
  function drawPath(ctx, pts, w, h) {
    ctx.beginPath();
    const P = i => [pts[i][0] * w, pts[i][1] * h];
    let [x, y] = P(0);
    ctx.moveTo(x, y);
    if (pts.length === 1) { ctx.lineTo(x + 0.01, y + 0.01); return; }
    for (let i = 1; i < pts.length - 1; i++) { const a = P(i), b = P(i + 1); ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    const l = P(pts.length - 1); ctx.lineTo(l[0], l[1]);
  }
  /* Chaikin corner cutting over [x, y, width] so curves stay round between samples (render only; stored points untouched). */
  function chaikin(t) {
    if (t.length < 3) return t;
    const out = [t[0]];
    for (let i = 0; i < t.length - 1; i++) { const a = t[i], b = t[i + 1]; out.push([a[0] * 0.75 + b[0] * 0.25, a[1] * 0.75 + b[1] * 0.25, a[2] * 0.75 + b[2] * 0.25], [a[0] * 0.25 + b[0] * 0.75, a[1] * 0.25 + b[1] * 0.75, a[2] * 0.25 + b[2] * 0.75]); }
    out.push(t[t.length - 1]); return out;
  }
  /* A variable-width stroke as the union of round "beads" and the quads joining them, all wound the same way, so one
     nonzero fill paints it seamlessly (no holes where a stroke crosses itself, no darker overlaps). */
  function ribbon(pts, widths) {
    const polys = [];
    const circle = (x, y, r) => { const n = r > 6 ? 16 : 10, c = []; for (let k = 0; k < n; k++) { const a = -k / n * 2 * Math.PI; c.push([x + r * Math.cos(a), y + r * Math.sin(a)]); } return c; };
    for (let i = 0; i < pts.length; i++) polys.push(circle(pts[i][0], pts[i][1], Math.max(0.15, widths[i] / 2)));
    for (let i = 1; i < pts.length; i++) {
      const a = pts[i - 1], b = pts[i], dx = b[0] - a[0], dy = b[1] - a[1], l = Math.hypot(dx, dy); if (l < 1e-6) continue;
      const nx = -dy / l, ny = dx / l, ra = widths[i - 1] / 2, rb = widths[i] / 2;
      polys.push([[a[0] + nx * ra, a[1] + ny * ra], [a[0] - nx * ra, a[1] - ny * ra], [b[0] - nx * rb, b[1] - ny * rb], [b[0] + nx * rb, b[1] + ny * rb]]);
    }
    for (const p of polys) { let area = 0; for (let k = 0; k < p.length; k++) { const q = p[k], r = p[(k + 1) % p.length]; area += q[0] * r[1] - r[0] * q[1]; } if (area > 0) p.reverse(); }   /* same orientation everywhere */
    return polys;
  }
  function penGeometry(s, w, h) {
    const px = s.points.map(p => [p[0] * w, p[1] * h]), widths = C.penWidths(s, w, h);
    let tri = px.map((p, i) => [p[0], p[1], widths[i]]);
    if (tri.length > 2 && tri.length < 3000) tri = chaikin(tri);
    return ribbon(tri.map(t => [t[0], t[1]]), tri.map(t => t[2]));
  }
  /* Pencil: a grain tile (fixed seed, so the texture never "boils" between frames) used as the fill pattern. */
  const grainTiles = new Map();
  function grain(ctx, color) {
    let tile = grainTiles.get(color);
    if (!tile) {
      tile = document.createElement('canvas'); tile.width = tile.height = 48; const g = tile.getContext('2d'), im = g.createImageData(48, 48), [r, gg, b] = hex(color).map(x => Math.round(x * 255));
      let seed = 2463534242; const rnd = () => { seed ^= seed << 13; seed ^= seed >>> 17; seed ^= seed << 5; return (seed >>> 0) / 4294967296; };
      for (let i = 0; i < im.data.length; i += 4) { im.data[i] = r; im.data[i + 1] = gg; im.data[i + 2] = b; im.data[i + 3] = Math.round(255 * (0.4 + 0.6 * rnd())); }
      g.putImageData(im, 0, 0); if (grainTiles.size > 24) grainTiles.clear(); grainTiles.set(color, tile);
    }
    return ctx.createPattern(tile, 'repeat') || color;
  }
  function fillPolys(ctx, polys) { ctx.beginPath(); for (const p of polys) { ctx.moveTo(p[0][0], p[0][1]); for (let k = 1; k < p.length; k++) ctx.lineTo(p[k][0], p[k][1]); ctx.closePath(); } ctx.fill('nonzero'); }
  function arrowSegs(s, w, h) {
    const a = s.points[0], b = s.points[s.points.length - 1], k = h / w, size = Math.max(0.012, (s.width || 3) * 0.0048);
    const segs = [[a, b]].concat(C.arrowHead(a, b, size, k)); if (s.head === 'both') segs.push(...C.arrowHead(b, a, size, k));
    return segs;
  }
  function drawStroke(ctx, s, w, h) {
    ctx.save();
    ctx.lineCap = 'round'; ctx.lineJoin = 'round';
    const col = s.color || '#e43d56', base = (s.width || 3) * w / 800;
    ctx.strokeStyle = col; ctx.fillStyle = col;
    if (s.tool === 'text' || s.tool === 'sticky') { drawTextBox(ctx, s, w, h); ctx.restore(); return; }
    if (s.tool === 'image') { drawImageItem(ctx, s, w, h); ctx.restore(); return; }
    if (s.tool === 'texthl' && s.mark) { ctx.globalAlpha = s.op || 0.9; markLines(ctx, [s], w, h); ctx.restore(); return; }
    if (s.tool === 'texthl') {                                   /* text-anchored highlight: one rounded translucent band per text line */
      if (!document.body.classList.contains('medixa-dark') && (!S.styles.highlight || S.styles.highlight.blend !== 'normal')) ctx.globalCompositeOperation = 'multiply';
      ctx.globalAlpha = s.op || 0.35; hlBands(ctx, [s], w, h);
      ctx.restore(); return;
    }
    const applyDash = d => {
      if (d === 'dashed') ctx.setLineDash([Math.max(4, base * 2.8), Math.max(3, base * 2)]);
      else if (d === 'dotted') ctx.setLineDash([Math.max(0.8, base * 0.15), Math.max(3, base * 2.1)]);
    };
    if (s.tool === 'arrow') {
      ctx.lineWidth = base; ctx.globalAlpha = s.op || 1;
      const segsA = arrowSegs(s, w, h);
      if (s.dash && s.dash !== 'solid' && segsA.length) {
        applyDash(s.dash); ctx.beginPath(); ctx.moveTo(segsA[0][0][0] * w, segsA[0][0][1] * h); ctx.lineTo(segsA[0][1][0] * w, segsA[0][1][1] * h); ctx.stroke();
        ctx.setLineDash([]); ctx.beginPath(); for (let i = 1; i < segsA.length; i++) { const [a, b] = segsA[i]; ctx.moveTo(a[0] * w, a[1] * h); ctx.lineTo(b[0] * w, b[1] * h); } ctx.stroke();
      } else {
        ctx.beginPath(); for (const [a, b] of segsA) { ctx.moveTo(a[0] * w, a[1] * h); ctx.lineTo(b[0] * w, b[1] * h); } ctx.stroke();
      }
      ctx.restore(); return;
    }
    const segs = C.shapeSegments(s);
    if (segs) {
      ctx.lineWidth = base; ctx.globalAlpha = s.op || 1; applyDash(s.dash);
      const a = s.points[0], b = s.points[s.points.length - 1];
      ctx.beginPath();
      if (s.tool === 'line') { ctx.moveTo(a[0] * w, a[1] * h); ctx.lineTo(b[0] * w, b[1] * h); }
      else if (s.tool === 'ellipse') ctx.ellipse((a[0] + b[0]) / 2 * w, (a[1] + b[1]) / 2 * h, Math.max(0.1, Math.abs(b[0] - a[0]) / 2 * w), Math.max(0.1, Math.abs(b[1] - a[1]) / 2 * h), s.rot || 0, 0, 2 * Math.PI);
      else if (!s.rot) ctx.rect(a[0] * w, a[1] * h, (b[0] - a[0]) * w, (b[1] - a[1]) * h);
      else { segs.forEach(([p], i) => i ? ctx.lineTo(p[0] * w, p[1] * h) : ctx.moveTo(p[0] * w, p[1] * h)); ctx.closePath(); }
      if (s.fill && (s.tool === 'rectangle' || s.tool === 'ellipse')) {
        ctx.save(); ctx.fillStyle = s.fill; ctx.globalAlpha = Math.min(0.28, (s.op || 1) * 0.25); ctx.fill(); ctx.restore();
      }
      ctx.stroke(); ctx.restore(); return;
    }
    if (s.tool === 'highlight') {
      /* One path, one stroke(): overlapping segments of the same stroke never darken. */
      if (!document.body.classList.contains('medixa-dark') && (!S.styles.highlight || S.styles.highlight.blend !== 'normal')) ctx.globalCompositeOperation = 'multiply';
      if (s.tip === 'flat') { ctx.lineCap = 'butt'; ctx.lineJoin = 'bevel'; }
      ctx.globalAlpha = s.op || 0.3; ctx.lineWidth = C.widthAt(s.width || 3, 1, 'highlight') * w / 800; drawPath(ctx, s.points, w, h); ctx.stroke();
    } else if (s.dash && s.dash !== 'solid') {
      const st = s.pen ? C.penStyle(s.pen) : { alpha: 1 };
      ctx.globalAlpha = (st.alpha || 1) * (s.op || 1); ctx.lineWidth = base; applyDash(s.dash);
      drawPath(ctx, s.points, w, h); ctx.stroke();
    } else if (s.pen) {
      /* Pen presets: a filled variable-width ribbon (pressure / speed / nib / taper from studio-core). */
      const st = C.penStyle(s.pen); ctx.globalAlpha = (st.alpha || 1) * (s.op || 1);
      ctx.fillStyle = s.pen === 'pencil' ? grain(ctx, col) : col; fillPolys(ctx, penGeometry(s, w, h));
    } else if (s.pr && s.pr.length === s.points.length && s.points.length > 1) {
      /* Legacy pressure pen: per-segment width, opaque so overlaps are invisible. */
      ctx.globalAlpha = s.op || 1;
      for (let i = 1; i < s.points.length; i++) {
        ctx.lineWidth = C.widthAt(s.width || 3, (s.pr[i] + s.pr[i - 1]) / 2, 'pen') * w / 800;
        ctx.beginPath(); ctx.moveTo(s.points[i - 1][0] * w, s.points[i - 1][1] * h);
        const m = [(s.points[i - 1][0] + s.points[i][0]) / 2 * w, (s.points[i - 1][1] + s.points[i][1]) / 2 * h];
        ctx.quadraticCurveTo(s.points[i - 1][0] * w, s.points[i - 1][1] * h, m[0], m[1]); ctx.lineTo(s.points[i][0] * w, s.points[i][1] * h); ctx.stroke();
      }
    } else { ctx.globalAlpha = s.op || 1; ctx.lineWidth = base; drawPath(ctx, s.points, w, h); ctx.stroke(); }
    ctx.restore();
  }
  /* texthl with mark 'underline' | 'strike' (2026-10-21): a line under / through each text line, instead of a fill */
  function markLines(ctx, list, w, h) {
    ctx.beginPath();
    for (const s of list) for (const r of s.rects) {
      const lh = (r[3] - r[1]) * h, y = s.mark === 'strike' ? (r[1] * h + lh * 0.55) : (r[3] * h - lh * 0.06);
      ctx.moveTo(r[0] * w, y); ctx.lineTo(r[2] * w, y);
    }
    ctx.lineWidth = Math.max(1, ((list[0].rects[0][3] - list[0].rects[0][1]) * h) * 0.085); ctx.lineCap = 'round'; ctx.stroke();
  }
  /* texthl fill (2026-10-21, R2/R8 «مثل Notewise»): one band per line with the line's own height, a little wider than the
     glyph run, corners rounded (0.35 x band height). All bands of a group go into ONE path filled once (nonzero, every
     band wound the same way), so overlapping highlights never darken. Stored rects are untouched. */
  function hlBands(ctx, list, w, h) {
    ctx.beginPath();
    for (const s of list) for (const r of s.rects) {
      const lh = (r[3] - r[1]) * h; if (!(lh > 0)) continue;
      const pad = 0.12 * lh, x = r[0] * w - pad, y = r[1] * h, bw = (r[2] - r[0]) * w + 2 * pad, rad = Math.max(0, Math.min(0.35 * lh, bw / 2, lh / 2));
      if (ctx.roundRect) { ctx.roundRect(x, y, bw, lh, rad); continue; }
      ctx.moveTo(x + rad, y); ctx.arcTo(x + bw, y, x + bw, y + lh, rad); ctx.arcTo(x + bw, y + lh, x, y + lh, rad); ctx.arcTo(x, y + lh, x, y, rad); ctx.arcTo(x, y, x + bw, y, rad); ctx.closePath();
    }
    ctx.fill('nonzero');
  }
  /* Consecutive highlights are painted per colour/opacity/tip group with ONE fill/stroke each, so where highlights overlap
     the colour does not stack up into a darker band (a marker over a marker looks like one marker). */
  function drawHighlights(ctx, list, w, h) {
    const groups = new Map();
    for (const s of list) { const key = s.tool + '|' + (s.mark || '') + '|' + (s.color || '') + '|' + (s.op || '') + '|' + (s.tip || 'round') + '|' + (s.tool === 'highlight' ? s.width || 3 : ''); let g = groups.get(key); if (!g) groups.set(key, g = []); g.push(s); }
    const mult = !document.body.classList.contains('medixa-dark') && (!S.styles.highlight || S.styles.highlight.blend !== 'normal');
    for (const g of groups.values()) {
      const s0 = g[0]; ctx.save(); ctx.fillStyle = ctx.strokeStyle = s0.color || '#f2c230';
      if (s0.tool === 'texthl' && s0.mark) { ctx.globalAlpha = s0.op || 0.9; markLines(ctx, g, w, h); ctx.restore(); continue; }
      if (mult) ctx.globalCompositeOperation = 'multiply';
      if (s0.tool === 'texthl') { ctx.globalAlpha = s0.op || 0.35; hlBands(ctx, g, w, h); }
      else {
        ctx.globalAlpha = s0.op || 0.3;
        ctx.lineCap = s0.tip === 'flat' ? 'butt' : 'round';
        ctx.lineJoin = s0.tip === 'flat' ? 'bevel' : 'round';
        ctx.lineWidth = C.widthAt(s0.width || 3, 1, 'highlight') * w / 800;
        ctx.beginPath(); for (const s of g) addPath(ctx, s.points, w, h); ctx.stroke();
      }
      ctx.restore();
    }
  }
  /* Same curve as drawPath, appended to the current path (several strokes, one stroke() call). */
  function addPath(ctx, pts, w, h) {
    const P = i => [pts[i][0] * w, pts[i][1] * h];
    let [x, y] = P(0); ctx.moveTo(x, y);
    if (pts.length === 1) { ctx.lineTo(x + 0.01, y + 0.01); return; }
    for (let i = 1; i < pts.length - 1; i++) { const a = P(i), b = P(i + 1); ctx.quadraticCurveTo(a[0], a[1], (a[0] + b[0]) / 2, (a[1] + b[1]) / 2); }
    const l = P(pts.length - 1); ctx.lineTo(l[0], l[1]);
  }
  /* Text / sticky: drawn by the browser (so Arabic shaping and RTL are exact). */
  function drawTextBox(ctx, s, w, h) {
    const b = C.bounds(s), x = b[0] * w, y = b[1] * h, bw = (b[2] - b[0]) * w, bh = (b[3] - b[1]) * h;
    ctx.save(); ctx.beginPath(); ctx.rect(x, y, bw, bh); ctx.clip();
    if (s.tool === 'sticky') { ctx.fillStyle = s.fill || '#fff3a3'; ctx.shadowColor = 'rgba(0,0,0,.2)'; ctx.shadowBlur = 6; ctx.fillRect(x, y, bw, bh); ctx.shadowBlur = 0; }
    ctx.fillStyle = s.color || '#18334b';
    const size = (s.size || 18) * w / 800; ctx.font = fontOf(s, size); ctx.textBaseline = 'top';
    const rtl = /[֐-ࣿ]/.test(s.text); ctx.direction = rtl ? 'rtl' : 'ltr'; ctx.textAlign = rtl ? 'right' : 'left';
    const pad = size * 0.4; let ty = y + pad;
    for (const para of String(s.text).split('\n')) {
      let line = '';
      for (const word of para.split(/\s+/)) {
        const t = line ? line + ' ' + word : word;
        if (ctx.measureText(t).width > bw - pad * 2 && line) { ctx.fillText(line, rtl ? x + bw - pad : x + pad, ty); ty += size * 1.35; line = word; } else line = t;
      }
      ctx.fillText(line, rtl ? x + bw - pad : x + pad, ty); ty += size * 1.35;
    }
    ctx.restore();
  }
  /* Height (normalized) a text needs at the box width, so notes grow with their content. */
  function fitTextHeight(s, pg) {
    const cv = fitTextHeight.cv || (fitTextHeight.cv = document.createElement('canvas')), ctx = cv.getContext('2d'), W = 800, H = 800 * pg.cssH / pg.cssW;
    const size = s.size || 18, pad = size * 0.4, bw = (s.w || 0.28) * W; ctx.font = fontOf(s, size);
    let lines = 0;
    for (const para of String(s.text).split('\n')) { let line = ''; lines++; for (const word of para.split(/\s+/)) { const t = line ? line + ' ' + word : word; if (ctx.measureText(t).width > bw - pad * 2 && line) { lines++; line = word; } else line = t; } }
    return Math.max(0.04, (pad * 2 + lines * size * 1.35) / H);
  }
  /* Images: pixels come from the asset store (decoded once, LRU-cached); until then a calm placeholder is drawn. */
  const pendingAssets = new Set();
  function wantAsset(id) {
    const A = Assets(); if (!A || pendingAssets.has(id)) return; pendingAssets.add(id);
    A.bitmap(id).then(img => { pendingAssets.delete(id); if (!img) { S.missing = (S.missing || new Set()).add(id); return; } S.pages.forEach(pg => { if (S.items.some(s => s && s.page === pg.n && s.asset === id)) invalidate(pg.n); }); }, () => { pendingAssets.delete(id); });
  }
  function drawImageItem(ctx, s, w, h) {
    const x = s.points[0][0] * w, y = s.points[0][1] * h, bw = s.w * w, bh = s.h * h;
    ctx.translate(x + bw / 2, y + bh / 2); if (s.rot) ctx.rotate(s.rot); if (s.fx || s.fy) ctx.scale(s.fx ? -1 : 1, s.fy ? -1 : 1);
    const A = Assets(), im = A && A.peek ? A.peek(s.asset) : null;
    if (im) {
      const iw = im.width || im.naturalWidth, ih = im.height || im.naturalHeight, c = s.crop || [0, 0, 1, 1];
      ctx.globalAlpha = s.op || 1; ctx.imageSmoothingQuality = 'high';
      ctx.drawImage(im, c[0] * iw, c[1] * ih, (c[2] - c[0]) * iw, (c[3] - c[1]) * ih, -bw / 2, -bh / 2, bw, bh);
    } else {
      ctx.fillStyle = '#eef3f5'; ctx.strokeStyle = '#9db6bf'; ctx.lineWidth = Math.max(1, w / 600); ctx.setLineDash([6, 4]);
      ctx.fillRect(-bw / 2, -bh / 2, bw, bh); ctx.strokeRect(-bw / 2, -bh / 2, bw, bh);
      if (!(S.missing && S.missing.has(s.asset))) wantAsset(s.asset);
    }
  }
  function sizePage(pg) {
    if (!pg.on) { if (pg.ink.width !== 1) { pg.ink.width = 1; pg.ink.height = 1; } if (pg.over.width !== 1) { pg.over.width = 1; pg.over.height = 1; } pg.dirty = true; return; }   /* off-screen pages hold no pixels */
    const r = pg.ink.getBoundingClientRect(), d = Math.max(0.05, Math.min(DPR(), Math.sqrt(MAX_PX / Math.max(1, r.width * r.height)))), e = pg.ext, kx = 1 + e.l + e.r, ky = 1 + e.t + e.b;
    if (r.width < 1) return;                                       /* hidden (e.g. split pane switching): keep the current pixels */
    pg.totW = Math.max(1, r.width); pg.totH = Math.max(1, r.height);
    pg.cssW = pg.totW / kx; pg.cssH = pg.totH / ky;                /* cssW/cssH = the PAGE area, margins excluded */
    const W = Math.round(pg.totW * d), H = Math.round(pg.totH * d);
    if (pg.ink.width !== W || pg.ink.height !== H) {
      pg.ink.width = W; pg.ink.height = H; pg.dirty = true;
      if (pg.hd) { pg.hd.canvas.width = 0; pg.hd.canvas.remove(); pg.hd = null; }   /* its CSS-px geometry is stale; the reader rebuilds it */
    }
    if (pg.over.width !== W || pg.over.height !== H) { pg.over.width = W; pg.over.height = H; pg.needsPaint = true; }
    pg.pw = W / kx; pg.ph = H / ky;                                /* page area in canvas px */
  }
  function drawPageItems(ctx, n, pw, ph) {
    let batch = [];
    const flushHl = () => { if (batch.length) drawHighlights(ctx, batch, pw, ph); batch = []; };
    for (const s of S.items) {
      if (!s || s.page !== n || !C.validStroke(s)) continue;
      if (S.skip && S.skip.has(s.id)) continue;                    /* being dragged: a tool draws it on the live overlay */
      if (isHl(s)) continue;                                           /* drawn into the page picture by studio-reader (multiply), never on the ink layer */
      flushHl(); drawStroke(ctx, s, pw, ph);
    }
    flushHl();
  }
  /* a fingerprint of the page's highlights: when it changes, the reader draws the page again (highlights are baked into it) */
  function hlSig(n) { return JSON.stringify(S.items.filter(s => s && s.page === n && isHl(s)).map(s => [s.id, s.rev, s.color, s.op, s.width, s.tip, s.mark, s.points && s.points.length, s.rects && s.rects.length, s.quote && s.quote.length])); }
  function renderInk(pg) {
    const sig = hlSig(pg.n);
    if (pg.hlSigShown !== undefined && pg.hlSigShown !== sig) emit('hlchange', pg.n);
    pg.hlSigShown = sig;
    const ctx = pg.ink.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, pg.ink.width, pg.ink.height);
    const h = pg.hd;
    if (h) {                                                         /* leave a hole where the sharp layer draws, so translucent ink is not doubled */
      const k = pg.ink.width / Math.max(1, pg.totW); ctx.save(); ctx.beginPath(); ctx.rect(0, 0, pg.ink.width, pg.ink.height); ctx.rect(h.x0 * k, h.y0 * k, h.w * k, h.h * k); ctx.clip('evenodd');
    }
    ctx.translate(pg.pw * pg.ext.l, pg.ph * pg.ext.t);
    drawPageItems(ctx, pg.n, pg.pw, pg.ph);
    if (h) ctx.restore();
    ctx.setTransform(1, 0, 0, 1, 0, 0);
    if (h) {                                                         /* the visible part, at device resolution */
      const c = h.canvas, x = c.getContext('2d'), kx = 1 + pg.ext.l + pg.ext.r, ky = 1 + pg.ext.t + pg.ext.b, pw = (pg.totW / kx) * h.d, ph = (pg.totH / ky) * h.d;
      x.setTransform(1, 0, 0, 1, 0, 0); x.clearRect(0, 0, c.width, c.height);
      x.translate(-h.x0 * h.d + pw * pg.ext.l, -h.y0 * h.d + ph * pg.ext.t);
      drawPageItems(x, pg.n, pw, ph); x.setTransform(1, 0, 0, 1, 0, 0);
    }
    pg.dirty = false;
  }
  /* Sharp ink at any zoom (2026-10-21): the reader asks for it when the ink canvas cannot hold screen resolution. The
     sharp canvas covers only the visible part of the page and never takes pointer events (drawing still lands on
     canvas.ink, so every tool keeps its coordinates). */
  const HD_PX = TOUCH ? 4.2e6 : 9e6;
  function setInkHd(n, on) {
    const pg = S.pages.get(n); if (!pg) return;
    const drop = () => { if (!pg.hd) return; pg.hd.canvas.width = 0; pg.hd.canvas.remove(); pg.hd = null; pg.dirty = true; paint(pg); };
    if (!on || !pg.on) return drop();
    const r = pg.ink.getBoundingClientRect(), need = DPR(), have = pg.ink.width / Math.max(1, r.width);
    if (r.width < 2 || have >= need * 0.97) return drop();
    const L = Math.max(r.left, 0), T = Math.max(r.top, 0), Rr = Math.min(r.right, innerWidth), B = Math.min(r.bottom, innerHeight);
    if (Rr - L < 4 || B - T < 4) return drop();
    const x0 = L - r.left, y0 = T - r.top, w = Rr - L, h = B - T, d = Math.min(need, Math.sqrt(HD_PX / (w * h)));
    if (d <= have * 1.05) return drop();
    let c = pg.hd && pg.hd.canvas;
    if (!c) { c = document.createElement('canvas'); c.className = 'ink-hd'; c.setAttribute('aria-hidden', 'true'); }
    c.width = Math.max(1, Math.round(w * d)); c.height = Math.max(1, Math.round(h * d));
    c.style.left = (pg.ink.offsetLeft + x0) + 'px'; c.style.top = (pg.ink.offsetTop + y0) + 'px'; c.style.width = w + 'px'; c.style.height = h + 'px';
    if (c.previousElementSibling !== pg.ink) pg.ink.after(c);
    pg.hd = { canvas: c, x0, y0, w, h, d }; pg.dirty = true; paint(pg);
  }
  function frame() {
    S.raf = 0;
    for (const pg of S.pages.values()) {
      if (!pg.on) continue;
      if (pg.dirty) renderInk(pg);
      if (!pg.needsPaint) continue;
      pg.needsPaint = false;
      const ctx = pg.over.getContext('2d'); ctx.setTransform(1, 0, 0, 1, 0, 0); ctx.clearRect(0, 0, pg.over.width, pg.over.height);
      if (pg.live) { ctx.save(); ctx.translate(pg.pw * pg.ext.l, pg.ph * pg.ext.t); drawStroke(ctx, pg.live, pg.pw, pg.ph); ctx.restore(); }
      if (pg.active && pg.active.tool === 'eraser') {
        if (pg.active.lasso && pg.active.lasso.length > 1) drawEraserLasso(ctx, pg, pg.active.lasso);
        else if (pg.active.last) drawCursor(ctx, pg, pg.active.last, pg.active.dynR);
      } else if (G.hover && G.hover.pg === pg) drawCursor(ctx, pg, G.hover.p, G.hover.r);
      emit('overlay', { pg, ctx });
    }
  }
  function paint(pg) { if (!pg) return; pg.needsPaint = true; if (!S.raf) S.raf = requestAnimationFrame(frame); }
  function setPageActive(n, on) { const pg = S.pages.get(n); if (!pg || pg.on === !!on) return; if (!on && pg.active) return; pg.on = !!on; sizePage(pg); if (on) { pg.dirty = true; paint(pg); } }
  function invalidate(n) { const pg = S.pages.get(n); if (pg) { pg.dirty = true; paint(pg); } }
  function rebuildAll() { S.pages.forEach(pg => { pg.dirty = true; paint(pg); }); rebuildIndex(); }
  function rebuildIndex() { S.index = new Map(); for (const s of S.items) { if (s && s.id && C.validStroke(s)) { let ix = S.index.get(s.page); if (!ix) S.index.set(s.page, ix = new C.SpatialIndex()); ix.insert(s); } } }
  const idx = n => { let ix = S.index.get(n); if (!ix) S.index.set(n, ix = new C.SpatialIndex()); return ix; };
  /* page aspect (height / width) — every rotation and isotropic distance uses it */
  const aspect = n => { const pg = S.pages.get(n); if (pg && pg.cssW > 1) return pg.cssH / pg.cssW; const p = api.reader && api.reader.byId && api.reader.byId.get(n); return p && p.w ? p.h / p.w : 1.414; };

  /* ---------- geometry helpers for the pointer pipeline ---------- */
  const SNAP = Math.PI / 12;
  const bx = (pg, u) => C.clamp(u, -pg.ext.l, 1 + pg.ext.r), by = (pg, v) => C.clamp(v, -pg.ext.t, 1 + pg.ext.b);
  function posOf(pg, e) {
    const r = pg.ink.getBoundingClientRect(), x = pg.ext, kx = 1 + x.l + x.r, ky = 1 + x.t + x.b;
    return [C.clamp(((e.clientX - r.left) / r.width) * kx - x.l, -x.l, 1 + x.r), C.clamp(((e.clientY - r.top) / r.height) * ky - x.t, -x.t, 1 + x.b)];
  }
  function snapEnd(a, b, tool, pg) {
    if (!S.snap) return b;
    const dx = (b[0] - a[0]) * pg.cssW, dy = (b[1] - a[1]) * pg.cssH;
    if (tool === 'line' || tool === 'arrow') { const ang = Math.round(Math.atan2(dy, dx) / SNAP) * SNAP, len = Math.hypot(dx, dy); return [bx(pg, a[0] + Math.cos(ang) * len / pg.cssW), by(pg, a[1] + Math.sin(ang) * len / pg.cssH)]; }
    const m = Math.max(Math.abs(dx), Math.abs(dy));
    return [bx(pg, a[0] + Math.sign(dx || 1) * m / pg.cssW), by(pg, a[1] + Math.sign(dy || 1) * m / pg.cssH)];
  }
  const inkPages = new WeakMap();
  function attachPage(o) {
    const over = document.createElement('canvas'); over.className = 'over'; over.setAttribute('aria-hidden', 'true'); o.ink.after(over);
    const pg = { n: o.pageNumber, wrap: o.wrap, ink: o.ink, over, pdf: o.pdf || null, dirty: true, needsPaint: true, live: null, active: null, cssW: 1, cssH: 1, totW: 1, totH: 1, pw: 1, ph: 1, ext: Object.assign({ l: 0, t: 0, r: 0, b: 0 }, S.layout.margins[o.pageNumber] || {}), on: !o.lazy && !o.pdf };
    pg.base = pg.ink;                                              /* older callers read committed ink from pg.base */
    pg.px = (u, v) => [(u + pg.ext.l) * pg.pw, (v + pg.ext.t) * pg.ph];
    S.pages.set(pg.n, pg); inkPages.set(o.ink, pg);
    o.ink.style.touchAction = 'none';
    sizePage(pg); paint(pg);
    /* a resize clears the canvas: redraw in the same callback (before paint), so annotations never blink while zooming */
    if (window.ResizeObserver) new ResizeObserver(() => { const w = pg.ink.width, h = pg.ink.height; sizePage(pg); if (pg.on && (pg.ink.width !== w || pg.ink.height !== h)) renderInk(pg); paint(pg); }).observe(o.ink);
    o.ink.addEventListener('contextmenu', e => e.preventDefault());
    return pg;
  }

  /* =====================================================================================================
     Input: one state machine for stylus, finger, mouse and two-finger navigation.
       stylus  -> draws immediately (lowest latency); while it is down, and for a short window after, touches are
                  palm contacts and are ignored.
       finger  -> draws with the active tool unless the device is in stylus mode (setting, or a stylus was used on
                  this device and "auto" is on): then one finger scrolls. A finger stroke starts "pending" for a few ms
                  so a second finger can turn it into navigation without leaving a dot.
       2 fingers -> pan + pinch zoom around the gesture midpoint (CSS preview, committed as a real zoom at the end).
     States: idle, drawing, highlighting, erasing, selecting, panning, pinching.
     ===================================================================================================== */
  /* size: a contact wider than this (CSS px) is a palm. iPad Safari reports a fingertip as 30-60 px wide, so the old
     limits (28-46) took most fingers for palms and the finger could neither scroll nor zoom (2026-10-21, محمد). */
  const PALM = { low: { window: 250, size: 130 }, medium: { window: 500, size: 100 }, high: { window: 900, size: 80 } };
  const PENDING_MS = 70, PENDING_PX = 7, HOLD_MS = 520;
  const G = { ptrs: new Map(), state: 'idle', penDown: null, lastPenUp: 0, nav: null, hover: null, lastScroll: 0, selfScroll: 0, inertia: 0 };
  let penSeenAt = +(rd(PEN_SEEN_KEY, 0)) || 0;
  /* «القلم يكتب والإصبع يحرّك» (pen mode). fingerMode: 'auto' = on once an Apple Pencil was used on this device (the
     switch is automatic); 'nav' = always on; 'draw' = off (the finger writes too). The toolbar toggle sets nav / draw. */
  const penMode = () => {
    const f = S.input.fingerMode;
    if (f === 'draw') return false;
    if (f === 'nav' || S.input.stylusOnly) return true;
    return !S.input.fingerDraw || (S.input.autoStylus !== false && penSeenAt > Date.now() - 60 * 864e5);
  };
  function markPen() {
    const t = Date.now(), first = !penSeenAt || t - penSeenAt > 60 * 864e5;
    if (t - penSeenAt > 60000) { penSeenAt = t; wr(PEN_SEEN_KEY, t); emit('input', S.input); }
    if (first && (S.input.fingerMode || 'auto') === 'auto') emit('pen-detected', true);   /* the toolbar tells the student once */
  }
  const setG = st => { if (G.state !== st) { G.state = st; document.documentElement.dataset.gesture = st; emit('gesture', st); } };
  const stateFor = tool => tool === 'eraser' ? 'erasing' : tool === 'highlight' ? 'highlighting' : TOOLS[tool] && tool !== 'text' && tool !== 'sticky' ? 'selecting' : 'drawing';
  const blocked = t => !t || !t.closest || !!t.closest('textarea,input,select,button,a,label,[contenteditable],.st-editor,.study-mask,.mx-mask,.mx-occlusion-draw,dialog') || document.body.classList.contains('study-mask-mode');
  const col = () => (api.reader && api.reader.root) || document.getElementById('pages');
  addEventListener('scroll', () => {
    if (G.inertia && Math.abs(window.scrollY - G.expectY) > 2) stopInertia();   /* someone else scrolled (wheel, keys, a jump): momentum stops */
    if (now() - G.selfScroll > 80) G.lastScroll = now();                          /* scrolls we did ourselves are not "the page was moving" */
  }, { passive: true, capture: true });
  const stopInertia = () => { if (G.inertia) { cancelAnimationFrame(G.inertia); G.inertia = 0; } };
  for (const ev of ['wheel', 'keydown']) addEventListener(ev, stopInertia, { passive: true, capture: true });

  function onDown(e) {
    stopInertia(); if (api.reader && api.reader.cancelSettle) api.reader.cancelSettle();
    const t = e.target, inPages = !!(t && t.closest && t.closest('#pages'));
    if (!inPages || (blocked(t) && !t.closest('canvas.ink'))) return;   /* text selection is MEDIXA's own (studio-smart.js), never a mode that blocks the pen or the finger */
    const ink = t.closest('canvas.ink'), pg = ink ? inkPages.get(ink) : null;
    if (e.pointerType === 'touch') return touchDown(e, pg);
    if (e.pointerType === 'pen') markPen();
    if (!pg) { if (e.pointerType === 'mouse' && e.button === 1) startPan(e, null); return; }
    if (e.pointerType === 'pen') { G.penDown = e.pointerId; palmSweep(); }
    if (e.pointerType === 'mouse' && e.button === 1) { e.preventDefault(); return startPan(e, pg); }
    if (e.pointerType === 'mouse' && e.button !== 0) return;
    e.preventDefault();
    if (S.tool === 'hand') return startPan(e, pg);
    const rec = { id: e.pointerId, type: e.pointerType, pg, role: 'draw', t0: now(), x0: e.clientX, y0: e.clientY, eraserTip: e.pointerType === 'pen' && ((e.buttons & 32) || e.button === 5) };
    G.ptrs.set(e.pointerId, rec);
    try { pg.ink.setPointerCapture(e.pointerId); } catch {}
    if (!beginTool(pg, e, rec)) G.ptrs.delete(e.pointerId);
  }
  /* A stylus touching down: touches that just started (a palm landing a moment before the pen) are discarded. */
  function palmSweep() {
    if (!S.input.palm) return;
    for (const r of G.ptrs.values()) {
      if (r.type !== 'touch') continue;
      if (r.role === 'pending') { clearTimeout(r.timer); r.role = 'rejected'; continue; }
      if (r.role === 'draw') { const fresh = now() - r.t0 < 450 || r.len < 30; endTool(r, fresh ? 'discard' : 'commit'); r.role = 'rejected'; }
      else if (r.role === 'pan' && now() - r.t0 < 450) { stopInertia(); r.role = 'rejected'; }   /* a palm landing just before the pen does not move the page */
    }
  }
  function touchDown(e, pg) {
    const t = now(), P = PALM[S.input.palmSens] || PALM.medium;
    const rec = { id: e.pointerId, type: 'touch', pg, role: null, t0: t, x0: e.clientX, y0: e.clientY, x: e.clientX, y: e.clientY, buf: [e], len: 0 };
    G.ptrs.set(e.pointerId, rec);
    const pm = penMode();
    if (S.input.palm && (G.penDown != null || t - G.lastPenUp < P.window || Math.max(e.width || 0, e.height || 0) > P.size * (pm ? 1.4 : 1))) { rec.role = 'rejected'; if (pg) e.preventDefault(); return; }
    e.preventDefault();
    if (G.nav) { rec.role = 'ignored'; return; }                   /* a third finger during a pinch changes nothing */
    const live = [...G.ptrs.values()].filter(r => r.type === 'touch' && r.role !== 'rejected' && r.role !== 'ignored');
    if (live.length >= 2) { if (S.input.twoFinger) startNav(live.slice(-2)); else rec.role = 'ignored'; return; }
    if (!pg || pm || S.tool === 'hand') return startPan(e, pg, rec);
    try { pg.ink.setPointerCapture(e.pointerId); } catch {}
    rec.role = 'pending'; rec.timer = setTimeout(() => promote(rec), PENDING_MS);
  }
  function promote(rec) {
    if (rec.role !== 'pending' || !G.ptrs.has(rec.id)) return;
    clearTimeout(rec.timer);
    if (G.lastScroll > rec.t0) { rec.role = 'ignored'; return; }      /* the page was scrolling (another finger / momentum): not ink */
    rec.role = 'draw';
    if (!beginTool(rec.pg, rec.buf[0], rec)) { rec.role = 'ignored'; return; }
    for (const ev of rec.buf.slice(1)) moveTool(rec, ev);
    rec.buf = null;
  }
  function onMove(e) {
    const rec = G.ptrs.get(e.pointerId);
    if (!rec) { hover(e); return; }
    if (rec.role === 'rejected' || rec.role === 'ignored') return;
    if (rec.role === 'pending') {
      rec.buf.push(e);
      if (Math.hypot(e.clientX - rec.x0, e.clientY - rec.y0) > PENDING_PX) promote(rec);
      return;
    }
    if (rec.role === 'pan') return panMove(rec, e);
    if (rec.role === 'nav') return navMove(e);
    if (rec.role === 'draw') moveTool(rec, e);
  }
  function onUp(e) {
    if (G.penDown === e.pointerId) { G.penDown = null; G.lastPenUp = now(); }   /* even when its stroke never started: a stuck pen blocked every finger */
    const rec = G.ptrs.get(e.pointerId); if (!rec) return;
    const cancel = e.type === 'pointercancel';
    if (rec.role === 'pending') { if (cancel) { clearTimeout(rec.timer); G.ptrs.delete(rec.id); return; } promote(rec); }
    G.ptrs.delete(e.pointerId);
    if (rec.role === 'draw') {
      /* a browser cancel (system gesture) keeps a real stroke; a tiny one is treated as accidental */
      const keep = !cancel || rec.len > 30 || now() - rec.t0 > 400;
      endTool(rec, keep ? 'commit' : 'discard', e);
    } else if (rec.role === 'pan') panEnd(rec);
    else if (rec.role === 'nav') navUp(rec);
    if (!G.ptrs.size) setG('idle');
  }

  /* ----- tools on a page ----- */
  function beginTool(pg, e, rec) {
    if (pg.active) return false;                                    /* one gesture per page at a time */
    const p = posOf(pg, e), tool = rec && rec.eraserTip ? 'eraser' : S.tool, a = { id: e.pointerId, type: e.pointerType, tool, ops: [], last: p, px: e.clientX, py: e.clientY, t0: now(), lt: now(), anchor: [e.clientX, e.clientY] };
    pg.active = a; if (rec) { rec.pg = pg; rec.len = 0; rec.lx = e.clientX; rec.ly = e.clientY; }
    setG(stateFor(tool));
    if (TOOLS[tool]) { a.custom = TOOLS[tool]; if (!TOOLS[tool].passive) setState('editing'); if (TOOLS[tool].down(pg, e, p) === false) { pg.active = null; if (S.state === 'editing') setState(S.dirty ? 'pending' : 'saved'); return false; } return true; }
    if (tool === 'eraser') {
      setState('editing');
      a.dynR = eraseSize();
      if (S.styles.eraser.mode === 'lasso' && !(rec && rec.eraserTip)) { a.lasso = [p]; paint(pg); }
      else { erase(pg, p, a.dynR); paint(pg); }
      return true;
    }
    if (['pen', 'highlight', 'line', 'rectangle', 'ellipse', 'arrow'].includes(tool)) {
      setState('editing');
      const st = S.styles[groupOf(tool)], k = aspect(pg.n);
      const L = { id: C.newId(), v: 2, rev: 1, page: pg.n, tool, color: st.color, width: st.width, points: [p] };
      if (tool === 'pen') {
        L.pen = st.pen; L.wr = st.wr.slice();
        if (st.op && st.op < 1) L.op = st.op;
        if (st.dash && st.dash !== 'solid') L.dash = st.dash;
        if (e.pointerType === 'pen') L.pr = [C.clamp01(e.pressure)];
        a.filter = st.smooth > 0 && C.InkFilter ? new C.InkFilter(st.smooth, k) : null;
      }
      if (tool === 'highlight') {
        L.op = st.op;
        if (st.tip === 'flat') L.tip = 'flat';
        if (st.alwaysStraight) { a.straight = true; a.hsnap = st.hsnap; }
        else a.filter = C.InkFilter ? new C.InkFilter(0.3, k) : null;
      }
      if (C.SHAPES.includes(tool) && st.dash && st.dash !== 'solid') L.dash = st.dash;
      if (tool === 'arrow' && st.head === 'both') L.head = 'both';
      if (a.filter) a.filter.push(p, e.timeStamp || now());
      pg.live = L; paint(pg); return true;
    }
    pg.active = null; return false;
  }
  function moveTool(rec, e) {
    const pg = rec.pg, a = pg && pg.active; if (!a || a.id !== e.pointerId) return;
    const stepPx = Math.hypot(e.clientX - rec.lx, e.clientY - rec.ly), tNow = now(), dt = Math.max(4, tNow - (a.lt || tNow));
    rec.len += stepPx; rec.lx = e.clientX; rec.ly = e.clientY; a.lt = tNow;
    if (a.tool === 'eraser') {
      const baseR = eraseSize();
      if (S.styles.eraser.autoSize !== false) {
        const v = stepPx / dt; /* px per ms */
        const targetR = baseR * C.clamp(1 + (v - 0.35) * 0.65, 1, 2.25);
        a.dynR = (a.dynR || baseR) * 0.72 + targetR * 0.28;
      } else a.dynR = baseR;
    }
    const evs = (e.getCoalescedEvents && e.getCoalescedEvents()) || [];
    for (const ev of (evs.length ? evs : [e])) {
      const p = posOf(pg, ev);
      if (a.custom) { a.custom.move(pg, ev, p); a.last = p; continue; }
      if (a.tool === 'eraser') {
        if (a.lasso) { a.lasso.push(p); a.last = p; continue; }
        if (a.last) {
          const dist = Math.hypot((p[0] - a.last[0]) * pg.cssW, (p[1] - a.last[1]) * pg.cssH), step = Math.max(3, (a.dynR || eraseSize()) * 0.6);
          if (dist > step) {
            const n = Math.min(12, Math.ceil(dist / step));
            for (let k = 1; k < n; k++) erase(pg, [a.last[0] + (p[0] - a.last[0]) * k / n, a.last[1] + (p[1] - a.last[1]) * k / n], a.dynR);
          }
        }
        erase(pg, p, a.dynR); a.last = p; continue;
      }
      const L = pg.live;
      if (!L) continue;
      if (C.SHAPES.includes(L.tool)) { L.points = [L.points[0], snapEnd(L.points[0], p, L.tool, pg)]; continue; }
      if (a.straight) { const s2 = C.straighten([L.points[0], p], { horizontal: a.hsnap, k: aspect(pg.n) }); L.points = s2; continue; }
      const q = a.filter ? a.filter.push(p, ev.timeStamp || now()) : p;
      const last = L.points[L.points.length - 1];
      if (Math.hypot((q[0] - last[0]) * pg.cssW, (q[1] - last[1]) * pg.cssH) < 0.6) continue;   /* thin redundant samples */
      L.points.push(q); if (L.pr) L.pr.push(C.clamp01(ev.pressure)); a.raw = p;
    }
    /* hold still (pen / highlighter) -> perfect shape / straight marker line */
    if (pg.live && !a.straight && !a.snapped && (a.tool === 'pen' || a.tool === 'highlight')) {
      if (Math.hypot(e.clientX - a.anchor[0], e.clientY - a.anchor[1]) > 3) { a.anchor = [e.clientX, e.clientY]; clearTimeout(a.holdT); if (rec.len > 24) a.holdT = setTimeout(() => onHold(pg, a), HOLD_MS); }
    }
    paint(pg);
  }
  function onHold(pg, a) {
    const L = pg.live; if (!L || pg.active !== a) return;
    const k = aspect(pg.n);
    if (a.tool === 'highlight') {
      /* a highlighter never turns into a circle or a box (holding still used to draw them): it is a band or nothing */
      if (S.styles.highlight.straight) { a.straight = true; a.hsnap = S.styles.highlight.hsnap; L.points = C.straighten(L.points, { horizontal: a.hsnap, k }); paint(pg); emit('snap', 'line'); return; }
    }
    if (a.tool === 'pen' && S.input.shapeSnap && C.recognizeShape) {
      const r = C.recognizeShape(L.points, k); if (!r) return;
      a.snapped = r.tool; L.tool = r.tool;
      if (r.tool === 'line') L.points = C.straighten(r.points, { horizontal: true, k });
      else L.points = r.points;
      delete L.pr; delete L.pen; delete L.wr; paint(pg); emit('snap', r.tool);
    }
  }
  function endTool(rec, how, e) {
    const pg = rec.pg, a = pg && pg.active; if (!a || a.id !== rec.id) return;
    clearTimeout(a.holdT);
    try { pg.ink.releasePointerCapture(rec.id); } catch {}
    pg.active = null;
    const cancelled = how === 'discard', p = e ? posOf(pg, e) : a.last;
    if (a.custom) { a.custom.up(pg, e || { pointerId: rec.id, clientX: a.px, clientY: a.py }, cancelled, p); if (S.state === 'editing') setState(S.dirty ? 'pending' : 'saved'); return; }
    if (a.tool === 'eraser') {
      if (!cancelled && a.lasso && a.lasso.length >= 3) eraseLasso(pg, a.lasso, a);
      if (a.ops.length) { S.hist.push(a.ops); markDirty(); } else if (S.state === 'editing') setState(S.dirty ? 'pending' : 'saved');
      invalidate(pg.n);
      if (!cancelled && S.styles.eraser.autoBack && !(rec && rec.eraserTip) && S.lastDrawTool && S.lastDrawTool !== 'eraser') setTool(S.lastDrawTool);
      return;
    }
    const L = pg.live; pg.live = null;
    if (!L) return;
    if (cancelled) { paint(pg); setState(S.dirty ? 'pending' : 'saved'); return; }      /* an accidental / rejected contact leaves nothing */
    if (a.raw && !C.SHAPES.includes(L.tool) && !a.straight) {                         /* the filter trails slightly: end exactly where the pen lifted */
      const last = L.points[L.points.length - 1];
      if (Math.hypot((a.raw[0] - last[0]) * pg.cssW, (a.raw[1] - last[1]) * pg.cssH) > 0.3) { L.points.push(a.raw); if (L.pr) L.pr.push(L.pr[L.pr.length - 1]); }
    }
    if (C.SHAPES.includes(L.tool) && L.points.length < 2) { paint(pg); setState(S.dirty ? 'pending' : 'saved'); return; }
    if (C.SHAPES.includes(L.tool) || a.straight) {
      const [a0, b0] = [L.points[0], L.points[L.points.length - 1]]; if (Math.hypot((b0[0] - a0[0]) * pg.cssW, (b0[1] - a0[1]) * pg.cssH) < 3) { paint(pg); setState(S.dirty ? 'pending' : 'saved'); return; }
    }
    if (!C.validStroke(L)) { paint(pg); setState(S.dirty ? 'pending' : 'saved'); return; }
    S.items.push(L); idx(pg.n).insert(L);
    S.hist.push([{ k: 'add', s: L }]);
    if (isHl(L)) pg.dirty = true;                                   /* highlights repaint as a group (no darker overlaps) */
    else { const ctx = pg.ink.getContext('2d'); ctx.save(); ctx.translate(pg.pw * pg.ext.l, pg.ph * pg.ext.t); drawStroke(ctx, L, pg.pw, pg.ph); ctx.restore(); }
    paint(pg); markDirty();
  }

  /* ----- erasing: whole strokes, precise split, or lasso area; filtered by target ----- */
  const eraseSize = () => C.clamp(S.styles.eraser.size || 12, 4, 60);
  function canErase(s) {
    if (!s) return false;
    const st = S.styles.eraser || {};
    if (st.keepShapes && (C.SHAPES.includes(s.tool) || s.tool === 'image' || s.tool === 'text' || s.tool === 'sticky')) return false;
    if (st.target === 'highlight') return s.tool === 'highlight' || s.tool === 'texthl';
    if (st.target === 'ink') return s.tool === 'pen';
    return true;
  }
  function halfInk(s, pg) { return ((s.width || 3) * (s.tool === 'highlight' ? 6 : s.pen ? 1.3 : 1)) / 2 * pg.cssW / 800; }
  function erase(pg, p, dynR) {
    const a = pg.active, r = dynR || eraseSize(), ru = r / Math.min(pg.cssW, pg.cssH) + 0.03, k = aspect(pg.n);
    const hits = idx(pg.n).query(p[0], p[1], ru).filter(s => s.page === pg.n && canErase(s) && S.items.includes(s));
    let changed = false;
    for (const s of hits) {
      const reach = r + halfInk(s, pg);
      if (S.styles.eraser.mode === 'precise' && C.splitStroke && (s.tool === 'pen' || s.tool === 'highlight')) {
        const res = C.splitStroke(s, p[0], p[1], reach / pg.cssW, k);
        if (res === null || res === 'whole') { if (res === 'whole' && C.distToStroke(s, p[0], p[1], pg.cssW, pg.cssH) <= reach) { removeOne(pg, s, a); changed = true; } continue; }
        replaceWithPieces(pg, s, res, a); changed = true; continue;
      }
      if (C.distToStroke(s, p[0], p[1], pg.cssW, pg.cssH) <= reach) { removeOne(pg, s, a); changed = true; }
    }
    if (changed) { pg.dirty = true; paint(pg); }
  }
  function eraseLasso(pg, poly, a) {
    const bb = poly.reduce((acc, q) => [Math.min(acc[0], q[0]), Math.min(acc[1], q[1]), Math.max(acc[2], q[0]), Math.max(acc[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    const hits = S.items.filter(s => {
      if (!s || s.page !== pg.n || !canErase(s) || !C.validStroke(s)) return false;
      const b = C.bounds(s);
      return b[2] >= bb[0] && b[0] <= bb[2] && b[3] >= bb[1] && b[1] <= bb[3] && C.lassoHit(s, poly, 'touch');
    });
    for (const s of hits) removeOne(pg, s, a);
    if (hits.length) pg.dirty = true;
  }
  function clearPage(n, onlyTarget) {
    const pageId = n || (api.reader && api.reader.current ? api.reader.current() : 1);
    const ids = S.items.filter(s => s && s.page === pageId && (!onlyTarget || canErase(s))).map(s => s.id);
    if (!ids.length) return 0;
    const ops = removeItems(ids);
    commit(ops);
    return ops.length;
  }
  function removeOne(pg, s, a) { const i = S.items.indexOf(s); if (i < 0) return; S.items.splice(i, 1); idx(pg.n).remove(s); S.deleted.add(s.id); a.ops.push({ k: 'del', s, i }); }
  /* Each replacement is recorded where it happened (del at i, pieces added at i, i+1, ...), so replaying the gesture
     forward or backward reproduces every intermediate list exactly — even when a piece is split again. */
  function replaceWithPieces(pg, s, pieces, a) {
    const i = S.items.indexOf(s); if (i < 0) return;
    S.items.splice(i, 1); idx(pg.n).remove(s); S.deleted.add(s.id); a.ops.push({ k: 'del', s, i });
    pieces.forEach((q, j) => {
      const n = Object.assign({}, s, { id: C.newId(), rev: 1, points: q.points }); if (q.pr && q.pr.length === q.points.length) n.pr = q.pr; else delete n.pr;
      if (!C.validStroke(n)) return;
      S.items.splice(i + j, 0, n); idx(pg.n).insert(n); a.ops.push({ k: 'add', s: n, i: i + j });
    });
  }
  function hover(e) {
    if (e.pointerType === 'touch') return;
    const ink = e.target && e.target.closest && e.target.closest('canvas.ink'), pg = ink ? inkPages.get(ink) : null;
    const want = S.tool === 'eraser' && S.styles.eraser.mode !== 'lasso' && pg ? { pg, p: posOf(pg, e), r: eraseSize() } : null;
    if (!want && !G.hover) return;
    const old = G.hover && G.hover.pg; G.hover = want; if (old && old !== (want && want.pg)) paint(old); if (want) paint(want.pg);
  }
  function drawCursor(ctx, pg, p, customR) {
    const k = pg.ink.width / pg.totW, q = pg.px(p[0], p[1]), r = (customR || eraseSize()) * k;
    const onlyHl = S.styles.eraser && S.styles.eraser.target === 'highlight';
    ctx.save(); ctx.lineWidth = 1.6 * k;
    ctx.strokeStyle = onlyHl ? '#d99b00' : '#168c8c';
    ctx.fillStyle = onlyHl ? 'rgba(242,194,48,.14)' : 'rgba(22,140,140,.08)';
    if (S.styles.eraser && S.styles.eraser.mode === 'precise') ctx.setLineDash([3 * k, 2 * k]);
    ctx.beginPath(); ctx.arc(q[0], q[1], r, 0, 2 * Math.PI); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  function drawEraserLasso(ctx, pg, pts) {
    const k = pg.ink.width / pg.totW;
    ctx.save(); ctx.setLineDash([5 * k, 4 * k]); ctx.strokeStyle = '#e43d56'; ctx.fillStyle = 'rgba(228,61,86,.09)'; ctx.lineWidth = 1.6 * k;
    ctx.beginPath(); pts.forEach((p, i) => { const a = pg.px(p[0], p[1]); i ? ctx.lineTo(a[0], a[1]) : ctx.moveTo(a[0], a[1]); });
    ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
  }
  document.addEventListener('pointerleave', () => { if (G.hover) { const pg = G.hover.pg; G.hover = null; paint(pg); } }, true);

  /* ----- navigation: one-finger pan (stylus mode / gaps / hand tool) and two-finger pan + pinch zoom ----- */
  function startPan(e, pg, rec) {
    rec = rec || { id: e.pointerId, type: e.pointerType, pg, t0: now(), x0: e.clientX, y0: e.clientY };
    rec.role = 'pan'; rec.x = e.clientX; rec.y = e.clientY; rec.samples = [[now(), e.clientX, e.clientY]];
    G.ptrs.set(e.pointerId, rec); setG('panning');
    try { (pg ? pg.ink : col()).setPointerCapture(e.pointerId); } catch {}
  }
  function scrollByXY(dx, dy) { G.selfScroll = now(); if (dy) window.scrollBy(0, dy); G.expectY = window.scrollY; const c = col(); if (c && dx) c.scrollBy(dx, 0); }
  function panMove(rec, e) {
    scrollByXY(rec.x - e.clientX, rec.y - e.clientY); rec.x = e.clientX; rec.y = e.clientY;
    rec.samples.push([now(), e.clientX, e.clientY]); if (rec.samples.length > 8) rec.samples.shift();
  }
  function panEnd(rec) {
    const s = rec.samples || []; if (s.length < 2) return;
    const a = s[0], b = s[s.length - 1], dt = Math.max(24, b[0] - a[0]); if (now() - b[0] > 80) return;   /* sparse samples must not fake a huge fling */
    const cap = v => C.clamp(v, -3, 3);                              /* px per ms */
    let vx = cap((a[1] - b[1]) / dt), vy = cap((a[2] - b[2]) / dt), last = now();
    const step = () => { const t = now(), d = t - last; last = t; scrollByXY(vx * d, vy * d); const f = Math.pow(0.94, d / 16); vx *= f; vy *= f; G.inertia = Math.hypot(vx, vy) > 0.03 ? requestAnimationFrame(step) : 0; };
    if (Math.hypot(vx, vy) > 0.25) G.inertia = requestAnimationFrame(step);
  }
  function startNav(recs) {
    for (const r of recs) {
      if (r.role === 'pending') clearTimeout(r.timer);
      if (r.role === 'draw') { const fresh = now() - r.t0 < 300 && r.len < 20; endTool(r, fresh ? 'discard' : 'commit'); }   /* a dot from the first finger is not ink */
      r.role = 'nav'; r.buf = null;
    }
    const [a, b] = recs, m = [(a.x + b.x) / 2, (a.y + b.y) / 2];
    G.nav = { a: a.id, b: b.id, d0: Math.max(10, Math.hypot(a.x - b.x, a.y - b.y)), m0: m, last: m, s: 1, mode: 'pan', z0: api.reader ? api.reader.zoom : 1, samples: [[now(), m[0], m[1]]] };
    setG('panning');
  }
  function navMove(e) {
    const r = G.ptrs.get(e.pointerId); if (!r || !G.nav) return; r.x = e.clientX; r.y = e.clientY;
    const A = G.ptrs.get(G.nav.a), B = G.ptrs.get(G.nav.b); if (!A || !B) return;
    const n = G.nav, m = [(A.x + B.x) / 2, (A.y + B.y) / 2], d = Math.max(10, Math.hypot(A.x - B.x, A.y - B.y));
    const R = api.reader, zmin = (R && R.minZoom) || 0.4, zmax = (R && R.maxZoom) || 8, s = R ? C.clamp(d / n.d0, zmin / n.z0, zmax / n.z0) : 1;
    if (n.mode === 'pan' && R && Math.abs(s - 1) > 0.06) {         /* the fingers spread / pinch: switch to zoom preview */
      /* Scaling main#pages itself made the whole document wider, so iPad Safari shrank the entire page (toolbars too)
         and the pinch fought itself (2026-10-21, فيديو محمد). Each nearby section is scaled about the fingers instead:
         they live inside the scroll column, so the document never changes size. */
      n.mode = 'pinch'; n.m0 = m; n.d0 = d; n.s = 1; setG('pinching');
      const vh = innerHeight;
      n.secs = [...R.root.children].filter(el => { if (el.tagName !== 'SECTION') return false; const r = el.getBoundingClientRect(); return r.bottom > -3 * vh && r.top < 4 * vh; });
      for (const el of n.secs) { const r = el.getBoundingClientRect(); el.style.transformOrigin = (m[0] - r.left) + 'px ' + (m[1] - r.top) + 'px'; el.style.willChange = 'transform'; }
      if (R.freeze) R.freeze(true);
    }
    if (n.mode === 'pan') { scrollByXY(n.last[0] - m[0], n.last[1] - m[1]); n.last = m; n.samples.push([now(), m[0], m[1]]); if (n.samples.length > 8) n.samples.shift(); return; }
    n.s = C.clamp(d / n.d0, zmin / n.z0, zmax / n.z0); n.last = m;
    const tf = 'translate(' + (m[0] - n.m0[0]) + 'px,' + (m[1] - n.m0[1]) + 'px) scale(' + n.s + ')';
    for (const el of n.secs) el.style.transform = tf;
    if (R.preview) R.preview(n.z0 * n.s);
  }
  function navUp(rec) {
    const n = G.nav; if (!n) return;
    for (const r of G.ptrs.values()) if (r.role === 'nav') r.role = 'ignored';   /* the finger left on the glass never starts ink */
    G.nav = null;
    if (n.mode === 'pinch') {
      const R = api.reader;
      for (const el of n.secs || []) { el.style.transform = ''; el.style.transformOrigin = ''; el.style.willChange = ''; }
      if (R.freeze) R.freeze(false);
      /* the document point that was under the fingers lands where the fingers are now (no jump) */
      if (R.zoomAt) R.zoomAt(n.z0 * n.s, n.m0[0], n.m0[1], n.last[0], n.last[1]); else R.setZoom(n.z0 * n.s);
    } else panEnd({ samples: n.samples });
    emit('nav-end', n.mode);
  }
  document.addEventListener('pointerdown', onDown, { passive: false });
  document.addEventListener('pointermove', onMove, { passive: false });
  document.addEventListener('pointerup', onUp);
  document.addEventListener('pointercancel', onUp);
  document.addEventListener('lostpointercapture', e => { const r = G.ptrs.get(e.pointerId); if (r && r.role === 'draw' && r.pg && r.pg.active && r.pg.active.id === e.pointerId) setTimeout(() => { if (G.ptrs.get(e.pointerId) === r) onUp({ type: 'pointercancel', pointerId: e.pointerId, clientX: r.lx, clientY: r.ly }); }, 0); });

  /* ---------- history ---------- */
  function afterHistory(ops) {
    if (!ops) return;
    const pages = new Set();
    for (const o of ops) { const s = o.s || S.items.find(x => x && x.id === o.id); if (s) pages.add(s.page); }
    pages.forEach(n => { const ix = new C.SpatialIndex(); S.items.forEach(s => s && s.id && s.page === n && C.validStroke(s) && ix.insert(s)); S.index.set(n, ix); invalidate(n); });
    S.items.forEach(s => s && s.id && S.deleted.delete(s.id));
    markDirty(); emit('select-refresh');
  }
  const undo = () => afterHistory(S.hist.undo());
  const redo = () => afterHistory(S.hist.redo());

  /* ---------- export (vector, rotation/CropBox aware) ---------- */
  function quadFlatten(pts) {
    if (pts.length < 3) return pts;
    const out = [pts[0]];
    for (let i = 1; i < pts.length - 1; i++) {
      const a = pts[i], b = pts[i + 1], m = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2], s = out[out.length - 1];
      for (let k = 1; k <= 6; k++) { const t = k / 6, u = 1 - t; out.push([u * u * s[0] + 2 * u * t * a[0] + t * t * m[0], u * u * s[1] + 2 * u * t * a[1] + t * t * m[1]]); }
    }
    out.push(pts[pts.length - 1]); return out;
  }
  /* Consecutive segments whose widths differ by < 8 % (or 0.15 pt) share one path. */
  function widthRuns(pts, wd) {
    if (pts.length < 2) return [{ pts: [pts[0], [pts[0][0] + 0.0001, pts[0][1]]], w: wd[0] || 1 }];
    const runs = []; let cur = { pts: [pts[0], pts[1]], w: (wd[0] + wd[1]) / 2 };
    for (let i = 2; i < pts.length; i++) {
      const w = (wd[i - 1] + wd[i]) / 2;
      if (Math.abs(w - cur.w) <= Math.max(0.15, cur.w * 0.08)) cur.pts.push(pts[i]); else { runs.push(cur); cur = { pts: [pts[i - 1], pts[i]], w }; }
    }
    runs.push(cur); return runs;
  }
  /* Expanded output: the page boxes grow to hold the margins; original content stays exactly where it was. */
  function growBoxes(page, box, rot, e) {
    const c = [C.viewToPdf(-e.l, -e.t, box, rot), C.viewToPdf(1 + e.r, 1 + e.b, box, rot)], x0 = Math.min(c[0][0], c[1][0]), x1 = Math.max(c[0][0], c[1][0]), y0 = Math.min(c[0][1], c[1][1]), y1 = Math.max(c[0][1], c[1][1]);
    page.setMediaBox(x0, y0, x1 - x0, y1 - y0); page.setCropBox(x0, y0, x1 - x0, y1 - y0);
  }
  /* What a clipped (original-page) export would leave out. */
  function marginReport() {
    const pages = new Set(); let strokes = 0;
    for (const s of S.items) { if (!s || !C.validStroke(s)) continue; const b = C.bounds(s); if (b[0] < 0 || b[1] < 0 || b[2] > 1 || b[3] > 1) { strokes++; pages.add(s.page); } }
    return { strokes, pages: [...pages].sort((a, b) => a - b), hasMargins: Object.keys(S.layout.margins).length > 0 };
  }
  /* Output page list: every source page (in place) plus the virtual blank pages in display order. */
  async function exportPdf(bytes, opts) {
    opts = opts || {};
    const { PDFDocument, rgb, LineCapStyle, LineJoinStyle } = window.PDFLib;
    const hasSrc = !!bytes && S.nSources > 0;                         /* a notebook has no source pages (pdf-lib would add one to an empty file) */
    const out = hasSrc ? await PDFDocument.load(bytes) : await PDFDocument.create(), nSrc = hasSrc ? out.getPageCount() : 0;
    const rasters = [], expand = opts.margins === 'expand';
    const srcPages = Array.from({ length: nSrc }, (_, i) => out.getPage(i)), map = new Map();
    const order = pageOrder(nSrc);
    order.forEach((id, k) => {
      if (id < C.BLANK_ID0) { map.set(id, srcPages[id - 1]); return; }
      const bl = S.layout.blanks.find(x => x.id === id), pg = out.insertPage(k, [bl.w, bl.h]);
      const geo = C.templateGeometry(bl.template, bl.w, bl.h), c = rgb(0.74, 0.82, 0.86);
      for (const [x1, y1, x2, y2] of geo.lines) pg.drawLine({ start: { x: x1, y: bl.h - y1 }, end: { x: x2, y: bl.h - y2 }, thickness: 0.5, color: c });
      for (const [x, y] of geo.dots) pg.drawCircle({ x, y: bl.h - y, size: 0.9, color: c });
      map.set(id, pg);
    });
    for (const [id, page] of map) {
      const strokes = S.items.filter(x => x && x.page === id && C.validStroke(x)); if (!strokes.length) continue;
      const box = page.getCropBox ? page.getCropBox() : page.getMediaBox(), rot = page.getRotation().angle;
      const [dw, dh] = C.displaySize(box, rot);
      if (expand && S.layout.margins[id]) growBoxes(page, box, rot, S.layout.margins[id]);
      const P = p => { const q = C.viewToPdf(p[0], p[1], box, rot); return [q[0], q[1]]; };
      const path = pts => pts.map((p, k) => { const q = P(p); return (k ? 'L' : 'M') + q[0].toFixed(3) + ' ' + (-q[1]).toFixed(3); }).join(' ');
      const segPath = segs => segs.map(([a, b]) => path([a, b])).join(' ');
      const wpt = (s, pr) => C.widthAt(s.width || 3, pr, s.tool === 'highlight' ? 'highlight' : s.tool === 'pen' ? 'pen' : 'shape') / 800 * dw;
      for (const s of strokes) {
        if (s.tool === 'text' || s.tool === 'sticky' || s.tool === 'image') { rasters.push({ page, box, rot, s }); continue; }
        if (s.tool === 'texthl' && s.mark) {
          const [r0, g0, b0] = hex(s.color || '#e43d56');
          for (const q of s.rects) { const lh = q[3] - q[1], y = s.mark === 'strike' ? q[1] + lh * 0.55 : q[3] - lh * 0.06; page.drawSvgPath(path([[q[0], y], [q[2], y]]), { x: 0, y: 0, borderColor: rgb(r0, g0, b0), borderWidth: Math.max(0.6, lh * dh * 0.085), borderOpacity: s.op || 0.9, borderLineCap: LineCapStyle.Round }); }
          continue;
        }
        if (s.tool === 'texthl') {
          const [r0, g0, b0] = hex(s.color || '#f2c230');
          for (const q of s.rects) page.drawSvgPath(path([[q[0], q[1]], [q[2], q[1]], [q[2], q[3]], [q[0], q[3]]]) + ' Z', { x: 0, y: 0, color: rgb(r0, g0, b0), opacity: s.op || 0.35, borderWidth: 0 });
          continue;
        }
        const [r, g, b] = hex(s.color), color = rgb(r, g, b), op = s.tool === 'highlight' ? (s.op || 0.3) : 1;
        const draw = (d, width) => page.drawSvgPath(d, { x: 0, y: 0, borderColor: color, borderWidth: width, borderOpacity: op, borderLineCap: LineCapStyle.Round, borderLineJoin: LineJoinStyle.Round });
        if (s.tool === 'pen' && s.pen) {
          /* the screen's variable width, exported as runs of near-equal width (round caps) so files stay small */
          const wd = C.penWidths(s, dw, dh), o = (C.penStyle(s.pen).alpha || 1) * (s.op || 1);
          for (const run of widthRuns(s.points, wd)) page.drawSvgPath(path(run.pts), { x: 0, y: 0, borderColor: color, borderWidth: run.w, borderOpacity: o, borderLineCap: LineCapStyle.Round, borderLineJoin: LineJoinStyle.Round });
          continue;
        }
        if (s.tool === 'arrow') { draw(segPath(arrowSegs(s, dw, dh)), wpt(s, 1)); continue; }
        const segs = C.shapeSegments(s);
        if (segs) {
          const pts = s.tool === 'line' ? s.points.slice(0, 1).concat(s.points.slice(-1)) : segs.map(x => x[0]).concat([segs[0][0]]);
          draw(path(pts), wpt(s, 1));
        } else if (s.pr && s.pr.length === s.points.length && s.points.length > 1) {
          for (let k = 1; k < s.points.length; k++) draw(path([s.points[k - 1], s.points[k]]), wpt(s, (s.pr[k] + s.pr[k - 1]) / 2));
        } else if (s.points.length === 1) draw(path([s.points[0], [s.points[0][0] + 0.0001, s.points[0][1]]]), wpt(s, 0.5));
        else draw(path(quadFlatten(s.points)), wpt(s, 0.5));
      }
    }
    if (rasters.length) await exportRasters(out, rasters);
    return out.save();
  }
  /* Text, sticky notes and images: drawn by the browser exactly as on screen (Arabic shaping, rotation, crop, flip,
     opacity), then placed by their box. Unrotated opaque JPEG images keep their original bytes. */
  async function exportRasters(out, list) {
    const { degrees } = window.PDFLib, A = Assets();
    for (const { page, box, rot, s } of list) {
      const [dw, dh] = C.displaySize(box, rot), b = C.bounds(s);
      if (s.tool === 'image') {
        const img = A ? await A.bitmap(s.asset) : null; if (!img) { S.exportMissing = (S.exportMissing || 0) + 1; continue; }
        const plain = !s.rot && !s.fx && !s.fy && !s.crop && (s.op || 1) >= 1, raw = plain && A.bytes ? await A.bytes(s.asset) : null;
        if (raw && /jpe?g|png/.test(raw.type)) {
          const emb = /png/.test(raw.type) ? await out.embedPng(raw.bytes) : await out.embedJpg(raw.bytes), o = C.viewToPdf(b[0], b[3], box, rot);
          page.drawImage(emb, { x: o[0], y: o[1], width: (b[2] - b[0]) * dw, height: (b[3] - b[1]) * dh, rotate: degrees(rot) });
          continue;
        }
      }
      const scale = s.tool === 'image' ? 2400 : 1200, W = Math.round((b[2] - b[0]) * scale), H = Math.round((b[3] - b[1]) * scale * dh / dw);
      const cv = document.createElement('canvas'); cv.width = Math.max(4, Math.min(4096, W)); cv.height = Math.max(4, Math.min(4096, H));
      const cx = cv.getContext('2d'), fx = cv.width / Math.max(1, W), fy = cv.height / Math.max(1, H); cx.scale(fx, fy); cx.translate(-b[0] * scale, -b[1] * scale * dh / dw);
      if (s.tool === 'image') { cx.save(); drawImageItem(cx, s, scale, scale * dh / dw); cx.restore(); } else drawTextBox(cx, s, scale, scale * dh / dw);
      const png = await out.embedPng(await (await fetch(cv.toDataURL('image/png'))).arrayBuffer());
      /* Display-space bottom-left of the box is the image origin; the image x-axis follows display-x, which is the
         PDF axis rotated by the page's /Rotate (verified for 0/90/180/270 with CropBox in tests/studio_phase2_browser.py). */
      const o = C.viewToPdf(b[0], b[3], box, rot);
      page.drawImage(png, { x: o[0], y: o[1], width: (b[2] - b[0]) * dw, height: (b[3] - b[1]) * dh, rotate: degrees(rot) });
    }
  }

  /* ---------- tool UI binding (header buttons keep their ids/data attributes) ---------- */
  function setTool(t) {
    if (t === 'pen' || t === 'highlight') S.lastDrawTool = t;
    S.tool = t; document.querySelectorAll('[data-tool]').forEach(b => { b.classList.toggle('active', b.dataset.tool === t); b.setAttribute('aria-pressed', String(b.dataset.tool === t)); });
    document.documentElement.dataset.studioTool = t;
    if (G.hover) { const pg = G.hover.pg; G.hover = null; paint(pg); }
    emit('tool', t);
  }
  const KEYS = { p: 'pen', h: 'highlight', e: 'eraser', l: 'lasso', t: 'text', v: 'hand' };
  function bindUi() {
    document.querySelectorAll('[data-tool]').forEach(b => b.onclick = () => setTool(b.dataset.tool));
    addEventListener('keydown', e => {
      if (e.target.closest && e.target.closest('input,textarea,select,[contenteditable]')) return;
      if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'z') { e.preventDefault(); e.shiftKey ? redo() : undo(); }
      else if ((e.ctrlKey || e.metaKey) && e.key.toLowerCase() === 'y') { e.preventDefault(); redo(); }
      else if (!e.ctrlKey && !e.metaKey && !e.altKey && KEYS[e.key] && (TOOLS[KEYS[e.key]] || ['pen', 'highlight', 'eraser', 'hand'].includes(KEYS[e.key]))) setTool(KEYS[e.key]);
    });
    addEventListener('visibilitychange', () => { if (document.visibilityState === 'hidden') { flush(); saveHist(); } });
    addEventListener('pagehide', () => { flush(); saveHist(); }); addEventListener('beforeunload', flush);
  }

  /* ---------- recovery banner (conflict / failed write / unsaved draft) ---------- */
  function banner(text, actions) {
    let el = $('studio-banner');
    if (!el) { el = document.createElement('div'); el.id = 'studio-banner'; el.setAttribute('role', 'alert'); document.body.append(el); }
    el.replaceChildren(); const sp = document.createElement('span'); sp.textContent = text; el.append(sp);
    for (const [label, fn] of actions) { const b = document.createElement('button'); b.type = 'button'; b.textContent = label; b.onclick = () => { el.classList.remove('open'); fn(); }; el.append(b); }
    el.classList.add('open');
  }
  /* The ink backup also carries the pixels of inserted images (they live in IndexedDB, not in the stroke list). */
  async function downloadJson() {
    const A = Assets(), assets = {};
    if (A && A.dataUrl) for (const id of new Set(S.items.filter(s => s && s.tool === 'image').map(s => s.asset))) { try { const u = await A.dataUrl(id); if (u) assets[id] = u; } catch {} }
    const blob = new Blob([JSON.stringify({ format: 'medixa-ink-v1', document: new URL(S.src, location.href).href, strokes: S.items, assets, exportedAt: new Date().toISOString() })], { type: 'application/json' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = 'medixa-ink-backup.json'; a.click(); setTimeout(() => URL.revokeObjectURL(a.href), 1000);
  }
  on('savefail', r => {
    if (r === 'conflict') banner('تغيّرت رسوماتك في تبويب آخر. يمكنك دمج التغييرين دون فقد أي منهما.', [['دمج وحفظ', () => mergeAndSave()], ['تنزيل نسخة', downloadJson]]);
    else banner('تعذر الحفظ على هذا الجهاز. حُفظت مسودة احتياطية وستُعاد المحاولة تلقائياً، وتنزيل نسخة يحميك من الضياع.', [['تنزيل نسخة', downloadJson]]);
  });
  on('draft', d => banner('وُجدت مسودة رسومات لم تُحفظ (' + d.items.length + ' عنصراً). هل تريد استعادتها ودمجها؟', [['استعادة', () => { const n = recoverDraft(); setState('saved', ' — أُضيف ' + n); }], ['تجاهل', () => { S.draft = null; clearDraft(); }]]));

  /* ---------- per-document undo history that survives switching tabs (sessionStorage, validated by a fingerprint) ---------- */
  const fp = () => { let h = 0x811c9dc5; for (const s of S.items) { const t = (s && s.id ? s.id : '?') + ':' + (s && s.rev || 1); for (let i = 0; i < t.length; i++) { h ^= t.charCodeAt(i); h = Math.imul(h, 16777619) >>> 0; } } return S.items.length + ':' + h.toString(36); };
  const histKey = () => 'medixa.studio.hist.v1:' + S.key;
  function saveHist() {
    try {
      let u = S.hist.undoStack, r = S.hist.redoStack, json = JSON.stringify({ fp: fp(), undo: u, redo: r });
      while (json.length > 1500000 && u.length > 1) { u = u.slice(Math.ceil(u.length / 4)); json = JSON.stringify({ fp: fp(), undo: u, redo: r.length > 20 ? [] : r }); }
      sessionStorage.setItem(histKey(), json);
    } catch {}
  }
  function restoreHist() {
    try {
      const v = JSON.parse(sessionStorage.getItem(histKey()) || 'null'); if (!v || v.fp !== fp() || !Array.isArray(v.undo) || !Array.isArray(v.redo)) return;
      const kinds = C.OPS || ['add', 'del', 'edit'];
      const ok = ops => Array.isArray(ops) && ops.every(o => o && kinds.includes(o.k));
      if (v.undo.every(ok) && v.redo.every(ok)) { S.hist.undoStack = v.undo; S.hist.redoStack = v.redo; }
    } catch {}
  }
  let ht = 0; function histSoon() { clearTimeout(ht); ht = setTimeout(saveHist, 600); }

  /* ---------- init ---------- */
  async function init(o) {
    S.src = o.src; S.key = 'medixa.pdf.annotations.v1:' + new URL(o.src, location.href).href;
    S.guard = openGuard(); loadLayout();
    const loaded = S.guard.value;
    const m = C.migrate(Array.isArray(loaded) ? loaded : []);
    S.items = m.list; S.invalid = m.invalid; S.dirty = false;      /* migration is in-memory; first real edit persists it */
    S.hist = new C.History(S.items); restoreHist(); S.hist.onchange = () => { emit('history'); histSoon(); };
    rebuildIndex(); bindUi(); setTool('pen'); emit('init');
    S.state = 'idle';
    if (o.bytes && window.crypto && crypto.subtle) { try { const h = await crypto.subtle.digest('SHA-256', o.bytes); S.docHash = [...new Uint8Array(h)].slice(0, 8).map(x => x.toString(16).padStart(2, '0')).join(''); } catch {} }
    const draft = await readDraft();
    if (draft && Array.isArray(draft.items) && draft.items.length) { S.draft = draft; emit('draft', draft); }
    return api;
  }
  function recoverDraft() {
    if (!S.draft) return 0;
    const before = S.items.length, merged = C.mergeById(S.items, C.migrate(S.draft.items).list, S.deleted);
    S.items.length = 0; S.items.push(...merged); S.hist.setItems(S.items); S.draft = null;
    rebuildAll(); S.dirty = true; flush(); return S.items.length - before;
  }
  function ready() { setState(S.guard.state === 'ok' ? 'saved' : S.guard.state); S.state = S.guard.state === 'ok' ? 'saved' : S.guard.state; const el = $('status'); if (el && S.guard.state === 'ok') el.textContent = 'جاهز • الحفظ محلي'; }

  /* ---------- layout (margins; the page area itself never changes) ---------- */
  const zeroExt = { l: 0, t: 0, r: 0, b: 0 };
  function loadLayout() {
    S.layoutKey = 'medixa.studio.layout.v1:' + new URL(S.src, location.href).href;
    S.layoutGuard = MedixaGuard.open(localStorage, S.layoutKey, { fallback: () => ({ v: 1, margins: {} }), valid: v => v && typeof v === 'object' && !Array.isArray(v) && v.margins && typeof v.margins === 'object' });
    const v = S.layoutGuard.value, out = { v: 1, margins: {}, blanks: [], order: null };
    if (Array.isArray(v.blanks)) { const seen = new Set(); for (const b of v.blanks) if (C.validBlank(b) && !seen.has(b.id)) { seen.add(b.id); out.blanks.push({ id: b.id, template: b.template, w: b.w, h: b.h, after: Number.isInteger(b.after) ? b.after : 0 }); } }
    if (Array.isArray(v.order) && v.order.every(Number.isInteger)) out.order = v.order.slice();
    for (const [k, e] of Object.entries(v.margins || {})) if (e && ['l', 't', 'r', 'b'].every(f => typeof e[f] === 'number' && e[f] >= 0 && e[f] <= 1)) out.margins[k] = { l: e.l, t: e.t, r: e.r, b: e.b };
    S.layout = out;
  }
  function saveLayout() { const r = S.layoutGuard.write(S.layout); if (r !== 'saved') { setState(r === 'conflict' ? 'conflict' : 'failed'); emit('savefail', r); } return r; }
  /* Smallest margins that still contain everything already written on the page (so shrinking never hides ink). */
  function needExt(n) {
    const need = { l: 0, t: 0, r: 0, b: 0 };
    for (const s of S.items) { if (!s || s.page !== n || !C.validStroke(s)) continue; const b = C.bounds(s); need.l = Math.max(need.l, -b[0]); need.t = Math.max(need.t, -b[1]); need.r = Math.max(need.r, b[2] - 1); need.b = Math.max(need.b, b[3] - 1); }
    for (const k of Object.keys(need)) need[k] = Math.min(1, Math.ceil(need[k] * 20) / 20);
    return need;
  }
  /* ext = {l,t,r,b} fractions of the page size (0..1). Returns {ext, clamped}. */
  function setMargins(n, ext, opts) {
    const pg = S.pages.get(n); if (!pg) return null;
    const want = {}; for (const k of ['l', 't', 'r', 'b']) want[k] = C.clamp(+ext[k] || 0, 0, 1);
    const need = needExt(n), fin = {}; let clamped = false;
    for (const k of ['l', 't', 'r', 'b']) { fin[k] = Math.max(want[k], need[k]); if (fin[k] > want[k] + 1e-9) clamped = true; }
    Object.assign(pg.ext, fin);
    if (['l', 't', 'r', 'b'].every(k => fin[k] === 0)) delete S.layout.margins[n]; else S.layout.margins[n] = Object.assign({}, fin);
    sizePage(pg); pg.dirty = true; paint(pg); emit('layout', { n, ext: fin });
    if (!opts || !opts.defer) saveLayout();
    return { ext: fin, clamped };
  }
  /* ---- virtual blank pages: ids >= 100001, never renumber source pages ---- */
  const pageOrder = (nSrc) => C.displayOrder(nSrc == null ? S.nSources : nSrc, S.layout.blanks, S.layout.order);
  function addBlank(afterId, template, size) {
    const used = S.layout.blanks.map(b => b.id), id = Math.max(C.BLANK_ID0 - 1, ...used) + 1, order = pageOrder();
    const ref = size || { w: 595, h: 842 }, rec = { id, template: C.TEMPLATES.includes(template) ? template : 'lined', w: ref.w, h: ref.h, after: afterId < C.BLANK_ID0 ? afterId : 0 };
    const at = afterId === 0 ? 0 : order.indexOf(afterId) + 1; order.splice(Math.max(0, at), 0, id); S.layout.order = order;
    rec.after = 0; for (let k = order.indexOf(id) - 1; k >= 0; k--) if (order[k] < C.BLANK_ID0) { rec.after = order[k]; break; }   /* fallback hint if the explicit order is ever lost */
    S.layout.blanks.push(rec);
    saveLayout(); emit('pages', { added: id }); return rec;
  }
  function removeBlank(id) {
    const i = S.layout.blanks.findIndex(b => b.id === id); if (i < 0) return false;
    S.layout.blanks.splice(i, 1); S.layout.order = pageOrder().filter(x => x !== id); delete S.layout.margins[id];
    const gone = S.items.filter(s => s && s.page === id); for (const s of gone) S.deleted.add(s.id);
    for (let k = S.items.length - 1; k >= 0; k--) if (S.items[k] && S.items[k].page === id) S.items.splice(k, 1);
    S.index.delete(id); S.hist.setItems(S.items); S.dirty = true; flush(); saveLayout(); emit('pages', { removed: id }); return true;
  }
  function moveBlank(id, dir) {
    const order = pageOrder(), i = order.indexOf(id), j = i + (dir < 0 ? -1 : 1); if (i < 0 || j < 0 || j >= order.length) return false;
    [order[i], order[j]] = [order[j], order[i]]; S.layout.order = order; saveLayout(); emit('pages', { moved: id }); return true;
  }
  function detachPage(id) { S.pages.delete(id); }
  const marginsOf = n => Object.assign({}, zeroExt, S.layout.margins[n] || {});
  /* Programmatic edits used by tool modules. Every call returns ops for one history command. */
  function addItem(s, at) {
    if (Number.isInteger(at) && at >= 0 && at < S.items.length) { S.items.splice(at, 0, s); idx(s.page).insert(s); invalidate(s.page); return { k: 'add', s, i: at }; }
    S.items.push(s); idx(s.page).insert(s); invalidate(s.page); return { k: 'add', s };
  }
  function removeItems(ids) {
    const ops = [];
    for (const id of ids) { const i = S.items.findIndex(x => x && x.id === id); if (i < 0) continue; const s = S.items[i]; S.items.splice(i, 1); S.deleted.add(id); ops.push({ k: 'del', s, i }); }
    const pages = new Set(ops.map(o => o.s.page)); pages.forEach(n => { rebuildIndexPage(n); invalidate(n); }); return ops;
  }
  function rebuildIndexPage(n) { const ix = new C.SpatialIndex(); S.items.forEach(s => s && s.id && s.page === n && C.validStroke(s) && ix.insert(s)); S.index.set(n, ix); }
  function patchItem(id, props) { const i = S.items.findIndex(x => x && x.id === id); if (i < 0) return null; const before = {}; for (const k of Object.keys(props)) before[k] = S.items[i][k]; S.items[i] = Object.assign({}, S.items[i], props); rebuildIndexPage(S.items[i].page); invalidate(S.items[i].page); return { k: 'edit', id, before, after: props }; }
  /* z-order: move one item to another position in the list (images above / below other annotations) */
  function reorder(id, to) {
    const from = S.items.findIndex(x => x && x.id === id); if (from < 0) return null; to = C.clamp(to, 0, S.items.length - 1); if (to === from) return null;
    const [s] = S.items.splice(from, 1); S.items.splice(to, 0, s); invalidate(s.page); return { k: 'mv', id, from, to };
  }
  function commit(ops) { if (ops && ops.length) { S.hist.push(ops); markDirty(); } }
  function setStyle(tool, props) { const g = GROUPS[tool] || tool; if (!S.styles[g]) return null; S.styles[g] = cleanStyle(g, Object.assign({}, S.styles[g], props)); saveStyles(); emit('style'); return S.styles[g]; }
  function setInput(props) { Object.assign(S.input, props || {}); S.input = Object.assign({}, DEF_INPUT, S.input); if (!['auto', 'nav', 'draw'].includes(S.input.fingerMode)) S.input.fingerMode = 'auto'; wr(INPUT_KEY, S.input); try { localStorage.setItem('medixa.penOnly', String(!!S.input.stylusOnly)); } catch {} emit('input', S.input); emit('penonly', S.input.stylusOnly); }
  /* the saved highlights of one page, multiplied straight onto the page pixels (ctx of the page canvas): the text stays black */
  function bakeHighlights(n, ctx, w, h) {
    const list = S.items.filter(s => s && s.page === n && C.validStroke(s) && isHl(s));
    if (!list.length) return;
    ctx.save(); ctx.globalCompositeOperation = 'multiply'; drawHighlights(ctx, list, w, h); ctx.restore();
  }
  const api = {
    S, C, init, draftKeys, setPageActive, pageOrder, addBlank, removeBlank, moveBlank, detachPage, setSources(n) { S.nSources = n; }, marginReport, setMargins, marginsOf, needExt, saveLayout, registerTool(n, t) { TOOLS[n] = t; }, addItem, removeItems, clearPage, patchItem, reorder, commit, fitTextHeight, rebuildIndexPage, setState, banner,
    page: n => S.pages.get(n), bakeHighlights, ready, attachPage, setTool, undo, redo, flush, mergeAndSave, recoverDraft, exportPdf, on, emit, markDirty, rebuildAll, invalidate, paint, idx, rebuildIndex, drawStroke, drawTextBox, aspect, downloadJson,
    style: tool => S.styles[GROUPS[tool] || tool] || null, setStyle, input: () => S.input, setInput, penMode, markPen,
    gesture: { get state() { return G.state; }, get pointers() { return [...G.ptrs.values()].map(r => ({ id: r.id, type: r.type, role: r.role })); }, get penSeen() { return penSeenAt; }, forgetPen() { penSeenAt = 0; wr(PEN_SEEN_KEY, 0); emit('input', S.input); } },
    setPenOnly(v) { setInput({ stylusOnly: !!v }); },
    penMode() { return penMode(); },
    /* the toolbar toggle: 'nav' = the pen writes, the finger scrolls and zooms; 'draw' = the finger writes too; 'auto' */
    setFingerMode(m) { if (m === 'draw') setInput({ fingerMode: 'draw', stylusOnly: false, fingerDraw: true }); else if (m === 'nav') setInput({ fingerMode: 'nav' }); else setInput({ fingerMode: 'auto', stylusOnly: false, fingerDraw: true, autoStylus: true }); },
    setSnap(v) { S.snap = !!v; },
    setInkHd, getItems: () => S.items, save: () => { S.dirty = true; return flush(); }, redraw: () => rebuildAll(), checkpoint: () => {}
  };
  window.MedixaStudio = api;
})();
