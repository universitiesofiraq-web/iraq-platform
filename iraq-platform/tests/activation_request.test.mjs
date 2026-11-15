import test from "node:test";
import assert from "node:assert/strict";
import { handleActivation } from "../functions/_lib/activation.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";
import { readFileSync } from "node:fs";

function fx() {
  const { DB, sql } = database(); seedAcademic(sql);
  sql.exec(readFileSync(new URL("../migrations/0024_activation_requests.sql", import.meta.url), "utf8"));
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  return { sql, env, post: (who, body) => handleActivation(signedRequest(sql, "/api/activation-request", who, body), env), get: (who, p) => handleActivation(signedRequest(sql, p, who), env) };
}
test("طلب تفعيل: يُرسل مرة واحدة، يُحصى للمشرف، ويُرفض إن كانت الجامعة مفعّلة", async () => {
  const { sql, env, post, get } = fx();
  assert.equal((await handleActivation(new Request("https://example.test/api/activation-request"), env)).status, 401);
  assert.equal((await post(3, { department_id: 1 })).status, 200);
  assert.equal((await post(3, { department_id: 1 })).status, 200); // مكرر: بلا خطأ ولا صف ثانٍ
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM activation_requests").get().n, 1);
  assert.equal((await post(3, { department_id: 999 })).status, 404);
  assert.equal((await (await get(3, "/api/activation-request?department_id=1")).json()).sent, true);
  assert.equal((await get(3, "/api/admin/activation-requests")).status, 403);
  const list = await (await get(1, "/api/admin/activation-requests")).json();
  assert.equal(list.items.length, 1); assert.equal(list.items[0].requests, 1);
  sql.exec("INSERT INTO university_onboarding(university_id,state,manager_id,verified_at,updated_at,updated_by) VALUES (1,'active',2,0,0,1)");
  assert.equal((await post(2, { department_id: 1 })).status, 409);
  assert.equal((await (await get(1, "/api/admin/activation-requests")).json()).items.length, 0);
});
