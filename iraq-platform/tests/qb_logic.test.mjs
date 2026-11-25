// تطابق نسخة العميل مع المنطق الشرطي على الخادم + سلوك القواعد.
import test from "node:test";
import assert from "node:assert/strict";
import { createRequire } from "node:module";
import { computeVisible, validateRules, logicDisabled } from "../functions/_lib/qb_logic.js";
const require = createRequire(import.meta.url);
const client = require("../site/js/qb-logic-client.js");

const items = [1, 2, 3, 4, 5, 6].map((n) => ({ id: "q" + n, kind: "question", position: n }));
test("show_if وjump وتجاهل إجابات العناصر المخفية", () => {
  const rules = [{ kind: "show_if", source: "q1", op: "eq", value: "a", target: "q2" }, { kind: "jump", source: "q3", op: "answered", target: "q6" }, { kind: "show_if", source: "q2", op: "in", value: ["x"], target: "q4" }];
  const ids = (v) => [...v].sort().join();
  assert.equal(ids(computeVisible(items, rules, {})), "q1,q3,q5,q6");
  assert.equal(ids(computeVisible(items, rules, { q1: "a", q2: "x" })), "q1,q2,q3,q4,q5,q6");
  assert.equal(ids(computeVisible(items, rules, { q1: "a", q2: "x", q3: "k" })), "q1,q2,q3,q6"); // الإجابة على q3 تقفز إلى q6
  assert.equal(ids(computeVisible(items, rules, { q2: "x" })), "q1,q3,q5,q6"); // إجابة عنصر مخفي (q2) لا تُحتسب
});
test("قفزة تخفي ما بين المصدر والهدف", () => {
  const v = computeVisible(items, [{ kind: "jump", source: "q2", op: "answered", target: "q5" }], { q2: "z" });
  assert.deepEqual([...v].sort(), ["q1", "q2", "q5", "q6"]);
});
test("المنطق معطّل في الامتحان الرسمي", () => {
  assert.equal(logicDisabled({ official: true }, "exam"), true);
  assert.equal(logicDisabled({ official: true }, "practice"), false);
  assert.equal(computeVisible(items, [{ kind: "jump", source: "q1", op: "answered", target: "q6" }], { q1: "a" }, { disabled: true }).size, 6);
});
test("حلقات وارتدادات مرفوضة", () => {
  const its = items.map((i) => ({ id: i.id, kind: "question", position: i.position }));
  assert.equal(validateRules(its, [{ kind: "show_if", source: "q3", op: "eq", value: 1, target: "q2" }]).ok, false);
  assert.equal(validateRules(its, [{ kind: "show_if", source: "q2", op: "eq", value: 1, target: "q2" }]).ok, false);
  assert.equal(validateRules(its, [{ kind: "show_if", source: "q1", op: "eq", value: 1, target: "q2" }]).ok, true);
});
test("العميل يطابق الخادم على 2000 حالة عشوائية", () => {
  let s = 12345; const rnd = () => (s = (s * 1664525 + 1013904223) >>> 0) / 2 ** 32;
  const ops = ["eq", "ne", "in", "answered", "notanswered"], kinds = ["show_if", "jump"], vals = ["a", "b", ["a", "b"], 1, true];
  for (let n = 0; n < 2000; n++) {
    const rules = [];
    for (let k = 0, c = Math.floor(rnd() * 5); k < c; k++) { const a = 1 + Math.floor(rnd() * 5), b = a + 1 + Math.floor(rnd() * (6 - a)); rules.push({ kind: kinds[Math.floor(rnd() * 2)], source: "q" + a, op: ops[Math.floor(rnd() * 5)], value: vals[Math.floor(rnd() * 5)], target: "q" + Math.min(6, b) }); }
    const answers = {}; for (const i of items) if (rnd() < 0.6) answers[i.id] = vals[Math.floor(rnd() * 5)];
    const disabled = rnd() < 0.1;
    assert.deepEqual([...computeVisible(items, rules, answers, { disabled })].sort(), [...client.computeVisible(items, rules, answers, { disabled })].sort(), JSON.stringify({ rules, answers }));
  }
});

test("خلط الأسئلة: يعمل داخل القسم، ويُعطَّل مع القواعد الشرطية", async () => {
  const { buildSnapshot } = await import("../functions/_lib/qb.js");
  const qs = {}; for (let i = 1; i <= 12; i++) qs[i] = { q: { id: String(i), type: "tf", text: "س" + i, points: 1, correct: true }, meta: {} };
  const its = Array.from({ length: 12 }, (_, i) => ({ id: "i" + (i + 1), kind: "question", qid: i + 1 }));
  const order = (s) => s.items.map((x) => x.qid).join(",");
  const base = { quiz: null, kind: "quiz", mode: "practice", sections: [], items: its, questions: qs, seed: "seed1" };
  const plain = buildSnapshot({ ...base, settings: {} });
  const shuffled = buildSnapshot({ ...base, settings: { shuffleQuestions: true } });
  assert.notEqual(order(shuffled), order(plain), "الخلط لم يغيّر الترتيب");
  assert.equal(order(shuffled), order(buildSnapshot({ ...base, settings: { shuffleQuestions: true } })), "الخلط غير حتمي لنفس البذرة");
  assert.equal([...shuffled.items.map((x) => x.qid)].sort().join(), [...plain.items.map((x) => x.qid)].sort().join(), "فُقد عنصر");
  const withRule = buildSnapshot({ ...base, settings: { shuffleQuestions: true }, rules: [{ kind: "show_if", source: "i1", op: "answered", value: null, target: "i5" }] });
  assert.equal(order(withRule), order(plain), "مع القواعد يجب أن يبقى الترتيب ثابتاً");
});
