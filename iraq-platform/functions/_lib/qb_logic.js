// functions/_lib/qb_logic.js — المنطق الشرطي للاختبارات (دوال نقية).
// نوعان من القواعد، وكلاهما إلى الأمام فقط (المصدر يسبق الهدف في الترتيب) فلا حلقات ولا مسارات غير صالحة بحكم البناء:
//   show_if: يظهر عنصر الهدف فقط إن تحقق شرط على إجابة سؤال سابق (عدّة قواعد لهدف واحد = أيٌّ منها).
//   jump:    إن تحقق الشرط تُخفى العناصر الواقعة بين المصدر والهدف (الهدف نفسه يظهر).
// لا يوجد عامل «صحيح/خاطئ»: الشروط على قيمة الإجابة فقط، فلا يكشف المنطق صحة الإجابة.
// في الامتحانات الرسمية يُعطَّل المنطق الشرطي كلياً (التحقق يرفضه واللقطة تتجاهله).

export const OPS = Object.freeze(["eq", "ne", "in", "answered", "notanswered"]);
export const RULE_KINDS = Object.freeze(["show_if", "jump"]);
export const MAX_RULES = 200;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
export const logicDisabled = (settings, mode) => !!(settings && settings.official) && mode === "exam";

const isEmptyAnswer = (a) => a === undefined || a === null || a === "" || (Array.isArray(a) && a.length === 0) || (isObj(a) && Object.keys(a).length === 0);
const norm = (a) => (Array.isArray(a) ? JSON.stringify([...a].map(String).sort()) : isObj(a) ? JSON.stringify(Object.keys(a).sort().map((k) => [k, String(a[k])])) : String(a));

export function conditionMet(op, value, answer) {
  if (op === "answered") return !isEmptyAnswer(answer);
  if (op === "notanswered") return isEmptyAnswer(answer);
  if (isEmptyAnswer(answer)) return op === "ne";
  if (op === "eq") return norm(answer) === norm(value);
  if (op === "ne") return norm(answer) !== norm(value);
  if (op === "in") {
    const list = Array.isArray(value) ? value.map(String) : [String(value)];
    return Array.isArray(answer) ? answer.some((x) => list.includes(String(x))) : list.includes(String(answer));
  }
  return false;
}

// items: [{id, kind, position}]؛ rules: [{kind, source, op, value, target}] (معرّفات عناصر).
export function validateRules(items, rules, { mode = "practice", official = false } = {}) {
  const errors = [];
  if (!Array.isArray(rules) || !rules.length) return { ok: true, errors };
  if (official && mode === "exam") return { ok: false, errors: ["المنطق الشرطي معطّل في الامتحانات الرسمية"] };
  if (rules.length > MAX_RULES) return { ok: false, errors: ["عدد القواعد أكبر من المسموح"] };
  const byId = new Map(items.map((i) => [i.id, i]));
  rules.forEach((r, n) => {
    const at = "القاعدة " + (n + 1) + ": ";
    if (!isObj(r) || !RULE_KINDS.includes(r.kind)) return errors.push(at + "نوع غير صالح");
    if (!OPS.includes(r.op)) return errors.push(at + "عامل مقارنة غير صالح");
    const s = byId.get(r.source), t = byId.get(r.target);
    if (!s || !t) return errors.push(at + "عنصر غير موجود");
    if (s.kind !== "question") return errors.push(at + "المصدر يجب أن يكون سؤالاً");
    if (s.position >= t.position) return errors.push(at + "الهدف يجب أن يأتي بعد المصدر (لا رجوع للخلف)");
    if (r.kind === "show_if" && t.kind === "pagebreak") return errors.push(at + "لا يُشترط على فاصل الصفحة");
    if ((r.op === "eq" || r.op === "ne" || r.op === "in") && (r.value === undefined || r.value === null || r.value === "")) return errors.push(at + "قيمة المقارنة مطلوبة");
    if (JSON.stringify(r.value ?? null).length > 2000) return errors.push(at + "قيمة المقارنة طويلة");
  });
  return { ok: errors.length === 0, errors };
}

// يعيد Set بمعرّفات العناصر الظاهرة. إجابة عنصر مخفي لا تُعتد بها في قواعد غيره.
export function computeVisible(items, rules, answers, { disabled = false } = {}) {
  const ordered = [...items].sort((a, b) => a.position - b.position);
  const visible = new Set();
  if (disabled || !Array.isArray(rules) || !rules.length) { ordered.forEach((i) => visible.add(i.id)); return visible; }
  const showIf = new Map(), jumps = new Map(), pos = new Map(ordered.map((i) => [i.id, i.position]));
  for (const r of rules) {
    const m = r.kind === "show_if" ? showIf : jumps;
    const key = r.kind === "show_if" ? r.target : r.source;
    if (!m.has(key)) m.set(key, []);
    m.get(key).push(r);
  }
  const ans = isObj(answers) ? answers : {};
  const answerOf = (id) => (visible.has(id) && Object.prototype.hasOwnProperty.call(ans, id) ? ans[id] : undefined);
  let skipBefore = -Infinity;
  for (const it of ordered) {
    let show = it.position >= skipBefore;
    if (show && showIf.has(it.id)) show = showIf.get(it.id).some((r) => visible.has(r.source) && conditionMet(r.op, r.value, answerOf(r.source)));
    if (!show) continue;
    visible.add(it.id);
    for (const r of jumps.get(it.id) || []) if (conditionMet(r.op, r.value, answerOf(r.source))) skipBefore = Math.max(skipBefore, pos.get(r.target) ?? -Infinity);
  }
  return visible;
}
