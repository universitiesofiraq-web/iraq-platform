import test from "node:test";
import assert from "node:assert/strict";
import { handleAdminWorkspace } from "../functions/_lib/admin-workspace.js";
import { handleAuth, uploadAccount } from "../functions/_lib/auth.js";
import { handle } from "../netlify/lib/core.mjs";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

function fixture() {
  const { DB, sql } = database();
  seedAcademic(sql);
  sql.exec(`
    INSERT INTO users (id,google_sub,email,name,role,active,created_at) VALUES
      (5,'5','dept@example.test','مسؤول القسم','student',1,0),
      (6,'6','college@example.test','مشرف الكلية','student',1,0),
      (7,'7','other@example.test','طالب آخر','student',1,0);
    INSERT INTO scopes VALUES (5,'department',1,'rep'),(6,'college',1,'rep');
    INSERT INTO user_profile (user_id,college_id,stage_id) VALUES (7,1,12);
  `);
  return { DB, sql, env: { DB, ADMIN_EMAILS: "owner@example.test" } };
}

test("stage appointment is unique, atomic, audited and restricted to an ancestor", async () => {
  const { env, sql } = fixture();
  const api = (path, who, body) => handleAdminWorkspace(signedRequest(sql, path, who, body), env);
  const assign = (actor, stage_id, expected_user_id, user_id) =>
    api("/api/admin/stage-representative", actor, { stage_id, expected_user_id, user_id });
  assert.equal((await assign(5, 21, 0, 3)).status, 403);
  assert.equal((await assign(5, 12, 0, 4)).status, 409);
  assert.equal((await assign(5, 12, 0, 3)).status, 200);
  assert.equal((await assign(5, 11, 0, 3)).status, 409);
  assert.equal((await assign(5, 12, 0, 7)).status, 409);
  assert.equal((await assign(3, 12, 3, 7)).status, 403);
  assert.equal((await api("/api/admin/workspace?type=stage&id=11", 3)).status, 403);
  assert.equal((await api("/api/admin/workspace?type=department&id=1", 3)).status, 403);
  assert.equal((await api("/api/admin/workspace?type=college&id=2", 6)).status, 403);
  const dept = await (await api("/api/admin/workspace?type=department&id=1", 5)).json();
  assert.deepEqual(dept.items.map(item => item.id), [11, 12]);
  const stage = await (await api("/api/admin/workspace?type=stage&id=12", 3)).json();
  assert.equal(stage.can_assign, false);
  assert.deepEqual(stage.items.map(item => [item.id, item.students]), [[12, 1]]);
  const revoke = { type: "department", id: 1, level: "rep", action: "remove", email: "dept@example.test" };
  const scope = (actor, body) => handleAuth(signedRequest(sql, "/api/auth/scope", actor, body), env);
  assert.equal((await scope(6, revoke)).status, 403);
  assert.equal((await scope(6, { ...revoke, action: "add", level: "uploader" })).status, 403);
  assert.equal((await api("/api/admin/stage-representative", 5, {
    stage_id: 12, expected_user_id: 3, user_email: "  OTHER@example.test  "
  })).status, 200);
  assert.equal((await assign(5, 12, 3, 0)).status, 409);
  assert.equal((await api("/api/admin/workspace?type=stage&id=12", 3)).status, 403);
  assert.equal((await api("/api/admin/workspace?type=stage&id=12", 7)).status, 200);
  const students = await (await api("/api/admin/stage-students?stage_id=12", 7)).json();
  assert.deepEqual(students.items, [{ id: 7, name: "طالب آخر", verified: false }]);
  assert.equal((await api("/api/admin/stage-students?stage_id=11", 7)).status, 403);
  assert.deepEqual(sql.prepare("SELECT target_user_id, action FROM scope_audit ORDER BY id").all().map(row => [row.target_user_id,row.action]), [[3,"grant"], [3,"revoke"], [7,"grant"]]);
  assert.equal((await scope(2, revoke)).status, 200);
});

