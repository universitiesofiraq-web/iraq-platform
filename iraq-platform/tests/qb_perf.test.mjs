// أداء: بنك كبير (6000 سؤال) — القوائم المصفّحة والتوليد وحفظ اختبار كبير ضمن ميزانية زمنية، والاستعلامات الثقيلة تستعمل فهارس.
import test from "node:test";
import assert from "node:assert/strict";
import { makeEnv, sba } from "./helpers/qb_env.mjs";

test("بنك 6000 سؤال: قوائم وبحث وتوليد وحفظ اختبار 300 عنصر ضمن الميزانية", async () => {
  const { call, ids, sql } = await makeEnv(), N = 6000, now = Date.now();
  const ins = sql.prepare("INSERT INTO qb_questions (subject_id, lecture_id, category_id, type, status, difficulty, content_json, search_text, content_hash, points, version, created_by, updated_by, created_at, updated_at) VALUES (1,?,NULL,?,?,?,?,?,?,1,1,?,?,?,?)");
  sql.exec("BEGIN");
  for (let i = 0; i < N; i++) { const c = sba("سؤال رقم " + i + " عن الجهاز " + (i % 40)); ins.run(1 + (i % 2), i % 5 ? "sba" : "tf", i % 3 ? "published" : "draft", 1 + (i % 3), JSON.stringify(c), "سؤال رقم " + i + " عن الجهاز " + (i % 40), "h" + i, ids.rep, ids.rep, now, now); }
  sql.exec("COMMIT");
  const time = async (label, fn, budget) => { const t = performance.now(); const r = await fn(); const ms = performance.now() - t; assert.ok(ms < budget, `${label}: ${ms.toFixed(0)}ms > ${budget}ms`); return r; };
  const l = await time("قائمة مفلترة", () => call(ids.rep, "GET", "admin/questions?subject=1&status=published&type=sba&limit=20&offset=1000"), 400);
  assert.equal(l.body.questions.length, 20); assert.ok(l.body.total > 2000);
  const s = await time("بحث نصي", () => call(ids.rep, "GET", "admin/questions?subject=1&q=" + encodeURIComponent("رقم 4999")), 600); assert.equal(s.body.total >= 1, true);
  const g = await time("توليد 100", () => call(ids.rep, "POST", "admin/quizzes/generate", { subject_id: 1, count: 100 }), 600); assert.equal(g.body.ids.length, 100); assert.equal(new Set(g.body.ids).size, 100, "تكرار في التوليد");
  const quiz = (await call(ids.rep, "POST", "admin/quizzes", { subject_id: 1, title: "كبير" })).body.id;
  const pub = (await call(ids.rep, "GET", "admin/questions?subject=1&status=published&limit=100")).body.questions.map((q) => q.id);
  const more = (await call(ids.rep, "GET", "admin/questions?subject=1&status=published&limit=100&offset=100")).body.questions.map((q) => q.id);
  const items = [...pub, ...more, ...g.body.ids.filter((x) => !pub.includes(x) && !more.includes(x))].slice(0, 300).map((id, i) => ({ id: "n" + i, kind: "question", question_id: id }));
  const sv = await time("حفظ اختبار كبير", () => call(ids.rep, "PUT", "admin/quiz/" + quiz, { items }), 1500); assert.equal(sv.status, 200, JSON.stringify(sv.body).slice(0, 200));
  const doc = await time("تحميل اختبار كبير", () => call(ids.rep, "GET", "admin/quiz/" + quiz), 600); assert.equal(doc.body.items.length, items.length);
  // الفهارس: الاستعلام الرئيسي للقائمة لا يمسح الجدول كله
  const plan = sql.prepare("EXPLAIN QUERY PLAN SELECT id FROM qb_questions q WHERE q.subject_id=? AND q.status=? ORDER BY q.updated_at DESC LIMIT 20").all(1, "published").map((r) => r.detail).join(" | ");
  assert.match(plan, /USING (COVERING )?INDEX/i, "قائمة الأسئلة بلا فهرس: " + plan);
});
