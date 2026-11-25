// functions/_lib/qb_content.js — تنظيف محتوى الأسئلة الواردة (حقول مسموحة فقط، حدود أطوال، روابط آمنة) ثم التحقق بمحرك التصحيح.
// كل نص عادي (لا HTML): الواجهة تعرضه بـtextContent. لا يُحفظ أي حقل غير معروف.
import { QUESTION_TYPES, validateQuestion, normalizeText } from "./qb_grade.js";

const isObj = (v) => v !== null && typeof v === "object" && !Array.isArray(v);
const clip = (v, n) => (typeof v === "string" ? v : typeof v === "number" ? String(v) : "").replace(/\u0000/g, "").trim().slice(0, n);
const arr = (v, max) => (Array.isArray(v) ? v.slice(0, max) : []);
export const MEDIA_KINDS = Object.freeze(["image", "xray", "ct", "mri", "ecg", "histology", "pathology", "clinical", "video"]);

// https فقط أو مسار نسبي داخل الموقع. يرفض javascript: وdata: و//host.
export function safeUrl(u) {
  const s = clip(u, 600);
  if (!s || /[\s"'<>\\]/.test(s)) return "";
  if (/^https:\/\/[^/]/i.test(s)) return s;
  if (/^(files|api|assets)\//i.test(s) || (/^\/[^/]/.test(s) && !/^\/\//.test(s))) return s;
  return "";
}

export function cleanMedia(list) {
  return arr(list, 12).map((m) => {
    const url = safeUrl(isObj(m) ? m.url : "");
    return url ? { kind: MEDIA_KINDS.includes(m.kind) ? m.kind : "image", url, caption: clip(m.caption, 300) } : null;
  }).filter(Boolean);
}

function cleanTable(t) {
  if (!isObj(t)) return undefined;
  const head = arr(t.head, 8).map((c) => clip(c, 80));
  const rows = arr(t.rows, 30).map((r) => arr(r, 8).map((c) => clip(c, 120)));
  return head.length && rows.length ? { head, rows } : undefined;
}

const idOf = (v, fallback) => (typeof v === "string" && /^[\w.\-:]{1,40}$/.test(v) ? v : fallback);

// يعيد المحتوى المنظَّف (بلا id) أو يرفض. لا يغيّر المدخل.
export function cleanContent(type, raw) {
  if (!QUESTION_TYPES.includes(type)) return { ok: false, errors: ["نوع سؤال غير معروف"] };
  if (!isObj(raw)) return { ok: false, errors: ["محتوى السؤال غير صالح"] };
  const c = { type, text: clip(raw.text, 8000), points: Number(raw.points ?? 1) };
  if (raw.explanation) c.explanation = clip(raw.explanation, 4000);
  if (raw.source) c.source = clip(raw.source, 500);
  if (raw.feedbackCorrect) c.feedbackCorrect = clip(raw.feedbackCorrect, 1000);
  if (raw.feedbackWrong) c.feedbackWrong = clip(raw.feedbackWrong, 1000);
  const media = cleanMedia(raw.media); if (media.length) c.media = media;
  const table = cleanTable(raw.table); if (table) c.table = table;
  if (raw.shuffle) c.shuffle = true;
  if (raw.required) c.required = true;
  if (Number.isFinite(Number(raw.time_limit_sec)) && Number(raw.time_limit_sec) > 0) c.time_limit_sec = Math.min(3600, Math.floor(Number(raw.time_limit_sec)));
  if (isObj(raw.negative) && raw.negative.enabled) c.negative = { enabled: true, penalty: Number(raw.negative.penalty) };
  const opts = (list, max = 60) => arr(list, max).map((o, i) => ({ id: idOf(o && o.id, "o" + (i + 1)), text: clip(o && o.text, 1000) }));
  switch (type) {
    case "sba": case "mcq": c.options = opts(raw.options); c.correct = clip(raw.correct, 40); break;
    case "mrq": c.options = opts(raw.options); c.correct = arr(raw.correct, 60).map((x) => clip(x, 40)); c.scoring = raw.scoring === "partial" ? "partial" : "all"; break;
    case "tf": c.correct = raw.correct === true || raw.correct === "true"; break;
    case "emq": c.options = opts(raw.options); c.items = arr(raw.items, 60).map((it, i) => ({ id: idOf(it && it.id, "i" + (i + 1)), text: clip(it && it.text, 1000), correct: clip(it && it.correct, 40) })); break;
    case "matching": c.pairs = arr(raw.pairs, 60).map((p, i) => ({ id: idOf(p && p.id, "p" + (i + 1)), rid: idOf(p && p.rid, "r" + (i + 1)), left: clip(p && p.left, 500), right: clip(p && p.right, 500) })); break;
    case "ordering": c.order = opts(raw.order); c.scoring = raw.scoring === "all" ? "all" : "partial"; break;
    case "fill": c.blanks = arr(raw.blanks, 60).map((b, i) => ({ id: idOf(b && b.id, "b" + (i + 1)), accepted: arr(b && b.accepted, 20).map((a) => clip(a, 300)).filter(Boolean), caseSensitive: !!(b && b.caseSensitive) })); break;
    case "saq": c.accepted = arr(raw.accepted, 30).map((a) => clip(a, 500)).filter(Boolean); break;
    case "numerical": {
      const n = isObj(raw.numeric) ? raw.numeric : {};
      c.numeric = { value: Number(n.value), tolerance: Number(n.tolerance ?? 0), mode: n.mode === "percent" ? "percent" : "abs" };
      if (n.unit) c.numeric.unit = clip(n.unit, 20);
      break;
    }
    default: break;
  }
  const v = validateQuestion({ ...c, id: "x" });
  if (!v.ok) return { ok: false, errors: v.errors };
  if (JSON.stringify(c).length > 60000) return { ok: false, errors: ["السؤال أكبر من الحد المسموح"] };
  return { ok: true, content: c };
}

// نص مطبَّع لكل ما يميّز السؤال، للبحث ولاكتشاف المكرر.
export function searchText(c) {
  const parts = [c.text];
  for (const k of ["options", "order"]) if (c[k]) parts.push(...c[k].map((o) => o.text));
  if (c.items) parts.push(...c.items.map((o) => o.text));
  if (c.pairs) parts.push(...c.pairs.flatMap((p) => [p.left, p.right]));
  if (c.blanks) parts.push(...c.blanks.flatMap((b) => b.accepted));
  if (c.accepted) parts.push(...c.accepted);
  return normalizeText(parts.join(" ")).slice(0, 6000);
}

export function hashBasis(type, c) {
  const opt = (list) => (list || []).map((o) => normalizeText(o.text)).sort().join("|");
  return [type, normalizeText(c.text), opt(c.options), opt(c.order), (c.pairs || []).map((p) => normalizeText(p.left) + ">" + normalizeText(p.right)).sort().join("|"), (c.blanks || []).map((b) => b.accepted.map(normalizeText).join("/")).join("|")].join("##");
}

// ما يتغير بين نسختين، لسجل التعديلات.
export function diffSummary(before, after) {
  if (!before) return "إنشاء السؤال";
  const names = { text: "النص", options: "الخيارات", correct: "الإجابة الصحيحة", points: "الدرجة", explanation: "الشرح", media: "الوسائط", items: "البنود", pairs: "الأزواج", order: "الترتيب", blanks: "الفراغات", accepted: "الإجابات المقبولة", numeric: "القيمة الرقمية", scoring: "نمط التصحيح", negative: "الدرجة السالبة", table: "الجدول", source: "المصدر", feedbackCorrect: "التغذية الراجعة", feedbackWrong: "التغذية الراجعة", shuffle: "الخلط" };
  const changed = [...new Set(Object.keys({ ...before, ...after }).filter((k) => JSON.stringify(before[k]) !== JSON.stringify(after[k])).map((k) => names[k] || k))];
  return changed.length ? "تعديل: " + changed.join("، ") : "حفظ بلا تغيير في المحتوى";
}
