/* qb-logic-client.js — نسخة العميل من المنطق الشرطي (تطابق functions/_lib/qb_logic.js؛ يفحص التطابق tests/qb_logic.test.mjs).
   الخادم هو المرجع عند التصحيح؛ هذه النسخة لإخفاء/إظهار الأسئلة أثناء الحل فقط. */
(function (g) {
  "use strict";
  var isObj = function (v) { return v !== null && typeof v === "object" && !Array.isArray(v); };
  var isEmpty = function (a) { return a === undefined || a === null || a === "" || (Array.isArray(a) && a.length === 0) || (isObj(a) && Object.keys(a).length === 0); };
  var norm = function (a) { return Array.isArray(a) ? JSON.stringify(a.slice().map(String).sort()) : isObj(a) ? JSON.stringify(Object.keys(a).sort().map(function (k) { return [k, String(a[k])]; })) : String(a); };
  function conditionMet(op, value, answer) {
    if (op === "answered") return !isEmpty(answer);
    if (op === "notanswered") return isEmpty(answer);
    if (isEmpty(answer)) return op === "ne";
    if (op === "eq") return norm(answer) === norm(value);
    if (op === "ne") return norm(answer) !== norm(value);
    if (op === "in") {
      var list = Array.isArray(value) ? value.map(String) : [String(value)];
      return Array.isArray(answer) ? answer.some(function (x) { return list.indexOf(String(x)) >= 0; }) : list.indexOf(String(answer)) >= 0;
    }
    return false;
  }
  function computeVisible(items, rules, answers, opts) {
    var disabled = !!(opts && opts.disabled);
    var ordered = items.slice().sort(function (a, b) { return a.position - b.position; });
    var visible = new Set();
    if (disabled || !Array.isArray(rules) || !rules.length) { ordered.forEach(function (i) { visible.add(i.id); }); return visible; }
    var showIf = new Map(), jumps = new Map(), pos = new Map(ordered.map(function (i) { return [i.id, i.position]; }));
    rules.forEach(function (r) {
      var m = r.kind === "show_if" ? showIf : jumps, key = r.kind === "show_if" ? r.target : r.source;
      if (!m.has(key)) m.set(key, []);
      m.get(key).push(r);
    });
    var ans = isObj(answers) ? answers : {};
    var answerOf = function (id) { return visible.has(id) && Object.prototype.hasOwnProperty.call(ans, id) ? ans[id] : undefined; };
    var skipBefore = -Infinity;
    ordered.forEach(function (it) {
      var show = it.position >= skipBefore;
      if (show && showIf.has(it.id)) show = showIf.get(it.id).some(function (r) { return visible.has(r.source) && conditionMet(r.op, r.value, answerOf(r.source)); });
      if (!show) return;
      visible.add(it.id);
      (jumps.get(it.id) || []).forEach(function (r) { if (conditionMet(r.op, r.value, answerOf(r.source))) skipBefore = Math.max(skipBefore, pos.has(r.target) ? pos.get(r.target) : -Infinity); });
    });
    return visible;
  }
  g.QBLogic = { conditionMet: conditionMet, computeVisible: computeVisible };
  if (typeof module !== "undefined") module.exports = g.QBLogic;
})(typeof window !== "undefined" ? window : globalThis);
