import test from "node:test";
import assert from "node:assert/strict";
import { handleAuth } from "../functions/_lib/auth.js";
import { handleAvatar } from "../functions/_lib/avatar.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

test("account deletion requires confirmation, wipes personal data and anonymizes the user", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  const env = { DB };
  const uid = sql.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get().id;
  sql.prepare("INSERT INTO user_data(user_id,k,v,t) VALUES(?,?,?,?)").run(uid, "fav", "[1]", 1);
  sql.prepare("INSERT INTO user_avatars (user_id,display_name,avatar) VALUES (?,?,?)").run(uid, "اسم اختبار", "/9j/");
  const avatar = () => handleAvatar(signedRequest(sql, "/api/avatar/" + uid, 2), env);
  assert.equal((await avatar()).headers.get("cache-control"), "private, no-cache");
  const api = (body) => handleAuth(signedRequest(sql, "/api/auth/delete", uid, body), env);
  assert.equal((await api({})).status, 400);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM user_data WHERE user_id=?").get(uid).n, 1);
  const ok = await api({ confirm: "DELETE" });
  assert.equal(ok.status, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM user_data WHERE user_id=?").get(uid).n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(uid).n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM user_avatars WHERE user_id=?").get(uid).n, 0);
  assert.equal((await avatar()).status, 404);
  sql.prepare("INSERT INTO user_avatars (user_id,avatar) VALUES (?,?)").run(uid, "/9j/");
  assert.equal((await avatar()).status, 404, "legacy avatar records for disabled accounts are not served");
  const u = sql.prepare("SELECT email,active FROM users WHERE id=?").get(uid);
  assert.equal(u.active, 0);
  assert.match(u.email, /deleted\.invalid$/);
});

test("deleting an owner account preserves an active configured owner even on concurrent requests", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  const env = { DB, ADMIN_EMAILS: "owner@example.test, manager@example.test, inactive@example.test" };
  const remove = id => handleAuth(signedRequest(sql, "/api/auth/delete", id, { confirm: "DELETE" }), env);
  const responses = await Promise.all([remove(1), remove(2)]);
  assert.deepEqual(responses.map(r => r.status).sort(), [200, 409]);
  assert.equal((await responses.find(r => r.status === 409).json()).error, "last_owner");
  const remaining = sql.prepare("SELECT id FROM users WHERE id IN (1,2) AND active=1").all();
  assert.equal(remaining.length, 1);
  assert.equal((await remove(remaining[0].id)).status, 409);
});
