// فحص محرك تصحيح بنك الأسئلة (QB-003): كل نوع، الدرجات الجزئية والسالبة، عدم تسريب الإجابات، ثبات اللقطة.
import test from "node:test";
import assert from "node:assert/strict";
import {
  QUESTION_TYPES, validateQuestion, publicQuestion, revealQuestion, snapshotQuestion,
  gradeAnswer, gradeAttempt, applyManualScores, normalizeText, parseNumber, seededShuffle
} from "../functions/_lib/qb_grade.js";

const opts = (...ids) => ids.map((id) => ({ id, text: "خيار " + id }));
const Q = {
  sba: { id: "q1", type: "sba", text: "ما هو؟", points: 2, options: opts("a", "b", "c", "d"), correct: "b" },
  mrq: { id: "q2", type: "mrq", text: "اختر", points: 4, options: opts("a", "b", "c", "d"), correct: ["a", "c"], scoring: "partial" },
  tf: { id: "q3", type: "tf", text: "صح؟", points: 1, correct: true },
  emq: { id: "q4", type: "emq", text: "طابق", points: 4, options: opts("x", "y", "z"), items: [{ id: "i1", text: "واحد", correct: "x" }, { id: "i2", text: "اثنان", correct: "y" }] },
  saq: { id: "q5", type: "saq", text: "اذكر", points: 2, accepted: ["الكبد", "liver"] },
  essay: { id: "q6", type: "essay", text: "اشرح", points: 5 },
  fill: { id: "q7", type: "fill", text: "الـ ___ و ___", points: 2, blanks: [{ id: "b1", accepted: ["القلب"] }, { id: "b2", accepted: ["Aorta", "الأبهر"] }] },
  matching: { id: "q8", type: "matching", text: "اربط", points: 3, pairs: [{ id: "p1", rid: "r9", left: "A", right: "1" }, { id: "p2", rid: "r4", left: "B", right: "2" }, { id: "p3", rid: "r7", left: "C", right: "3" }] },
  ordering: { id: "q9", type: "ordering", text: "رتّب", points: 4, scoring: "partial", order: opts("s1", "s2", "s3", "s4") },
  numerical: { id: "q10", type: "numerical", text: "كم؟", points: 2, numeric: { value: 120, tolerance: 5, mode: "percent", unit: "mg" } }
};

test("كل الأنواع الأحد عشر صالحة", () => {
  assert.equal(QUESTION_TYPES.length, 11);
  for (const q of Object.values(Q)) assert.deepEqual(validateQuestion(q), { ok: true, errors: [] }, q.type);
});

test("التحقق يرفض أسئلة معطوبة", () => {
  const bad = [
    null, { type: "x" }, { ...Q.sba, correct: "zz" }, { ...Q.sba, points: 0 }, { ...Q.sba, text: "  " },
    { ...Q.sba, options: opts("a", "a") }, { ...Q.mrq, correct: [] }, { ...Q.mrq, correct: ["a", "a"] },
    { ...Q.tf, correct: "true" }, { ...Q.matching, pairs: [{ id: "p1", rid: "r", left: "a", right: "b" }] },
    { ...Q.matching, pairs: Q.matching.pairs.map((p) => ({ ...p, rid: "same" })) },
    { ...Q.numerical, numeric: { value: "x" } }, { ...Q.sba, negative: { enabled: true, penalty: 9 } },
    { ...Q.fill, blanks: [] }, { ...Q.emq, items: [{ id: "i", text: "t", correct: "nope" }] }
  ];
  for (const q of bad) assert.equal(validateQuestion(q).ok, false, JSON.stringify(q)?.slice(0, 60));
});

