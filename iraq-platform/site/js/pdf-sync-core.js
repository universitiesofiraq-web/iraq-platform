/* js/pdf-sync-core.js — منطق مزامنة كتابة الطالب وتظليله وبطاقاته على ملفات PDF مع حسابه (Step 63).
   دوال نقية بلا شبكة ولا تخزين (تعمل في المتصفح وفي Node للفحص): تقسيم الكتابة إلى صفوف لكل صفحة، ودمج ثلاثي (3-way) بالمعرّف.
   الدمج الثلاثي يقارن: ما اتفق عليه الجهاز والخادم في آخر مزامنة (base)، وما في الجهاز الآن (local)، وما في الخادم الآن (remote).
   النتيجة: كل ما أضافه أي طرف يبقى، وما حذفه أحد الطرفين (ولم يعدّله الآخر) يُحذف، وما عدّله طرف وحذفه الآخر يبقى (لا نخسر عمل الطالب). */
(function (root) {
  'use strict';

  /* ---------- تجزئة ثابتة ---------- */
  function cyrb53(str, seed) {
    let h1 = 0xdeadbeef ^ (seed || 0), h2 = 0x41c6ce57 ^ (seed || 0);
    for (let i = 0; i < str.length; i++) {
      const ch = str.charCodeAt(i);
      h1 = Math.imul(h1 ^ ch, 2654435761);
      h2 = Math.imul(h2 ^ ch, 1597334677);
    }
    h1 = Math.imul(h1 ^ (h1 >>> 16), 2246822507) ^ Math.imul(h2 ^ (h2 >>> 13), 3266489909);
    h2 = Math.imul(h2 ^ (h2 >>> 16), 2246822507) ^ Math.imul(h1 ^ (h1 >>> 13), 3266489909);
    return 4294967296 * (2097151 & h2) + (h1 >>> 0);
  }
  /* JSON بترتيب مفاتيح ثابت، حتى لا يختلف الناتج بين جهازين لمجرد ترتيب الخصائص */
  function stable(v) {
    if (Array.isArray(v)) return '[' + v.map(stable).join(',') + ']';
    if (v && typeof v === 'object') return '{' + Object.keys(v).sort().map(k => JSON.stringify(k) + ':' + stable(v[k])).join(',') + '}';
    return JSON.stringify(v === undefined ? null : v);
  }
  const hashOf = v => cyrb53(stable(v)).toString(36);
  /* معرّف الملف: 24 حرفاً سداسياً من مساره (لا يحمل اسم الملف ولا النطاق) */
  function docId(path) {
    const hex = n => (n >>> 0).toString(16).padStart(8, '0');
    return hex(cyrb53(path, 1)) + hex(cyrb53(path, 2)) + hex(cyrb53(path, 3));
  }
  const keyOf = it => (it && typeof it.id === 'string' && it.id) ? it.id : 'h:' + hashOf(it);
  const rev = it => (it && typeof it.rev === 'number' && Number.isFinite(it.rev)) ? it.rev : 1;

  /* لقطة: مفتاح العنصر ← تجزئته */
  function snap(items) { const o = {}; for (const it of items || []) o[keyOf(it)] = hashOf(it); return o; }

  /* ---------- الدمج الثلاثي لقائمة عناصر ---------- */
  function merge3(base, local, remote) {
    base = base || {};
    const L = new Map(), R = new Map(), order = [];
    for (const it of remote || []) { const k = keyOf(it); if (!R.has(k)) { R.set(k, it); order.push(k); } }
    for (const it of local || []) { const k = keyOf(it); if (!L.has(k)) { L.set(k, it); if (!R.has(k)) order.push(k); } }
    const out = [];
    for (const k of order) {
      const l = L.get(k), r = R.get(k), inB = Object.prototype.hasOwnProperty.call(base, k);
      if (l && r) {
        const hl = hashOf(l), hr = hashOf(r);
        if (hl === hr) { out.push(r); continue; }
        const lc = !inB || hl !== base[k], rc = !inB || hr !== base[k];
        if (lc && !rc) out.push(l);
        else if (rc && !lc) out.push(r);
        else out.push(rev(r) > rev(l) ? r : l);                    // عدّله الطرفان: الأعلى rev، وعند التساوي الجهاز
      } else if (l) {                                              // عند الجهاز فقط
        if (!inB) out.push(l);                                     // أضافه الجهاز
        else if (hashOf(l) !== base[k]) out.push(l);               // حذفه الخادم لكن الجهاز عدّله: نبقيه
        /* وإلا حذفه الخادم والجهاز لم يعدّله: يُحذف */
      } else if (r) {                                              // عند الخادم فقط
        if (!inB) out.push(r);                                     // أضافه الجهاز الآخر
        else if (hashOf(r) !== base[k]) out.push(r);               // حذفه الجهاز لكن الخادم عدّله: نبقيه
        /* وإلا حذفه الجهاز ولم يعدّله الخادم: يُحذف */
      }
    }
    return out;
  }

  /* ---------- أنواع الصفوف ---------- */
  const STUDY_FIELDS = ['masks', 'cards', 'notes', 'quiz', 'maps'];
  const isObj = v => v && typeof v === 'object' && !Array.isArray(v);
  const pageOf = it => (it && Number.isInteger(it.page) && it.page >= 1 && it.page <= 9999) ? it.page : 0;

  const KINDS = {
    ink: {
      empty: d => !d || !d.length,
      blank: () => [],
      valid: d => Array.isArray(d),
      snap: d => snap(d),
      merge: (b, l, r) => merge3(b, l, r)
    },
    study: {
      empty: d => !d || STUDY_FIELDS.every(f => !Array.isArray(d[f]) || !d[f].length),
      blank: () => ({}),
      valid: d => isObj(d),
      snap: d => { const o = {}; for (const f of STUDY_FIELDS) o[f] = snap(Array.isArray(d && d[f]) ? d[f] : []); return o; },
      merge: (b, l, r) => {
        l = l || {}; r = r || {}; b = b || {};
        const out = Object.assign({}, r, l);                        // الحقول الأخرى (غير القوائم): قيمة الجهاز
        for (const f of STUDY_FIELDS) {
          const m = merge3(b[f], Array.isArray(l[f]) ? l[f] : [], Array.isArray(r[f]) ? r[f] : []);
          if (m.length || Array.isArray(l[f]) || Array.isArray(r[f])) out[f] = m;
        }
        return out;
      }
    },
    layout: {
      empty: d => !d || (!Object.keys(d.margins || {}).length && !(d.blanks || []).length && d.order == null),
      blank: () => ({}),
      valid: d => isObj(d),
      snap: d => hashOf(d || {}),
      merge: (b, l, r) => {                                         // هوامش وصفحات فارغة: إن لم يعدّل الجهاز (أو لم يكن عنده شيء) نأخذ الخادم، وإلا الجهاز
        if (!l || KINDS.layout.empty(l)) return r;
        return (b && hashOf(l) === b) ? r : l;
      }
    }
  };
  const kindOf = k => k.indexOf('ink:') === 0 ? 'ink' : k;

  /* ---------- من التخزين المحلي إلى صفوف ---------- */
  /* local = {ink: مصفوفة|null, study: كائن|null, layout: كائن|null}. يعيد {صف: بيانات} (الصفحات التي فيها عناصر فقط) */
  function localRows(local) {
    const rows = {};
    if (Array.isArray(local.ink)) {
      for (const it of local.ink) { const k = 'ink:' + pageOf(it); (rows[k] = rows[k] || []).push(it); }
    }
    if (isObj(local.study)) rows.study = local.study;
    if (isObj(local.layout)) rows.layout = local.layout;
    return rows;
  }
  /* من صفوف الصفحات إلى قائمة واحدة مرتبة بالصفحة (خطوط الصفحة نفسها تبقى بترتيبها) */
  function inkList(rows) {
    return Object.keys(rows).filter(k => k.indexOf('ink:') === 0).sort((a, b) => Number(a.slice(4)) - Number(b.slice(4)))
      .reduce((all, k) => all.concat(rows[k]), []);
  }

  /* ---------- خطة المزامنة عند فتح الصفحة ---------- */
  /* remote: {k: {d: نص, t: رقم}}؛ state: {rows: {k: {t, h, base}}}؛ لا تغيّر مدخلاتها.
     تعيد {rows: {k: {data, write, push:{d,base}|null, state:{t,h,base}|null, skip?}}, writeLocal:{ink,study,layout}} */
  function plan(local, remote, state) {
    const lrows = localRows(local), st = (state && state.rows) || {};
    const keys = new Set([...Object.keys(lrows), ...Object.keys(remote || {}), ...Object.keys(st).filter(k => k.indexOf('ink:') === 0 || k === 'study' || k === 'layout')]);
    const out = {}, changedKinds = new Set();
    for (const k of keys) {
      const kind = KINDS[kindOf(k)];
      if (!kind) continue;
      let L = lrows[k]; if (L === undefined) L = kind.blank();
      let R = null, rawR = remote && remote[k];
      if (rawR) { try { R = JSON.parse(rawR.d); } catch { R = null; } if (!kind.valid(R)) { out[k] = { skip: 'bad_remote' }; continue; } }
      const s = st[k], hl = hashOf(L), res = { data: L, write: false, push: null, state: null };
      if (!rawR) {
        if (!kind.empty(L)) res.push = { d: JSON.stringify(L), base: null };
      } else if (s && s.t === rawR.t) {
        if (hl !== s.h) res.push = { d: JSON.stringify(L), base: rawR.t };
      } else {
        const merged = kind.merge(s ? s.base : (kind === KINDS.layout ? null : {}), L, R);
        const hm = hashOf(merged);
        res.data = merged;
        if (hm !== hl) { res.write = true; changedKinds.add(kindOf(k)); }
        if (hm !== hashOf(R)) res.push = { d: JSON.stringify(merged), base: rawR.t };
        else res.state = { t: rawR.t, h: hm, base: kind.snap(merged) };
      }
      out[k] = res;
    }
    const writeLocal = {};
    if (changedKinds.has('ink')) {
      const rows = {}; for (const k of Object.keys(out)) if (k.indexOf('ink:') === 0 && out[k].data) rows[k] = out[k].data;
      // صفحات لم تتغير تبقى كما في الجهاز
      for (const k of Object.keys(lrows)) if (k.indexOf('ink:') === 0 && !rows[k]) rows[k] = lrows[k];
      writeLocal.ink = inkList(rows);
    }
    if (out.study && out.study.write) writeLocal.study = out.study.data;
    if (out.layout && out.layout.write) writeLocal.layout = out.layout.data;
    return { rows: out, writeLocal };
  }

  /* ---------- أثناء الجلسة: ما الذي تغيّر منذ آخر مزامنة؟ (لا دمج هنا؛ التعارض يُحلّ عند فتح الصفحة التالية) ---------- */
  function dirtyRows(local, state) {
    const lrows = localRows(local), st = (state && state.rows) || {}, out = [];
    const keys = new Set([...Object.keys(lrows), ...Object.keys(st)]);
    for (const k of keys) {
      const kind = KINDS[kindOf(k)]; if (!kind) continue;
      const L = lrows[k] === undefined ? kind.blank() : lrows[k], s = st[k];
      if (!s && kind.empty(L)) continue;
      if (s && s.h === hashOf(L)) continue;
      out.push({ k, data: L, d: JSON.stringify(L), base: s ? s.t : null });
    }
    return out;
  }
  /* حالة الصف بعد حفظ ناجح */
  function stateAfterPush(k, data, t) { return { t, h: hashOf(data), base: KINDS[kindOf(k)].snap(data) }; }

  const api = { cyrb53, stable, hashOf, docId, keyOf, snap, merge3, localRows, inkList, plan, dirtyRows, stateAfterPush, STUDY_FIELDS };
  if (typeof module !== 'undefined' && module.exports) module.exports = api; else root.MedixaPdfSyncCore = api;
})(typeof window !== 'undefined' ? window : globalThis);
