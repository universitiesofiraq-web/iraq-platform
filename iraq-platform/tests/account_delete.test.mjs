import test from "node:test";
import assert from "node:assert/strict";
import { handleAuth } from "../functions/_lib/auth.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

test("account deletion requires confirmation, wipes personal data and anonymizes the user", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  const env = { DB };
  const uid = sql.prepare("SELECT id FROM users ORDER BY id LIMIT 1").get().id;
  sql.prepare("INSERT INTO user_data(user_id,k,v,t) VALUES(?,?,?,?)").run(uid, "fav", "[1]", 1);
  const api = (body) => handleAuth(signedRequest(sql, "/api/auth/delete", uid, body), env);
  assert.equal((await api({})).status, 400);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM user_data WHERE user_id=?").get(uid).n, 1);
  const ok = await api({ confirm: "DELETE" });
  assert.equal(ok.status, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM user_data WHERE user_id=?").get(uid).n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM sessions WHERE user_id=?").get(uid).n, 0);
  const u = sql.prepare("SELECT email,active FROM users WHERE id=?").get(uid);
  assert.equal(u.active, 0);
  assert.match(u.email, /deleted\.invalid$/);
});
