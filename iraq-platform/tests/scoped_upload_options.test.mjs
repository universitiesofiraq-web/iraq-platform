import test from "node:test";
import assert from "node:assert/strict";
import { handleUploadOptions } from "../functions/_lib/upload-options.js";
import { onRequest } from "../functions/api/[[path]].js";
import { uploadAccount } from "../functions/_lib/auth.js";
import { handle } from "../netlify/lib/core.mjs";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

function fixture() {
  const { DB, sql } = database();
  seedAcademic(sql);
  sql.exec("DELETE FROM scopes");
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  const call = (query = "", who = 3) => handleUploadOptions(signedRequest(sql, "/api/upload-options" + query, who), env);
  return { env, sql, call };
}

for (const [type, id, expected] of [["university", 1, [11,12]], ["college", 1, [11,12]], ["department", 1, [11,12]], ["stage", 12, [12]]]) {
  test(type + " upload options include only the granted academic subtree", async () => {
    const { sql, call } = fixture();
    sql.prepare("INSERT INTO scopes VALUES (3,?,?,'rep')").run(type, id);
    const response = await call();
    assert.match(response.headers.get("cache-control"), /private, no-store/);
    assert.equal(response.headers.get("vary"), "Cookie");
    const data = await response.json();
    assert.equal(data.admin, false, "a legacy stored admin role cannot expand scopes");
    assert.deepEqual(data.universities.map(x => x.id), [1]);
    assert.deepEqual(data.colleges.map(x => x.id), [1]);
    assert.deepEqual(data.departments.map(x => x.id), [1]);
    const subjects = await (await call("?department_id=1&university_id=1&college_id=1")).json();
    assert.deepEqual(subjects.items.map(x => x.id), expected);
    assert.ok(subjects.items.every(x => x.can_publish));
    assert.equal((await call("?department_id=2")).status, 403);
    assert.equal((await call("?subject_id=21")).status, 403);
    assert.equal((await call("?department_id=1&college_id=2")).status, 403);
    assert.equal((await call("?department_id=1&university_id=2")).status, 403);
    assert.equal((await call("?stage_id=21")).status, 403);
  });
}

test("multiple grants remain a union of exact scopes, with per-material publication rights", async () => {
  const { sql, call } = fixture();
  sql.exec("INSERT INTO scopes VALUES (3,'stage',11,'rep'),(3,'stage',21,'uploader')");
  const data = await (await call()).json();
  assert.deepEqual(data.universities.map(x => x.id).sort(), [1,2]);
  assert.deepEqual((await (await call("?department_id=1")).json()).items.map(x => x.id), [11]);
  assert.equal((await (await call("?subject_id=11")).json()).items[0].can_publish, true);
  assert.equal((await (await call("?subject_id=21")).json()).items[0].can_publish, false);
  assert.equal((await call("?subject_id=12")).status, 403);
  sql.exec("DELETE FROM scopes WHERE node_id=21");
  assert.equal((await call("?subject_id=21")).status, 403);
  assert.deepEqual((await (await call()).json()).universities.map(x => x.id), [1]);
});

test("root administrators retain all choices, while guests and unscoped accounts are rejected", async () => {
  const { call, sql, env } = fixture();
  assert.equal((await call("", null)).status, 401);
  assert.equal((await call()).status, 403);
  assert.equal((await call("", 4)).status, 401);
  const admin = await (await call("", 1)).json();
  assert.equal(admin.admin, true);
  assert.equal(admin.universities.length, 2);
  assert.equal((await (await call("?subject_id=21", 1)).json()).items[0].can_publish, true);
  assert.equal((await call("?subject_id=999", 1)).status, 403);
  assert.equal((await call("?stage_id=bad", 1)).status, 400);
  assert.equal((await call("?department_id=-1", 1)).status, 400);
  assert.equal((await onRequest({ request: signedRequest(sql, "/api/upload-options", 1), env })).status, 200);
  assert.equal((await handleUploadOptions(new Request("https://example.test/api/upload-options", { method: "POST" }), env)).status, 405);
});

test("an assigned empty department stays visible without exposing another department", async () => {
  const { sql, call } = fixture();
  sql.exec("INSERT INTO departments VALUES (3,2,'قسم جديد',NULL); INSERT INTO scopes VALUES (3,'department',3,'uploader')");
  const data = await (await call()).json();
  assert.deepEqual(data.departments.map(x => x.id), [3]);
  assert.deepEqual((await (await call("?department_id=3")).json()).items, []);
  assert.equal((await call("?department_id=2")).status, 403);
});

test("chunk, finish and link reject forged subjects and revoked grants through existing upload entry points", async () => {
  const { sql, env } = fixture();
  sql.exec("INSERT INTO scopes VALUES (3,'stage',12,'rep'),(3,'stage',21,'uploader')");
  const values = new Map();
  let entries = [];
  const deps = {
    account: uploadAccount(env), env: () => "", ip: "", now: Date.now,
    manifest: { async read() { return entries; }, async update(fn) { entries = fn(entries); return entries; } },
    store: {
      async get(key) { return values.get(key) ?? null; },
      async set(key, value) { values.set(key, value); },
      async delete(key) { values.delete(key); }
    }
  };
  const post = (path, body) => handle(signedRequest(sql, "/api/" + path, 3, body), deps);
  const id = "bbbbbbbb-bbbb-bbbb-bbbb-bbbbbbbbbbbb";
  const headers = signedRequest(sql, "/", 3).headers;
  headers.set("origin", "https://example.test");
  const chunk = course => handle(new Request("https://example.test/api/chunk?id=" + id + "&index=0&courseId=" + course,
    { method: "POST", headers, body: "%PDF-1.4" }), deps);
  assert.equal((await chunk("s11")).status, 403);
  assert.equal(values.size, 0);
  assert.equal((await post("finish", { id, courseId: "s11", chunks: 1, number: 1, title: "خارج النطاق" })).status, 403);
  const link = { type: "quiz", number: 0, label: "اختبار", url: "https://example.org/test" };
  assert.equal((await post("link", { ...link, courseId: "s11" })).status, 403);
  assert.equal((await post("link", { ...link, courseId: "s9999" })).status, 403);
  const approved = await post("link", { ...link, courseId: "s12" });
  assert.equal(approved.status, 200);
  assert.equal((await approved.json()).status, "approved");
  const pending = await post("link", { ...link, courseId: "s21" });
  assert.equal(pending.status, 200);
  assert.equal((await pending.json()).status, "pending");
  sql.exec("DELETE FROM scopes WHERE type='stage' AND node_id=12");
  assert.equal((await chunk("s12")).status, 403);
  assert.equal((await post("link", { ...link, courseId: "s12" })).status, 403);
  assert.equal(entries.length, 2);
});
