import test from "node:test";
import assert from "node:assert/strict";
import { handleCollegeLogo } from "../functions/_lib/college_logo.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

const PNG = "data:image/png;base64," + Buffer.concat([Buffer.from([0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a]), Buffer.alloc(150, 7)]).toString("base64");
function fx() {
  const { DB, sql } = database(); seedAcademic(sql);
  sql.exec("CREATE TABLE IF NOT EXISTS college_logos (college_id INTEGER PRIMARY KEY, mime TEXT NOT NULL, data TEXT NOT NULL, updated_by INTEGER, updated_at INTEGER NOT NULL)");
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  return { sql, env, post: (who, body, id = 1) => handleCollegeLogo(signedRequest(sql, "/api/college-logo/" + id, who, body), env) };
}
test("شعار الكلية: لا يوجد → 404، المشرف يرفع، الطالب يُرفض، الصورة الفاسدة تُرفض", async () => {
  const { sql, env, post } = fx();
  assert.equal((await handleCollegeLogo(new Request("https://example.test/api/college-logo/1"), env)).status, 404);
  assert.equal((await post(3, { image: PNG })).status, 403);
  assert.equal((await post(1, { image: "data:image/png;base64,AAAA" })).status, 400);
  assert.equal((await post(1, { image: PNG })).status, 200);
  const g = await handleCollegeLogo(new Request("https://example.test/api/college-logo/1"), env);
  assert.equal(g.status, 200); assert.equal(g.headers.get("content-type"), "image/png");
  assert.equal((await post(1, { remove: true })).status, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM college_logos").get().n, 0);
});
