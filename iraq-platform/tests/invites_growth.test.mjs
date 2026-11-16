import test from "node:test";
import assert from "node:assert/strict";
import { handleInvites } from "../functions/_lib/invites.js";
import { handleCatalog } from "../functions/_lib/catalog.js";
import { handleOnboarding } from "../functions/_lib/onboarding.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

function fixture() {
  const { DB, sql } = database();
  seedAcademic(sql);
  sql.exec(`
    INSERT INTO users (id,google_sub,email,name,role,active,created_at) VALUES
      (5,'5','dept@example.test','مسؤول القسم','student',1,0),
      (7,'7','stage@example.test','ممثل المرحلة','student',1,0),
      (9,'9','new@example.test','طالب جديد','student',1,0),
      (10,'10','other@example.test','طالب آخر','student',1,0);
    INSERT INTO scopes VALUES (5,'department',1,'rep'),(7,'stage',12,'rep');
  `);
  return { sql, env: { DB, ADMIN_EMAILS: "owner@example.test" } };
}

test("invite links: scoped creation, public resolution, revocation and source tracking", async () => {
  const { sql, env } = fixture();
  const inv = (path, who, body) => handleInvites(signedRequest(sql, path, who, body), env);
  const create = (who, type, id) => inv("/api/admin/invites", who, { action: "create", type, id });
  assert.equal((await create(9, "department", 1)).status, 403);
  assert.equal((await create(7, "stage", 11)).status, 403);
  assert.equal((await create(7, "department", 1)).status, 403);
  const dept = (await (await create(5, "department", 1)).json()).code;
  const stage = (await (await create(7, "stage", 12)).json()).code;
  assert.match(dept, /^[A-Z2-9]{10}$/);
  assert.equal((await inv("/api/invite?code=" + stage, 9)).status, 404);
  sql.exec("INSERT INTO university_onboarding (university_id,state,manager_id,verified_at,updated_at,updated_by) VALUES (1,'active',1,1,1,1)");
  const resolved = await (await inv("/api/invite?code=" + stage, 9)).json();
  assert.deepEqual([resolved.department_id, resolved.stage, resolved.type], [1, 2, "stage"]);
  assert.equal((await inv("/api/invite?code=AAAAAAAAAA", 9)).status, 404);
  assert.equal((await inv("/api/admin/invites?type=stage&id=12", 9)).status, 403);
  assert.equal((await (await inv("/api/admin/invites?type=stage&id=12", 7)).json()).items.length, 1);

  const join = (who, body) => handleCatalog(signedRequest(sql, "/api/catalog/join", who, body), env);
  assert.equal((await join(9, { department_id: 1, stage: 2, invite: stage })).status, 200);
  assert.equal((await join(10, { department_id: 1, stage: 3, invite: stage })).status, 200); // مرحلة مختلفة: تسجيل مباشر
  const counts = sql.prepare("SELECT invite_code AS c, COUNT(*) AS n FROM signup_events GROUP BY invite_code ORDER BY n").all();
  assert.deepEqual(counts.map(r => [r.c, r.n]), [[null, 1], [stage, 1]]);

  sql.exec("UPDATE university_onboarding SET state='suspended' WHERE university_id=1");
  assert.equal((await inv("/api/invite?code=" + stage, 9)).status, 404);
  assert.equal((await join(9, { department_id: 1, stage: 2, invite: stage })).status, 403);

  assert.equal((await inv("/api/admin/invites", 9, { action: "revoke", code: dept })).status, 403);
  assert.equal((await inv("/api/admin/invites", 5, { action: "revoke", code: dept })).status, 200);
  assert.equal((await inv("/api/invite?code=" + dept, 9)).status, 404);
  for (let i = 0; i < 9; i++) assert.equal((await create(7, "stage", 12)).status, 200);
  assert.equal((await create(7, "stage", 12)).status, 409);
});

test("growth analytics: totals, top universities and sources", async () => {
  const { sql, env } = fixture();
  const now = Date.now();
  sql.exec(`
    INSERT INTO user_profile (user_id,college_id,stage_id) VALUES (9,1,12),(10,1,12);
    INSERT INTO invitations (code,type,node_id,created_by,created_at) VALUES ('ABCDEFGHJK','stage',12,7,${now});
    INSERT INTO signup_events (user_id,stage_id,invite_code,created_at) VALUES (9,12,'ABCDEFGHJK',${now}),(10,12,NULL,${now});
    INSERT INTO sessions (token_hash,user_id,expires_at) VALUES ('a',9,${now + 29 * 86400000}),('b',10,${now + 5 * 86400000});
  `);
  const res = await handleOnboarding(signedRequest(sql, "/api/admin/universities/analytics", 1), env);
  assert.equal(res.status, 200);
  const data = await res.json();
  assert.deepEqual(data.totals, { students: 2, active7: 1, active30: 3, signups7: 2, signups30: 2, accounts7: 0 });
  assert.equal(data.top[0].name_ar, "جامعة الدليل");
  assert.equal(data.top[0].students, 2);
  assert.deepEqual(data.sources.map(r => [r.code, r.n]).sort(), [["ABCDEFGHJK", 1], ["direct", 1]]);
  assert.equal(data.daily.reduce((s, r) => s + r.n, 0), 2);
  assert.equal((await handleOnboarding(signedRequest(sql, "/api/admin/universities/analytics", 9), env)).status, 403);
});
