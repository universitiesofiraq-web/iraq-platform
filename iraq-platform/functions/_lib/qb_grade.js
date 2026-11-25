// functions/_lib/qb_grade.js — محرك أسئلة وتصحيح بنك الأسئلة (دوال نقية: بلا قاعدة بيانات ولا شبكة).
// القاعدة الأمنية: التصحيح يجري على الخادم فقط، وما يُرسَل للطالب يمر عبر publicQuestion() التي تحذف مفاتيح الإجابة.
// الأنواع: sba | mcq | mrq | tf | emq | saq | essay | fill | matching | ordering | numerical
// (clinical حالة سريرية: حاوية لا تُصحَّح بنفسها؛ أسئلتها الفرعية تُصحَّح كل على حدة.)

export const QUESTION_TYPES = Object.freeze(["sba", "mcq", "mrq", "tf", "emq", "saq", "essay", "fill", "matching", "ordering", "numerical"]);
const MANUAL_ONLY = new Set(["essay"]);
const MAX_TEXT = 8000, MAX_ITEMS = 60, MAX_ANSWER_LEN = 4000;

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const str = (v) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "");
const round = (n) => Math.round(n * 10000) / 10000 + 0; // + 0 يحوّل -0 إلى 0
const has = (o, k) => Object.prototype.hasOwnProperty.call(o, k);

