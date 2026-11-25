// فحص واجهة بنك الأسئلة (الخادم الحقيقي على SQLite محلي): صلاحيات، تسرّب مفاتيح، مهل، تكرار التسليم، تعطيل المنصة.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, sba } from "./helpers/qb_env.mjs";
import { handleQb } from "../functions/_lib/qb.js";

async function seeded() {
  const t = await makeEnv(), { call, ids } = t;
  const mk = async (uid, type, content, extra = {}) => (await call(uid, "POST", "admin/questions", { subject_id: 1, type, content, ...extra })).body.id;
  const q1 = await mk(ids.up, "sba", sba("س1"));
  const q2 = await mk(ids.up, "tf", { text: "الجملة صحيحة؟", correct: true, points: 2 });
  const q3 = await mk(ids.up, "saq", { text: "اذكر عضواً", accepted: ["قلب", "heart"], points: 1 });
  const q4 = await mk(ids.up, "essay", { text: "اشرح الدورة الدموية", points: 4 });
  for (const q of [q1, q2, q3, q4]) assert.equal((await call(ids.rep, "POST", `admin/question/${q}/status`, { to: "published" })).status, 200);
  return { ...t, q: [q1, q2, q3, q4] };
}

test("خامل: بلا QB_ENABLED يعيد null ولا يلمس القاعدة", async () => {
  let touched = false;
  const env = { DB: new Proxy({}, { get() { touched = true; throw new Error("touched"); } }) };
  const res = await handleQb(new Request("https://example.test/api/qb/subjects"), env, { currentUser: async () => ({ id: 1 }) });
  assert.equal(res, null); assert.equal(touched, false);
  assert.equal(await handleQb(new Request("https://example.test/api/other"), { ...env, QB_ENABLED: "1" }, {}), null);
});

test("بلا دخول 401، وCSRF من أصل آخر 403", async () => {
  const { call, ids } = await makeEnv();
  assert.equal((await call(null, "GET", "subjects")).status, 401);
  assert.equal((await call(ids.up, "POST", "admin/questions", { subject_id: 1 }, { origin: "https://evil.test" })).status, 403);
});

test("إنشاء سؤال: الصلاحيات حسب النطاق", async () => {
  const { call, ids } = await makeEnv();
  const body = { subject_id: 1, type: "sba", content: sba() };
  assert.equal((await call(ids.st, "POST", "admin/questions", body)).status, 403);       // طالب
  assert.equal((await call(ids.other, "POST", "admin/questions", body)).status, 403);
  assert.equal((await call(ids.up, "POST", "admin/questions", { ...body, subject_id: 2 })).status, 403); // مادة قسم آخر
  const ok = await call(ids.up, "POST", "admin/questions", body);
  assert.equal(ok.status, 201); assert.equal(ok.body.status, "draft");
  assert.equal((await call(ids.root, "POST", "admin/questions", body)).status, 201);
  const dup = await call(ids.up, "POST", "admin/questions", body);
  assert.equal(dup.body.duplicates.length >= 1, true);
  assert.equal((await call(ids.up, "POST", "admin/questions", { subject_id: 1, type: "sba", content: { text: "x", options: [{ id: "a", text: "1" }], correct: "z" } })).status, 422);
});

test("الاعتماد والنشر للممثل فقط، والرافع لا ينشر", async () => {
  const { call, ids } = await makeEnv();
  const id = (await call(ids.up, "POST", "admin/questions", { subject_id: 1, type: "sba", content: sba() })).body.id;
  assert.equal((await call(ids.up, "POST", "admin/question/" + id + "/status", { to: "published" })).status, 403); // الرافع لا ينشر
  assert.equal((await call(ids.up, "POST", "admin/question/" + id + "/status", { to: "pending" })).status, 200);
  assert.equal((await call(ids.up, "POST", "admin/question/" + id + "/status", { to: "published" })).status, 403);
  assert.equal((await call(ids.rep, "POST", "admin/question/" + id + "/status", { to: "published" })).status, 200);
  assert.equal((await call(ids.up, "PUT", "admin/question/" + id, { content: sba("معدّل") })).status, 403); // منشور: لا يعدّله صاحبه
  assert.equal((await call(ids.rep, "PUT", "admin/question/" + id, { content: sba("معدّل") })).status, 200);
  const g = await call(ids.rep, "GET", "admin/question/" + id);
  assert.equal(g.body.versions.length, 2); assert.equal(g.body.reviews.length >= 2, true);
});

