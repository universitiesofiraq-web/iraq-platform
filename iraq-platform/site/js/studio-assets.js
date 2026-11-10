/* MEDIXA Study Studio — on-device image store for pictures the student inserts into the study workspace.
   Pixels live here (IndexedDB 'medixa-assets' / 'images'), never in the stroke list: a stroke only names its asset id.
   Every image is re-encoded once on the way in (EXIF location and orientation are dropped, longest side <= 2400 px,
   PNG when it has transparency else JPEG) so pdf-lib can embed the stored bytes as they are.
   id = 'img_' + first 32 hex chars of SHA-256 of the stored bytes: the same picture inserted twice is stored once, and
   a backup restored with putDataUrl() gets back the very id its strokes reference.
   Errors: rejected Error objects with .code ('type' | 'size' | 'decode' | 'dims' | 'quota' | 'idb') and an Arabic
   .message ready to show. Nothing here throws synchronously. */
(function (root, factory) {
  const api = factory();
  if (typeof module === 'object' && module.exports) module.exports = api;
  else root.MedixaAssets = api;
})(typeof self !== 'undefined' ? self : this, function () {
  'use strict';
  const DB = 'medixa-assets', STORE = 'images';
  const MAX_BYTES = 25 * 1024 * 1024, MAX_PIXELS = 60e6, MAX_SIDE = 2400, ALPHA_MIN = 250, JPEG_Q = 0.9;
  const HEAD = 512 * 1024;                       /* enough of the file to find the JPEG frame header behind EXIF/ICC blocks */
  const ALLOWED = ['image/jpeg', 'image/png', 'image/webp'];
  const ID = /^img_[0-9a-f]{16,64}$/;
  const nav = typeof navigator !== 'undefined' ? navigator : {};
  /* Same touch test as studio-ink.js: iPad Safari drops decoded images (and canvases) past its memory budget. */
  const TOUCH = (nav.maxTouchPoints || 0) > 0 || /iP(hone|ad|od)/.test(nav.userAgent || '');
  const BUDGET = TOUCH ? 40e6 : 120e6;
  const MSG = {
    type: 'نوع الصورة غير مدعوم. استعمل JPG أو PNG أو WebP.',
    size: 'الصورة أكبر من 25 ميغابايت. اختر صورة أصغر.',
    decode: 'تعذّر فتح الصورة. ربما الملف تالف.',
    dims: 'أبعاد الصورة كبيرة جداً. صغّرها ثم حاول مرة أخرى.',
    quota: 'لا توجد مساحة كافية على جهازك لحفظ الصورة.',
    idb: 'تعذّر الوصول إلى صور هذا الجهاز. أعد تحميل الصفحة وحاول مرة أخرى.'
  };
  function fail(code, cause) { const e = new Error(MSG[code] || MSG.idb); e.code = MSG[code] ? code : 'idb'; if (cause) e.cause = cause; return e; }
  const coded = (e, code) => (e && e.code && MSG[e.code] ? e : fail(code, e));
  const isQuota = e => !!e && (e.name === 'QuotaExceededError' || e.name === 'NS_ERROR_DOM_QUOTA_REACHED' || e.code === 22);

  /* ---------- pure helpers (exported for node tests) ---------- */
  function u8of(b) { return b instanceof Uint8Array ? b : (b instanceof ArrayBuffer ? new Uint8Array(b) : null); }
  /* File type from magic bytes; the browser-declared type is only a hint. */
  function _sniff(b) {
    const u = u8of(b); if (!u || u.length < 12) return null;
    if (u[0] === 0xFF && u[1] === 0xD8 && u[2] === 0xFF) return 'image/jpeg';
    if (u[0] === 0x89 && u[1] === 0x50 && u[2] === 0x4E && u[3] === 0x47 && u[4] === 0x0D && u[5] === 0x0A && u[6] === 0x1A && u[7] === 0x0A) return 'image/png';
    if (u[0] === 0x52 && u[1] === 0x49 && u[2] === 0x46 && u[3] === 0x46 && u[8] === 0x57 && u[9] === 0x45 && u[10] === 0x42 && u[11] === 0x50) return 'image/webp';
    return null;
  }
  /* Largest integer size with the same aspect whose longest side is <= max; never upscales. */
  function _fit(w, h, max) {
    w = Math.round(+w); h = Math.round(+h); max = Math.floor(+max) || MAX_SIDE;
    if (!(w > 0 && h > 0 && Number.isFinite(w) && Number.isFinite(h))) return [0, 0];
    if (Math.max(w, h) <= max) return [w, h];
    return w >= h ? [max, Math.max(1, Math.min(max, Math.round(h * max / w)))] : [Math.max(1, Math.min(max, Math.round(w * max / h))), max];
  }
  /* Pixel size from the file header, so a 100-megapixel photo is refused before decoding it can crash an iPad tab.
     Raw (pre-EXIF-rotation) size: only the product w*h is used. null when the header is not in `b`. */
  function _dims(b) {
    const u = u8of(b), t = _sniff(u); if (!t) return null;
    const be16 = i => (u[i] << 8) | u[i + 1], le16 = i => u[i] | (u[i + 1] << 8), le24 = i => u[i] | (u[i + 1] << 8) | (u[i + 2] << 16);
    const ok = d => (d[0] > 0 && d[1] > 0 ? d : null);
    if (t === 'image/png') return u.length >= 24 && u[12] === 0x49 && u[13] === 0x48 && u[14] === 0x44 && u[15] === 0x52 ? ok([(be16(16) * 65536 + be16(18)), (be16(20) * 65536 + be16(22))]) : null;
    if (t === 'image/webp') {
      if (u.length < 30) return null;
      const fourcc = String.fromCharCode(u[12], u[13], u[14], u[15]);
      if (fourcc === 'VP8X') return ok([le24(24) + 1, le24(27) + 1]);
      if (fourcc === 'VP8L' && u[20] === 0x2F) { const v = (u[21] | (u[22] << 8) | (u[23] << 16) | (u[24] << 24)) >>> 0; return ok([(v & 0x3FFF) + 1, ((v >>> 14) & 0x3FFF) + 1]); }
      if (fourcc === 'VP8 ' && u[23] === 0x9D && u[24] === 0x01 && u[25] === 0x2A) return ok([le16(26) & 0x3FFF, le16(28) & 0x3FFF]);
      return null;
    }
    let i = 2;                                    /* JPEG: walk the segments up to the first frame header (SOFn) */
    while (i + 9 < u.length) {
      if (u[i] !== 0xFF) return null;
      const m = u[i + 1];
      if (m === 0xFF) { i++; continue; }
      if ((m >= 0xD0 && m <= 0xD9) || m === 0x01) { i += 2; continue; }
      if (m >= 0xC0 && m <= 0xCF && m !== 0xC4 && m !== 0xC8 && m !== 0xCC) return ok([be16(i + 7), be16(i + 5)]);
      i += 2 + be16(i + 2);
    }
    return null;
  }
  /* SHA-256 for pages without crypto.subtle (plain http on a LAN address): ids must match on every device. */
  function _sha256(b) {
    const u = u8of(b) || new Uint8Array(0), H = [], K = [];
    for (let p = 2, n = 0; n < 64; p++) {
      let prime = true; for (let d = 2; d * d <= p; d++) if (p % d === 0) { prime = false; break; }
      if (!prime) continue;
      if (n < 8) H[n] = (Math.pow(p, 1 / 2) * 4294967296) | 0;
      K[n++] = (Math.pow(p, 1 / 3) * 4294967296) | 0;
    }
    const len = u.length, nb = ((len + 9 + 63) >> 6) << 6, m = new Uint8Array(nb); m.set(u); m[len] = 0x80;
    const dv = new DataView(m.buffer); dv.setUint32(nb - 4, (len * 8) >>> 0); dv.setUint32(nb - 8, Math.floor(len / 0x20000000));
    const W = new Int32Array(64), r = (x, n) => (x >>> n) | (x << (32 - n));
    for (let o = 0; o < nb; o += 64) {
      for (let i = 0; i < 16; i++) W[i] = dv.getInt32(o + i * 4);
      for (let i = 16; i < 64; i++) { const a = W[i - 15], c = W[i - 2]; W[i] = (W[i - 16] + (r(a, 7) ^ r(a, 18) ^ (a >>> 3)) + W[i - 7] + (r(c, 17) ^ r(c, 19) ^ (c >>> 10))) | 0; }
      let [a, b2, c, d, e, f, g, h] = H;
      for (let i = 0; i < 64; i++) {
        const t1 = (h + (r(e, 6) ^ r(e, 11) ^ r(e, 25)) + ((e & f) ^ (~e & g)) + K[i] + W[i]) | 0;
        const t2 = ((r(a, 2) ^ r(a, 13) ^ r(a, 22)) + ((a & b2) ^ (a & c) ^ (b2 & c))) | 0;
        h = g; g = f; f = e; e = (d + t1) | 0; d = c; c = b2; b2 = a; a = (t1 + t2) | 0;
      }
      H[0] = (H[0] + a) | 0; H[1] = (H[1] + b2) | 0; H[2] = (H[2] + c) | 0; H[3] = (H[3] + d) | 0;
      H[4] = (H[4] + e) | 0; H[5] = (H[5] + f) | 0; H[6] = (H[6] + g) | 0; H[7] = (H[7] + h) | 0;
    }
    return H.map(x => (x >>> 0).toString(16).padStart(8, '0')).join('');
  }
  async function hashHex(u) {
    const s = typeof crypto !== 'undefined' && crypto.subtle;
    if (s) try { return Array.from(new Uint8Array(await s.digest('SHA-256', u)), x => x.toString(16).padStart(2, '0')).join(''); } catch (e) { /* fall back below */ }
    return _sha256(u);
  }
  function toB64(u) { let s = ''; for (let i = 0; i < u.length; i += 0x8000) s += String.fromCharCode.apply(null, u.subarray(i, i + 0x8000)); return btoa(s); }
  function fromB64(s) { const bin = atob(s), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

  /* ---------- decoding, scaling, encoding ---------- */
  const isBlob = x => typeof Blob !== 'undefined' && x instanceof Blob;
  const normType = t => { t = String(t || '').toLowerCase().split(';')[0].trim(); return t === 'image/jpg' || t === 'image/pjpeg' ? 'image/jpeg' : t; };
  function readBuf(b) {
    if (typeof b.arrayBuffer === 'function') return b.arrayBuffer();
    return new Promise((res, rej) => { const fr = new FileReader(); fr.onload = () => res(fr.result); fr.onerror = () => rej(fr.error); fr.readAsArrayBuffer(b); });
  }
  const sizeOf = im => [im.naturalWidth || im.width || 0, im.naturalHeight || im.height || 0];
  const close = im => { try { if (im && typeof im.close === 'function') im.close(); } catch (e) { /* already closed */ } };
  function imgEl(blob) {
    return new Promise((res, rej) => {
      if (typeof Image !== 'function' || typeof URL === 'undefined') return rej(new Error('no image decoder'));
      const u = URL.createObjectURL(blob), im = new Image();
      im.onload = () => { URL.revokeObjectURL(u); im.naturalWidth ? res(im) : rej(new Error('empty image')); };
      im.onerror = () => { URL.revokeObjectURL(u); rej(new Error('image decode failed')); };
      im.decoding = 'async'; im.src = u;
    });
  }
  async function decode(blob) {
    if (typeof createImageBitmap === 'function') {
      try { return await createImageBitmap(blob); } catch (e) { /* older Safari cannot decode Blobs here: try <img> */ }
    }
    return imgEl(blob);
  }
  function canvas(w, h) {
    if (typeof OffscreenCanvas === 'function') { try { const c = new OffscreenCanvas(w, h); if (c.getContext('2d')) return c; } catch (e) { /* no 2d OffscreenCanvas */ } }
    const c = document.createElement('canvas'); c.width = w; c.height = h; return c;
  }
  function ctx2d(c) {
    const x = c.getContext('2d'); if (!x) throw fail('dims');       /* the device refused a canvas this big */
    x.imageSmoothingEnabled = true; x.imageSmoothingQuality = 'high'; return x;
  }
  const free = c => { try { c.width = 0; c.height = 0; } catch (e) { /* ignore */ } };   /* iOS keeps canvas memory until resized */
  function encode(c, type, q) {
    if (typeof c.convertToBlob === 'function') return c.convertToBlob({ type, quality: q });
    return new Promise((res, rej) => c.toBlob(b => (b ? res(b) : rej(new Error('encode failed'))), type, q));
  }
  /* Halving steps keep fine lines (text in a photographed slide) that one big jump would alias away. */
  function scale(src, sw, sh, tw, th) {
    let cur = src, cw = sw, ch = sh, tmp = null;
    while (cw >= tw * 2 && ch >= th * 2) {
      const nw = Math.max(tw, Math.round(cw / 2)), nh = Math.max(th, Math.round(ch / 2)), c = canvas(nw, nh);
      ctx2d(c).drawImage(cur, 0, 0, cw, ch, 0, 0, nw, nh);
      if (tmp) free(tmp); tmp = cur = c; cw = nw; ch = nh;
    }
    const out = canvas(tw, th); ctx2d(out).drawImage(cur, 0, 0, cw, ch, 0, 0, tw, th);
    if (tmp) free(tmp);
    return out;
  }
  /* Read in strips so a 2400 px image never needs one 23 MB pixel copy at once. */
  function hasAlpha(c, w, h) {
    const x = ctx2d(c);
    for (let y = 0; y < h; y += 256) {
      const d = x.getImageData(0, y, w, Math.min(256, h - y)).data;
      for (let i = 3; i < d.length; i += 4) if (d[i] < ALPHA_MIN) return true;
    }
    return false;
  }
  async function prepare(file) {
    if (!isBlob(file)) throw fail('type');
    const declared = normType(file.type);
    if (file.size > MAX_BYTES) throw fail('size');
    let head;
    try { head = new Uint8Array(await readBuf(file.slice(0, HEAD))); } catch (e) { throw fail('decode', e); }
    const kind = _sniff(head);
    if (!kind) throw fail(ALLOWED.includes(declared) ? 'decode' : 'type');   /* claims to be an image but is not one */
    const d0 = _dims(head);
    if (d0 && d0[0] * d0[1] > MAX_PIXELS) throw fail('dims');
    let src;
    try { src = await decode(file); } catch (e) { throw fail('decode', e); }
    try {
      const [w0, h0] = sizeOf(src);
      if (!(w0 > 0 && h0 > 0)) throw fail('decode');
      if (w0 * h0 > MAX_PIXELS) throw fail('dims');
      const [w, h] = _fit(w0, h0, MAX_SIDE), c = scale(src, w0, h0, w, h);
      close(src); src = null;
      try {
        const alpha = kind !== 'image/jpeg' && hasAlpha(c, w, h), type = alpha ? 'image/png' : 'image/jpeg';
        const blob = await encode(c, type, JPEG_Q);
        const got = blob && blob.size ? _sniff(new Uint8Array(await readBuf(blob.slice(0, 16)))) : null;
        if (got !== type) throw fail('decode');
        return { blob, type, w, h, alpha };
      } finally { free(c); }
    } catch (e) { throw coded(e, 'decode'); } finally { if (src) close(src); }
  }

  /* ---------- IndexedDB ---------- */
  let dbp = null;
  function open() {
    if (dbp) return dbp;
    const p = new Promise((res, rej) => {
      let rq;
      try {
        if (typeof indexedDB === 'undefined' || !indexedDB) throw new Error('IndexedDB unavailable');
        rq = indexedDB.open(DB, 1);
      } catch (e) { return rej(fail('idb', e)); }
      rq.onupgradeneeded = () => { const d = rq.result; if (!d.objectStoreNames.contains(STORE)) d.createObjectStore(STORE); };
      rq.onsuccess = () => {
        const d = rq.result;
        d.onversionchange = () => { d.close(); if (dbp === p) dbp = null; };
        d.onclose = () => { if (dbp === p) dbp = null; };        /* Safari drops the connection after backgrounding */
        res(d);
      };
      rq.onerror = () => rej(fail(isQuota(rq.error) ? 'quota' : 'idb', rq.error));
      rq.onblocked = () => {};
    });
    dbp = p; p.catch(() => { if (dbp === p) dbp = null; });
    return p;
  }
  /* One transaction; resolves with what fn passes to set() once it commits. A dead connection is reopened once. */
  function withStore(mode, fn, retried) {
    return open().then(d => new Promise((res, rej) => {
      let t, out, err;
      try { t = d.transaction(STORE, mode); } catch (e) {
        if (dbp) dbp = null; try { d.close(); } catch (e2) { /* ignore */ }
        return retried ? rej(fail('idb', e)) : res(withStore(mode, fn, true));
      }
      const guard = f => (...a) => { try { f(...a); } catch (e) { err = err || e; try { t.abort(); } catch (e2) { /* already finished */ } } };
      t.oncomplete = () => res(out);
      t.onerror = ev => { err = err || (ev && ev.target && ev.target.error); };
      t.onabort = () => { const e = err || t.error; rej(fail(isQuota(e) ? 'quota' : 'idb', e)); };
      guard(fn)(t.objectStore(STORE), v => { out = v; }, guard);
    }));
  }
  const okId = id => typeof id === 'string' && ID.test(id);
  /* Write-if-absent inside one readwrite transaction, so two tabs adding the same picture still store it once. */
  async function store(u, type, w, h, alpha) {
    const id = 'img_' + (await hashHex(u)).slice(0, 32);
    const rec = { id, type, w, h, alpha: !!alpha, size: u.length, created: Date.now(), blob: new Blob([u], { type }) };
    const prev = await withStore('readwrite', (st, set, guard) => {
      const g = st.get(id);
      g.onsuccess = guard(() => { if (g.result) set(g.result); else st.put(rec, id); });
    });
    const r = prev || rec;
    return { id, w: r.w, h: r.h, type: r.type, alpha: !!r.alpha, size: r.size, dup: !!prev };
  }
  async function put(file) {
    const p = await prepare(file);
    let u; try { u = new Uint8Array(await readBuf(p.blob)); } catch (e) { throw fail('decode', e); }
    return store(u, p.type, p.w, p.h, p.alpha);
  }
  /* صورة وصلت من حساب الطالب على جهاز آخر: تُحفظ بالمعرّف نفسه الذي رفعها (بلا إعادة ضغط، فالمعرّف لا يتغير) */
  async function putRaw(id, u, type) {
    if (!okId(id)) throw fail('type');
    const d = _dims(u); if (!d) throw fail('decode');
    const rec = { id, type, w: d[0], h: d[1], alpha: type === 'image/png', size: u.length, created: Date.now(), blob: new Blob([u], { type }) };
    await withStore('readwrite', (st, set, guard) => {
      const g = st.get(id);
      g.onsuccess = guard(() => { if (!g.result) st.put(rec, id); set(true); });
    });
    return id;
  }
  async function get(id) {
    if (!okId(id)) return null;
    const r = await withStore('readonly', (st, set) => { const g = st.get(id); g.onsuccess = () => set(g.result || null); });
    return r && isBlob(r.blob) ? r : null;
  }
  async function bytes(id) {
    const r = await get(id); if (!r) return null;
    try { return { bytes: new Uint8Array(await readBuf(r.blob)), type: r.type }; } catch (e) { throw fail('idb', e); }
  }
  async function has(id) {
    if (!okId(id)) return false;
    return !!(await withStore('readonly', (st, set) => { const q = st.count(id); q.onsuccess = () => set(q.result > 0); }));
  }
  async function ids() {
    return (await withStore('readonly', (st, set) => {
      if (typeof st.getAllKeys === 'function') { const q = st.getAllKeys(); q.onsuccess = () => set(q.result.map(String)); return; }
      const out = [], q = st.openCursor(); set(out);
      q.onsuccess = () => { const c = q.result; if (c) { out.push(String(c.key)); c.continue(); } };
    })) || [];
  }
  async function estimate() {
    try { return nav.storage && typeof nav.storage.estimate === 'function' ? await nav.storage.estimate() : null; } catch (e) { return null; }
  }

  /* ---------- decoded images: LRU by pixel count (render loops peek every frame) ---------- */
  const cache = new Map(), inflight = new Map();
  let cachePx = 0;
  function remember(id, img) {
    const [w, h] = sizeOf(img), px = Math.max(1, w * h);
    cache.set(id, { img, px }); cachePx += px;
    for (const [k, e] of cache) {                 /* oldest first; the image just returned is never closed */
      if (cachePx <= BUDGET) break;
      if (k === id) continue;
      cache.delete(k); cachePx -= e.px; close(e.img);
    }
  }
  function peek(id) {
    const e = cache.get(id); if (!e) return null;
    cache.delete(id); cache.set(id, e);           /* drawn this frame = most recently used */
    return e.img;
  }
  function bitmap(id) {
    const hit = peek(id); if (hit) return Promise.resolve(hit);
    if (inflight.has(id)) return inflight.get(id);
    const p = get(id)
      .then(r => (r ? decode(r.blob).catch(() => null) : null))
      .then(img => { inflight.delete(id); if (img) remember(id, img); return img; },
            e => { inflight.delete(id); throw coded(e, 'idb'); });
    inflight.set(id, p);
    return p;
  }

  /* ---------- backups (JSON) ---------- */
  async function dataUrl(id) {
    const b = await bytes(id); if (!b) return null;
    return 'data:' + b.type + ';base64,' + toB64(b.bytes);
  }
  /* Our own PNG/JPEG bytes are kept exactly (same hash, so the restored id matches the strokes); anything else is
     prepared like a fresh insert. */
  async function putDataUrl(url) {
    const m = typeof url === 'string' ? /^data:([\w.+-]+\/[\w.+-]+)?((?:;[\w.+-]+=[^;,]*)*);base64,/i.exec(url.slice(0, 256)) : null;
    if (!m) throw fail('type');
    const b64 = url.slice(m[0].length).replace(/\s+/g, '');
    if (Math.floor(b64.length * 3 / 4) > MAX_BYTES + 2) throw fail('size');
    let u; try { u = fromB64(b64); } catch (e) { throw fail('decode', e); }
    if (u.length > MAX_BYTES) throw fail('size');
    const kind = _sniff(u);
    if (kind === 'image/png' || kind === 'image/jpeg') {
      const img = await decode(new Blob([u], { type: kind })).catch(() => null);
      if (img) {
        let keep = null;
        try {
          const [w, h] = sizeOf(img);
          if (w > 0 && h > 0 && Math.max(w, h) <= MAX_SIDE) {
            let alpha = false;
            if (kind === 'image/png') { const c = canvas(w, h); try { ctx2d(c).drawImage(img, 0, 0); alpha = hasAlpha(c, w, h); } finally { free(c); } }
            keep = { w, h, alpha };
          }
        } catch (e) { keep = null; } finally { close(img); }
        if (keep) return store(u, kind, keep.w, keep.h, keep.alpha);
      }
    }
    return put(new Blob([u], { type: kind || normType(m[1]) }));
  }

  return {
    prepare, put, putRaw, get, bytes, has, ids, estimate, bitmap, peek, dataUrl, putDataUrl,
    LIMITS: { bytes: MAX_BYTES, pixels: MAX_PIXELS, side: MAX_SIDE, alphaMin: ALPHA_MIN, quality: JPEG_Q, budget: BUDGET },
    MESSAGES: MSG, _sniff, _fit, _dims, _sha256
  };
});