/* ---------- تطبيع النصوص والأرقام ---------- */
// يوحّد الحروف العربية (ألف/ياء/تاء مربوطة) ويحذف التشكيل والتطويل ويطوي المسافات.
export function normalizeText(v, { caseSensitive = false } = {}) {
  let s = str(v).normalize("NFKC").replace(/[ً-ٰٟـ]/g, "");
  s = s.replace(/[إأآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
  s = s.replace(/\s+/g, " ").trim();
  return caseSensitive ? s : s.toLowerCase();
}

// يقبل الأرقام العربية-الهندية والفاصلة العشرية. يعيد null إن لم يكن رقماً صالحاً.
export function parseNumber(v) {
  if (typeof v === "number") return Number.isFinite(v) ? v : null;
  let s = str(v).trim();
  if (!s || s.length > 40) return null;
  s = s.replace(/[٠-٩]/g, (d) => String(d.charCodeAt(0) - 0x0660)).replace(/[۰-۹]/g, (d) => String(d.charCodeAt(0) - 0x06f0));
  s = s.replace(/٫/g, ".").replace(/٬/g, "").replace(/\s/g, "");
  if (/^-?\d+,\d+$/.test(s)) s = s.replace(",", ".");
  else s = s.replace(/,/g, "");
  if (!/^[-+]?(\d+\.?\d*|\.\d+)(e[-+]?\d+)?$/i.test(s)) return null;
  const n = Number(s);
  return Number.isFinite(n) ? n : null;
}

/* ---------- خلط حتمي (يعيد الخادم إنتاج الترتيب نفسه من البذرة) ---------- */
function seedFrom(text) {
  let h = 1779033703 ^ text.length;
  for (let i = 0; i < text.length; i++) { h = Math.imul(h ^ text.charCodeAt(i), 3432918353); h = (h << 13) | (h >>> 19); }
  return () => { h = Math.imul(h ^ (h >>> 16), 2246822507); h = Math.imul(h ^ (h >>> 13), 3266489909); return ((h ^= h >>> 16) >>> 0) / 4294967296; };
}
export function seededShuffle(list, seed) {
  const rnd = seedFrom(String(seed)), a = list.slice();
  for (let i = a.length - 1; i > 0; i--) { const j = Math.floor(rnd() * (i + 1)); [a[i], a[j]] = [a[j], a[i]]; }
  return a;
}

/* ---------- التحقق من صحة السؤال ---------- */
const uniqueIds = (list) => new Set(list.map((x) => x.id)).size === list.length;
const okId = (v) => typeof v === "string" && /^[\w.\-:]{1,40}$/.test(v);

export function validateQuestion(q) {
  const errors = [];
  const err = (m) => errors.push(m);
  if (!isObj(q)) return { ok: false, errors: ["السؤال ليس كائناً"] };
  if (!QUESTION_TYPES.includes(q.type)) return { ok: false, errors: ["نوع سؤال غير معروف"] };
  if (!str(q.text).trim() || str(q.text).length > MAX_TEXT) err("نص السؤال فارغ أو أطول من المسموح");
  if (!(typeof q.points === "number" && q.points > 0 && q.points <= 1000)) err("الدرجة يجب أن تكون رقماً موجباً");
  if (q.negative !== undefined) {
    if (!isObj(q.negative)) err("إعداد الدرجة السالبة غير صالح");
    else if (q.negative.enabled && !(typeof q.negative.penalty === "number" && q.negative.penalty > 0 && q.negative.penalty <= q.points)) err("العقوبة يجب أن تكون بين 0 ودرجة السؤال");
  }
  const optList = (list, min) => {
    if (!Array.isArray(list) || list.length < min || list.length > MAX_ITEMS) return err("عدد الخيارات غير صالح"), false;
    if (!list.every((o) => isObj(o) && okId(o.id) && str(o.text).trim())) return err("خيار بلا معرّف أو نص"), false;
    if (!uniqueIds(list)) return err("معرّفات خيارات مكررة"), false;
    return true;
  };
  const t = q.type;
  if (t === "sba" || t === "mcq") {
    if (optList(q.options, 2) && !q.options.some((o) => o.id === q.correct)) err("الإجابة الصحيحة ليست ضمن الخيارات");
  } else if (t === "mrq") {
    if (optList(q.options, 2)) {
      if (!Array.isArray(q.correct) || !q.correct.length || !q.correct.every((c) => q.options.some((o) => o.id === c)) || new Set(q.correct).size !== q.correct.length) err("إجابات MRQ الصحيحة غير صالحة");
    }
    if (q.scoring !== undefined && !["all", "partial"].includes(q.scoring)) err("نمط التصحيح غير صالح");
  } else if (t === "tf") {
    if (typeof q.correct !== "boolean") err("إجابة صح/خطأ يجب أن تكون true أو false");
  } else if (t === "emq") {
    if (optList(q.options, 2)) {
      if (!Array.isArray(q.items) || !q.items.length || q.items.length > MAX_ITEMS || !q.items.every((i) => isObj(i) && okId(i.id) && str(i.text).trim() && q.options.some((o) => o.id === i.correct)) || !uniqueIds(q.items)) err("بنود EMQ غير صالحة");
    }
  } else if (t === "matching") {
    if (!Array.isArray(q.pairs) || q.pairs.length < 2 || q.pairs.length > MAX_ITEMS || !q.pairs.every((p) => isObj(p) && okId(p.id) && okId(p.rid) && str(p.left).trim() && str(p.right).trim()) || !uniqueIds(q.pairs) || new Set(q.pairs.map((p) => p.rid)).size !== q.pairs.length) err("أزواج المطابقة غير صالحة (rid مطلوب وفريد)");
  } else if (t === "ordering") {
    optList(q.order, 2);
    if (q.scoring !== undefined && !["all", "partial"].includes(q.scoring)) err("نمط التصحيح غير صالح");
  } else if (t === "fill") {
    if (!Array.isArray(q.blanks) || !q.blanks.length || q.blanks.length > MAX_ITEMS || !q.blanks.every((b) => isObj(b) && okId(b.id) && Array.isArray(b.accepted) && b.accepted.length && b.accepted.every((a) => str(a).trim())) || !uniqueIds(q.blanks)) err("فراغات الإكمال غير صالحة");
  } else if (t === "saq") {
    if (q.accepted !== undefined && !(Array.isArray(q.accepted) && q.accepted.every((a) => str(a).trim()))) err("الإجابات المقبولة غير صالحة");
  } else if (t === "numerical") {
    const n = q.numeric;
    if (!isObj(n) || !Number.isFinite(n.value)) err("القيمة الرقمية الصحيحة مطلوبة");
    else if (n.tolerance !== undefined && !(Number.isFinite(n.tolerance) && n.tolerance >= 0)) err("هامش الخطأ غير صالح");
    else if (n.mode !== undefined && !["abs", "percent"].includes(n.mode)) err("نوع هامش الخطأ غير صالح");
  }
  return { ok: errors.length === 0, errors };
}

/* ---------- ما يراه الطالب: بلا مفاتيح الإجابة ---------- */
// seed: معرّف المحاولة، فيتكرر الخلط نفسه عند إعادة التحميل ويعرفه الخادم عند التصحيح.
export function publicQuestion(q, seed = "") {
  const base = { id: q.id, type: q.type, text: q.text, points: q.points };
  if (q.media) base.media = q.media;
  if (q.caseId) base.caseId = q.caseId;
  if (q.required) base.required = true;
  const mix = (list) => (q.shuffle ? seededShuffle(list, seed + ":" + q.id) : list);
  const opts = (list) => list.map((o) => ({ id: o.id, text: o.text }));
  switch (q.type) {
    case "sba": case "mcq": return { ...base, options: opts(mix(q.options)) };
    case "mrq": return { ...base, options: opts(mix(q.options)), selectCount: q.correct.length };
    case "tf": return base;
    case "emq": return { ...base, options: opts(mix(q.options)), items: q.items.map((i) => ({ id: i.id, text: i.text })) };
    case "matching": return { ...base, left: q.pairs.map((p) => ({ id: p.id, text: p.left })), right: seededShuffle(q.pairs.map((p) => ({ id: p.rid, text: p.right })), seed + ":" + q.id) };
    case "ordering": return { ...base, items: seededShuffle(opts(q.order), seed + ":" + q.id) };
    case "fill": return { ...base, blanks: q.blanks.map((b) => ({ id: b.id })) };
    case "numerical": return { ...base, unit: q.numeric.unit || undefined };
    default: return base; // saq, essay
  }
}

/* الشرح والتغذية الراجعة تُعرض بعد الإجابة فقط وحسب إعدادات الاختبار. */
export function revealQuestion(q) {
  const out = { id: q.id, explanation: q.explanation || null, source: q.source || null, feedbackCorrect: q.feedbackCorrect || null, feedbackWrong: q.feedbackWrong || null };
  switch (q.type) {
    case "sba": case "mcq": case "tf": out.correct = q.correct; break;
    case "mrq": out.correct = q.correct.slice(); break;
    case "emq": out.correct = Object.fromEntries(q.items.map((i) => [i.id, i.correct])); break;
    case "matching": out.correct = Object.fromEntries(q.pairs.map((p) => [p.id, p.rid])); break;
    case "ordering": out.correct = q.order.map((o) => o.id); break;
    case "fill": out.correct = Object.fromEntries(q.blanks.map((b) => [b.id, b.accepted[0]])); break;
    case "saq": out.correct = (q.accepted || []).slice(0, 1); break;
    case "numerical": out.correct = q.numeric.value; break;
    default: break;
  }
  return out;
}

/* ---------- لقطة ثابتة تُخزَّن مع كل محاولة ---------- */
export function snapshotQuestion(q) {
  const v = validateQuestion(q);
  if (!v.ok) throw new Error("invalid_question: " + v.errors[0]);
  return JSON.parse(JSON.stringify(q));
}

/* ---------- التصحيح ---------- */
function result(q, score, status, detail) {
  return { id: q.id, score: round(score), max: q.points, status, ...(detail ? { detail } : {}) };
}
const unanswered = (q) => result(q, 0, "unanswered");
const penaltyOf = (q) => (q.negative && q.negative.enabled ? q.negative.penalty : 0);
const wrong = (q, detail) => result(q, -penaltyOf(q), "wrong", detail);
const clamp = (q, v) => Math.max(-penaltyOf(q), Math.min(q.points, v));

function gradeOne(q, ans) {
  const t = q.type;
  if (MANUAL_ONLY.has(t)) return str(ans).trim() ? { id: q.id, score: null, max: q.points, status: "pending" } : unanswered(q);
  const empty = ans === undefined || ans === null || ans === "" || (Array.isArray(ans) && !ans.length) || (isObj(ans) && !Object.keys(ans).length);
  if (empty) return unanswered(q);

  if (t === "sba" || t === "mcq") return ans === q.correct ? result(q, q.points, "correct") : wrong(q);

  if (t === "tf") {
    const v = ans === true || ans === "true" ? true : ans === false || ans === "false" ? false : null;
    if (v === null) return unanswered(q);
    return v === q.correct ? result(q, q.points, "correct") : wrong(q);
  }

  if (t === "mrq") {
    const ids = new Set(q.options.map((o) => o.id));
    const picked = [...new Set(Array.isArray(ans) ? ans.filter((a) => typeof a === "string" && ids.has(a)) : [])];
    if (!picked.length) return unanswered(q);
    const good = picked.filter((p) => q.correct.includes(p)).length, bad = picked.length - good;
    if (good === q.correct.length && bad === 0) return result(q, q.points, "correct");
    if (q.scoring === "partial") {
      const s = clamp(q, (q.points * (good - bad)) / q.correct.length);
      return result(q, s, s > 0 ? "partial" : "wrong", { good, bad });
    }
    return wrong(q, { good, bad });
  }

  if (t === "emq" || t === "matching") {
    if (!isObj(ans)) return unanswered(q);
    const rows = t === "emq" ? q.items.map((i) => [i.id, i.correct]) : q.pairs.map((p) => [p.id, p.rid]);
    const right = rows.filter(([id, c]) => has(ans, id) && ans[id] === c).length;
    if (!Object.keys(ans).some((k) => rows.some(([id]) => id === k))) return unanswered(q);
    const s = (q.points * right) / rows.length;
    return result(q, s, right === rows.length ? "correct" : right > 0 ? "partial" : "wrong", { right, of: rows.length });
  }

  if (t === "ordering") {
    if (!Array.isArray(ans)) return unanswered(q);
    const want = q.order.map((o) => o.id);
    const exact = ans.length === want.length && want.every((id, i) => ans[i] === id);
    if (exact) return result(q, q.points, "correct");
    if (q.scoring !== "partial") return wrong(q);
    const inPlace = want.filter((id, i) => ans[i] === id).length;
    const s = (q.points * inPlace) / want.length;
    return result(q, s, inPlace > 0 ? "partial" : "wrong", { inPlace, of: want.length });
  }

  if (t === "fill") {
    if (!isObj(ans)) return unanswered(q);
    let right = 0, filled = 0;
    for (const b of q.blanks) {
      const given = has(ans, b.id) ? str(ans[b.id]).slice(0, MAX_ANSWER_LEN) : "";
      if (!given.trim()) continue;
      filled++;
      const g = normalizeText(given, { caseSensitive: !!b.caseSensitive });
      if (b.accepted.some((a) => normalizeText(a, { caseSensitive: !!b.caseSensitive }) === g)) right++;
    }
    if (!filled) return unanswered(q);
    const s = (q.points * right) / q.blanks.length;
    return result(q, s, right === q.blanks.length ? "correct" : right > 0 ? "partial" : "wrong", { right, of: q.blanks.length });
  }

  if (t === "saq") {
    const given = str(ans).slice(0, MAX_ANSWER_LEN);
    if (!given.trim()) return unanswered(q);
    if (!q.accepted || !q.accepted.length) return { id: q.id, score: null, max: q.points, status: "pending" }; // بلا مفتاح: تصحيح يدوي
    const g = normalizeText(given);
    return q.accepted.some((a) => normalizeText(a) === g) ? result(q, q.points, "correct") : wrong(q);
  }

  if (t === "numerical") {
    const n = parseNumber(ans);
    if (n === null) return unanswered(q);
    const { value, tolerance = 0, mode = "abs" } = q.numeric;
    const allow = mode === "percent" ? Math.abs(value) * tolerance / 100 : tolerance;
    return Math.abs(n - value) <= allow + 1e-12 ? result(q, q.points, "correct") : wrong(q);
  }
  return unanswered(q);
}

export function gradeAnswer(q, ans) {
  const v = validateQuestion(q);
  if (!v.ok) throw new Error("invalid_question: " + v.errors[0]);
  return gradeOne(q, ans);
}

// snapshot: مصفوفة أسئلة اللقطة؛ answers: {معرّف السؤال: إجابة}؛ opts.passScore: درجة النجاح (اختياري).
// النتيجة نهائية فقط إن لم يبقَ سؤال ينتظر التصحيح اليدوي.
export function gradeAttempt(snapshot, answers, { passScore } = {}) {
  const ans = isObj(answers) ? answers : {};
  const per = snapshot.map((q) => gradeOne(q, has(ans, q.id) ? ans[q.id] : undefined));
  const max = round(per.reduce((n, r) => n + r.max, 0));
  const pending = per.filter((r) => r.status === "pending").length;
  const score = round(Math.max(0, per.reduce((n, r) => n + (typeof r.score === "number" ? r.score : 0), 0)));
  const count = (s) => per.filter((r) => r.status === s).length;
  const out = {
    score, max, percent: max ? round((score / max) * 100) : 0,
    correct: count("correct"), partial: count("partial"), wrong: count("wrong"), unanswered: count("unanswered"), pending,
    final: pending === 0, perQuestion: per
  };
  if (typeof passScore === "number") out.passed = out.final ? score >= passScore : null;
  return out;
}

// إعادة احتساب بعد تصحيح يدوي: manual = {معرّف السؤال: درجة}؛ تُقيَّد بين 0 ودرجة السؤال.
export function applyManualScores(snapshot, answers, manual, opts) {
  const base = gradeAttempt(snapshot, answers, opts);
  const m = isObj(manual) ? manual : {};
  const per = base.perQuestion.map((r) => {
    if (r.status !== "pending" || !has(m, r.id)) return r;
    const v = Number(m[r.id]);
    if (!Number.isFinite(v)) return r;
    const s = Math.max(0, Math.min(r.max, v));
    return { ...r, score: round(s), status: s === r.max ? "correct" : s > 0 ? "partial" : "wrong", manual: true };
  });
  const pending = per.filter((r) => r.status === "pending").length;
  const score = round(Math.max(0, per.reduce((n, r) => n + (typeof r.score === "number" ? r.score : 0), 0)));
  const out = { ...base, perQuestion: per, score, percent: base.max ? round((score / base.max) * 100) : 0, pending, final: pending === 0 };
  out.correct = per.filter((r) => r.status === "correct").length; out.partial = per.filter((r) => r.status === "partial").length; out.wrong = per.filter((r) => r.status === "wrong").length;
  if (opts && typeof opts.passScore === "number") out.passed = out.final ? score >= opts.passScore : null;
  return out;
}
