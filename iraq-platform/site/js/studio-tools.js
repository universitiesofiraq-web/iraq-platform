/* MEDIXA Study Studio — advanced annotation tools on top of the single ink engine:
   selection (freeform lasso or rectangle; move / resize / rotate / restyle / copy / paste / z-order / duplicate / delete),
   pictures (insert, paste, drop, flip, rotate, crop, opacity), text + sticky notes with a style row, Zoom Writing.
   All geometry stays in canonical page coordinates; nothing here keeps a second copy of the document.
   Angles are radians (clockwise), as stored by studio-core; the UI only ever shows degrees. */
(function () {
  'use strict';
  const M = window.MedixaStudio; if (!M) return;
  const C = M.C, S = M.S, $ = id => document.getElementById(id);
  const DPR = () => Math.min(3, window.devicePixelRatio || 1);
  const TEAL = '#168c8c';
  const TOUCH = (navigator.maxTouchPoints || 0) > 0 || /iP(hone|ad|od)/.test(navigator.userAgent);
  const HEX6 = /^#[0-9a-f]{6}$/i;
  const inField = t => !!(t && t.closest && t.closest('input,textarea,select,[contenteditable]'));
  const svg = (d, cls) => '<svg class="' + (cls || 'sel-ic') + '" viewBox="0 0 24 24" width="20" height="20" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' + d + '</svg>';

  /* =============================== selection =============================== */
  const types = { ink: true, shape: true, text: true, img: true, hl: true };
  try { Object.assign(types, JSON.parse(localStorage.getItem('medixa.studio.lasso.v1') || '{}')); } catch {}
  const kind = s => s.tool === 'text' || s.tool === 'sticky' ? 'text' : s.tool === 'image' ? 'img' : (s.tool === 'texthl' || s.tool === 'highlight') ? 'hl' : C.SHAPES.includes(s.tool) ? 'shape' : 'ink';
  const MODE_KEY = 'medixa.studio.lassomode.v1', HIT_KEY = 'medixa.studio.lassohit.v1';
  let selMode = 'free'; try { if (localStorage.getItem(MODE_KEY) === 'rect') selMode = 'rect'; } catch {}
  let hitMode = 'inside'; try { if (localStorage.getItem(HIT_KEY) === 'touch') hitMode = 'touch'; } catch {}
  const sel = { page: 0, ids: [] };
  let drag = null;   /* the gesture in progress: draw (lasso / rectangle) | move | resize | rotate | crop */
  let crop = null;   /* crop mode for one picture: {id, r:[a0,b0,a1,b1]} fractions of its box in its own (rotated) frame */
  const byId = id => S.items.find(s => s && s.id === id);
  const selItems = () => sel.ids.map(byId).filter(Boolean);
  const movable = s => s.tool !== 'texthl';                      /* text highlights belong to the PDF text: never moved */
  const canWidth = s => s.tool === 'pen' || s.tool === 'highlight' || C.SHAPES.includes(s.tool);
  const canColor = s => s.tool !== 'image';
  const canOp = s => s.tool === 'highlight' || s.tool === 'texthl' || s.tool === 'image';
  const defOp = s => s.tool === 'image' ? 1 : s.tool === 'texthl' ? 0.35 : 0.3;
  const liveOf = s => (drag && drag.live && drag.live.get(s.id)) || s;
  const bounds = pg => ({ bx: [-pg.ext.l, 1 + pg.ext.r], by: [-pg.ext.t, 1 + pg.ext.b] });
  const dpx = (pg, a, b) => Math.hypot((a[0] - b[0]) * pg.cssW, (a[1] - b[1]) * pg.cssH);
  const inside = (box, p) => p[0] >= box[0] && p[0] <= box[2] && p[1] >= box[1] && p[1] <= box[3];
  /* values of `keys` as they are now (absent -> null, so an undo can remove a field again, also after a reload) */
  const pickKeys = (s, keys) => { const o = {}; for (const k of keys) o[k] = s[k] === undefined ? null : s[k]; return o; };
  function boxOf(items) {
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    for (const s of items) { const b = C.bounds(s); x0 = Math.min(x0, b[0]); y0 = Math.min(y0, b[1]); x1 = Math.max(x1, b[2]); y1 = Math.max(y1, b[3]); }
    return [x0, y0, x1, y1];
  }
  function clearSel() { endPreview(); const p = sel.page; sel.ids = []; sel.page = 0; crop = null; if (p) M.paint(M.page(p)); updateBar(); }
  function select(ids, page) {
    const list = (Array.isArray(ids) ? ids : [ids]).map(byId).filter(Boolean), n = page || (list[0] && list[0].page) || 0;
    if (S.tool !== 'lasso') M.setTool('lasso');
    endPreview(); const old = sel.page, keep = list.filter(s => s.page === n);
    sel.page = keep.length ? n : 0; sel.ids = keep.map(s => s.id); crop = null;
    if (old && old !== sel.page) M.paint(M.page(old)); if (sel.page) M.paint(M.page(sel.page));
    updateBar(); return sel.ids.length;
  }
  /* Edits several items as one history step. fn(item) -> changed props or null. */
  function editOps(list, fn) {
    const ops = [], pages = new Set();
    for (const s of list) {
      const props = fn(s); if (!props) continue;
      const i = S.items.findIndex(x => x && x.id === s.id); if (i < 0) continue;
      props.rev = (s.rev || 1) + 1;
      const n = Object.assign({}, s, props); if (!C.validStroke(n)) continue;
      ops.push({ k: 'edit', id: s.id, before: pickKeys(s, Object.keys(props)), after: props }); S.items[i] = n; pages.add(s.page);
    }
    pages.forEach(n => { M.rebuildIndexPage(n); M.invalidate(n); });
    return ops;
  }
  const record = ops => { if (ops && ops.length) M.commit(ops); updateBar(); return ops ? ops.length : 0; };

  /* ----- transform frame: box around the movable part of the selection, corner handles, rotate handle ----- */
  const PAD = 6, ROT_GAP = 30, STEP = Math.PI / 12;              /* CSS px; rotation snaps to 15° */
  const hitR = e => (e && e.pointerType === 'mouse' && !TOUCH ? 16 : 22);
  function frame(pg) {
    const items = selItems().filter(movable).map(liveOf); if (!items.length || !pg) return null;
    const b = boxOf(items), pu = PAD / pg.cssW, pv = PAD / pg.cssH, x0 = b[0] - pu, y0 = b[1] - pv, x1 = b[2] + pu, y1 = b[3] + pv, cx = (x0 + x1) / 2, cy = (y0 + y1) / 2;
    const gap = ROT_GAP / pg.cssH, above = y0 - gap >= -pg.ext.t;   /* no room above the page: the handle goes below */
    const turns = items.some(s => s.tool !== 'text' && s.tool !== 'sticky');   /* notes stay upright: nothing to turn */
    const h = { nw: [x0, y0], ne: [x1, y0], sw: [x0, y1], se: [x1, y1] };
    if ((x1 - x0) * pg.cssW > 42) { h.n = [cx, y0]; h.s = [cx, y1]; }
    if ((y1 - y0) * pg.cssH > 42) { h.w = [x0, cy]; h.e = [x1, cy]; }
    return { b, x0, y0, x1, y1, c: [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2], h, rot: turns ? [cx, above ? y0 - gap : Math.min(1 + pg.ext.b, y1 + gap)] : null, stem: [cx, above ? y0 : y1] };
  }
  function handleAt(pg, f, p, r) {
    if (f.rot && dpx(pg, f.rot, p) <= r) return 'rot';
    let best = null, bd = r;
    for (const [k, q] of Object.entries(f.h)) { const d = dpx(pg, q, p); if (d <= bd) { bd = d; best = k; } }
    return best;
  }
  function pickAt(pg, p) {
    const cand = M.idx(pg.n).query(p[0], p[1], 0.05).filter(s => s.page === pg.n && types[kind(s)]);
    let best = null, bd = 12, fill = null, fi = -1;
    for (const s of cand) {
      const d = C.distToStroke(s, p[0], p[1], pg.cssW, pg.cssH);
      if (s.tool === 'image' || s.tool === 'texthl') { if (d <= 4) { const i = S.items.indexOf(s); if (i > fi) { fi = i; fill = s; } } continue; }   /* filled: the topmost under the finger */
      if (d < bd) { bd = d; best = s; }
    }
    return best || fill;                                          /* a line drawn over a picture wins over the picture */
  }
  function itemsIn(pg, poly) {
    const bb = poly.reduce((a, q) => [Math.min(a[0], q[0]), Math.min(a[1], q[1]), Math.max(a[2], q[0]), Math.max(a[3], q[1])], [Infinity, Infinity, -Infinity, -Infinity]);
    return S.items.filter(s => {
      if (!s || s.page !== pg.n || !types[kind(s)] || !C.validStroke(s)) return false;
      const b = C.bounds(s); return b[2] >= bb[0] && b[0] <= bb[2] && b[3] >= bb[1] && b[1] <= bb[3] && C.lassoHit(s, poly, hitMode);
    });
  }
  const rectPoly = (a, b) => [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
  const norm = a => { a %= 2 * Math.PI; return a > Math.PI ? a - 2 * Math.PI : a <= -Math.PI ? a + 2 * Math.PI : a; };

  M.registerTool('lasso', {
    down(pg, e, p) {
      if (crop) return cropDown(pg, e, p);
      if (sel.ids.length && sel.page === pg.n) {
        const f = frame(pg);
        if (f) {
          const h = handleAt(pg, f, p, hitR(e));
          if (h || inside([f.x0, f.y0, f.x1, f.y1], p)) {
            drag = { mode: h === 'rot' ? 'rotate' : h ? 'resize' : 'move', handle: h, page: pg.n, start: p, box: f.b, c: f.c, ang: 0, live: null, out: null,
              orig: new Map(selItems().filter(movable).map(s => [s.id, s])) };
            drag.order = S.items.filter(s => s && drag.orig.has(s.id)).map(s => s.id);   /* the live preview keeps the drawing order */
            return;
          }
        }
      }
      if (sel.ids.length) clearSel();
      drag = { mode: 'draw', page: pg.n, start: p, end: p, poly: [p], rect: selMode === 'rect' };
    },
    move(pg, e, p) {
      if (!drag || drag.page !== pg.n) return;
      if (drag.mode === 'crop') return cropMove(pg, p);
      if (drag.mode === 'draw') { if (drag.rect) drag.end = p; else drag.poly.push(p); M.paint(pg); return; }
      transformMove(pg, e, p);
    },
    up(pg, e, cancelled, p) {
      const D = drag; if (!D) return;
      if (D.mode === 'crop') { drag = null; M.paint(pg); return; }
      if (D.mode === 'draw') { drag = null; finishSelect(pg, D, cancelled, p); return; }
      finishTransform(pg, cancelled);
    }
  });
  function finishSelect(pg, D, cancelled, p) {
    let hit = [];
    if (!cancelled) {
      const end = D.rect ? D.end : p, d = dpx(pg, end, D.start);
      const tiny = D.rect ? d < 6 : D.poly.length < 4 || d < 6 && D.poly.length < 8;
      if (tiny) { const s = pickAt(pg, D.start); if (s) hit = [s]; }
      else hit = itemsIn(pg, D.rect ? rectPoly(D.start, end) : D.poly);
    }
    sel.page = hit.length ? pg.n : 0; sel.ids = hit.map(s => s.id); M.paint(pg); updateBar();
  }
  function transformMove(pg, e, p) {
    const D = drag;
    if (D.mode === 'move') return live(pg, { dx: p[0] - D.start[0], dy: p[1] - D.start[1] });
    if (D.mode === 'rotate') {
      const c = D.c, at = q => Math.atan2((q[1] - c[1]) * pg.cssH, (q[0] - c[0]) * pg.cssW);
      let a = norm(at(p) - at(D.start));
      if (e.shiftKey || S.snap) {                                  /* a single rotated object snaps its own angle, a group its turn */
        const one = D.orig.size === 1 ? [...D.orig.values()][0] : null, r0 = one && one.rot || 0;
        a = norm(Math.round((r0 + a) / STEP) * STEP - r0);
      }
      D.ang = a; return live(pg, { rot: a, cx: c[0], cy: c[1], k: M.aspect(pg.n) });
    }
    const b = D.box, h = D.handle, ax = h.includes('w') ? b[2] : h.includes('e') ? b[0] : (b[0] + b[2]) / 2, ay = h.includes('n') ? b[3] : h.includes('s') ? b[1] : (b[1] + b[3]) / 2;
    const ow = Math.max(0.01, Math.abs(D.start[0] - ax)), oh = Math.max(0.01, Math.abs(D.start[1] - ay));
    let sx = h === 'n' || h === 's' ? 1 : Math.max(0.05, Math.abs(p[0] - ax) / ow);
    let sy = h === 'e' || h === 'w' ? 1 : Math.max(0.05, Math.abs(p[1] - ay) / oh);
    const one = D.orig.size === 1 ? [...D.orig.values()][0] : null;
    if (h.length === 2 && !(one && !['pen', 'highlight', 'image'].includes(one.tool) && !e.shiftKey)) sx = sy = Math.max(sx, sy);   /* corner handles keep proportions */
    live(pg, { sx, sy, cx: ax, cy: ay });
  }
  /* Live preview: the selection is hidden from the committed ink layer once (S.skip) and drawn on the page's live
     overlay each frame, so a drag never re-renders the whole page. */
  function live(pg, m) {
    const D = drag; m = Object.assign({}, m, bounds(pg));
    if (!D.live) { D.live = new Map(); D.out = new Map(); S.skip = new Set(D.orig.keys()); pg.dirty = true; }
    for (const [id, o] of D.orig) { const t = C.transformStroke(o, m); D.out.set(id, t); D.live.set(id, Object.assign({}, o, t)); }
    M.paint(pg);
  }
  function finishTransform(pg, cancelled) {
    const D = drag; drag = null; S.skip = null;
    const ops = [];
    if (!cancelled && D.live) for (const [id, o] of D.orig) {
      const t = D.out.get(id), i = S.items.findIndex(x => x && x.id === id); if (!t || i < 0) continue;
      ops.push({ k: 'edit', id, before: pickKeys(o, Object.keys(t)), after: t }); S.items[i] = D.live.get(id);
    }
    if (D.live) { M.rebuildIndexPage(pg.n); pg.dirty = true; }     /* a press that moved nothing leaves the ink layer alone */
    M.paint(pg); record(ops);
  }

  /* ----- overlay: lasso / rectangle preview, live transform, frame + handles, crop ----- */
  M.on('overlay', ({ pg, ctx }) => {
    const k = pg.ink.width / pg.totW, P = (u, v) => pg.px(u, v);
    if (drag && drag.page === pg.n && drag.live) {
      ctx.save(); ctx.translate(pg.pw * pg.ext.l, pg.ph * pg.ext.t);
      for (const id of drag.order) { const s = drag.live.get(id); if (s) M.drawStroke(ctx, s, pg.pw, pg.ph); }
      ctx.restore();
    }
    if (drag && drag.mode === 'draw' && drag.page === pg.n) {
      const pts = drag.rect ? rectPoly(drag.start, drag.end) : drag.poly;
      ctx.save(); ctx.setLineDash([6 * k, 4 * k]); ctx.strokeStyle = TEAL; ctx.fillStyle = 'rgba(22,140,140,.08)'; ctx.lineWidth = 1.6 * k;
      ctx.beginPath(); pts.forEach((q, i) => { const a = P(q[0], q[1]); i ? ctx.lineTo(a[0], a[1]) : ctx.moveTo(a[0], a[1]); }); if (drag.rect) ctx.closePath(); ctx.fill(); ctx.stroke(); ctx.restore();
    }
    if (sel.page === pg.n && sel.ids.length) drawSelection(pg, ctx, k, P);
    if (crop) drawCrop(pg, ctx, k, P);
    if (zw.open && zw.page === pg.n) {
      const R = zw.R(pg), a = P(R.u0, R.v0), w = R.wU * pg.pw, h = R.hV * pg.ph;
      ctx.save(); ctx.fillStyle = 'rgba(22,140,140,.10)'; ctx.strokeStyle = TEAL; ctx.lineWidth = 2 * k; ctx.fillRect(a[0], a[1], w, h); ctx.strokeRect(a[0], a[1], w, h); ctx.restore();
    }
  });
  function dot(ctx, x, y, r, fill) { ctx.beginPath(); ctx.arc(x, y, r, 0, 2 * Math.PI); ctx.fillStyle = fill; ctx.fill(); ctx.stroke(); }
  function drawSelection(pg, ctx, k, P) {
    const items = selItems(); if (!items.length) return;
    ctx.save(); ctx.strokeStyle = TEAL; ctx.lineWidth = 1.4 * k; ctx.setLineDash([4 * k, 3 * k]);
    for (const s of items) if (s.tool === 'texthl') for (const r of s.rects) { const a = P(r[0], r[1]), b = P(r[2], r[3]); ctx.strokeRect(a[0] - 2 * k, a[1] - 2 * k, b[0] - a[0] + 4 * k, b[1] - a[1] + 4 * k); }
    ctx.restore();
    if (crop) return;
    const hr = (TOUCH ? 9 : 7) * k;
    if (drag && drag.mode === 'rotate' && drag.page === pg.n) {       /* the original frame turning about its centre, with the angle */
      const b = drag.box, pu = PAD / pg.cssW, pv = PAD / pg.cssH, K = M.aspect(pg.n), c = drag.c;
      const cs = [[b[0] - pu, b[1] - pv], [b[2] + pu, b[1] - pv], [b[2] + pu, b[3] + pv], [b[0] - pu, b[3] + pv]].map(q => P(...C.rotateIso(q, c, drag.ang, K)));
      ctx.save(); ctx.strokeStyle = TEAL; ctx.lineWidth = 1.6 * k; ctx.setLineDash([5 * k, 4 * k]); ctx.beginPath(); cs.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); ctx.stroke();
      const m = P(c[0], c[1]), deg = Math.round(drag.ang * 180 / Math.PI) + '°'; ctx.setLineDash([]); ctx.font = '600 ' + 13 * k + 'px system-ui'; ctx.textAlign = 'center'; ctx.textBaseline = 'middle';
      const tw = ctx.measureText(deg).width + 12 * k; ctx.fillStyle = 'rgba(18,44,71,.85)'; ctx.fillRect(m[0] - tw / 2, m[1] - 11 * k, tw, 22 * k); ctx.fillStyle = '#fff'; ctx.fillText(deg, m[0], m[1]);
      ctx.restore(); return;
    }
    const f = frame(pg); if (!f) return;
    const a0 = P(f.x0, f.y0), a1 = P(f.x1, f.y1);
    ctx.save(); ctx.strokeStyle = TEAL; ctx.lineWidth = 1.6 * k; ctx.setLineDash([5 * k, 4 * k]);
    ctx.strokeRect(a0[0], a0[1], a1[0] - a0[0], a1[1] - a0[1]); ctx.setLineDash([]);
    for (const [hk, q] of Object.entries(f.h)) { const x = P(...q); dot(ctx, x[0], x[1], hk.length === 1 ? hr * 0.78 : hr, hk.length === 1 ? '#e3f3f1' : '#fff'); }
    if (f.rot) {                                                  /* rotate handle: a teal knob on a stem, with a small turning arrow */
      const st = P(...f.stem), ro = P(...f.rot); ctx.beginPath(); ctx.moveTo(st[0], st[1]); ctx.lineTo(ro[0], ro[1]); ctx.stroke();
      dot(ctx, ro[0], ro[1], hr + 1.5 * k, TEAL);
      ctx.strokeStyle = '#fff'; ctx.lineWidth = 1.5 * k; ctx.beginPath(); ctx.arc(ro[0], ro[1], hr * 0.5, -Math.PI * 0.9, Math.PI * 0.4); ctx.stroke();
    }
    ctx.restore();
  }
  M.on('select-refresh', () => {
    sel.ids = sel.ids.filter(id => byId(id)); if (!sel.ids.length) sel.page = 0;
    if (crop && !(byId(crop.id) && sel.ids.includes(crop.id))) crop = null;
    updateBar(); const pg = M.page(sel.page || 1); if (pg) M.paint(pg);
  });
  /* desktop: the cursor tells what a press will do */
  addEventListener('pointermove', e => {
    if (e.pointerType !== 'mouse' || e.buttons || S.tool !== 'lasso' || drag) return;
    const c = e.target && e.target.closest && e.target.closest('canvas.ink'); if (!c) return;
    const pg = [...S.pages.values()].find(x => x.ink === c); if (!pg) return;
    let cur = '';
    if (sel.page === pg.n && sel.ids.length && !crop) {
      const r = c.getBoundingClientRect(), x = pg.ext, p = [(e.clientX - r.left) / r.width * (1 + x.l + x.r) - x.l, (e.clientY - r.top) / r.height * (1 + x.t + x.b) - x.t], f = frame(pg);
      if (f) { const h = handleAt(pg, f, p, hitR(e)); cur = h === 'rot' ? 'grab' : h === 'nw' || h === 'se' ? 'nwse-resize' : h === 'ne' || h === 'sw' ? 'nesw-resize' : h === 'n' || h === 's' ? 'ns-resize' : h === 'e' || h === 'w' ? 'ew-resize' : inside([f.x0, f.y0, f.x1, f.y1], p) ? 'move' : ''; }
    }
    if (c.style.cursor !== cur) c.style.cursor = cur;
  }, { passive: true });

  /* ----- actions ----- */
  function del() { const ids = sel.ids.slice(); if (!ids.length) return 0; const ops = M.removeItems(ids); clearSel(); return record(ops); }   /* pictures stay in IndexedDB, so undo brings them back */
  /* new copies of `list` on page n, shifted by `off`; one history step; the copies become the selection */
  function place(list, n, off) {
    const pg = M.page(n); if (!pg || !list.length) return [];
    const K = M.aspect(n), m = Object.assign({ dx: off, dy: off }, bounds(pg)), ops = [], ids = [];
    for (const src of list) {
      let s = JSON.parse(JSON.stringify(src)); s.page = n;
      if (s.tool === 'image' && s.k && Math.abs(s.k - K) > 1e-6) { s.h = Math.min(10, s.h * s.k / K); s.k = K; }   /* same picture proportions on a page of another shape */
      s = Object.assign(s, C.transformStroke(s, m), { id: C.newId(), rev: 1 });
      if (!C.validStroke(s)) continue;
      ops.push(M.addItem(s)); ids.push(s.id);
    }
    if (!ops.length) return [];
    M.commit(ops); select(ids, n); return ids;
  }
  function duplicate() { return place(selItems().filter(movable), sel.page, 0.02); }   /* a picture copy keeps the same asset id */
  let clip = null;                                               /* internal clipboard (this tab only) */
  function copy() {
    const list = selItems().filter(movable); if (!list.length) return 0;
    clip = { items: JSON.parse(JSON.stringify(list)), n: 0 }; updateBar(); return list.length;
  }
  function currentPage() { const R = M.reader, n = R && R.current ? R.current() : sel.page; return M.page(n) ? n : sel.page || [...S.pages.keys()][0]; }
  function paste(page) {
    if (!clip || !clip.items.length) return [];
    clip.n++; return place(clip.items, page || currentPage(), 0.02 * clip.n);
  }
  /* z-order: the whole selection to the top / bottom of the drawing order, keeping its own order; one step */
  function zorder(top) {
    const list = selItems().sort((a, b) => S.items.indexOf(a) - S.items.indexOf(b)); if (!list.length) return 0;
    const ops = [];
    if (top) for (const s of list) { const o = M.reorder(s.id, S.items.length - 1); if (o) ops.push(o); }
    else for (const s of list.reverse()) { const o = M.reorder(s.id, 0); if (o) ops.push(o); }
    return record(ops);
  }
  /* Restyle every selected item that supports the property: texthl colour/opacity, pictures opacity, ink and shapes
     colour/width, text colour. One history step; returns the number of items changed. */
  const canDash = s => s.tool === 'pen' || C.SHAPES.includes(s.tool);
  function styleProps(s, props) {
    const p = {};
    if (typeof props.color === 'string' && HEX6.test(props.color) && canColor(s) && s.color !== props.color) p.color = props.color;
    if (typeof props.width === 'number' && props.width > 0 && canWidth(s)) { const w = Math.min(40, props.width); if (s.width !== w) p.width = w; }
    if (typeof props.op === 'number' && Number.isFinite(props.op) && (canOp(s) || s.tool === 'pen' || C.SHAPES.includes(s.tool))) { const o = Math.round(C.clamp(props.op, 0.1, 1) * 100) / 100; if ((s.op || defOp(s)) !== o) p.op = o; }
    if (typeof props.dash === 'string' && (C.DASHES || ['solid', 'dashed', 'dotted']).includes(props.dash) && canDash(s)) { const d = props.dash === 'solid' ? null : props.dash; if ((s.dash || null) !== d) p.dash = d; }
    return Object.keys(p).length ? p : null;
  }
  let preview = null;                                            /* a slider being dragged: originals, so release is one step */
  function applyStyle(props) {
    endPreview(); if (!props || !sel.ids.length) return 0;
    return record(editOps(selItems(), s => styleProps(s, props)));
  }
  function previewStyle(props) {
    if (!preview) preview = new Map(selItems().map(s => [s.id, s]));
    const pages = new Set();
    for (const [id, s] of preview) { const i = S.items.findIndex(x => x && x.id === id); if (i < 0) continue; S.items[i] = Object.assign({}, s, styleProps(s, props) || {}); pages.add(s.page); }
    pages.forEach(n => M.invalidate(n));
  }
  function endPreview() {
    if (!preview) return;
    for (const [id, s] of preview) { const i = S.items.findIndex(x => x && x.id === id); if (i >= 0) S.items[i] = s; }
    preview = null; if (sel.page) M.rebuildIndexPage(sel.page);
  }
  function nudge(dx, dy) {
    const pg = M.page(sel.page); if (!pg || !sel.ids.length) return 0;
    const m = Object.assign({ dx: dx / pg.cssW, dy: dy / pg.cssH }, bounds(pg));
    return record(editOps(selItems().filter(movable), s => { const t = C.transformStroke(s, m); delete t.rev; return t; }));
  }

  /* =============================== pictures =============================== */
  const oneImage = () => { const l = selItems(); return l.length === 1 && l[0].tool === 'image' ? l[0] : null; };
  const centreOf = s => [s.points[0][0] + s.w / 2, s.points[0][1] + s.h / 2];
  /* the picture's own frame (rotated with it): (a, b) in 0..1 of its box <-> page point */
  const toPage = (s, a, b) => { const q = [s.points[0][0] + a * s.w, s.points[0][1] + b * s.h]; return s.rot ? C.rotateIso(q, centreOf(s), s.rot, s.k) : q; };
  const toLocal = (s, p) => { const q = s.rot ? C.rotateIso(p, centreOf(s), -s.rot, s.k) : p; return [(q[0] - s.points[0][0]) / s.w, (q[1] - s.points[0][1]) / s.h]; };
  function flip(axis) {
    const one = oneImage();
    if (one) { const f = axis === 'y' ? 'fy' : 'fx'; return record(editOps([one], x => ({ [f]: !x[f] }))); }
    const items = selItems().filter(movable), pg = sel.page && M.page(sel.page);
    if (!items.length || !pg) return 0;
    const b = boxOf(items), cx = (b[0] + b[2]) / 2, cy = (b[1] + b[3]) / 2;
    const m = Object.assign({ sx: axis === 'x' ? -1 : 1, sy: axis === 'y' ? -1 : 1, cx, cy }, bounds(pg));
    return record(editOps(items, x => {
      if (x.tool === 'image') { const f = axis === 'y' ? 'fy' : 'fx', t = C.transformStroke(x, m); delete t.rev; t[f] = !x[f]; return t; }
      const t = C.transformStroke(x, m); delete t.rev; return t;
    }));
  }
  function rotate90() {
    const one = oneImage();
    if (one) {
      const pg = M.page(one.page); if (!pg) return 0;
      const c = centreOf(one), m = Object.assign({ rot: Math.PI / 2, cx: c[0], cy: c[1], k: M.aspect(one.page) }, bounds(pg));
      return record(editOps([one], x => { const t = C.transformStroke(x, m); delete t.rev; return t; }));
    }
    const items = selItems().filter(movable), pg = sel.page && M.page(sel.page);
    if (!items.length || !pg) return 0;
    const b = boxOf(items), c = [(b[0] + b[2]) / 2, (b[1] + b[3]) / 2];
    const m = Object.assign({ rot: Math.PI / 2, cx: c[0], cy: c[1], k: M.aspect(sel.page) }, bounds(pg));
    return record(editOps(items, x => { const t = C.transformStroke(x, m); delete t.rev; return t; }));
  }
  function cut() { if (!copy()) return 0; return del(); }
  function selectAll(page) {
    const n = page || currentPage(), list = S.items.filter(s => s && s.page === n && types[kind(s)] && C.validStroke(s));
    if (!list.length) return 0;
    return select(list.map(s => s.id), n);
  }
  /* Crop: r = the part of the box to keep, in the picture's own frame. The kept part stays exactly where it was; the
     stored crop is in fractions of the source bitmap, through the flips (drawImageItem mirrors inside the box). */
  const CROP_MIN = 0.05;
  function cropStart() { const s = oneImage(); if (!s) return false; crop = { id: s.id, r: [0, 0, 1, 1] }; M.paint(M.page(s.page)); updateBar(); return true; }
  function cropCancel() { if (!crop) return; const s = byId(crop.id); crop = null; if (s) M.paint(M.page(s.page)); updateBar(); }
  function cropProps(s, r) {
    const c = s.crop || [0, 0, 1, 1], cw = c[2] - c[0], ch = c[3] - c[1];
    const [a0, b0, a1, b1] = r, x0 = c[0] + (s.fx ? 1 - a1 : a0) * cw, x1 = c[0] + (s.fx ? 1 - a0 : a1) * cw, y0 = c[1] + (s.fy ? 1 - b1 : b0) * ch, y1 = c[1] + (s.fy ? 1 - b0 : b1) * ch;
    const w = (a1 - a0) * s.w, h = (b1 - b0) * s.h, m = toPage(s, (a0 + a1) / 2, (b0 + b1) / 2);
    const nc = [x0, y0, x1, y1].map(v => Math.round(C.clamp01(v) * 1e6) / 1e6);
    const full = nc[0] <= 1e-6 && nc[1] <= 1e-6 && nc[2] >= 1 - 1e-6 && nc[3] >= 1 - 1e-6;
    return { crop: full ? null : nc, w, h, points: [[m[0] - w / 2, m[1] - h / 2]] };
  }
  function cropApply(r) {
    if (!crop) return 0; const s = byId(crop.id); r = r || crop.r; crop = null;
    if (!s || (r[0] <= 0 && r[1] <= 0 && r[2] >= 1 && r[3] >= 1)) { if (s) M.paint(M.page(s.page)); updateBar(); return 0; }
    return record(editOps([s], x => cropProps(x, r)));
  }
  /* the whole picture again: the box grows around the part that was visible, at the same scale */
  function uncrop() {
    const s = oneImage(); if (!s || !s.crop) return 0;
    const c = s.crop, cw = c[2] - c[0], ch = c[3] - c[1];
    return record(editOps([s], x => {
      const W = Math.min(10, x.w / cw), H = Math.min(10, x.h / ch), a0 = x.fx ? 1 - c[2] : c[0], a1 = x.fx ? 1 - c[0] : c[2], b0 = x.fy ? 1 - c[3] : c[1], b1 = x.fy ? 1 - c[1] : c[3];
      const ctr = centreOf(x), off = [((0.5 - (a0 + a1) / 2) * W), ((0.5 - (b0 + b1) / 2) * H)], q = [ctr[0] + off[0], ctr[1] + off[1]], m = x.rot ? C.rotateIso(q, ctr, x.rot, x.k) : q;
      return { crop: null, w: W, h: H, points: [[m[0] - W / 2, m[1] - H / 2]] };
    }));
  }
  function cropDown(pg, e, p) {
    const s = byId(crop.id); if (!s || s.page !== pg.n) return false;
    const r = crop.r, cs = { nw: [r[0], r[1]], ne: [r[2], r[1]], sw: [r[0], r[3]], se: [r[2], r[3]] }, R = hitR(e);
    let h = null, bd = R; for (const [k, q] of Object.entries(cs)) { const d = dpx(pg, toPage(s, q[0], q[1]), p); if (d <= bd) { bd = d; h = k; } }
    const q = toLocal(s, p);
    if (!h && !(q[0] >= r[0] && q[0] <= r[2] && q[1] >= r[1] && q[1] <= r[3])) return false;
    drag = { mode: 'crop', page: pg.n, h: h || 'move', start: q, r0: r.slice() };
  }
  function cropMove(pg, p) {
    const s = byId(crop.id); if (!s) return;
    const q = toLocal(s, p), D = drag, r0 = D.r0, r = r0.slice(), cl = C.clamp01, c = s.crop || [0, 0, 1, 1];
    const mw = Math.max(CROP_MIN, 0.015 / (c[2] - c[0])), mh = Math.max(CROP_MIN, 0.015 / (c[3] - c[1]));   /* stored crop stays > 1 % of the bitmap */
    if (D.h === 'move') { const dx = C.clamp(q[0] - D.start[0], -r0[0], 1 - r0[2]), dy = C.clamp(q[1] - D.start[1], -r0[1], 1 - r0[3]); r[0] += dx; r[2] += dx; r[1] += dy; r[3] += dy; }
    else {
      if (D.h.includes('w')) r[0] = C.clamp(cl(q[0]), 0, r[2] - mw); else r[2] = C.clamp(cl(q[0]), r[0] + mw, 1);
      if (D.h.includes('n')) r[1] = C.clamp(cl(q[1]), 0, r[3] - mh); else r[3] = C.clamp(cl(q[1]), r[1] + mh, 1);
    }
    crop.r = r; M.paint(pg);
  }
  function drawCrop(pg, ctx, k, P) {
    const s = byId(crop.id); if (!s || s.page !== pg.n) return;
    const r = crop.r, poly = (a0, b0, a1, b1) => [[a0, b0], [a1, b0], [a1, b1], [a0, b1]].map(q => P(...toPage(s, q[0], q[1])));
    const full = poly(0, 0, 1, 1), keep = poly(r[0], r[1], r[2], r[3]), path = pts => { pts.forEach((q, i) => i ? ctx.lineTo(q[0], q[1]) : ctx.moveTo(q[0], q[1])); ctx.closePath(); };
    ctx.save(); ctx.beginPath(); path(full); path(keep); ctx.fillStyle = 'rgba(18,44,71,.55)'; ctx.fill('evenodd');
    ctx.beginPath(); path(keep); ctx.lineWidth = 2 * k; ctx.strokeStyle = '#fff'; ctx.stroke(); ctx.setLineDash([5 * k, 4 * k]); ctx.strokeStyle = TEAL; ctx.stroke(); ctx.setLineDash([]);
    ctx.strokeStyle = TEAL; ctx.lineWidth = 1.6 * k; for (const q of keep) dot(ctx, q[0], q[1], (TOUCH ? 9 : 7) * k, '#fff');
    ctx.restore();
  }
  /* insert: stored once in IndexedDB (studio-assets), the annotation only names the asset */
  function visiblePage() { const n = currentPage(); return M.page(n) ? n : 0; }
  function viewCentre(pg) {
    const r = pg.ink.getBoundingClientRect(), x0 = Math.max(r.left, 0), x1 = Math.min(r.right, innerWidth), y0 = Math.max(r.top, 0), y1 = Math.min(r.bottom, innerHeight);
    if (r.width < 2 || x1 <= x0 || y1 <= y0) return [0.5, 0.5];
    const e = pg.ext; return [C.clamp01(((x0 + x1) / 2 - r.left) / r.width * (1 + e.l + e.r) - e.l), C.clamp01(((y0 + y1) / 2 - r.top) / r.height * (1 + e.t + e.b) - e.t)];
  }
  const ok = () => {};
  async function insert(file, opts) {
    opts = opts || {};
    const A = window.MedixaAssets;
    if (!A || typeof A.put !== 'function') { M.banner('إدراج الصور غير متاح الآن.', [['حسناً', ok]]); return null; }
    if (!file) return null;
    let rec; const was = S.state; M.setState('editing');           /* re-encoding a large photo takes a moment on an iPad */
    try { rec = await A.put(file); } catch (e) { M.setState(was); M.banner(e && e.code && e.message ? e.message : 'تعذّر إدراج الصورة. حاول مرة أخرى.', [['حسناً', ok]]); return null; }
    if (S.state === 'editing') M.setState(was);
    const n = opts.page && M.page(opts.page) ? opts.page : visiblePage(), pg = M.page(n); if (!pg || !rec || !(rec.w > 0 && rec.h > 0)) return null;
    const K = M.aspect(n), ar = rec.h / rec.w;                   /* page fractions: h = (pixel h / w) * w / (page h / w) */
    const w = Math.min(0.5, 0.9 * K / ar), h = ar * w / K, c = opts.at || viewCentre(pg);
    const s = { id: C.newId(), v: 2, rev: 1, page: n, tool: 'image', asset: rec.id, points: [[C.clamp(c[0] - w / 2, 0, 1 - w), C.clamp(c[1] - h / 2, 0, 1 - h)]], w, h, k: K, rot: 0, op: 1 };
    if (!C.validStroke(s)) return null;
    M.commit([M.addItem(s)]); select([s.id], n);
    return s;
  }
  let picker = null;
  function pick() {
    if (!picker) {
      picker = document.createElement('input'); picker.type = 'file'; picker.accept = 'image/jpeg,image/png,image/webp'; picker.id = 'studio-image-input';
      picker.tabIndex = -1; picker.setAttribute('aria-hidden', 'true');   /* off-screen, not display:none: older iOS Safari will not open a hidden file input */
      picker.style.cssText = 'position:fixed;left:-9999px;top:0;width:1px;height:1px;opacity:0;pointer-events:none';
      picker.addEventListener('change', () => { const f = picker.files && picker.files[0]; picker.value = ''; if (f) insert(f); });
      document.body.append(picker);
    }
    picker.click();
  }
  const imageIn = dt => { if (!dt) return null; for (const f of dt.files || []) if (/^image\//.test(f.type)) return f; for (const it of dt.items || []) if (it.kind === 'file' && /^image\//.test(it.type)) { const f = it.getAsFile(); if (f) return f; } return null; };
  /* Ctrl/Cmd+V: an image on the system clipboard is inserted; otherwise the internal clipboard is pasted. Safari fires
     no paste event outside editable fields, so the keydown arms a fallback that the paste event cancels. */
  let pastePending = false;
  document.addEventListener('paste', e => {
    if (inField(e.target)) return;
    const f = imageIn(e.clipboardData);
    if (f) { e.preventDefault(); pastePending = false; insert(f); return; }
    if (pastePending && clip) { e.preventDefault(); pastePending = false; paste(); }
  });
  const pageAt = t => [...S.pages.values()].find(x => x.wrap && x.wrap.contains(t));
  document.addEventListener('dragover', e => {
    if (!e.target.closest || !e.target.closest('#pages') || !e.dataTransfer || ![...(e.dataTransfer.types || [])].includes('Files')) return;
    e.preventDefault(); e.dataTransfer.dropEffect = 'copy';
  });
  document.addEventListener('drop', e => {
    if (!e.target.closest || !e.target.closest('#pages') || !e.dataTransfer) return;
    const f = [...(e.dataTransfer.files || [])][0]; if (!f) return;
    e.preventDefault();
    const pg = pageAt(e.target); let at = null;
    if (pg) { const r = pg.ink.getBoundingClientRect(), x = pg.ext; if (r.width > 1) at = [C.clamp01((e.clientX - r.left) / r.width * (1 + x.l + x.r) - x.l), C.clamp01((e.clientY - r.top) / r.height * (1 + x.t + x.b) - x.t)]; }
    insert(f, { page: pg && pg.n, at });
  });

  /* =============================== selection bar =============================== */
  const SWATCHES = [['#e43d56', 'أحمر'], ['#2f6fed', 'أزرق'], ['#168c8c', 'تركوازي'], ['#f2c230', 'أصفر']];
  const IC = {
    free: '<path d="M7 22a5 5 0 0 1-2-4"/><path d="M3.3 14A6.8 6.8 0 0 1 2 10c0-4.4 4.5-8 10-8s10 3.6 10 8-4.5 8-10 8a12 12 0 0 1-5-1"/><circle cx="5" cy="16" r="2"/>',
    rect: '<rect x="3.5" y="5" width="17" height="14" rx="1.5" stroke-dasharray="3 2.6"/>',
    copy: '<rect x="9" y="9" width="11" height="11" rx="2"/><path d="M5 15V6a2 2 0 0 1 2-2h8"/>',
    paste: '<rect x="5" y="4" width="14" height="17" rx="2"/><path d="M9 4V2.8h6V4"/><path d="M9 11h6M9 15h4"/>',
    dup: '<rect x="8" y="8" width="12" height="12" rx="2"/><path d="M4 16V6a2 2 0 0 1 2-2h10"/><path d="M14 11v6M11 14h6"/>',
    front: '<rect x="3" y="3" width="11" height="11" rx="1.5"/><rect x="9" y="9" width="12" height="12" rx="1.5" fill="currentColor" fill-opacity=".28"/>',
    back: '<rect x="9" y="9" width="12" height="12" rx="1.5"/><rect x="3" y="3" width="11" height="11" rx="1.5" fill="currentColor" fill-opacity=".28"/>',
    del: '<path d="M4 7h16"/><path d="M10 11v6M14 11v6"/><path d="M6 7l1 13h10l1-13"/><path d="M9 7V4h6v3"/>',
    clear: '<path d="M6 6l12 12M18 6 6 18"/>',
    fx: '<path d="M12 3v18"/><path d="M8 7 3 12l5 5z"/><path d="m16 7 5 5-5 5z"/>',
    fy: '<path d="M3 12h18"/><path d="M7 8l5-5 5 5z"/><path d="m7 16 5 5 5-5z"/>',
    rot: '<path d="M20 11a8 8 0 1 0-2.3 5.7"/><path d="M20 4v7h-7"/>',
    crop: '<path d="M6 2v14a2 2 0 0 0 2 2h14"/><path d="M18 22V8a2 2 0 0 0-2-2H2"/>',
    full: '<path d="M4 9V4h5M20 9V4h-5M4 15v5h5M20 15v5h-5"/>',
    done: '<path d="m5 12 5 5 9-10"/>'
  };
  let bar = null;
  const B = {};
  function ensureBar() {
    if (bar) return bar;
    bar = document.createElement('div'); bar.id = 'studio-selbar'; bar.setAttribute('role', 'toolbar'); bar.setAttribute('aria-label', 'إجراءات التحديد');
    const group = (cls, label) => { const g = document.createElement('div'); g.className = 'sel-g ' + cls; g.setAttribute('role', 'group'); g.setAttribute('aria-label', label); bar.append(g); return g; };
    const mk = (g, id, label, icon, fn, short) => {
      const b = document.createElement('button'); b.type = 'button'; b.id = id; b.className = 'sel-b'; b.title = label; b.setAttribute('aria-label', label);
      b.innerHTML = (icon ? svg(icon) : '') + '<span class="sel-l"></span>'; b.lastChild.textContent = short == null ? label : short; if (!b.lastChild.textContent) b.lastChild.remove();
      b.addEventListener('click', fn); g.append(b); return b;
    };
    const gm = B.mode = group('sel-mode', 'طريقة التحديد');
    B.free = mk(gm, 'sel-mode-free', 'تحديد حر', IC.free, () => setMode('free'), 'حر');
    B.rect = mk(gm, 'sel-mode-rect', 'تحديد بمستطيل', IC.rect, () => setMode('rect'), 'مستطيل');
    const ga = B.acts = group('sel-acts', 'إجراءات');
    B.copy = mk(ga, 'sel-copy', 'نسخ', IC.copy, () => copy());
    B.cut = mk(ga, 'sel-cut', 'قص', '<circle cx="6" cy="6" r="3"/><circle cx="6" cy="18" r="3"/><path d="M20 4 8.12 15.88M14.47 14.48 20 20M8.12 8.12 12 12"/>', () => cut());
    B.paste = mk(ga, 'sel-paste', 'لصق', IC.paste, () => paste());
    B.dup = mk(ga, 'sel-dup', 'تكرار', IC.dup, () => duplicate());
    B.rotAny = mk(ga, 'sel-rot-any', 'تدوير 90°', IC.rot, () => rotate90(), '90°');
    B.fliphAny = mk(ga, 'sel-fliph-any', 'قلب أفقي', IC.fx, () => flip('x'), '');
    B.front = mk(ga, 'sel-front', 'إلى الأمام', IC.front, () => zorder(true));
    B.back = mk(ga, 'sel-back', 'إلى الخلف', IC.back, () => zorder(false));
    B.del = mk(ga, 'sel-del', 'حذف', IC.del, () => del());
    const gi = B.img = group('sel-img', 'الصورة');
    mk(gi, 'sel-fliph', 'قلب أفقي', IC.fx, () => flip('x'));
    mk(gi, 'sel-flipv', 'قلب عمودي', IC.fy, () => flip('y'));
    mk(gi, 'sel-rot90', 'تدوير 90°', IC.rot, () => rotate90(), 'تدوير \u206690°\u2069');
    mk(gi, 'sel-crop', 'قص الصورة', IC.crop, () => cropStart(), 'قص');
    B.uncrop = mk(gi, 'sel-uncrop', 'إعادة الصورة كاملة', IC.full, () => uncrop(), 'الصورة كاملة');
    const gc = B.crop = group('sel-cropping', 'قص الصورة');
    const hint = document.createElement('span'); hint.className = 'sel-hint'; hint.textContent = 'اسحب الزوايا لاختيار الجزء الظاهر'; gc.append(hint);
    mk(gc, 'sel-crop-ok', 'تطبيق القص', IC.done, () => cropApply(), 'تم');
    mk(gc, 'sel-crop-cancel', 'إلغاء القص', IC.clear, () => cropCancel(), 'إلغاء');
    const gs = B.style = group('sel-style', 'تنسيق المحدد');
    B.colors = document.createElement('div'); B.colors.className = 'sel-colors'; gs.append(B.colors);
    for (const [c, n] of SWATCHES) { const b = document.createElement('button'); b.type = 'button'; b.className = 'sel-sw'; b.dataset.color = c; b.title = n; b.setAttribute('aria-label', 'اللون ' + n); b.style.setProperty('--sw', c); b.addEventListener('click', () => applyStyle({ color: c })); B.colors.append(b); }
    const cl = document.createElement('label'); cl.className = 'sel-custom'; cl.title = 'لون آخر';
    B.color = document.createElement('input'); B.color.type = 'color'; B.color.id = 'sel-color'; B.color.value = '#e43d56'; B.color.setAttribute('aria-label', 'لون آخر للمحدد');
    B.color.addEventListener('input', () => previewStyle({ color: B.color.value })); B.color.addEventListener('change', () => applyStyle({ color: B.color.value }));
    cl.append(B.color); B.colors.append(cl);
    const range = (id, label, min, max, step, toProps) => {
      const l = document.createElement('label'); l.className = 'sel-range'; const t = document.createElement('span'); t.textContent = label;
      const i = document.createElement('input'); i.type = 'range'; i.id = id; i.min = min; i.max = max; i.step = step; i.setAttribute('aria-label', label);
      i.addEventListener('input', () => previewStyle(toProps(+i.value))); i.addEventListener('change', () => applyStyle(toProps(+i.value)));
      l.append(t, i); gs.append(l); return l;
    };
    B.widthL = range('sel-width', 'السُمك', 1, 20, 0.5, v => ({ width: v })); B.width = B.widthL.querySelector('input');
    B.opL = range('sel-op', 'الشفافية', 10, 100, 5, v => ({ op: v / 100 })); B.op = B.opL.querySelector('input');
    const t = B.types = group('st-types', 'أنواع قابلة للتحديد');
    for (const [k, label] of [['ink', 'رسم'], ['shape', 'أشكال'], ['text', 'نصوص'], ['img', 'صور'], ['hl', 'تظليل النص']]) {
      const l = document.createElement('label'), c = document.createElement('input'); c.type = 'checkbox'; c.checked = types[k]; c.dataset.type = k;
      c.onchange = () => { types[k] = c.checked; try { localStorage.setItem('medixa.studio.lasso.v1', JSON.stringify(types)); } catch {} };
      l.append(c, ' ' + label); t.append(l);
    }
    B.clear = mk(bar, 'sel-clear', 'إلغاء التحديد', IC.clear, () => clearSel(), '');
    document.body.append(bar); return bar;
  }
  function updateBar() {
    const b = ensureBar(), items = selItems(), has = items.length > 0;
    b.classList.toggle('open', S.tool === 'lasso' || has); b.classList.toggle('has-sel', has); b.classList.toggle('cropping', !!crop);
    for (const [m, el] of [['free', B.free], ['rect', B.rect]]) el.setAttribute('aria-pressed', String(selMode === m));
    for (const c of B.types.querySelectorAll('input')) c.checked = !!types[c.dataset.type];
    const img = oneImage(), mov = items.some(movable);
    B.mode.hidden = has || !!crop; B.style.hidden = !has || !!crop; B.acts.hidden = !!crop || !(has || (clip && clip.items.length));
    B.colors.hidden = !items.some(canColor); B.widthL.hidden = !items.some(canWidth); B.opL.hidden = !items.some(canOp);
    for (const el of [B.copy, B.cut, B.dup, B.front, B.back]) if (el) el.hidden = !mov;
    if (B.rotAny) B.rotAny.hidden = !mov || !!img;
    if (B.fliphAny) B.fliphAny.hidden = !mov || !!img;
    B.del.hidden = !has; B.paste.hidden = !(clip && clip.items.length);
    B.img.hidden = !img || !!crop; B.uncrop.hidden = !(img && img.crop); B.crop.hidden = !crop;
    B.types.hidden = has; B.clear.hidden = !has || !!crop;
    if (has && !preview) {                                       /* sliders and swatches show the first item's look */
      const f = items[0], w = items.find(canWidth), o = items.find(canOp);
      if (w) B.width.value = w.width || 3; if (o) B.op.value = Math.round((o.op || defOp(o)) * 100);
      if (f.color && HEX6.test(f.color)) B.color.value = f.color;
      for (const sw of B.colors.querySelectorAll('.sel-sw')) sw.setAttribute('aria-pressed', String(!!f.color && sw.dataset.color.toLowerCase() === f.color.toLowerCase()));
    }
    placeSelBar();
  }
  function placeSelBar() {
    if (!bar || !bar.classList.contains('open')) return;
    if (matchMedia('(max-width: 720px)').matches || !sel.ids.length || !sel.page) {
      bar.style.top = ''; bar.style.left = ''; bar.style.right = ''; bar.style.marginInline = '';
      return;
    }
    const pg = M.page(sel.page); if (!pg || !pg.ink) return;
    const f = frame(pg), r = pg.ink.getBoundingClientRect();
    if (!f || r.width < 2) return;
    const kx = 1 + pg.ext.l + pg.ext.r, ky = 1 + pg.ext.t + pg.ext.b;
    const sx = u => r.left + (u + pg.ext.l) / kx * r.width;
    const sy = v => r.top + (v + pg.ext.t) / ky * r.height;
    const topV = f.rot ? Math.min(f.y0, f.rot[1]) : f.y0, botV = f.rot ? Math.max(f.y1, f.rot[1]) : f.y1;
    const boxTop = sy(topV), boxBot = sy(botV), boxCx = (sx(f.x0) + sx(f.x1)) / 2;
    const bw = bar.offsetWidth || 420, bh = bar.offsetHeight || 52;
    const minTop = document.body.classList.contains('st-compact') ? 74 : 124, maxBot = innerHeight - 76;
    let y = boxTop - bh - 14;
    if (y < minTop) y = boxBot + 14;
    if (y + bh > maxBot) y = Math.max(minTop, Math.min(maxBot - bh, boxTop + 12));
    const x = Math.max(12, Math.min(innerWidth - bw - 12, Math.round(boxCx - bw / 2)));
    bar.style.top = Math.round(y) + 'px';
    bar.style.left = x + 'px';
    bar.style.right = 'auto';
    bar.style.marginInline = '0';
  }
  addEventListener('scroll', () => { if (sel.ids.length && bar && bar.classList.contains('open')) placeSelBar(); }, { passive: true, capture: true });
  function setMode(m) {
    selMode = m === 'rect' ? 'rect' : 'free';
    try { localStorage.setItem(MODE_KEY, selMode); } catch {}
    if (S.tool !== 'lasso') M.setTool('lasso'); updateBar(); return selMode;
  }
  addEventListener('keydown', e => {
    if (inField(e.target)) return;
    const mod = e.ctrlKey || e.metaKey, key = (e.key || '').toLowerCase();
    if (mod && key === 'v' && clip && clip.items.length) { pastePending = true; setTimeout(() => { if (pastePending) { pastePending = false; paste(); } }, 0); return; }
    if (S.tool !== 'lasso' && !sel.ids.length) return;
    const textSel = () => { const t = window.getSelection && String(window.getSelection() || ''); return !!t; };
    if (mod && key === 'c') { if (sel.ids.length && !textSel()) { e.preventDefault(); copy(); } return; }
    if (mod) return;
    const step = e.shiftKey ? 10 : 1;
    if (e.key === 'Escape') { if (crop) cropCancel(); else { clearSel(); closeEditor(true); } }
    else if (e.key === 'Enter' && crop) { e.preventDefault(); cropApply(); }
    else if (crop) return;
    else if (e.key === 'Delete' || e.key === 'Backspace') { if (sel.ids.length) { e.preventDefault(); del(); } }
    else if (sel.ids.length && e.key === 'ArrowLeft') { e.preventDefault(); nudge(-step, 0); }
    else if (sel.ids.length && e.key === 'ArrowRight') { e.preventDefault(); nudge(step, 0); }
    else if (sel.ids.length && e.key === 'ArrowUp') { e.preventDefault(); nudge(0, -step); }
    else if (sel.ids.length && e.key === 'ArrowDown') { e.preventDefault(); nudge(0, step); }
  });
  M.on('tool', t => {
    if (t !== 'lasso') { if (drag && drag.orig) { const pg = M.page(drag.page); if (pg) finishTransform(pg, true); } drag = null; crop = null; if (sel.ids.length) clearSel(); }
    updateBar(); if (t !== 'text' && t !== 'sticky') closeEditor(false);
  });

  /* =============================== text + sticky notes =============================== */
  let editor = null;
  const FILLS = ['#fff3a3', '#cdeff0', '#ffd9de', '#dcf3c6'];
  const TSIZES = [12, 14, 16, 18, 20, 24, 28, 32, 36, 40];
  function textAt(pg, p) {
    const list = S.items.filter(s => s && s.page === pg.n && (s.tool === 'text' || s.tool === 'sticky') && C.validStroke(s));
    for (let i = list.length - 1; i >= 0; i--) { const b = C.bounds(list[i]); if (inside(b, p)) return list[i]; }
    return null;
  }
  function closeEditor(cancel) {
    if (!editor) return;
    const ed = editor; editor = null;
    if (!cancel && ed.commit) ed.commit();
    ed.el.remove();
  }
  function openEditor(pg, p, tool, existing) {
    closeEditor(false);
    const el = document.createElement('div'); el.className = 'st-editor'; el.dataset.kind = tool;
    const ta = document.createElement('textarea'); ta.maxLength = C.LIMITS.text; ta.dir = 'auto'; ta.rows = 3; ta.setAttribute('aria-label', tool === 'sticky' ? 'نص الملاحظة اللاصقة' : 'نص التعليق'); ta.value = existing ? existing.text : '';
    const w = existing ? existing.w : 0.28, def = M.style('text') || {};
    /* look of the note: its own values, or the text tool's current style for a new one (older notes: defaults) */
    const look = existing ? { size: existing.size || 18, bold: !!existing.bold, italic: !!existing.italic, color: existing.color || '#18334b' }
      : { size: C.clamp(def.size || 18, 6, 96), bold: !!def.bold, italic: !!def.italic, color: HEX6.test(def.color || '') ? def.color : '#18334b' };
    const x0 = existing ? C.bounds(existing)[0] : C.clamp(p[0], -pg.ext.l, 1 + pg.ext.r - w), y0 = existing ? C.bounds(existing)[1] : C.clamp(p[1], -pg.ext.t, 0.9 + pg.ext.b);
    const kx = 1 + pg.ext.l + pg.ext.r, ky = 1 + pg.ext.t + pg.ext.b;
    el.style.left = ((x0 + pg.ext.l) / kx * 100) + '%'; el.style.top = ((y0 + pg.ext.t) / ky * 100) + '%'; el.style.width = (w / kx * 100) + '%';
    const restyle = () => { ta.style.fontSize = (look.size * pg.cssW / 800) + 'px'; ta.style.fontWeight = look.bold ? '700' : ''; ta.style.fontStyle = look.italic ? 'italic' : ''; ta.style.color = look.color; };
    /* style row: size, bold, italic, colour */
    const sr = document.createElement('div'); sr.className = 'st-editor-style'; sr.setAttribute('role', 'group'); sr.setAttribute('aria-label', 'تنسيق النص');
    const sz = document.createElement('select'); sz.className = 'st-ed-size'; sz.setAttribute('aria-label', 'حجم الخط');
    for (const v of [...new Set(TSIZES.concat(look.size))].sort((a, b) => a - b)) { const o = document.createElement('option'); o.value = v; o.textContent = v; sz.append(o); }
    sz.value = String(look.size); sz.addEventListener('change', () => { look.size = +sz.value; restyle(); });
    const tog = (cls, label, ch, prop) => {
      const b = document.createElement('button'); b.type = 'button'; b.className = 'st-ed-tog ' + cls; b.textContent = ch; b.setAttribute('aria-label', label); b.title = label; b.setAttribute('aria-pressed', String(look[prop]));
      b.addEventListener('click', () => { look[prop] = !look[prop]; b.setAttribute('aria-pressed', String(look[prop])); restyle(); }); return b;
    };
    const col = document.createElement('input'); col.type = 'color'; col.className = 'st-ed-color'; col.value = look.color; col.setAttribute('aria-label', 'لون النص'); col.title = 'لون النص';
    col.addEventListener('input', () => { look.color = col.value; restyle(); });
    sr.append(sz, tog('st-ed-b', 'عريض', 'B', 'bold'), tog('st-ed-i', 'مائل', 'I', 'italic'), col);
    restyle();
    const row = document.createElement('div'); row.className = 'st-editor-row';
    let fill = existing && existing.fill || FILLS[0];
    if (tool === 'sticky') for (const f of FILLS) { const b = document.createElement('button'); b.type = 'button'; b.className = 'st-fill'; b.dataset.fill = f; b.setAttribute('aria-label', 'لون الملاحظة'); b.style.background = f; b.onclick = () => { fill = f; ta.style.background = f; }; row.append(b); }
    if (tool === 'sticky') ta.style.background = fill;
    const okb = document.createElement('button'); okb.type = 'button'; okb.className = 'st-ok'; okb.textContent = 'حفظ'; okb.onclick = () => closeEditor(false);
    const cancel = document.createElement('button'); cancel.type = 'button'; cancel.textContent = 'إلغاء'; cancel.onclick = () => closeEditor(true);
    row.append(okb, cancel);
    if (existing) { const d = document.createElement('button'); d.type = 'button'; d.className = 'st-del'; d.textContent = 'حذف'; d.onclick = () => { editor = null; el.remove(); M.commit(M.removeItems([existing.id])); }; row.append(d); }
    el.append(sr, ta, row); pg.wrap.append(el);
    { const r = sr.getBoundingClientRect(), wr = pg.wrap.getBoundingClientRect(); let dx = 0;   /* a narrow note: the style row stays on one line, inside the page */
      if (r.right > wr.right) dx = wr.right - r.right; if (r.left + dx < wr.left) dx = wr.left - r.left; if (dx) sr.style.transform = 'translateX(' + Math.round(dx) + 'px)'; }
    ta.addEventListener('keydown', ev => { if (ev.key === 'Escape') { ev.stopPropagation(); closeEditor(true); } else if (ev.key === 'Enter' && (ev.ctrlKey || ev.metaKey)) { ev.preventDefault(); closeEditor(false); } });
    editor = { el, ta, pg, look, commit() {
      const text = ta.value.replace(/\s+$/g, '');
      if (existing) {
        const cur = byId(existing.id) || existing;
        if (!text) { M.commit(M.removeItems([existing.id])); return; }
        const props = {};
        if (text !== cur.text) props.text = text;
        if (tool === 'sticky' && fill !== cur.fill) props.fill = fill;
        if (look.size !== (cur.size || 18)) props.size = look.size;
        if (look.bold !== !!cur.bold) props.bold = look.bold;
        if (look.italic !== !!cur.italic) props.italic = look.italic;
        if (look.color !== (cur.color || '#18334b')) props.color = look.color;
        if (!Object.keys(props).length) return;
        record(editOps([cur], s => { props.h = M.fitTextHeight(Object.assign({}, s, props), pg); return props; }));
        return;
      }
      if (!text) return;
      const s = { id: C.newId(), v: 2, rev: 1, page: pg.n, tool, color: look.color, width: 3, text, size: look.size, w, h: 0.1, points: [[x0, y0]] };
      if (look.bold) s.bold = true; if (look.italic) s.italic = true;
      if (tool === 'sticky') s.fill = fill;
      s.h = M.fitTextHeight(s, pg); if (y0 + s.h > 1 + pg.ext.b) s.points = [[x0, Math.max(-pg.ext.t, 1 + pg.ext.b - s.h)]];
      M.commit([M.addItem(s)]);
      M.setStyle('text', { size: look.size, bold: look.bold, italic: look.italic, color: look.color });   /* the next note starts like this one */
    } };
    setTimeout(() => ta.focus({ preventScroll: true }), 0);
  }
  for (const t of ['text', 'sticky']) M.registerTool(t, {
    down(pg, e, p) {
      if (editor && editor.pg === pg && editor.el.contains(e.target)) return false;
      const hit = textAt(pg, p); openEditor(pg, p, hit ? hit.tool : t, hit);
      return false;
    }, move() {}, up() {}
  });
  /* double tap / double click on text with any tool reopens it for editing */
  addEventListener('dblclick', ev => {
    const c = ev.target.closest && ev.target.closest('canvas.ink'); if (!c) return;
    const pg = [...S.pages.values()].find(x => x.ink === c); if (!pg) return;
    const r = c.getBoundingClientRect(), x = pg.ext, p = [(ev.clientX - r.left) / r.width * (1 + x.l + x.r) - x.l, (ev.clientY - r.top) / r.height * (1 + x.t + x.b) - x.t], hit = textAt(pg, p);
    if (hit) openEditor(pg, p, hit.tool, hit);
  });

  /* =============================== Zoom Writing =============================== */
  const zw = { open: false, page: 1, mag: 3, dir: 1, cu: 0.1, cv: 0.2, prev: 'pen', live: null, strip: null, ctx: null, raf: 0 };
  zw.R = pg => {
    const sw = zw.strip ? zw.strip.getBoundingClientRect().width : 600, sh = zw.strip ? zw.strip.getBoundingClientRect().height : 150;
    const wU = Math.min(1 + pg.ext.l + pg.ext.r, (sw / zw.mag) / pg.cssW), hV = Math.min(1 + pg.ext.t + pg.ext.b, (sh / zw.mag) / pg.cssH);
    const e = pg.ext; return { u0: C.clamp(zw.cu, -e.l, 1 + e.r - wU), v0: C.clamp(zw.cv, -e.t, 1 + e.b - hV), wU, hV };
  };
  function zwBuild() {
    const el = document.createElement('section'); el.id = 'zw'; el.setAttribute('aria-label', 'الكتابة المكبرة'); el.hidden = true;
    el.innerHTML = '<div class="zw-head"><strong>الكتابة المكبرة</strong>' +
      '<label>التكبير <select id="zw-mag"><option value="2">×2</option><option value="3" selected>×3</option><option value="4">×4</option><option value="6">×6</option></select></label>' +
      '<label>الاتجاه <select id="zw-dir"><option value="1">من اليسار</option><option value="-1">من اليمين</option></select></label>' +
      '<button type="button" id="zw-left" aria-label="حرّك المنطقة لليسار">◀</button><button type="button" id="zw-right" aria-label="حرّك المنطقة لليمين">▶</button><button type="button" id="zw-up" aria-label="حرّك المنطقة للأعلى">▲</button><button type="button" id="zw-down" aria-label="حرّك المنطقة للأسفل">▼</button>' +
      '<button type="button" id="zw-newline">سطر جديد</button><button type="button" id="zw-close" aria-label="إغلاق الكتابة المكبرة">إغلاق</button></div><canvas id="zw-canvas" aria-label="مساحة الكتابة المكبرة"></canvas>';
    document.body.append(el);
    zw.el = el; zw.strip = el.querySelector('#zw-canvas'); zw.ctx = zw.strip.getContext('2d');
    el.querySelector('#zw-mag').onchange = e => { const R = zw.R(M.page(zw.page)), cu = R.u0 + R.wU / 2, cv = R.v0 + R.hV / 2; zw.mag = +e.target.value; zwRecentre(cu, cv); };
    el.querySelector('#zw-dir').onchange = e => { zw.dir = +e.target.value; };
    const mv = (du, dv) => () => { const R = zw.R(M.page(zw.page)); zw.cu = R.u0 + du * R.wU * 0.5; zw.cv = R.v0 + dv * R.hV * 0.5; zwSync(true); };
    el.querySelector('#zw-left').onclick = mv(-1, 0); el.querySelector('#zw-right').onclick = mv(1, 0); el.querySelector('#zw-up').onclick = mv(0, -1); el.querySelector('#zw-down').onclick = mv(0, 1);
    el.querySelector('#zw-newline').onclick = newLine; el.querySelector('#zw-close').onclick = zwClose;
    const c = zw.strip; c.style.touchAction = 'none';
    let drawing = null;
    const map = e => { const r = c.getBoundingClientRect(), R = zw.R(M.page(zw.page)); const su = C.clamp01((e.clientX - r.left) / r.width), sv = C.clamp01((e.clientY - r.top) / r.height), pe = M.page(zw.page).ext; return [C.clamp(R.u0 + su * R.wU, -pe.l, 1 + pe.r), C.clamp(R.v0 + sv * R.hV, -pe.t, 1 + pe.b), su]; };
    c.addEventListener('pointerdown', e => {
      if (drawing) return; if (S.penOnly && e.pointerType !== 'pen') return;
      e.preventDefault(); try { c.setPointerCapture(e.pointerId); } catch {}
      const m = map(e), tool = zw.prev === 'highlight' ? 'highlight' : 'pen';
      drawing = { id: e.pointerId, s: { id: C.newId(), v: 2, rev: 1, page: zw.page, tool, color: S.color, width: Math.max(0.5, S.width / zw.mag), points: [[m[0], m[1]]] }, lastSu: m[2] };
      if (e.pointerType === 'pen' && tool === 'pen') drawing.s.pr = [C.clamp01(e.pressure)];
      zw.live = drawing.s; zwDraw();
    });
    c.addEventListener('pointermove', e => {
      if (!drawing || drawing.id !== e.pointerId) return;
      for (const ev of ((e.getCoalescedEvents && e.getCoalescedEvents()) || [e])) { const m = map(ev), L = drawing.s, last = L.points[L.points.length - 1]; if (Math.hypot(m[0] - last[0], m[1] - last[1]) < 0.0004) continue; L.points.push([m[0], m[1]]); if (L.pr) L.pr.push(C.clamp01(ev.pressure)); drawing.lastSu = m[2]; }
      zwDraw();
    });
    const end = (e, cancel) => {
      if (!drawing || drawing.id !== e.pointerId) return; const d = drawing; drawing = null; zw.live = null;
      if (!cancel && d.s.points.length >= 1) { M.commit([M.addItem(d.s)]); autoAdvance(d.lastSu); }
      zwDraw();
    };
    c.addEventListener('pointerup', e => end(e, false)); c.addEventListener('pointercancel', e => end(e, true));
    new ResizeObserver(() => zwSync()).observe(c);
  }
  function zwRecentre(cu, cv) { const R = zw.R(M.page(zw.page)); zw.cu = cu - R.wU / 2; zw.cv = cv - R.hV / 2; zwSync(); }
  function zwSync(reveal) {
    if (!zw.open) return; const c = zw.strip, r = c.getBoundingClientRect(), d = DPR();
    if (c.width !== Math.round(r.width * d) || c.height !== Math.round(r.height * d)) { c.width = Math.round(r.width * d); c.height = Math.round(r.height * d); }
    const R = zw.R(M.page(zw.page)); zw.cu = R.u0; zw.cv = R.v0;
    zwDraw(); const pg = M.page(zw.page); M.paint(pg); if (reveal) zwReveal(pg, R);
  }
  /* Keep the target region visible above the strip. */
  function zwReveal(pg, R) {
    const r = pg.ink.getBoundingClientRect(), ky = 1 + pg.ext.t + pg.ext.b, top = r.top + (R.v0 + pg.ext.t) / ky * r.height, bottom = r.top + (R.v0 + R.hV + pg.ext.t) / ky * r.height, limit = innerHeight - (zw.el.getBoundingClientRect().height + 24);
    if (bottom > limit || top < 70) scrollBy(0, (bottom > limit ? bottom - limit : top - 90) + 0);
  }
  function zwDraw() {
    if (!zw.open || zw.raf) return;
    zw.raf = requestAnimationFrame(() => {
      zw.raf = 0; const pg = M.page(zw.page); if (!pg) return; const R = zw.R(pg), c = zw.strip, x = zw.ctx, W = c.width, H = c.height;
      x.fillStyle = '#fff'; x.fillRect(0, 0, W, H);
      const pdf = pg.wrap.querySelector('canvas.pdf');
      if (pdf && pdf.width > 1) {                                  /* only the part of the region that lies on the page itself */
        const iu0 = Math.max(0, R.u0), iv0 = Math.max(0, R.v0), iu1 = Math.min(1, R.u0 + R.wU), iv1 = Math.min(1, R.v0 + R.hV);
        if (iu1 > iu0 && iv1 > iv0) x.drawImage(pdf, iu0 * pdf.width, iv0 * pdf.height, (iu1 - iu0) * pdf.width, (iv1 - iv0) * pdf.height, (iu0 - R.u0) / R.wU * W, (iv0 - R.v0) / R.hV * H, (iu1 - iu0) / R.wU * W, (iv1 - iv0) / R.hV * H);
      }
      const e = pg.ext; x.drawImage(pg.base, (R.u0 + e.l) * pg.pw, (R.v0 + e.t) * pg.ph, R.wU * pg.pw, R.hV * pg.ph, 0, 0, W, H);
      if (zw.live) {
        const sw = c.getBoundingClientRect().width, tmp = Object.assign({}, zw.live, { points: zw.live.points.map(q => [(q[0] - R.u0) / R.wU, (q[1] - R.v0) / R.hV]), width: zw.live.width * zw.mag * pg.cssW / sw });
        M.drawStroke(x, tmp, W, H);
      }
    });
  }
  function autoAdvance(su) {
    const pg = M.page(zw.page), R = zw.R(pg), edge = zw.dir === 1 ? su > 0.8 : su < 0.2;
    if (!edge) return;
    const nu = R.u0 + zw.dir * R.wU * 0.7;
    if (nu < 0 || nu > 1 - R.wU) newLine(); else { zw.cu = nu; zwSync(true); }
  }
  function newLine() {
    const pg = M.page(zw.page), R = zw.R(pg);
    zw.cu = zw.dir === 1 ? 0 : 1 - R.wU; zw.cv = Math.min(1 - R.hV, R.v0 + R.hV * 0.85); zwSync(true);
  }
  function zwOpen() {
    if (!zw.el) zwBuild();
    if (!zw.open) zw.prev = S.lastDrawTool === 'highlight' ? 'highlight' : 'pen';
    const pages = [...S.pages.values()], vis = pages.find(p => p.ink.getBoundingClientRect().bottom > 160) || pages[0];
    zw.page = zw.page && M.page(zw.page) && zw.open ? zw.page : vis.n; zw.open = true; zw.el.hidden = false; document.body.classList.add('zw-open');
    const pg = M.page(zw.page), r = pg.ink.getBoundingClientRect();
    if (!zw.seeded) { zw.cu = 0.05; zw.cv = Math.max(0, Math.min(0.9, (160 - r.top) / r.height + 0.05)); zw.seeded = true; }
    zwSync(true);
  }
  function zwClose() { zw.open = false; if (zw.el) zw.el.hidden = true; document.body.classList.remove('zw-open'); const pg = M.page(zw.page); if (pg) M.paint(pg); if (S.tool === 'zoom') M.setTool(zw.prev); }
  M.registerTool('zoom', {
    down(pg, e, p) { if (!zw.open) zwOpen(); zw.page = pg.n; const R = zw.R(pg); zw.cu = p[0] - R.wU / 2; zw.cv = p[1] - R.hV / 2; zwSync(); },
    move(pg, e, p) { if (!zw.open) return; const R = zw.R(pg); zw.cu = p[0] - R.wU / 2; zw.cv = p[1] - R.hV / 2; zwSync(); }, up() {}
  });
  M.on('tool', t => { if (t === 'zoom') zwOpen(); else if (zw.open && t !== 'zoom') { zwClose(); } });
  M.on('change', () => { if (zw.open) zwDraw(); });
  addEventListener('resize', () => zwSync());
  M.zoomWriting = { zw, open: zwOpen, close: zwClose, newLine };
  function setHitMode(m) {
    hitMode = m === 'touch' ? 'touch' : 'inside';
    try { localStorage.setItem(HIT_KEY, hitMode); } catch {}
    updateBar(); return hitMode;
  }
  function setType(k, on) {
    if (!(k in types)) return;
    types[k] = !!on;
    try { localStorage.setItem('medixa.studio.lasso.v1', JSON.stringify(types)); } catch {}
    updateBar();
  }
  M.selection = {
    sel, types, setType, clear: clearSel, duplicate, del, cut, selectAll, nudge, select, copy, paste, applyStyle,
    front: () => zorder(true), back: () => zorder(false), count: () => selItems().length, items: selItems,
    mode: () => selMode, setMode, hitMode: () => hitMode, setHitMode, hasClip: () => !!(clip && clip.items.length),
    /* page-coordinate positions of the frame and its handles (null when nothing movable is selected) */
    handles() { const pg = M.page(sel.page), f = frame(pg); return f ? { box: [f.x0, f.y0, f.x1, f.y1], nw: f.h.nw, ne: f.h.ne, sw: f.h.sw, se: f.h.se, n: f.h.n, s: f.h.s, e: f.h.e, w: f.h.w, rot: f.rot, centre: f.c } : null; },
    handleRadius: pointerType => hitR({ pointerType }),
    crop: { start: cropStart, apply: cropApply, cancel: cropCancel, reset: uncrop, get rect() { return crop ? crop.r.slice() : null; }, set rect(r) { if (crop && Array.isArray(r) && r.length === 4) { crop.r = r.map(C.clamp01); const s = byId(crop.id); if (s) M.paint(M.page(s.page)); } } },
    flip, rotate90
  };
  M.images = { pick, insert };
})();