test("SBA وTF: صحيح وخاطئ وبلا إجابة", () => {
  assert.equal(gradeAnswer(Q.sba, "b").score, 2);
  assert.equal(gradeAnswer(Q.sba, "a").status, "wrong");
  assert.equal(gradeAnswer(Q.sba, "a").score, 0);
  assert.equal(gradeAnswer(Q.sba, undefined).status, "unanswered");
  assert.equal(gradeAnswer(Q.sba, "ليس خياراً").status, "wrong");
  assert.equal(gradeAnswer(Q.tf, true).status, "correct");
  assert.equal(gradeAnswer(Q.tf, "false").status, "wrong");
  assert.equal(gradeAnswer(Q.tf, "ربما").status, "unanswered");
});

test("الدرجة السالبة تعمل فقط عند تفعيلها صراحةً", () => {
  const neg = { ...Q.sba, negative: { enabled: true, penalty: 0.5 } };
  assert.equal(gradeAnswer(neg, "a").score, -0.5);
  assert.equal(gradeAnswer(neg, undefined).score, 0);
  assert.equal(gradeAnswer({ ...Q.sba, negative: { enabled: false, penalty: 1 } }, "a").score, 0);
  // الإجمالي لا ينزل تحت الصفر
  assert.equal(gradeAttempt([neg], { q1: "a" }).score, 0);
});

test("MRQ: كامل وجزئي وعقوبة الخطأ وكل-أو-لا-شيء", () => {
  assert.equal(gradeAnswer(Q.mrq, ["a", "c"]).score, 4);
  assert.equal(gradeAnswer(Q.mrq, ["a"]).score, 2);
  assert.equal(gradeAnswer(Q.mrq, ["a", "b"]).score, 0); // صحيح−خطأ = 0
  assert.equal(gradeAnswer(Q.mrq, ["b", "d"]).status, "wrong");
  assert.equal(gradeAnswer(Q.mrq, ["a", "a", "c"]).score, 4); // تكرار الخيار لا يزيد
  assert.equal(gradeAnswer({ ...Q.mrq, scoring: "all" }, ["a"]).score, 0);
  assert.equal(gradeAnswer(Q.mrq, ["غريب"]).status, "unanswered");
  assert.equal(gradeAnswer({ ...Q.mrq, negative: { enabled: true, penalty: 1 } }, ["b", "d"]).score, -1);
});

test("EMQ والمطابقة: درجات جزئية لكل بند", () => {
  assert.equal(gradeAnswer(Q.emq, { i1: "x", i2: "y" }).score, 4);
  assert.equal(gradeAnswer(Q.emq, { i1: "x", i2: "z" }).score, 2);
  assert.equal(gradeAnswer(Q.emq, { i1: "z" }).status, "wrong");
  assert.equal(gradeAnswer(Q.matching, { p1: "r9", p2: "r4", p3: "r7" }).status, "correct");
  assert.equal(gradeAnswer(Q.matching, { p1: "r9", p2: "r7", p3: "r4" }).score, 1);
  assert.equal(gradeAnswer(Q.matching, { zz: "r9" }).status, "unanswered");
});

test("الترتيب: كامل وجزئي", () => {
  assert.equal(gradeAnswer(Q.ordering, ["s1", "s2", "s3", "s4"]).score, 4);
  assert.equal(gradeAnswer(Q.ordering, ["s1", "s2", "s4", "s3"]).score, 2);
  assert.equal(gradeAnswer({ ...Q.ordering, scoring: "all" }, ["s1", "s2", "s4", "s3"]).score, 0);
  assert.equal(gradeAnswer(Q.ordering, []).status, "unanswered");
});