test("stage announcements require the exact stage scope or trusted student membership", async () => {
  const { env, sql } = fixture();
  sql.exec("INSERT INTO scopes VALUES (3,'stage',12,'rep')");
  sql.exec("INSERT INTO university_onboarding VALUES (1,'active',2,1,1,1)");
  const api = (path, who, body) => handleAdminWorkspace(signedRequest(sql, path, who, body), env);
  const root = "/api/admin/stage-announcements?stage_id=";
  assert.equal((await api(root + 11, 3, { title: "مرفوض" })).status, 403);
  assert.equal((await api(root + 21, 3, { title: "مرفوض" })).status, 403);
  assert.equal((await api(root + 12, 3, { title: "تبليغ المرحلة الثانية" })).status, 200);
  assert.equal((await api(root + 12, 7)).status, 403);
  const student = "/api/stage-announcements?stage_id=";
  assert.equal((await api(student + 12, 7)).status, 200);
  const ownFeed = await (await api("/api/stage-announcements", 7)).json();
  assert.deepEqual(ownFeed.items.map(row => row.title), ["تبليغ المرحلة الثانية"]);
  assert.deepEqual((await (await api("/api/stage-announcements", 3)).json()).items, []);
  sql.exec("UPDATE university_onboarding SET state='suspended' WHERE university_id=1");
  assert.deepEqual((await (await api("/api/stage-announcements", 7)).json()).items, []);
  assert.equal((await api(student + 11, 7)).status, 403);
  assert.equal((await api(student + 12)).status, 401);
  const all = await handleAuth(signedRequest(sql, "/api/announcements"), env);
  assert.deepEqual((await all.json()).items, []);
});

