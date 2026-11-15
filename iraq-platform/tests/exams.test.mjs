import test from "node:test";
import assert from "node:assert/strict";
import { handleExams } from "../functions/_lib/exams.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

const NOW = Date.parse("2026-11-15T10:00:00Z");
function fx() {
  const { DB, sql } = database(); seedAcademic(sql);
  sql.exec("INSERT INTO university_onboarding (university_id,state,manager_id,verified_at,updated_at,updated_by) VALUES (1,'active',1,1,1,1),(2,'registered',1,NULL,1,1);");
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  const post = (who, path, body) => handleExams(signedRequest(sql, "/api/exams" + path, who, body), env, { now: () => NOW });
  const get = (q) => handleExams(new Request("https://example.test/api/exams?" + q), env, { now: () => NOW }).then((r) => r.json());
  return { sql, post, get };
}
const ok = { department_id: 1, stage: 1, title: "تشريح — نصف الكورس", exam_date: "2026-11-20", exam_time: "09:30", place: "القاعة 2" };

test("الامتحانات: الممثل يضيف، الطالب يُرفض، الطلاب يرون امتحانات مرحلتهم فقط", async () => {
  const { post, get } = fx();
  assert.equal((await post(3, "", ok)).status, 403);
  assert.equal((await post(2, "", { ...ok, exam_date: "2020-01-01" })).status, 400);
  assert.equal((await post(2, "", { ...ok, exam_date: "غدا" })).status, 400);
  assert.equal((await post(2, "", { ...ok, exam_time: "25:99" })).status, 400);
  assert.equal((await post(2, "", ok)).status, 200);
  assert.equal((await post(2, "", { ...ok, stage: 2, title: "مرحلة ثانية" })).status, 200);
  assert.equal((await post(2, "", { ...ok, stage: null, title: "للجميع", exam_date: "2026-11-25" })).status, 200);
  assert.deepEqual((await get("department_id=1&stage=1")).items.map((x) => x.title), ["تشريح — نصف الكورس", "للجميع"]);
  assert.equal((await get("department_id=1")).items.length, 3);
  assert.equal((await get("department_id=2")).items.length, 0);
});

test("الامتحانات: الحذف للمدير فقط، والجامعة غير المفعّلة لا تظهر", async () => {
  const { sql, post, get } = fx();
  const id = (await (await post(2, "", ok)).json()).id;
  assert.equal((await post(3, "/delete", { id })).status, 403);
  assert.equal((await post(2, "/delete", { id })).status, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM exams").get().n, 0);
  sql.exec("INSERT INTO exams (department_id,title,exam_date,created_at) VALUES (2,'x','2026-11-20',1)");
  assert.equal((await get("department_id=2")).items.length, 0);
});
