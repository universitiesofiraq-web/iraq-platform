import test from "node:test";
import assert from "node:assert/strict";
import { handleCatalog } from "../functions/_lib/catalog.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

function fixture() {
  const { DB, sql } = database();
  seedAcademic(sql);
  sql.exec("DELETE FROM scopes");
  sql.prepare("INSERT INTO scopes VALUES (3,'stage',11,'rep')").run();
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  const add = (body, who = 3) => handleCatalog(signedRequest(sql, "/api/catalog/add", who, { type: "subject", ...body }), env);
  return { sql, add };
}

test("ممثل مرحلة يضيف مادة لمرحلته فقط (بالمعرّف، والمرحلة تؤخذ من السجل)", async () => {
  const { sql, add } = fixture();
  const ok = await add({ department_id: 1, stage_id: 11, term: 2, name_ar: "التشريح", stage: 2 });
  assert.equal(ok.status, 200);
  const row = sql.prepare("SELECT st.number AS stage, t.number AS term FROM subjects sb JOIN terms t ON t.id=sb.term_id JOIN stages st ON st.id=t.stage_id WHERE sb.name_ar='التشريح'").get();
  assert.deepEqual({ ...row }, { stage: 1, term: 2 }, "المرحلة من السجل لا من المدخل");
});
test("ممثل مرحلة لا يضيف لمرحلة أخرى ولا بلا stage_id", async () => {
  const { add } = fixture();
  assert.equal((await add({ department_id: 1, stage_id: 12, term: 1, name_ar: "س" })).status, 403);
  assert.equal((await add({ department_id: 1, stage: 1, term: 1, name_ar: "س" })).status, 403);
  assert.equal((await add({ department_id: 2, stage_id: 11, term: 1, name_ar: "س" })).status, 403);
});
