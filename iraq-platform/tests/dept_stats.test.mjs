import test from "node:test";
import assert from "node:assert/strict";
import { handleDeptStats } from "../functions/_lib/dept_stats.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

test("لوحة الممثل: أعداد الطلاب لكل مرحلة للمدير فقط", async () => {
  const { DB, sql } = database(); seedAcademic(sql);
  const NOW = 1000 * 86400000;
  sql.exec(`INSERT INTO user_profile (user_id,college_id,stage_id) VALUES (1,1,11),(3,1,11),(4,1,12);
    INSERT INTO signup_events (user_id,stage_id,created_at) VALUES (1,11,${NOW - 86400000}),(3,11,${NOW - 30 * 86400000});`);
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  const get = (who) => handleDeptStats(signedRequest(sql, "/api/dept-stats?department_id=1", who), env, { now: () => NOW });
  assert.equal((await handleDeptStats(new Request("https://example.test/api/dept-stats?department_id=1"), env)).status, 401);
  assert.equal((await get(3)).status, 403);
  const d = await (await get(2)).json();
  assert.deepEqual(d.stages, [{ stage: 1, students: 2 }, { stage: 2, students: 1 }]);
  assert.equal(d.total, 3); assert.equal(d.joined_week, 1);
  assert.equal(JSON.stringify(d).includes("@"), false, "لا بريد ولا أسماء");
});
