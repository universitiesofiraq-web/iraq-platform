import test from "node:test";
import assert from "node:assert/strict";
import { handleCatalog } from "../functions/_lib/catalog.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

function fixture() {
  const { DB, sql } = database();
  seedAcademic(sql);
  sql.exec(`DELETE FROM scopes; DELETE FROM subjects; DELETE FROM terms; DELETE FROM stages; DELETE FROM departments; DELETE FROM colleges; DELETE FROM universities;
    INSERT INTO universities (id,slug,name_ar) VALUES (1,'b','جامعة البصرة');
    INSERT INTO colleges (id,university_id,slug,name_ar) VALUES (1,1,'m','كلية الطب'),(2,1,'e','كلية الهندسة');
    INSERT INTO departments (id,college_id,name_ar) VALUES (1,1,'المرحلة الأولى'),(2,1,'المرحلة الثانية'),(3,1,'المرحلة الثالثة'),(4,2,'الميكانيك');
    INSERT INTO stages (id,department_id,number) VALUES (11,1,1),(12,2,2),(13,3,3),(14,3,1),(41,4,1);
    INSERT INTO scopes VALUES (5,'stage',11,'rep');`);
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  return { sql, call: (method, who = 1) => handleCatalog(signedRequest(sql, "/api/catalog/fixdepts", who, method === "POST" ? {} : undefined), env) };
}

test("المعاينة لا تغيّر شيئاً وغير المشرف يُرفض", async () => {
  const { sql, call } = fixture();
  assert.equal((await call("GET", 3)).status, 403);
  const d = await (await call("GET")).json();
  assert.equal(d.colleges.length, 1);
  assert.equal(d.colleges[0].create, true);
  assert.deepEqual(d.colleges[0].conflicts, [1], "المرحلة 1 مكررة فتُترك");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM departments").get().n, 4);
});

test("التنفيذ ينقل المراحل إلى قسم واحد دون تغيير معرّفاتها ويبقي الصلاحيات", async () => {
  const { sql, call } = fixture();
  const r = await (await call("POST")).json();
  assert.equal(r.ok, true); assert.equal(r.created_departments, 1); assert.equal(r.moved_stages, 3);
  const dep = sql.prepare("SELECT id FROM departments WHERE name_ar='الطب العام'").get();
  const moved = sql.prepare("SELECT id FROM stages WHERE department_id=? ORDER BY id").all(dep.id).map((x) => x.id);
  assert.deepEqual(moved, [11, 12, 13]);
  assert.equal(sql.prepare("SELECT department_id FROM stages WHERE id=14").get().department_id, 3, "المتعارض يبقى");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM scopes WHERE node_id=11").get().n, 1);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM departments WHERE name_ar='الميكانيك'").get().n, 1, "كلية أخرى لا تُمس");
});
