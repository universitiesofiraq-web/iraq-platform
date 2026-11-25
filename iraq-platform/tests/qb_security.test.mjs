// مصفوفة أمان واجهة المشرف: لا يصل غير المصرّح له إلى أي مسار إداري، الرافع لا يتجاوز مستواه، ومدخلات حقن/ضخمة لا تُسقط الخادم.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, sba } from "./helpers/qb_env.mjs";

async function world() {
  const t = await makeEnv(), { call, ids } = t;
  const q = (await call(ids.up, "POST", "admin/questions", { subject_id: 1, type: "sba", content: sba("مسودة الرافع") })).body.id;
  const pub = (await call(ids.rep, "POST", "admin/questions", { subject_id: 1, type: "sba", content: sba("منشور") })).body.id;
  await call(ids.rep, "POST", `admin/question/${pub}/status`, { to: "published" });
  const cat = (await call(ids.rep, "POST", "admin/categories", { subject_id: 1, name: "ت" })).body.id;
  const cs = (await call(ids.rep, "POST", "admin/cases", { subject_id: 1, title: "حالة", body: { history: "x" } })).body.id;
  const quiz = (await call(ids.rep, "POST", "admin/quizzes", { subject_id: 1, title: "اختبار" })).body.id;
  await call(ids.rep, "PUT", "admin/quiz/" + quiz, { items: [{ id: "a", kind: "question", question_id: pub }] });
  await call(ids.rep, "POST", `admin/quiz/${quiz}/status`, { to: "published" });
  const att = (await call(ids.st, "POST", "attempts", { quiz_id: quiz })).body.attempt.id;
  await call(ids.st, "POST", `attempts/${att}/submit`, {});
  const rep = (await call(ids.st, "POST", `questions/${pub}/report`, { reason: "wrong", details: "x" }));
  return { ...t, q, pub, cat, cs, quiz, att, rep };
}

// كل المسارات الإدارية الخاصة بمادة: (غير مصرّح) يجب ألا ينجح أي منها
const routes = (w) => [
  ["GET", "admin/questions?subject=1"], ["POST", "admin/questions", { subject_id: 1, type: "sba", content: sba("x") }],
  ["GET", `admin/question/${w.pub}`], ["PUT", `admin/question/${w.pub}`, { content: sba("تعديل") }], ["DELETE", `admin/question/${w.pub}`], ["POST", `admin/question/${w.pub}/status`, { to: "archived" }],
  ["POST", "admin/questions/bulk", { ids: [w.pub], action: "difficulty", value: 3 }], ["GET", "admin/duplicates?subject=1"], ["POST", "admin/merge", { keep_id: w.pub, merge_ids: [w.q] }],
  ["GET", "admin/categories?subject=1"], ["POST", "admin/categories", { subject_id: 1, name: "ج" }], ["PUT", `admin/categories/${w.cat}`, { name: "د" }], ["DELETE", `admin/categories/${w.cat}`],
  ["GET", "admin/cases?subject=1"], ["POST", "admin/cases", { subject_id: 1, title: "ح" }], ["PUT", `admin/cases/${w.cs}`, { title: "ح2" }], ["DELETE", `admin/cases/${w.cs}`],
  ["GET", "admin/quizzes?subject=1"], ["POST", "admin/quizzes", { subject_id: 1, title: "ز" }], ["GET", `admin/quiz/${w.quiz}`], ["PUT", `admin/quiz/${w.quiz}`, { meta: { title: "اختراق" } }], ["DELETE", `admin/quiz/${w.quiz}`], ["POST", `admin/quiz/${w.quiz}/status`, { to: "archived" }], ["POST", `admin/quiz/${w.quiz}/duplicate`, {}], ["GET", `admin/quiz/${w.quiz}/stats`],
  ["GET", "admin/stats?subject=1"], ["GET", "admin/grading?subject=1"], ["GET", `admin/attempt/${w.att}`], ["POST", `admin/attempt/${w.att}/grade`, { scores: {} }],
  ["GET", "admin/export?subject=1"], ["POST", "admin/import/preview", { subject_id: 1, items: [{ type: "tf", content: { text: "ا", correct: true } }] }], ["POST", "admin/import/commit", { subject_id: 1, items: [{ type: "tf", content: { text: "ا", correct: true } }] }],
  ["GET", "admin/reports?subject=1"], ["GET", "admin/audit"]
];

test("مستخدم بلا صلاحية (طالب/خارج النطاق): كل المسارات الإدارية مرفوضة", async () => {
  const w = await world();
  for (const uid of [w.ids.st, w.ids.other]) for (const [m, p, b] of routes(w)) {
    const r = await w.call(uid, m, p, b);
    // التقارير تعيد قائمة فارغة مصفّاة بالنطاق (لا تسرّب)؛ ما سواها يجب أن يُرفض
    if (p.startsWith("admin/reports")) { assert.ok(r.status === 403 || (r.status === 200 && r.body.reports.length === 0), "تسرّب بلاغات"); continue; }
    if (p === "admin/questions/bulk") { assert.equal(r.status, 200); assert.equal(r.body.failed.length, 1, "التعديل الجماعي يجب أن يفشل لكل عنصر"); continue; }
    assert.ok([401, 403, 404].includes(r.status), `${m} ${p} للمستخدم ${uid} أعاد ${r.status}`);
  }
  // لم يتغير شيء
  assert.equal((await w.call(w.ids.rep, "GET", `admin/quiz/${w.quiz}`)).body.quiz.title, "اختبار");
  const after = await w.call(w.ids.rep, "GET", `admin/question/${w.pub}`);
  assert.equal(after.status, 200); assert.equal(after.body.question.difficulty, 2, "تغيّرت الصعوبة بالتعديل الجماعي المرفوض"); assert.equal(after.body.question.status, "published");
});

