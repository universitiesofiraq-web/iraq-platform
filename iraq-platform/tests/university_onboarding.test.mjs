import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleOnboarding } from "../functions/_lib/onboarding.js";
import { handleCatalog } from "../functions/_lib/catalog.js";
import { onRequestGet } from "../functions/api/platform.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

const root = "/api/admin/universities";

test("onboarding migration is repeatable and preserves old directory rows and scopes", () => {
  const { sql } = database(7);
  seedAcademic(sql);
  const migration = readFileSync(new URL("../migrations/0008_university_onboarding.sql", import.meta.url), "utf8");
  sql.exec(migration);
  sql.exec(migration);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM universities WHERE is_active=1").get().n, 2);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM university_onboarding").get().n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM scopes").get().n, 2);
});

test("only explicit verified activation exposes the university and its children", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  const api = (path, id, body, origin) => handleOnboarding(signedRequest(sql, path, id, body, origin), env);
  const read = (path, id) => handleCatalog(signedRequest(sql, "/api/catalog/" + path, id), env);
  const platform = id => onRequestGet({ request: signedRequest(sql, "/api/platform?dept=" + id), env });
  assert.deepEqual((await (await read("index")).json()).u, []);
  assert.deepEqual((await (await api(root, 1)).json()).items, []);
  assert.equal((await api(root, 3)).status, 403);
  assert.equal((await api(root, 4)).status, 401);
  assert.equal((await read("universities?view=directory", 3)).status, 403);
  assert.equal((await (await read("universities?view=directory", 1)).json()).items.length, 2);
  assert.equal((await api(root, 1, { id: 1, action: "register", manager_id: 2 }, "https://foreign.test")).status, 403);
  assert.equal((await api(root, 1, { id: 2, action: "register", manager_id: 4 })).status, 409);
  assert.equal((await api(root, 1, { id: 1, action: "register", manager_id: 2 })).status, 200);
  assert.equal((await api(root, 1, { id: 1, action: "activate" })).status, 409);
  assert.equal((await platform(1)).status, 404);
  assert.deepEqual((await (await read("subjects?department_id=1")).json()).items, []);
  assert.equal((await api(root, 1, { id: 1, action: "verify" })).status, 200);
  assert.equal((await api(root, 1, { id: 1, action: "activate" })).status, 200);
  const index = await (await read("index")).json();
  assert.deepEqual(index.u.map(item => item[0]), [1]);
  assert.deepEqual(index.c.map(item => item[0]), [1]);
  assert.deepEqual(index.d.map(item => item[0]), [1]);
  assert.equal((await read("subject?id=21")).status, 404);
  assert.equal((await platform(1)).status, 200);
  assert.equal((await platform(2)).status, 404);
  assert.deepEqual((await (await api(root, 1)).json()).totals, { directory: 2, active: 1, registered: 0, suspended: 0 });
  assert.equal((await api(root, 1, { id: 1, action: "suspend" })).status, 200);
  assert.equal((await read("department?id=1")).status, 404);
  assert.equal((await (await api(root + "?filter=suspended", 1)).json()).items.length, 1);
  const audit = await (await api(root + "/audit", 1)).json();
  assert.deepEqual(audit.items.map(row => row.state), ["suspended", "active", "registered", "registered"]);
  assert.ok(audit.items.every(row => row.actor === "المالك"));
});