test("الطالب: لا مفتاح إجابة في الأسئلة ولا في المحاولة الجارية", async () => {
  const { call, ids, q } = await seeded();
  const qs = await call(ids.st, "GET", "questions?subject=1");
  assert.equal(qs.status, 200); assert.equal(qs.body.questions.length, 4);
  const raw = JSON.stringify(qs.body);
  assert.equal(/"correct"|"accepted"|explanation/.test(raw), false);
  const at = await call(ids.st, "POST", "attempts", { smart: { subject_id: 1, count: 4, mode: "exam" } });
  assert.equal(at.status, 201, JSON.stringify(at.body));
  assert.equal(/"correct"|"accepted"|explanation/.test(JSON.stringify(at.body)), false);
});

test("المسودات لا تظهر للطلاب وغير المصرّح لهم", async () => {
  const { call, ids } = await makeEnv();
  await call(ids.up, "POST", "admin/questions", { subject_id: 1, type: "sba", content: sba() });
  assert.equal((await call(ids.st, "GET", "questions?subject=1")).body.questions.length, 0);
  assert.equal((await call(ids.st, "GET", "admin/questions?subject=1")).status, 403);
  assert.equal((await call(ids.other, "GET", "admin/questions?subject=1")).status, 403);
});

test("اختبار كامل: بناء، نشر، حل، تسليم، نتيجة، IDOR، تسليم مزدوج", async () => {
  const { call, ids, q, sql } = await seeded();
  const quizId = (await call(ids.rep, "POST", "admin/quizzes", { subject_id: 1, title: "اختبار 1" })).body.id;
  const save = await call(ids.rep, "PUT", "admin/quiz/" + quizId, { meta: { mode: "exam", duration_min: 10, pass_score: 3, attempts_allowed: 2, settings: { showResults: true, allowReview: true, showExplanations: true } }, sections: [{ id: "s1", title: "قسم" }], items: [{ id: "i1", kind: "heading", content: { text: "عنوان" }, section: "s1" }, { id: "i2", kind: "question", question_id: q[0], section: "s1" }, { id: "i3", kind: "question", question_id: q[1] }, { id: "i4", kind: "question", question_id: q[2] }, { id: "i5", kind: "question", question_id: q[3] }], conditions: [] });
  assert.equal(save.status, 200, JSON.stringify(save.body));
  const doc = await call(ids.rep, "GET", "admin/quiz/" + quizId);
  assert.equal(doc.body.items.length, 5);
  assert.equal((await call(ids.rep, "POST", `admin/quiz/${quizId}/status`, { to: "published" })).status, 200);
  assert.equal((await call(ids.st, "GET", "quizzes?subject=1")).body.quizzes.length, 1);

  const a = await call(ids.st, "POST", "attempts", { quiz_id: quizId });
  assert.equal(a.status, 201, JSON.stringify(a.body));
  const aid = a.body.attempt.id;
  assert.equal((await call(ids.st2, "GET", "attempts/" + aid)).status, 404);               // IDOR
  assert.equal((await call(ids.st2, "PUT", `attempts/${aid}/answers`, { answers: {} })).status, 404);
  assert.equal((await call(ids.st2, "POST", `attempts/${aid}/submit`, {})).status, 404);
  const qs = a.body.attempt.items.filter((i) => i.kind === "question");
  const idOf = (n) => String(q[n]);
  const put = await call(ids.st, "PUT", `attempts/${aid}/answers`, { answers: { [idOf(0)]: "a", [idOf(1)]: true, [idOf(2)]: "Heart", [idOf(3)]: "نص طويل" }, rev: 0 });
  assert.equal(put.status, 200, JSON.stringify(put.body));
  const [s1, s2] = await Promise.all([call(ids.st, "POST", `attempts/${aid}/submit`, {}), call(ids.st, "POST", `attempts/${aid}/submit`, {})]);
  assert.deepEqual([s1.status, s2.status].sort(), [200, 200]);
  const row = sql.prepare("SELECT status, final, score, max_score FROM qb_attempts WHERE id=?").get(aid);
  assert.equal(row.status, "submitted"); assert.equal(row.final, 0); assert.equal(row.score, 4); assert.equal(row.max_score, 8);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM qb_attempt_answers WHERE attempt_id=?").get(aid).n, 4);
  const res = await call(ids.st, "GET", `attempts/${aid}/result`);
  assert.equal(res.status, 200); assert.equal(res.body.result.final, false);
  // تصحيح يدوي
  const list = await call(ids.rep, "GET", "admin/grading?subject=1");
  assert.equal(list.body.attempts.length, 1);
  assert.equal((await call(ids.st, "GET", "admin/grading?subject=1")).status, 403);
  const g = await call(ids.rep, "GET", "admin/attempt/" + aid);
  assert.equal(g.body.pending.length, 1);
  const done = await call(ids.rep, "POST", `admin/attempt/${aid}/grade`, { scores: { [idOf(3)]: 3 } });
  assert.equal(done.status, 200, JSON.stringify(done.body)); assert.equal(done.body.final, true); assert.equal(done.body.score, 7);
  assert.equal(sql.prepare("SELECT status, final FROM qb_attempts WHERE id=?").get(aid).final, 1);
});

