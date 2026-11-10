import test from "node:test";
import assert from "node:assert/strict";
import { onRequest } from "../functions/api/[[path]].js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

test("Pages router applies role checks to onboarding, directory and stage resources", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  const call = (route, who, body, origin) =>
    onRequest({ request: signedRequest(sql, route, who, body, origin), env });
  const uni = "/api/admin/universities";
  assert.equal((await call(uni)).status, 401);
  assert.equal((await call(uni + "/managers?university_id=1", 3)).status, 403);
  const candidates = (await (await call(uni + "/managers?university_id=1", 1)).json()).items;
  assert.deepEqual(candidates.map(item => item.id), [2]);
  assert.deepEqual((await (await call(uni + "/managers?university_id=2", 1)).json()).items, []);

  assert.equal((await call(uni, 1, { id: 1, action: "register", manager_id: 2 })).status, 200);
  assert.equal((await call(uni, 1, { id: 1, action: "verify" })).status, 200);
  assert.equal((await call(uni, 1, { id: 1, action: "activate" })).status, 200);
  assert.equal((await (await call("/api/catalog/index")).json()).u.length, 1);

  assert.equal((await call("/api/admin/stage-representative", 2, { stage_id: 12, expected_user_id: 0, user_id: 3 })).status, 200);
  const stage = "/api/admin/workspace?type=stage&id=";
  assert.equal((await call(stage + 11, 3)).status, 403);
  assert.deepEqual((await (await call(stage + 12, 3)).json()).subjects.map(item => item.id), [12]);
  assert.equal((await call("/api/admin/stage-announcements?stage_id=12", 3, { title: "إعلان" }, "https://foreign.test")).status, 403);
  assert.equal((await call("/api/admin/stage-announcements?stage_id=12", 3, { title: "إعلان" })).status, 200);
  assert.deepEqual((await (await call("/api/announcements")).json()).items, []);
});