test("الإكمال والإجابة القصيرة: توحيد العربية والحروف", () => {
  assert.equal(gradeAnswer(Q.fill, { b1: "  القلب ", b2: "aorta" }).status, "correct");
  assert.equal(gradeAnswer(Q.fill, { b1: "القلب", b2: "الابهر" }).status, "correct"); // أبهر = ابهر
  assert.equal(gradeAnswer(Q.fill, { b1: "القلب", b2: "x" }).score, 1);
  assert.equal(gradeAnswer(Q.saq, "الكَبِد").status, "correct"); // تشكيل
  assert.equal(gradeAnswer(Q.saq, "LIVER").status, "correct");
  assert.equal(gradeAnswer(Q.saq, "الكلية").status, "wrong");
  assert.equal(gradeAnswer({ ...Q.saq, accepted: [] }, "أي شيء").status, "pending"); // بلا مفتاح: يدوي
  const cs = { ...Q.fill, blanks: [{ id: "b1", accepted: ["Na"], caseSensitive: true }] };
  assert.equal(gradeAnswer(cs, { b1: "na" }).status, "wrong");
  assert.equal(gradeAnswer(cs, { b1: "Na" }).status, "correct");
});

test("الرقمي: هامش مطلق ونسبي وأرقام عربية", () => {
  assert.equal(gradeAnswer(Q.numerical, "120").status, "correct");
  assert.equal(gradeAnswer(Q.numerical, "125.9").status, "correct"); // 5% من 120 = 6 ⇒ الحد الأقصى 126
  assert.equal(gradeAnswer(Q.numerical, "126.1").status, "wrong");
  assert.equal(gradeAnswer(Q.numerical, "126.1").score, 0);
  assert.equal(gradeAnswer(Q.numerical, "114").status, "correct");
  assert.equal(gradeAnswer(Q.numerical, "113.9").status, "wrong");
  assert.equal(gradeAnswer(Q.numerical, "١٢٣").status, "correct");
  assert.equal(gradeAnswer(Q.numerical, "123,5").status, "correct"); // فاصلة عشرية
  assert.equal(gradeAnswer(Q.numerical, "abc").status, "unanswered");
  const abs = { ...Q.numerical, numeric: { value: 7.4, tolerance: 0.05, mode: "abs" } };
  assert.equal(gradeAnswer(abs, 7.44).status, "correct");
  assert.equal(gradeAnswer(abs, 7.46).status, "wrong");
  assert.equal(parseNumber("1e400"), null);
  assert.equal(parseNumber("12 mg"), null);
});

test("المقالي ينتظر التصحيح اليدوي ولا تُعتبر النتيجة نهائية", () => {
  const snap = [Q.sba, Q.essay].map(snapshotQuestion);
  const r = gradeAttempt(snap, { q1: "b", q6: "إجابة طويلة" }, { passScore: 3 });
  assert.equal(r.pending, 1);
  assert.equal(r.final, false);
  assert.equal(r.passed, null);
  assert.equal(r.score, 2);
  assert.equal(gradeAttempt(snap, { q1: "b" }).perQuestion[1].status, "unanswered");
  const done = applyManualScores(snap, { q1: "b", q6: "x" }, { q6: 4 }, { passScore: 5 });
  assert.equal(done.final, true);
  assert.equal(done.score, 6);
  assert.equal(done.passed, true);
  assert.equal(applyManualScores(snap, { q6: "x" }, { q6: 99 }).score, 5); // مقيَّدة بدرجة السؤال
  assert.equal(applyManualScores(snap, { q6: "x" }, { q6: -3 }).score, 0);
});

test("حساب المحاولة: المجاميع والنسبة والنجاح", () => {
  const snap = [Q.sba, Q.tf, Q.mrq].map(snapshotQuestion);
  const r = gradeAttempt(snap, { q1: "b", q3: false, q2: ["a"] }, { passScore: 4 });
  assert.equal(r.max, 7);
  assert.equal(r.score, 4); // 2 + 0 + 2
  assert.equal(r.correct, 1); assert.equal(r.wrong, 1); assert.equal(r.partial, 1);
  assert.equal(r.percent, 57.1429);
  assert.equal(r.passed, true);
  assert.equal(gradeAttempt(snap, null).score, 0);
  assert.equal(gradeAttempt(snap, []).unanswered, 3);
});