test("المهلة: تسليم بعد الموعد يُحتسب بما حُفظ، والحفظ بعد الموعد مرفوض", async () => {
  const { call, ids, q, clock } = await seeded();
  const quizId = (await call(ids.rep, "POST", "admin/quizzes", { subject_id: 1, title: "مؤقت" })).body.id;
  await call(ids.rep, "PUT", "admin/quiz/" + quizId, { meta: { mode: "exam", duration_min: 1 }, items: [{ id: "a", kind: "question", question_id: q[0] }] });
  await call(ids.rep, "POST", `admin/quiz/${quizId}/status`, { to: "published" });
  const a = await call(ids.st, "POST", "attempts", { quiz_id: quizId }), aid = a.body.attempt.id;
  clock.now += 61_000 + 6_000;
  const late = await call(ids.st, "PUT", `attempts/${aid}/answers`, { answers: { [String(q[0])]: "a" } });
  assert.equal(late.status >= 400, true);
  const sub = await call(ids.st, "POST", `attempts/${aid}/submit`, {});
  assert.equal(sub.status, 200);
  assert.equal((await call(ids.st, "GET", `attempts/${aid}/result`)).body.result.score, 0);
});

test("وضع التدريب: check يكشف الإجابة؛ وفي الامتحان مرفوض", async () => {
  const { call, ids, q } = await seeded();
  const p = await call(ids.st, "POST", "attempts", { smart: { subject_id: 1, count: 2, mode: "practice" } });
  assert.equal(p.status, 201);
  const aid = p.body.attempt.id, qid = p.body.attempt.items.find((i) => i.kind === "question").qid;
  const ck = await call(ids.st, "POST", `attempts/${aid}/check`, { qid, answer: "a" });
  assert.equal(ck.status, 200);
  const e = await call(ids.st, "POST", "attempts", { smart: { subject_id: 1, count: 2, mode: "exam" } });
  assert.equal((await call(ids.st, "POST", `attempts/${e.body.attempt.id}/check`, { qid: e.body.attempt.items.find((i) => i.kind === "question").qid, answer: "a" })).status >= 400, true);
});