test("الرافع لا يتجاوز مستوى الإدخال: لا نشر ولا حذف ولا مراجعة ولا تعديل لما ليس له", async () => {
  const w = await world(), up = w.ids.up;
  const deny = [["POST", `admin/question/${w.pub}/status`, { to: "archived" }], ["PUT", `admin/question/${w.pub}`, { content: sba("تعديل") }], ["DELETE", `admin/question/${w.pub}`],
    ["POST", "admin/merge", { keep_id: w.pub, merge_ids: [w.q] }], ["GET", "admin/duplicates?subject=1"], ["PUT", `admin/categories/${w.cat}`, { name: "د" }], ["DELETE", `admin/categories/${w.cat}`],
    ["PUT", `admin/quiz/${w.quiz}`, { meta: { title: "اختراق" } }], ["POST", `admin/quiz/${w.quiz}/status`, { to: "archived" }], ["DELETE", `admin/quiz/${w.quiz}`], ["GET", `admin/quiz/${w.quiz}/stats`],
    ["GET", "admin/grading?subject=1"], ["GET", `admin/attempt/${w.att}`], ["POST", `admin/attempt/${w.att}/grade`, { scores: {} }], ["GET", "admin/audit"], ["POST", `admin/question/${w.q}/status`, { to: "published" }]];
  for (const [m, p, b] of deny) { const r = await w.call(up, m, p, b); assert.equal(r.status, 403, `${m} ${p} للرافع أعاد ${r.status}`); }
  const bulk = await w.call(up, "POST", "admin/questions/bulk", { ids: [w.pub], action: "difficulty", value: 3 }); // سؤال منشور ليس له
  assert.equal(bulk.status, 200); assert.equal((bulk.body.failed || []).length, 1, "تعديل جماعي لسؤال غير مملوك يجب أن يفشل");
  const own = await w.call(up, "PUT", `admin/question/${w.q}`, { content: sba("تعديلي") }); assert.equal(own.status, 200); // مسودته: مسموح
  assert.equal((await w.call(up, "POST", `admin/question/${w.q}/status`, { to: "pending" })).status, 200);                 // إرسال للمراجعة مسموح
  assert.equal((await w.call(up, "PUT", `admin/question/${w.q}`, { content: sba("بعد الإرسال") })).status, 200);          // ما زال pending: مسموح
  await w.call(w.ids.rep, "POST", `admin/question/${w.q}/status`, { to: "approved" });
  assert.equal((await w.call(up, "PUT", `admin/question/${w.q}`, { content: sba("بعد الاعتماد") })).status, 403);          // بعد الاعتماد: مقفل
});

test("مدخلات حقن وضخمة لا تُسقط الخادم ولا تسرّب", async () => {
  const w = await world(), rep = w.ids.rep;
  const evil = ["' OR 1=1 --", "%' ; DROP TABLE qb_questions; --", "\\", "%", "_", "\u0000", "<script>alert(1)</script>", "x".repeat(5000)];
  for (const e of evil) {
    for (const p of [`admin/questions?subject=1&q=${encodeURIComponent(e)}`, `admin/questions?subject=1&tag=${encodeURIComponent(e)}&sort=${encodeURIComponent(e)}`, `admin/tags?q=${encodeURIComponent(e)}`, `questions?subject=1&q=${encodeURIComponent(e)}`]) {
      const r = await w.call(rep, "GET", p); assert.ok(r.status < 500, `${p.slice(0, 60)} أعاد ${r.status}`);
    }
  }
  assert.equal((await w.call(rep, "GET", "admin/questions?subject=1")).body.total >= 2, true, "الجدول سليم");
  // حقن في المحتوى: يُخزَّن نصاً حرفياً ولا يُنفَّذ (العرض بـtextContent)
  const x = await w.call(rep, "POST", "admin/questions", { subject_id: 1, type: "sba", content: sba("<img src=x onerror=alert(1)> '); DROP TABLE qb_questions;--") });
  assert.equal(x.status, 201); const back = await w.call(rep, "GET", `admin/question/${x.body.id}`); assert.ok(back.body.question.content.text.includes("<img"));
  // روابط خطرة في الوسائط
  const bad = await w.call(rep, "POST", "admin/questions", { subject_id: 1, type: "sba", content: sba("ص", { media: [{ kind: "image", url: "javascript:alert(1)" }] }) });
  assert.ok(bad.status === 422 || !JSON.stringify((await w.call(rep, "GET", `admin/question/${bad.body.id || 0}`)).body || {}).includes("javascript:"), "javascript: URL مقبول!");
  // حجم ضخم
  const big = await w.call(rep, "POST", "admin/import/preview", { subject_id: 1, items: Array.from({ length: 800 }, (_, i) => ({ type: "tf", content: { text: "س" + i, correct: true } })) });
  assert.ok(big.status === 200 && big.body.total <= 500 || big.status >= 400, "الاستيراد يجب أن يقصّ أو يرفض ما فوق 500");
  // قيم غير صالحة
  for (const [m, p, b] of [["POST", "admin/questions/bulk", { ids: "x", action: "status" }], ["POST", "admin/questions/bulk", { ids: [1], action: "drop" }], ["PUT", `admin/quiz/${w.quiz}`, { items: [{ kind: "evil" }] }], ["POST", "admin/questions", { subject_id: "1 OR 1=1", type: "sba", content: sba() }], ["GET", "admin/question/abc"], ["GET", "admin/attempt/not-hex"]]) {
    const r = await w.call(rep, m, p, b); assert.ok(r.status >= 400 && r.status < 500, `${m} ${p} أعاد ${r.status}`);
  }
});