test("لا تسريب: نسخة الطالب بلا مفاتيح الإجابة لأي نوع", () => {
  for (const q of Object.values(Q)) {
    const pub = publicQuestion({ ...q, explanation: "سرّ-الشرح", shuffle: true }, "attempt-1");
    const json = JSON.stringify(pub);
    for (const bad of ["correct", "accepted", "explanation", "سرّ-الشرح", "feedback", "scoring", "rid"]) assert.equal(json.includes(bad), false, q.type + " leaks " + bad);
  }
  const m = publicQuestion(Q.matching, "s");
  assert.equal(m.right.every((r) => !["p1", "p2", "p3"].includes(r.id)), true); // معرّفات اليمين لا تكشف الأزواج
  assert.deepEqual(m.right.map((r) => r.text).sort(), ["1", "2", "3"]);
  const o = publicQuestion(Q.ordering, "s").items.map((i) => i.id).sort();
  assert.deepEqual(o, ["s1", "s2", "s3", "s4"]);
  assert.equal(publicQuestion(Q.numerical, "s").unit, "mg");
  assert.equal("value" in publicQuestion(Q.numerical, "s"), false);
});

test("الكشف بعد الإجابة يحمل الشرح والإجابة الصحيحة", () => {
  const r = revealQuestion({ ...Q.sba, explanation: "لأن..." });
  assert.equal(r.correct, "b"); assert.equal(r.explanation, "لأن...");
  assert.deepEqual(revealQuestion(Q.matching).correct, { p1: "r9", p2: "r4", p3: "r7" });
  assert.deepEqual(revealQuestion(Q.ordering).correct, ["s1", "s2", "s3", "s4"]);
});

test("الخلط حتمي بالبذرة ويختلف بين المحاولات", () => {
  const a = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "x"), b = seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "x");
  assert.deepEqual(a, b);
  assert.deepEqual([...a].sort(), [1, 2, 3, 4, 5, 6, 7, 8]);
  assert.notDeepEqual(a, seededShuffle([1, 2, 3, 4, 5, 6, 7, 8], "y"));
  const q = { ...Q.sba, shuffle: true };
  assert.deepEqual(publicQuestion(q, "t1").options, publicQuestion(q, "t1").options);
});

test("اللقطة الثابتة لا تتأثر بتعديل السؤال لاحقاً", () => {
  const live = JSON.parse(JSON.stringify(Q.sba));
  const snap = snapshotQuestion(live);
  live.correct = "a"; live.options[0].text = "غُيّر";
  assert.equal(gradeAttempt([snap], { q1: "b" }).score, 2);
  assert.equal(gradeAttempt([snap], { q1: "a" }).score, 0);
  assert.throws(() => snapshotQuestion({ ...Q.sba, correct: "zz" }), /invalid_question/);
});

test("إجابات خبيثة لا تُسقط المحرك ولا تلوّث الكائنات", () => {
  const evil = [
    { __proto__: { i1: "x" } }, JSON.parse('{"__proto__":{"i1":"x","i2":"y"}}'), { constructor: "x" },
    "x".repeat(100000), [{}], 12345, true, () => 1
  ];
  for (const q of Object.values(Q)) for (const a of evil) { try { gradeAnswer(q, a); } catch (e) { assert.fail(q.type + ": " + e.message); } }
  assert.equal(gradeAnswer(Q.emq, JSON.parse('{"__proto__":{"i1":"x","i2":"y"}}')).status, "unanswered");
  assert.equal(({}).i1, undefined);
  assert.equal(gradeAttempt([Q.sba], JSON.parse('{"__proto__":{"q1":"b"}}')).score, 0);
});

test("تطبيع النص", () => {
  assert.equal(normalizeText("  أَحْمَد  إبراهيم "), "احمد ابراهيم");
  assert.equal(normalizeText("مدرسة"), normalizeText("مدرسه"));
  assert.equal(normalizeText("ABC", { caseSensitive: true }), "ABC");
});