test("المنطق الشرطي: يُرفض في الامتحان الرسمي ويُقبل غير ذلك", async () => {
  const { call, ids, q } = await seeded();
  const quizId = (await call(ids.rep, "POST", "admin/quizzes", { subject_id: 1, title: "شرطي" })).body.id;
  const items = [{ id: "a", kind: "question", question_id: q[0] }, { id: "b", kind: "question", question_id: q[1] }];
  const conds = [{ kind: "show_if", source: "a", op: "eq", value: "a", target: "b" }];
  assert.equal((await call(ids.rep, "PUT", "admin/quiz/" + quizId, { meta: { mode: "practice" }, items, conditions: conds })).status, 200);
  assert.equal((await call(ids.rep, "PUT", "admin/quiz/" + quizId, { meta: { mode: "exam", settings: { official: true } }, items, conditions: conds })).status, 422);
  assert.equal((await call(ids.rep, "PUT", "admin/quiz/" + quizId, { meta: { mode: "practice" }, items, conditions: [{ kind: "show_if", source: "b", op: "eq", value: "x", target: "a" }] })).status, 422);
});

test("نشر اختبار فيه سؤال غير منشور مرفوض؛ والحذف يمنع المستخدم", async () => {
  const { call, ids, q } = await seeded();
  const draft = (await call(ids.up, "POST", "admin/questions", { subject_id: 1, type: "sba", content: sba("مسودة") })).body.id;
  const quizId = (await call(ids.rep, "POST", "admin/quizzes", { subject_id: 1, title: "z" })).body.id;
  await call(ids.rep, "PUT", "admin/quiz/" + quizId, { items: [{ id: "a", kind: "question", question_id: draft }] });
  assert.equal((await call(ids.rep, "POST", `admin/quiz/${quizId}/status`, { to: "published" })).status, 409);
  assert.equal((await call(ids.rep, "DELETE", "admin/question/" + draft)).status, 409); // مستخدم في اختبار
  assert.equal((await call(ids.rep, "DELETE", "admin/quiz/" + quizId)).status, 200);
  assert.equal((await call(ids.rep, "DELETE", "admin/question/" + draft)).status, 200);
});

test("استيراد: دائماً مسودات، يتجاوز المكرر، يرفض غير الصالح", async () => {
  const { call, ids, sql } = await makeEnv();
  const items = [{ type: "sba", content: sba("أ") }, { type: "sba", content: sba("أ") }, { type: "sba", content: { text: "سيئ" } }, { type: "tf", content: { text: "ب؟", correct: false } }];
  const pv = await call(ids.up, "POST", "admin/import/preview", { subject_id: 1, items });
  assert.equal(pv.body.valid, 3); assert.equal(pv.body.invalid, 1);
  const cm = await call(ids.up, "POST", "admin/import/commit", { subject_id: 1, items: items.map((i) => ({ ...i, status: "published" })) });
  assert.equal(cm.body.created, 2);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM qb_questions WHERE status='published'").get().n, 0);
  assert.equal((await call(ids.st, "POST", "admin/import/commit", { subject_id: 1, items })).status, 403);
});

test("البلاغات والمفضلة والبطاقات والإحصاءات", async () => {
  const { call, ids, q } = await seeded();
  assert.equal((await call(ids.st, "POST", "reports", { question_id: q[0], reason: "wrong_answer", details: "x" })).status, 201);
  assert.deepEqual((await call(ids.st, "GET", "admin/reports")).body.reports, []);
  const rp = await call(ids.rep, "GET", "admin/reports?subject=1");
  assert.equal(rp.body.reports.length, 1);
  assert.equal((await call(ids.rep, "PUT", "admin/reports/" + rp.body.reports[0].id, { status: "resolved" })).status, 200);
  assert.equal((await call(ids.st, "PUT", "bookmarks/" + q[0], {})).status, 200);
  assert.equal((await call(ids.st, "GET", "bookmarks?subject=1")).body.questions.length, 1);
  assert.equal((await call(ids.st, "GET", "me/stats")).status, 200);
});
