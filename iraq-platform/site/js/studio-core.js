/* MEDIXA Study Studio — pure logic (no DOM). One document model, one history, one coordinate convention.
   Canonical page coordinates: u,v in [0,1] of the UPRIGHT page as pdf.js shows it (after the page's /Rotate and
   CropBox), origin top-left, y down. Device pixel ratio only changes raster resolution. The stored stroke stays
   compatible with the v1 format ({page,tool,color,width,points:[[u,v],...]}); v2 adds id, rev, pr (pressure).
   Ink fields (all optional; absent = legacy): pen, op (opacity), wr (width range), rot (radians, clockwise on screen),
   k (page height/width, so rotations look right on non-square pages), bold/italic/size (text), head (arrow),
   and the image record {asset,w,h,k,fx,fy,crop,ar}. Iso space = (u, v*k): one unit is the page width on both axes. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MedixaStudioCore = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const LIMITS = { strokes: 100000, points: 200000, text: 4000, shapes: 100000 };
  const TOOLS = ['pen', 'highlight', 'line', 'rectangle', 'ellipse', 'text', 'sticky', 'texthl', 'arrow', 'image'];   /* texthl = highlight anchored to PDF text (rects + quote), not freehand */
  const SHAPES = ['line', 'rectangle', 'ellipse', 'arrow'];
  const PENS = ['ballpoint', 'fountain', 'brush', 'pencil', 'technical'];
  const HEADS = ['end', 'both'];
  const DASHES = ['solid', 'dashed', 'dotted'];
  const TIPS = ['round', 'flat'];
  const ASSET = /^img_[0-9a-f]{16,64}$/;
  const clamp = (n, a, b) => Math.min(b, Math.max(a, n));
  const clamp01 = n => clamp(n, 0, 1);
  const isNum = n => typeof n === 'number' && Number.isFinite(n);
  const inR = (n, a, b) => isNum(n) && n >= a && n <= b;
  const isBool = b => typeof b === 'boolean';
  const COLOR = /^#[0-9a-fA-F]{3,8}$/;

  /* ---------- validation / migration ---------- */
  function validStroke(s) {
    if (!s || typeof s !== 'object') return false;
    if (!Number.isInteger(s.page) || s.page < 1) return false;
    if (typeof s.tool !== 'string' || !TOOLS.includes(s.tool)) return false;
    if (!Array.isArray(s.points) || s.points.length === 0 || s.points.length > LIMITS.points) return false;
    if (!s.points.every(p => Array.isArray(p) && p.length === 2 && isNum(p[0]) && isNum(p[1]))) return false;
    if (s.color != null && (typeof s.color !== 'string' || !COLOR.test(s.color))) return false;
    if (s.width != null && (!isNum(s.width) || s.width <= 0 || s.width > 200)) return false;
    if (s.pr != null && (!Array.isArray(s.pr) || s.pr.length !== s.points.length || !s.pr.every(isNum))) return false;
    if (s.tool === 'text' || s.tool === 'sticky') {
      if (typeof s.text !== 'string' || s.text.length > LIMITS.text) return false;
      /* the box size feeds bounds() (index, page margins); fill reaches a CSS background in the editor */
      if ((s.w != null && !(isNum(s.w) && s.w >= 0)) || (s.h != null && !(isNum(s.h) && s.h >= 0))) return false;
      if (s.fill != null && (typeof s.fill !== 'string' || !COLOR.test(s.fill))) return false;
    }
    if (s.tool === 'texthl') {
      if (!Array.isArray(s.rects) || !s.rects.length || s.rects.length > 400) return false;
      if (!s.rects.every(r => Array.isArray(r) && r.length === 4 && r.every(isNum) && r[2] > r[0] && r[3] > r[1])) return false;
      if (s.quote != null && (typeof s.quote !== 'string' || s.quote.length > 2000)) return false;
    }
    /* ink fields: present-but-invalid rejects the stroke (a corrupt value must never reach the renderer) */
    if (s.pen != null && !PENS.includes(s.pen)) return false;
    if (s.op != null && !inR(s.op, 0.02, 1)) return false;
    if (s.wr != null && !(Array.isArray(s.wr) && s.wr.length === 2 && inR(s.wr[0], 0.1, 4) && inR(s.wr[1], s.wr[0], 4))) return false;
    if (s.rot != null && !inR(s.rot, -50, 50)) return false;
    if (s.k != null && !inR(s.k, 0.05, 20)) return false;
    if (s.bold != null && !isBool(s.bold)) return false;
    if (s.italic != null && !isBool(s.italic)) return false;
    if (s.size != null && !inR(s.size, 4, 400)) return false;
    if (s.head != null && !HEADS.includes(s.head)) return false;
    if (s.dash != null && !DASHES.includes(s.dash)) return false;
    if (s.tip != null && !TIPS.includes(s.tip)) return false;
    if (s.fill != null && (typeof s.fill !== 'string' || !COLOR.test(s.fill))) return false;
    if (s.tool === 'arrow' && s.points.length < 2) return false;
    if (s.tool === 'image') {
      if (typeof s.asset !== 'string' || !ASSET.test(s.asset)) return false;
      if (s.points.length !== 1) return false;                      /* top-left of the UNROTATED box */
      if (!(isNum(s.w) && s.w > 0 && s.w <= 10 && isNum(s.h) && s.h > 0 && s.h <= 10)) return false;
      if (s.k == null) return false;                                /* needed to rotate without shearing */
      if (s.fx != null && !isBool(s.fx)) return false;
      if (s.fy != null && !isBool(s.fy)) return false;
      if (s.crop != null) {
        const c = s.crop;
        if (!Array.isArray(c) || c.length !== 4 || !c.every(x => inR(x, 0, 1)) || !(c[2] > c[0] + 0.01) || !(c[3] > c[1] + 0.01)) return false;
      }
      if (s.ar != null && !(isNum(s.ar) && s.ar > 0)) return false;
    }
    return true;
  }
  let seq = 0;
  const newId = () => 's' + Date.now().toString(36) + (seq++ % 1296).toString(36) + Math.random().toString(36).slice(2, 6);
  /* Legacy strokes get a deterministic id (FNV-1a of their JSON) so two tabs migrating the same data agree. */
  function fnv(str) { let h = 0x811c9dc5; for (let i = 0; i < str.length; i++) { h ^= str.charCodeAt(i); h = Math.imul(h, 0x01000193) >>> 0; } return h.toString(36); }
  /* Returns the same array object semantics-wise: valid legacy strokes gain id/rev/v; invalid entries are kept
     verbatim (never dropped) so recovery stays possible. */
  function migrate(list) {
    const out = [], invalid = [], used = new Set();
    let changed = false;
    for (const s of list) { if (s && s.id) used.add(s.id); }
    for (const s of list) {
      if (!validStroke(s)) { out.push(s); invalid.push(s); continue; }
      if (s.id && s.v === 2) { out.push(s); continue; }
      changed = true;
      let id = s.id, base = 'L' + fnv(JSON.stringify(s)), k = 0;
      if (!id) { id = base; while (used.has(id)) id = base + '_' + (++k); used.add(id); }
      out.push(Object.assign({}, s, { id, v: 2, rev: s.rev || 1 }));
    }
    return { list: out, invalid, changed };
  }
  function validList(list) {
    return Array.isArray(list) && list.length <= LIMITS.strokes;
  }

  /* ---------- iso space ---------- */
  const kOf = k => (isNum(k) && k > 0 ? k : 1);
  const toIso = (p, k) => [p[0], p[1] * kOf(k)];
  const fromIso = (p, k) => [p[0], p[1] / kOf(k)];
  /* Rotate p about c by ang radians in iso space (positive = clockwise on screen, same as canvas rotate()). */
  function rotateIso(p, c, ang, k) {
    k = kOf(k);
    const x = p[0] - c[0], y = (p[1] - c[1]) * k, co = Math.cos(ang), si = Math.sin(ang);
    return [c[0] + x * co - y * si, c[1] + (x * si + y * co) / k];
  }
  function normAngle(a) {
    let r = a % (2 * Math.PI);
    if (r > Math.PI) r -= 2 * Math.PI; else if (r <= -Math.PI) r += 2 * Math.PI;
    return Math.abs(r) < 1e-12 ? 0 : r;
  }
  /* Corners (tl,tr,br,bl of the unrotated box, then rotated by s.rot about its centre) of an image or rectangle/ellipse. */
  function boxCorners(s) {
    let x0, y0, x1, y1;
    if (s.tool === 'image') { x0 = s.points[0][0]; y0 = s.points[0][1]; x1 = x0 + (s.w || 0); y1 = y0 + (s.h || 0); }
    else { const a = s.points[0], b = s.points[s.points.length - 1]; x0 = Math.min(a[0], b[0]); x1 = Math.max(a[0], b[0]); y0 = Math.min(a[1], b[1]); y1 = Math.max(a[1], b[1]); }
    const c = [(x0 + x1) / 2, (y0 + y1) / 2], r = s.rot || 0, k = kOf(s.k);
    const pts = [[x0, y0], [x1, y0], [x1, y1], [x0, y1]];
    return r ? pts.map(p => rotateIso(p, c, r, k)) : pts;
  }

  /* ---------- arrows ---------- */
  const HEAD_ANGLE = 28 * Math.PI / 180;
  /* Two head segments at b, pointing back along the shaft a→b; sizeU in u units, measured in iso space. */
  function arrowHead(a, b, sizeU, k) {
    k = kOf(k);
    const A = toIso(a, k), B = toIso(b, k);
    let dx = A[0] - B[0], dy = A[1] - B[1];
    const l = Math.hypot(dx, dy);
    if (l > 0) { dx /= l; dy /= l; } else { dx = -1; dy = 0; }
    const out = [];
    for (const sg of [1, -1]) {
      const co = Math.cos(sg * HEAD_ANGLE), si = Math.sin(sg * HEAD_ANGLE);
      out.push([[b[0], b[1]], fromIso([B[0] + sizeU * (dx * co - dy * si), B[1] + sizeU * (dx * si + dy * co)], k)]);
    }
    return out;
  }
  /* Head length grows with the line width but never exceeds 45% of the shaft (two heads still fit). */
  function arrowHeadSize(s) {
    const k = kOf(s.k), a = s.points[0], b = s.points[s.points.length - 1];
    const L = Math.hypot(b[0] - a[0], (b[1] - a[1]) * k);
    return Math.min(0.45 * L, (6 + 3 * (s.width || 3)) / 800);
  }

  /* ---------- geometry ---------- */
  function bounds(s) {
    if (s.tool === 'image' || ((s.tool === 'rectangle' || s.tool === 'ellipse') && s.rot)) {
      if (s.tool === 'ellipse') {
        const a = s.points[0], b = s.points[s.points.length - 1], k = kOf(s.k), r = s.rot;
        const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2 * k;
        const ex = Math.hypot(rx * Math.cos(r), ry * Math.sin(r)), ey = Math.hypot(rx * Math.sin(r), ry * Math.cos(r)) / k;
        return [cx - ex, cy - ey, cx + ex, cy + ey];
      }
      const c = boxCorners(s);
      return [Math.min(c[0][0], c[1][0], c[2][0], c[3][0]), Math.min(c[0][1], c[1][1], c[2][1], c[3][1]), Math.max(c[0][0], c[1][0], c[2][0], c[3][0]), Math.max(c[0][1], c[1][1], c[2][1], c[3][1])];
    }
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity;
    const pts = s.tool === 'arrow' ? shapeSegments(s).flat() : s.points;
    for (const p of pts) { if (p[0] < x0) x0 = p[0]; if (p[0] > x1) x1 = p[0]; if (p[1] < y0) y0 = p[1]; if (p[1] > y1) y1 = p[1]; }
    if (s.tool === 'text' || s.tool === 'sticky') {
      const w = s.w || 0.28, h = s.h || 0.1;
      x1 = Math.max(x1, x0 + w); y1 = Math.max(y1, y0 + h);
    }
    return [x0, y0, x1, y1];
  }
  /* distance (CSS px) from point to a segment. pw/ph = page CSS size so that u/v are scaled isotropically. */
  function segDist(px, py, ax, ay, bx, by) {
    const dx = bx - ax, dy = by - ay, l2 = dx * dx + dy * dy;
    let t = l2 ? ((px - ax) * dx + (py - ay) * dy) / l2 : 0;
    t = clamp(t, 0, 1);
    return Math.hypot(px - (ax + t * dx), py - (ay + t * dy));
  }
  function shapeSegments(s) {
    const a = s.points[0], b = s.points[s.points.length - 1];
    if (s.tool === 'line') return [[a, b]];
    if (s.tool === 'arrow') {
      const k = kOf(s.k), size = arrowHeadSize(s), segs = [[a, b]].concat(arrowHead(a, b, size, k));
      return s.head === 'both' ? segs.concat(arrowHead(b, a, size, k)) : segs;
    }
    if (s.tool === 'rectangle') {
      const c = s.rot ? boxCorners(s) : [[a[0], a[1]], [b[0], a[1]], [b[0], b[1]], [a[0], b[1]]];
      return [[c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]];
    }
    if (s.tool === 'ellipse') {
      const cx = (a[0] + b[0]) / 2, cy = (a[1] + b[1]) / 2, rx = Math.abs(b[0] - a[0]) / 2, ry = Math.abs(b[1] - a[1]) / 2, n = 40, segs = [];
      const r = s.rot || 0, k = kOf(s.k), at = p => (r ? rotateIso(p, [cx, cy], r, k) : p);
      let prev = at([cx + rx, cy]);
      for (let i = 1; i <= n; i++) { const t = (i / n) * 2 * Math.PI, p = at([cx + rx * Math.cos(t), cy + ry * Math.sin(t)]); segs.push([prev, p]); prev = p; }
      return segs;
    }
    return null;
  }
  /* Smallest distance in CSS px between a point (u,v) and the stroke. */
  function distToStroke(s, u, v, pw, ph) {
    if (s.tool === 'texthl') {
      let best = Infinity;
      for (const r of s.rects) { const dx = Math.max(r[0] - u, 0, u - r[2]) * pw, dy = Math.max(r[1] - v, 0, v - r[3]) * ph; best = Math.min(best, Math.hypot(dx, dy)); }
      return best;
    }
    if (s.tool === 'image') {                                       /* filled: anywhere on the picture counts as a hit */
      const c = boxCorners(s);
      if (pointInPolygon(u, v, c)) return 0;
      let best = Infinity;
      for (let i = 0; i < 4; i++) { const a = c[i], b = c[(i + 1) % 4]; best = Math.min(best, segDist(u * pw, v * ph, a[0] * pw, a[1] * ph, b[0] * pw, b[1] * ph)); }
      return best;
    }
    if (s.tool === 'text' || s.tool === 'sticky') {
      const [x0, y0, x1, y1] = bounds(s);
      const dx = Math.max(x0 - u, 0, u - x1) * pw, dy = Math.max(y0 - v, 0, v - y1) * ph;
      return Math.hypot(dx, dy);
    }
    const segs = shapeSegments(s);
    let best = Infinity;
    if (segs) {
      for (const [a, b] of segs) best = Math.min(best, segDist(u * pw, v * ph, a[0] * pw, a[1] * ph, b[0] * pw, b[1] * ph));
      return best;
    }
    const pts = s.points;
    if (pts.length === 1) return Math.hypot(u * pw - pts[0][0] * pw, v * ph - pts[0][1] * ph);
    for (let i = 1; i < pts.length; i++) best = Math.min(best, segDist(u * pw, v * ph, pts[i - 1][0] * pw, pts[i - 1][1] * ph, pts[i][0] * pw, pts[i][1] * ph));
    return best;
  }
  /* Uniform grid over normalized page space so erasing does not scan every stroke. */
  class SpatialIndex {
    constructor(cell = 0.05) { this.cell = cell; this.map = new Map(); this.boxes = new Map(); }
    _cells(b, pad) {
      const c = this.cell, out = [];
      const x0 = Math.floor(clamp01(b[0] - pad) / c), x1 = Math.floor(clamp01(b[2] + pad) / c), y0 = Math.floor(clamp01(b[1] - pad) / c), y1 = Math.floor(clamp01(b[3] + pad) / c);
      for (let x = x0; x <= x1; x++) for (let y = y0; y <= y1; y++) out.push(x * 1000 + y);
      return out;
    }
    insert(s) { const b = bounds(s); this.boxes.set(s.id, b); for (const k of this._cells(b, 0)) { let a = this.map.get(k); if (!a) this.map.set(k, a = new Set()); a.add(s); } }
    remove(s) { const b = this.boxes.get(s.id); if (!b) return; for (const k of this._cells(b, 0)) this.map.get(k)?.delete(s); this.boxes.delete(s.id); }
    query(u, v, pad) { const seen = new Set(); for (const k of this._cells([u, v, u, v], pad)) for (const s of this.map.get(k) || []) seen.add(s); return [...seen]; }
    rebuild(list) { this.map.clear(); this.boxes.clear(); for (const s of list) if (s.id && validStroke(s)) this.insert(s); }
  }

  /* ---------- smoothing / pressure ---------- */
  /* Incremental, bounded: raw samples are never modified; the renderer draws quadratic curves through midpoints.
     minDist (CSS px) thins samples that add no information. */
  function thin(points, pr, minDistU, last) {
    if (!last) return true;
    return Math.hypot(points[0] - last[0], points[1] - last[1]) >= minDistU;
  }
  function widthAt(base, pressure, tool) {
    if (tool === 'highlight') return base * 6;
    if (tool !== 'pen') return base;
    const p = isNum(pressure) ? clamp01(pressure) : 0.5;   /* pressure 0 is valid and gives the thinnest line */
    return base * (0.35 + 1.3 * p);
  }
  /* Mouse / touch without real pressure get a documented constant 0.5. */
  const MOUSE_PRESSURE = 0.5;

  /* ---------- pens (variable-width ink) ---------- */
  /* pressure: how much pressure changes width; taper: thinning at both ends; smooth: render smoothing strength;
     alpha: ink opacity (pencil is a little transparent); thin: simulate pressure from speed when the device has none;
     nib: angled-nib (45°) width change by direction. */
  const PEN_STYLES = {
    ballpoint: { pressure: 0.25, taper: 0.12, smooth: 0.45, alpha: 1, thin: 0, nib: 0 },
    fountain: { pressure: 1, taper: 0.55, smooth: 0.55, alpha: 1, thin: 0.35, nib: 0.35 },
    brush: { pressure: 1.35, taper: 0.75, smooth: 0.65, alpha: 0.96, thin: 0.5, nib: 0.45 },
    pencil: { pressure: 0.6, taper: 0.3, smooth: 0.35, alpha: 0.82, thin: 0.1, nib: 0 },
    technical: { pressure: 0, taper: 0, smooth: 0.15, alpha: 1, thin: 0, nib: 0 }
  };
  function penStyle(pen) { return Object.assign({}, PEN_STYLES[PENS.includes(pen) ? pen : 'ballpoint']); }
  /* Width (CSS px) at every point. Pure function of the stored stroke, so a reload draws exactly the same ink. */
  function penWidths(s, pw, ph) {
    const pts = s.points, n = pts.length, st = penStyle(s.pen);
    pw = isNum(pw) && pw > 0 ? pw : 800; ph = isNum(ph) && ph > 0 ? ph : pw;
    const base = (s.width || 3) * pw / 800;
    if (n <= 1) return [base];
    const X = i => pts[i][0] * pw, Y = i => pts[i][1] * ph;
    const seg = []; for (let i = 0; i < n - 1; i++) seg.push(Math.hypot(X(i + 1) - X(i), Y(i + 1) - Y(i)));
    let p;
    if (Array.isArray(s.pr) && s.pr.length === n) p = s.pr.map(x => (isNum(x) ? clamp01(x) : 0.5));
    else if (st.thin > 0) {
      /* no real pressure: large spacing between samples = fast hand = lighter line (range 0.25..0.75) */
      const ref = base * 4 + 4, sim = [];
      for (let i = 0; i < n; i++) {
        const a = i > 0 ? seg[i - 1] : seg[i], b = i < n - 1 ? seg[i] : seg[i - 1];
        sim.push(0.75 - 0.5 * clamp01((a + b) / 2 / ref));
      }
      const gain = Math.min(1, st.thin / 0.35);                    /* pencil varies less than fountain */
      p = sim.map((_, i) => { const lo = Math.max(0, i - 1), hi = Math.min(n - 1, i + 1); let sum = 0; for (let j = lo; j <= hi; j++) sum += sim[j]; return 0.5 + (sum / (hi - lo + 1) - 0.5) * gain; });
    } else p = new Array(n).fill(0.5);
    const wr = Array.isArray(s.wr) && s.wr.length === 2 && isNum(s.wr[0]) && isNum(s.wr[1]) ? s.wr : [0.25, 2.2];
    const lo = base * wr[0], hi = base * wr[1], out = [];
    let ang = null;
    for (let i = 0; i < n && st.nib; i++) { const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dx = X(b) - X(a), dy = Y(b) - Y(a); if (dx || dy) { ang = Math.atan2(dy, dx); break; } }
    if (ang == null) ang = Math.PI / 4;
    for (let i = 0; i < n; i++) {
      let w = base * (1 + st.pressure * ((0.35 + 1.3 * p[i]) - 1));
      if (st.nib) {
        const a = Math.max(0, i - 1), b = Math.min(n - 1, i + 1), dx = X(b) - X(a), dy = Y(b) - Y(a);
        if (dx || dy) ang = Math.atan2(dy, dx);
        w *= 1 - st.nib * 0.5 * Math.abs(Math.sin(ang - Math.PI / 4));
      }
      out.push(clamp(w, lo, hi));
    }
    if (st.taper > 0) {
      /* taper zone ends at whichever comes first: 25% of the points or 3 line widths of distance */
      const f0 = 1 - 0.85 * st.taper, nT = 0.25 * (n - 1), dT = 3 * base, ease = t => t * (2 - t);
      const fs = new Array(n), fe = new Array(n);
      for (let i = 0, c = 0; i < n; i++) { if (i) c += seg[i - 1]; fs[i] = f0 + (1 - f0) * ease(clamp01(Math.max(i / nT, dT > 0 ? c / dT : 1))); }
      for (let i = n - 1, c = 0; i >= 0; i--) { if (i < n - 1) c += seg[i]; fe[i] = f0 + (1 - f0) * ease(clamp01(Math.max((n - 1 - i) / nT, dT > 0 ? c / dT : 1))); }
      for (let i = 0; i < n; i++) out[i] *= Math.min(fs[i], fe[i]);
    }
    return out;
  }
  /* Rendering-only Chaikin smoothing (stored points never change). Works on any point dimension, so [x,y,w]
     triplets keep their widths aligned. Endpoints preserved; output length <= 4x the input. */
  function smoothPoints(pts, strength) {
    const it = Math.round(clamp01(isNum(strength) ? strength : 0) * 2), max = 4 * pts.length;
    let cur = pts.map(p => p.slice());
    if (cur.length < 3) return cur;
    for (let r = 0; r < it && cur.length * 2 <= max; r++) {
      const out = [cur[0]];
      for (let i = 0; i < cur.length - 1; i++) {
        const a = cur[i], b = cur[i + 1];
        out.push(a.map((x, j) => 0.75 * x + 0.25 * b[j]), a.map((x, j) => 0.25 * x + 0.75 * b[j]));
      }
      out.push(cur[cur.length - 1]);
      cur = out;
    }
    return cur;
  }
  /* Closed polygon (pixel space) around a variable-width polyline: one fill() draws the whole stroke, so
     semi-transparent ink has no darker overlaps at the joins. widths are full widths. */
  function strokeOutline(pts, widths) {
    const P = [], H = [];
    for (let i = 0; i < (pts ? pts.length : 0); i++) {
      const p = pts[i]; if (!p || !isNum(p[0]) || !isNum(p[1])) continue;
      const wv = widths && widths.length ? widths[Math.min(i, widths.length - 1)] : 0, hw = isNum(wv) && wv > 0 ? wv / 2 : 0;
      const q = P[P.length - 1];
      if (q && q[0] === p[0] && q[1] === p[1]) { H[H.length - 1] = Math.max(H[H.length - 1], hw); continue; }
      P.push([p[0], p[1]]); H.push(hw);
    }
    const n = P.length, poly = [];
    if (!n) return poly;
    const arc = (c, r, a0, steps, from, to) => { for (let j = from; j <= to; j++) { const a = a0 - Math.PI * j / steps; poly.push([c[0] + r * Math.cos(a), c[1] + r * Math.sin(a)]); } };
    if (n === 1) { arc(P[0], H[0], 0, 8, 0, 15); return poly; }
    const N = [];
    for (let i = 0; i < n - 1; i++) { const dx = P[i + 1][0] - P[i][0], dy = P[i + 1][1] - P[i][1], l = Math.hypot(dx, dy) || 1; N.push([-dy / l, dx / l]); }
    const left = [], right = [];
    for (let i = 0; i < n; i++) {
      let m, len = H[i];
      if (i === 0) m = N[0]; else if (i === n - 1) m = N[n - 2];
      else {
        const a = N[i - 1], b = N[i], mx = a[0] + b[0], my = a[1] + b[1], ml = Math.hypot(mx, my);
        if (ml < 1e-9) m = a;                                      /* full reversal: no defined join direction */
        else { m = [mx / ml, my / ml]; const cos = m[0] * b[0] + m[1] * b[1]; len = cos > 1e-9 ? Math.min(H[i] / cos, 2 * H[i]) : 2 * H[i]; }
      }
      left.push([P[i][0] + m[0] * len, P[i][1] + m[1] * len]); right.push([P[i][0] - m[0] * len, P[i][1] - m[1] * len]);
    }
    const nE = N[n - 2], nS = N[0];
    for (const q of left) poly.push(q);
    arc(P[n - 1], H[n - 1], Math.atan2(nE[1], nE[0]), 8, 1, 7);     /* round end cap, through the forward direction */
    for (let i = n - 1; i >= 0; i--) poly.push(right[i]);
    arc(P[0], H[0], Math.atan2(-nS[1], -nS[0]), 8, 1, 7);          /* round start cap, through the backward direction */
    return poly;
  }
  /* 1€ filter (Casiez et al.) in iso space: steady hand = smooth, fast hand = little lag. Speed is measured in
     iso units/s x 1000 (≈ px on a 1000 px wide page) so beta keeps its usual meaning. strength 0 = passthrough. */
  class InkFilter {
    constructor(strength = 0.5, k = 1) {
      this.strength = clamp01(isNum(strength) ? strength : 0); this.k = kOf(k);
      this.minCutoff = 0.5 + 9.5 * (1 - this.strength); this.beta = 0.02; this.dCutoff = 1;
      this.reset();
    }
    reset() { this.has = false; this.x = 0; this.y = 0; this.dx = 0; this.dy = 0; this.t = null; }
    push(p, tMs) {
      if (this.strength === 0) return [p[0], p[1]];
      const x = p[0], y = p[1] * this.k;
      if (!this.has) { this.has = true; this.x = x; this.y = y; this.dx = 0; this.dy = 0; this.t = isNum(tMs) ? tMs : null; return [p[0], p[1]]; }
      let dt = isNum(tMs) && this.t != null ? (tMs - this.t) / 1000 : 0;
      if (isNum(tMs)) this.t = tMs;
      if (!(dt > 0)) dt = 1 / 120;                                  /* coalesced events can share a timestamp */
      dt = Math.min(dt, 0.5);
      const alpha = fc => 1 / (1 + 1 / (2 * Math.PI * fc * dt));
      const ad = alpha(this.dCutoff);
      this.dx += ad * ((x - this.x) / dt - this.dx); this.dy += ad * ((y - this.y) / dt - this.dy);
      const a = alpha(this.minCutoff + this.beta * Math.hypot(this.dx, this.dy) * 1000);
      this.x += a * (x - this.x); this.y += a * (y - this.y);
      return [this.x, this.y / this.k];
    }
    /* End of stroke: the last point is the raw pointer-up position so the line ends where the pen lifted. */
    finish(raw) { this.reset(); return [raw[0], raw[1]]; }
  }

  /* ---------- erasing (partial) ---------- */
  const WHOLE = new Set(['text', 'sticky', 'texthl', 'image', 'line', 'rectangle', 'ellipse', 'arrow']);
  /* Circle eraser at (u,v), radius rU (u units, iso). null = miss; 'whole' = remove the object; otherwise the
     freehand pieces that survive, with exact boundary points (pressure interpolated). */
  function splitStroke(s, u, v, rU, k) {
    k = kOf(k);
    if (!(isNum(rU) && rU > 0) || !s || !Array.isArray(s.points) || !s.points.length) return null;
    if (WHOLE.has(s.tool)) return distToStroke(s, u, v, 1, k) < rU ? 'whole' : null;
    const pts = s.points, n = pts.length, pr = Array.isArray(s.pr) && s.pr.length === n ? s.pr : null;
    const cu = u, cv = v * k, r2 = rU * rU;
    const d2 = i => { const x = pts[i][0] - cu, y = pts[i][1] * k - cv; return x * x + y * y; };
    let hit = n === 1 ? d2(0) < r2 : false;
    for (let i = 1; i < n && !hit; i++) hit = segDist(cu, cv, pts[i - 1][0], pts[i - 1][1] * k, pts[i][0], pts[i][1] * k) < rU;
    if (!hit) return null;
    if (n === 1) return [];
    const pieces = [];
    let cur = null;
    const at = (i, t) => { const a = pts[i]; if (t == null) return { p: [a[0], a[1]], r: pr ? pr[i] : 0 }; const b = pts[i + 1]; return { p: [a[0] + t * (b[0] - a[0]), a[1] + t * (b[1] - a[1])], r: pr ? pr[i] + t * (pr[i + 1] - pr[i]) : 0 }; };
    if (d2(0) >= r2) cur = [at(0)];
    for (let i = 0; i < n - 1; i++) {
      const ax = pts[i][0] - cu, ay = pts[i][1] * k - cv, ex = pts[i + 1][0] - pts[i][0], ey = (pts[i + 1][1] - pts[i][1]) * k;
      const qa = ex * ex + ey * ey, qb = 2 * (ax * ex + ay * ey), qc = ax * ax + ay * ay - r2, disc = qb * qb - 4 * qa * qc;
      let t1 = 1, t2 = 0;
      if (qa > 0 && disc > 0) { const sq = Math.sqrt(disc); t1 = (-qb - sq) / (2 * qa); t2 = (-qb + sq) / (2 * qa); }
      if (!(qa > 0 && disc > 0) || t2 <= 0 || t1 >= 1) { if (!cur) cur = [at(i)]; cur.push(at(i + 1)); continue; }   /* segment fully outside */
      if (t1 > 0) { if (!cur) cur = [at(i)]; cur.push(at(i, t1)); pieces.push(cur); cur = null; }                     /* enters the circle */
      else if (cur) { pieces.push(cur); cur = null; }
      if (t2 < 1) cur = [at(i, t2), at(i + 1)];                                                                       /* leaves the circle */
    }
    if (cur) pieces.push(cur);
    const out = [];
    for (const pc of pieces) {
      if (pc.length < 2) continue;
      let len = 0; for (let i = 1; i < pc.length; i++) len += Math.hypot(pc[i].p[0] - pc[i - 1].p[0], (pc[i].p[1] - pc[i - 1].p[1]) * k);
      if (len < 0.5 * rU) continue;
      const o = { points: pc.map(q => q.p) }; if (pr) o.pr = pc.map(q => q.r);
      out.push(o);
    }
    return out;
  }

  /* ---------- straighten / shape recognition ---------- */
  function straighten(pts, opt) {
    const o = opt || {}, k = kOf(o.k), a = [pts[0][0], pts[0][1]], b = [pts[pts.length - 1][0], pts[pts.length - 1][1]];
    if (o.horizontal) { const ang = Math.atan2(Math.abs(b[1] - a[1]) * k, Math.abs(b[0] - a[0])); if (ang < 12 * Math.PI / 180) b[1] = a[1]; }
    return [a, b];
  }
  /* Hold-to-snap: a hand-drawn line, ellipse or rectangle becomes the clean shape (axis-aligned corners a,b).
     Anything else (handwriting, scribbles, open curves) returns null so the ink stays as drawn. */
  function recognizeShape(pts, k) {
    k = kOf(k);
    if (!Array.isArray(pts) || pts.length < 2 || !pts.every(p => Array.isArray(p) && isNum(p[0]) && isNum(p[1]))) return null;
    const P = pts.map(p => [p[0], p[1] * k]), n = P.length;
    let x0 = Infinity, y0 = Infinity, x1 = -Infinity, y1 = -Infinity, path = 0;
    for (let i = 0; i < n; i++) { const p = P[i]; x0 = Math.min(x0, p[0]); x1 = Math.max(x1, p[0]); y0 = Math.min(y0, p[1]); y1 = Math.max(y1, p[1]); if (i) path += Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]); }
    const W = x1 - x0, H = y1 - y0, diag = Math.hypot(W, H);
    if (!(diag > 1e-4)) return null;
    const A = P[0], B = P[n - 1], chord = Math.hypot(B[0] - A[0], B[1] - A[1]);
    const out = (tool, a, b) => ({ tool, points: [fromIso(a, k), fromIso(b, k)] });
    if (chord > 0) {
      let md = 0; for (const p of P) md = Math.max(md, segDist(p[0], p[1], A[0], A[1], B[0], B[1]));
      if (md < 0.06 * chord && path <= 1.5 * chord) return out('line', A, B);   /* path test rejects back-and-forth scribbles */
    }
    if (chord >= 0.25 * diag) return null;                                    /* open stroke */
    const minS = Math.min(W, H);
    if (minS < 0.08 * Math.max(W, H) || path > 3 * (W + H)) return null;      /* flat loop or several laps */
    const cx = (x0 + x1) / 2, cy = (y0 + y1) / 2, rx = W / 2, ry = H / 2, bins = new Set();
    let wsum = 0, eErr = 0, rDist = 0;
    for (let i = 0; i < n; i++) {
      const p = P[i], wgt = ((i > 0 ? Math.hypot(p[0] - P[i - 1][0], p[1] - P[i - 1][1]) : 0) + (i < n - 1 ? Math.hypot(P[i + 1][0] - p[0], P[i + 1][1] - p[1]) : 0)) / 2;
      wsum += wgt;                                                              /* weight by arc length: slow corners do not dominate */
      eErr += wgt * Math.abs(Math.hypot((p[0] - cx) / rx, (p[1] - cy) / ry) - 1);
      rDist += wgt * Math.min(p[0] - x0, x1 - p[0], p[1] - y0, y1 - p[1]);
      bins.add(Math.floor(((Math.atan2((p[1] - cy) / ry, (p[0] - cx) / rx) + Math.PI) / (2 * Math.PI)) * 12) % 12);
    }
    if (!(wsum > 0) || bins.size < 10) return null;                           /* must go (almost) all the way round */
    eErr /= wsum; rDist /= wsum;
    const rErr = rDist / (minS / 2), isEll = eErr < 0.12, isRect = rDist < 0.08 * minS;
    if (isRect && (!isEll || rErr < eErr)) return out('rectangle', [x0, y0], [x1, y1]);
    if (isEll) return out('ellipse', [x0, y0], [x1, y1]);
    return null;
  }

  /* ---------- history ---------- */
  /* One command = one gesture. ops: {k:'add',s,i?}|{k:'del',s,i}|{k:'edit',id,before,after}|{k:'mv',id,from,to}.
     Applying/undoing works on ids against the live array, so history is valid across page changes. Bounded only by
     dropping the OLDEST undo steps; the document itself is never discarded. */
  const OPS = ['add', 'del', 'edit', 'mv'];
  class History {
    constructor(items, limit = 300) { this.items = items; this.undoStack = []; this.redoStack = []; this.limit = limit; this.onchange = null; }
    setItems(items) { this.items = items; this.undoStack = []; this.redoStack = []; }
    _find(id) { return this.items.findIndex(s => s && s.id === id); }
    _apply(ops, reverse) {
      const list = reverse ? ops.slice().reverse() : ops;
      for (const o of list) {
        if (o.k === 'add') {
          if (reverse) { const i = this._find(o.s.id); if (i >= 0) this.items.splice(i, 1); }
          else if (this._find(o.s.id) < 0) { if (Number.isInteger(o.i) && o.i >= 0) this.items.splice(Math.min(o.i, this.items.length), 0, o.s); else this.items.push(o.s); }
        }
        else if (o.k === 'del') { if (reverse) { if (this._find(o.s.id) < 0) this.items.splice(Math.min(o.i, this.items.length), 0, o.s); } else { const i = this._find(o.s.id); if (i >= 0) this.items.splice(i, 1); } }
        else if (o.k === 'edit') { const i = this._find(o.id); if (i >= 0) this.items[i] = Object.assign({}, this.items[i], reverse ? o.before : o.after); }
        else if (o.k === 'mv') {                                    /* z-order change: found by id, so stale indexes are harmless */
          const i = this._find(o.id), to = reverse ? o.from : o.to;
          if (i >= 0 && Number.isInteger(to)) { const it = this.items.splice(i, 1)[0]; this.items.splice(clamp(to, 0, this.items.length), 0, it); }
        }
      }
    }
    /* Record an already-applied gesture. */
    push(ops) { if (!ops.length) return; this.undoStack.push(ops); if (this.undoStack.length > this.limit) this.undoStack.shift(); this.redoStack = []; this.onchange && this.onchange(); }
    undo() { const ops = this.undoStack.pop(); if (!ops) return null; this._apply(ops, true); this.redoStack.push(ops); this.onchange && this.onchange(); return ops; }
    redo() { const ops = this.redoStack.pop(); if (!ops) return null; this._apply(ops, false); this.undoStack.push(ops); this.onchange && this.onchange(); return ops; }
    get canUndo() { return this.undoStack.length > 0; }
    get canRedo() { return this.redoStack.length > 0; }
  }

  /* ---------- transforms (lasso / shapes) ---------- */
  function transformStroke(s, m) {
    /* m = {dx,dy,sx,sy,cx,cy,rot,k}: scale about (cx,cy), rotate by rot radians about (cx,cy) in iso space
       (k = page height/width, default 1), then translate. Result clamped to the page (+margins). */
    const sx = m.sx == null ? 1 : m.sx, sy = m.sy == null ? 1 : m.sy, cx = m.cx || 0, cy = m.cy || 0, dx = m.dx || 0, dy = m.dy || 0;
    const bx = m.bx || [0, 1], by = m.by || [0, 1];      /* page extent incl. margins: [-l, 1+r] x [-t, 1+b] */
    const rot = isNum(m.rot) ? m.rot : 0, K = isNum(m.k) && m.k > 0 ? m.k : kOf(s.k);
    const sc = p => [cx + (p[0] - cx) * sx, cy + (p[1] - cy) * sy];
    const rt = p => (rot ? rotateIso(p, [cx, cy], rot, K) : p);
    const cl = p => [clamp(p[0], bx[0], bx[1]), clamp(p[1], by[0], by[1])];
    const out = { rev: (s.rev || 1) + 1 };
    if (s.pr) out.pr = s.pr;
    if (s.tool === 'texthl') {                           /* tied to the PDF text: no move, scale or rotation ever applies */
      out.points = s.points; if (s.rects) out.rects = s.rects;
      return out;
    }
    if (s.tool === 'image') {
      /* the centre follows the transform (clamped); size scales by |sx|,|sy|; rotation adds to the image's own */
      const w = s.w || 0, h = s.h || 0, tl = s.points[0];
      const nw = Math.min(10, Math.max(Math.min(w, 0.01), w * Math.abs(sx))), nh = Math.min(10, Math.max(Math.min(h, 0.01), h * Math.abs(sy)));
      const c = rt(sc([tl[0] + w / 2, tl[1] + h / 2])), c1 = cl([c[0] + dx, c[1] + dy]);
      out.points = [[c1[0] - nw / 2, c1[1] - nh / 2]]; out.w = nw; out.h = nh;
      if (rot) { out.rot = normAngle((s.rot || 0) + rot); out.k = K; }
      return out;
    }
    if ((rot || s.rot) && (s.tool === 'rectangle' || s.tool === 'ellipse')) {
      /* a rotated box is clamped by its centre: its stored (unrotated) corners may lie off the page, and clamping
         them one by one would resize and shift the shape on a plain move */
      const sp = s.points.map(sc), a = sp[0], b = sp[sp.length - 1], c0 = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      const c = rt(c0), c1 = cl([c[0] + dx, c[1] + dy]), ox = c1[0] - c0[0], oy = c1[1] - c0[1];
      out.points = sp.map(p => [p[0] + ox, p[1] + oy]);
      if (rot) { out.rot = normAngle((s.rot || 0) + rot); out.k = K; }
      return out;
    }
    if (rot && (s.tool === 'text' || s.tool === 'sticky')) {
      /* text stays upright: only its box centre follows the rotation */
      const nw = s.w != null ? Math.max(0.02, s.w * Math.abs(sx)) : null, nh = s.h != null ? Math.max(0.02, s.h * Math.abs(sy)) : null;
      const ew = nw || 0.28, eh = nh || 0.1, a = sc(s.points[0]), c = rt([a[0] + ew / 2, a[1] + eh / 2]);
      const ox = c[0] - ew / 2 - a[0] + dx, oy = c[1] - eh / 2 - a[1] + dy;
      out.points = s.points.map(p => { const q = sc(p); return cl([q[0] + ox, q[1] + oy]); });
      if (nw != null) out.w = nw; if (nh != null) out.h = nh;
      return out;
    }
    out.points = s.points.map(p => { const q = rt(sc(p)); return cl([q[0] + dx, q[1] + dy]); });
    if (s.w != null) out.w = Math.max(0.02, s.w * Math.abs(sx));
    if (s.h != null) out.h = Math.max(0.02, s.h * Math.abs(sy));
    if (rot && s.tool === 'arrow') out.k = K;
    return out;
  }
  function pointInPolygon(x, y, poly) {
    let inside = false;
    for (let i = 0, j = poly.length - 1; i < poly.length; j = i++) {
      const xi = poly[i][0], yi = poly[i][1], xj = poly[j][0], yj = poly[j][1];
      if ((yi > y) !== (yj > y) && x < ((xj - xi) * (y - yi)) / (yj - yi) + xi) inside = !inside;
    }
    return inside;
  }
  function segsCross(a, b, c, d) {
    const ccw = (p1, p2, p3) => (p3[1] - p1[1]) * (p2[0] - p1[0]) > (p2[1] - p1[1]) * (p3[0] - p1[0]);
    return ccw(a, c, d) !== ccw(b, c, d) && ccw(a, b, c) !== ccw(a, b, d);
  }
  function polyCrossesSegs(poly, segs) {
    for (let i = 0; i < poly.length; i++) {
      const p1 = poly[i], p2 = poly[(i + 1) % poly.length];
      for (const [a, b] of segs) if (segsCross(p1, p2, a, b)) return true;
    }
    return false;
  }
  /* A stroke is lassoed when at least half of its sample points (or its box centre for text/images) are inside,
     or when mode === 'touch' and the lasso polygon touches/intersects any part of the stroke. */
  function lassoHit(s, poly, mode) {
    if (poly.length < 3) return false;
    const touch = mode === 'touch';
    if (s.tool === 'image') {
      const tl = s.points[0], cx = tl[0] + (s.w || 0) / 2, cy = tl[1] + (s.h || 0) / 2;
      if (pointInPolygon(cx, cy, poly)) return true;
      if (!touch) return false;
      const c = boxCorners(s);
      if (c.some(p => pointInPolygon(p[0], p[1], poly)) || poly.some(p => pointInPolygon(p[0], p[1], c))) return true;
      return polyCrossesSegs(poly, [[c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]]);
    }
    if (s.tool === 'text' || s.tool === 'sticky') {
      const b = bounds(s);
      if (pointInPolygon((b[0] + b[2]) / 2, (b[1] + b[3]) / 2, poly)) return true;
      if (!touch) return false;
      const c = [[b[0], b[1]], [b[2], b[1]], [b[2], b[3]], [b[0], b[3]]];
      return c.some(p => pointInPolygon(p[0], p[1], poly)) || poly.some(p => p[0] >= b[0] && p[0] <= b[2] && p[1] >= b[1] && p[1] <= b[3]) || polyCrossesSegs(poly, [[c[0], c[1]], [c[1], c[2]], [c[2], c[3]], [c[3], c[0]]]);
    }
    if (s.tool === 'texthl' && Array.isArray(s.rects)) {
      if (touch) return s.rects.some(r => pointInPolygon((r[0] + r[2]) / 2, (r[1] + r[3]) / 2, poly) || poly.some(p => p[0] >= r[0] && p[0] <= r[2] && p[1] >= r[1] && p[1] <= r[3]));
    }
    const segs = shapeSegments(s);
    if (segs && touch) {
      for (const [a, b] of segs) if (pointInPolygon(a[0], a[1], poly) || pointInPolygon(b[0], b[1], poly) || pointInPolygon((a[0] + b[0]) / 2, (a[1] + b[1]) / 2, poly)) return true;
      return polyCrossesSegs(poly, segs);
    }
    let pts = s.points;
    if (s.rot && (s.tool === 'rectangle' || s.tool === 'ellipse')) {   /* test the corners where they are drawn */
      const a = pts[0], b = pts[pts.length - 1], c = [(a[0] + b[0]) / 2, (a[1] + b[1]) / 2];
      pts = pts.map(p => rotateIso(p, c, s.rot, kOf(s.k)));
    }
    let inn = 0;
    for (const p of pts) {
      if (pointInPolygon(p[0], p[1], poly)) { if (touch) return true; inn++; }
    }
    if (touch && pts.length > 1) {
      const pSegs = [];
      for (let i = 1; i < pts.length; i++) pSegs.push([pts[i - 1], pts[i]]);
      if (polyCrossesSegs(poly, pSegs)) return true;
    }
    return inn >= Math.ceil(pts.length / 2);
  }

  /* ---------- PDF coordinate mapping ---------- */
  /* Canonical (u,v) of the displayed page → PDF user-space point. box = {x,y,width,height} of the CropBox (unrotated),
     rotation = page /Rotate in degrees. Mirrors pdf.js's viewport transform; verified in tests/studio_pdf_export. */
  /* Same normalisation as pdf.js: a /Rotate that is not a multiple of 90 is ignored, the rest becomes 0..270. */
  const rot90 = r => (isNum(r) && r % 90 === 0 ? ((r % 360) + 360) % 360 : 0);
  function viewToPdf(u, v, box, rotation) {
    const W = box.width, H = box.height, r = rot90(rotation);
    let x, y;
    if (r === 0) { x = u * W; y = (1 - v) * H; }
    else if (r === 90) { x = v * W; y = u * H; }
    else if (r === 180) { x = (1 - u) * W; y = v * H; }
    else { x = (1 - v) * W; y = (1 - u) * H; }
    return [box.x + x, box.y + y];
  }
  /* Size of the displayed page in PDF units. */
  function displaySize(box, rotation) {
    const r = rot90(rotation);
    return r === 90 || r === 270 ? [box.height, box.width] : [box.width, box.height];
  }
  /* Legacy v1 points were normalized to the displayed canvas, so they are already canonical. */

  /* ---------- page templates (blank pages / notebooks) ---------- */
  const TEMPLATES = ['blank', 'lined', 'grid', 'dots'];
  const BLANK_ID0 = 100001;                                       /* virtual page ids start here; source pages keep their own numbers */
  /* Geometry in PDF points, origin top-left, y down: {lines:[[x1,y1,x2,y2]], dots:[[x,y]]}. One source for canvas and export. */
  function templateGeometry(kind, w, h) {
    const lines = [], dots = [], step = 24, top = 56, side = 36;
    if (kind === 'lined') for (let y = top; y < h - 24; y += step) lines.push([side, y, w - side, y]);
    else if (kind === 'grid') { let yEnd = top; for (let y = top; y < h - 24; y += step) { lines.push([side, y, w - side, y]); yEnd = y; } for (let x = side; x <= w - side + 0.1; x += step) lines.push([x, top, x, yEnd]); }   /* verticals stop at the last rule */
    else if (kind === 'dots') for (let y = top; y < h - 24; y += step) for (let x = side; x <= w - side + 0.1; x += step) dots.push([x, y]);
    return { lines, dots };
  }
  function validBlank(b) { return b && typeof b === 'object' && Number.isInteger(b.id) && b.id >= BLANK_ID0 && TEMPLATES.includes(b.template) && isNum(b.w) && isNum(b.h) && b.w >= 100 && b.w <= 3000 && b.h >= 100 && b.h <= 3000; }
  /* Display order of page ids. `order` (explicit) wins only if it is an exact permutation of sources + blanks and keeps
     the source pages in ascending order; otherwise blanks follow the page named by their `after` hint. */
  function displayOrder(nSources, blanks, order) {
    const ids = new Set(blanks.map(b => b.id)), src = Array.from({ length: nSources }, (_, i) => i + 1);
    if (Array.isArray(order) && order.length === nSources + blanks.length && new Set(order).size === order.length && order.every(x => ids.has(x) || (Number.isInteger(x) && x >= 1 && x <= nSources))) {
      const s2 = order.filter(x => x <= nSources); if (s2.every((x, i) => x === i + 1)) return order.slice();
    }
    const out = []; const at = a => blanks.filter(b => (b.after || 0) === a).map(b => b.id);
    out.push(...at(0)); for (const n of src) { out.push(n); out.push(...at(n)); }
    for (const b of blanks) if (!out.includes(b.id)) out.push(b.id);   /* stale hint (e.g. the PDF now has fewer pages): never hide a page */
    return out;
  }

  /* ---------- merge (multi-tab conflict path) ---------- */
  /* Union by id. For ids present on both sides the higher rev wins. ids in `deleted` (removed in this tab) stay
     removed. Entries without id (legacy invalid) are kept once by JSON fingerprint. */
  function mergeById(local, remote, deleted) {
    const del = deleted || new Set(), byId = new Map(), noId = new Map(), order = [];
    const add = s => {
      if (s && s.id) {
        if (del.has(s.id)) return;
        const cur = byId.get(s.id);
        if (!cur) { byId.set(s.id, s); order.push([byId, s.id]); } else if ((s.rev || 1) > (cur.rev || 1)) byId.set(s.id, s);
      } else { const k = JSON.stringify(s); if (!noId.has(k)) { noId.set(k, s); order.push([noId, k]); } }   /* an id may equal another entry's JSON */
    };
    for (const s of remote) add(s);
    for (const s of local) add(s);
    return order.map(([m, k]) => m.get(k));
  }

  return { LIMITS, TOOLS, SHAPES, PENS, DASHES, TIPS, OPS, MOUSE_PRESSURE, clamp, clamp01, validStroke, validList, migrate, newId, bounds, distToStroke, segDist, shapeSegments, SpatialIndex, thin, widthAt, History, transformStroke, TEMPLATES, BLANK_ID0, templateGeometry, validBlank, displayOrder, pointInPolygon, lassoHit, viewToPdf, displaySize, mergeById,
    toIso, fromIso, rotateIso, boxCorners, arrowHead, arrowHeadSize, penStyle, penWidths, smoothPoints, strokeOutline, InkFilter, splitStroke, straighten, recognizeShape };
});