test("stage scope reaches file review, direct downloads and chunk storage without breaking old keys", async () => {
  const { env, sql } = fixture();
  sql.exec("INSERT INTO scopes VALUES (3,'stage',12,'rep')");
  const uuid = n => "aaaaaaaa-aaaa-aaaa-aaaa-" + String(n).padStart(12,"0");
  const a = { id: uuid(1), courseId: "s11", kind: "file", size: 5, chunks: 1, status: "pending" };
  const b = { id: uuid(2), courseId: "s12", kind: "file", size: 5, chunks: 1, status: "pending" };
  const values = new Map([["manifest.json", JSON.stringify([a,b])], ["chunks/" + a.id + "/000", new TextEncoder().encode("%PDF-").buffer]]);
  const get = (key, options = {}) => {
    const item = values.get(key) ?? null;
    return options.type === "json" && item !== null ? JSON.parse(item) : item;
  };
  const store = {
    async get(key, options) { return get(key, options); },
    async set(key, value) { values.set(key, value); },
    async delete(key) { values.delete(key); },
    async getMetadata(key) { return values.has(key) ? { metadata: { size: values.get(key).byteLength } } : null; },
    async getWithMetadata(key, options) { return values.has(key) ? { data: get(key,options), etag:"tag" } : null; }
  };
  const deps = { store, env: () => "", ip: "127.0.0.1", now: Date.now, account: uploadAccount(env) };
  const send = (path, who, body) => handle(signedRequest(sql, "/api/" + path, who, body), deps);
  assert.equal((await send("file/" + a.id, 3)).status, 404);
  assert.equal((await send("file/" + b.id, 3)).headers.get("cache-control"), "private, no-store");
  assert.equal((await (await send("file/" + a.id, 5)).text()), "%PDF-");
  assert.deepEqual((await (await send("admin", 3, {})).json()).items.map(entry => entry.id), [b.id]);
  assert.deepEqual((await (await send("admin", 5, { stage_id: 12 })).json()).items.map(entry => entry.id), [b.id]);
  assert.equal((await send("admin", 3, { stage_id: 11 })).status, 403);
  assert.equal((await send("reports", 3, { stage_id: 21 })).status, 403);
  assert.equal((await send("review", 3, { id: a.id, action: "approve" })).status, 403);
  assert.equal((await send("finish", 3, { id: a.id, courseId:"s11", chunks:1, number:1, title:"ملف" })).status, 403);
  assert.ok(values.has("chunks/" + a.id + "/000"));
  const chunk = (id, who, courseId, body = "%PDF-1.4\n") => {
    const auth = signedRequest(sql, "/api/chunk?id=" + id + "&index=0&courseId=" + courseId, who);
    return handle(new Request(auth.url, { method:"POST", headers:auth.headers, body }), deps);
  };
  assert.equal((await chunk(a.id, 3, "s12")).status, 409);
  assert.equal((await chunk(uuid(3), 3, "s11")).status, 403);
  assert.equal((await chunk(uuid(3), 3, "s12")).status, 200);
  assert.ok(values.has("account-chunks/3/s12/" + uuid(3) + "/000"));
  assert.equal((await send("abort", 5, { id: uuid(3), courseId:"s12" })).status, 200);
  assert.ok(values.has("account-chunks/3/s12/" + uuid(3) + "/000"));
  assert.equal((await send("abort", 3, { id: uuid(3), courseId:"s12" })).status, 200);
  assert.ok(!values.has("account-chunks/3/s12/" + uuid(3) + "/000"));

  let pdf = "%PDF-1.4\n";
  const offsets = [];
  for (const object of ["<< /Type /Catalog /Pages 2 0 R >>", "<< /Type /Pages /Kids [3 0 R] /Count 1 >>", "<< /Type /Page /Parent 2 0 R /MediaBox [0 0 100 100] >>"]) {
    offsets.push(pdf.length);
    pdf += offsets.length + " 0 obj\n" + object + "\nendobj\n";
  }
  const xref = pdf.length;
  pdf += "xref\n0 4\n0000000000 65535 f \n" + offsets.map(offset => String(offset).padStart(10,"0") + " 00000 n \n").join("");
  pdf += "trailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n" + xref + "\n%%EOF\n";
  assert.equal((await chunk(uuid(4), 3, "s12", pdf)).status, 200);
  const finish = { id: uuid(4), courseId: "s12", chunks: 1, number: 1, title: "PDF" };
  assert.equal((await send("finish", 3, finish)).status, 200);
  assert.equal((await send("finish", 3, finish)).status, 200);
  assert.equal((await send("finish", 5, finish)).status, 409);
  assert.equal((await (await send("file/" + uuid(4))).text()), pdf);
  assert.equal((await send("abort", 3, { id: uuid(4), courseId:"s12" })).status, 200);
  assert.equal((await (await send("file/" + uuid(4))).text()), pdf);
});

test("a representative confirms, unconfirms and bulk-confirms students of the stage only", async () => {
  const { env, sql } = fixture();
  const api = (path, who, body) => handleAdminWorkspace(signedRequest(sql, path, who, body), env);
  const url = "/api/admin/stage-students?stage_id=12";
  let list = await (await api(url, 5)).json();
  assert.deepEqual(list.items, [{ id: 7, name: "طالب آخر", verified: false }]);
  assert.equal((await api(url, 3, { action: "verify", user_id: 7 })).status, 403);
  assert.equal((await api(url, 5, { action: "verify", user_id: 3 })).status, 409);
  assert.equal((await api(url, 5, { action: "verify", user_id: 7 })).status, 200);
  assert.equal((await (await api(url, 5)).json()).items[0].verified, true);
  assert.equal((await api(url, 5, { action: "unverify", user_id: 7 })).status, 200);
  assert.equal((await (await api(url, 5)).json()).items[0].verified, false);
  assert.equal((await api(url, 5, { action: "verify_all" })).status, 200);
  assert.equal((await (await api(url, 5)).json()).items[0].verified, true);
  sql.exec("UPDATE user_profile SET stage_id=11 WHERE user_id=7");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM student_verification v JOIN user_profile p ON p.user_id=v.user_id AND p.stage_id=v.stage_id").get().n, 0);
});
