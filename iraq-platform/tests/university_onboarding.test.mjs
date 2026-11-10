import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { handleOnboarding } from "../functions/_lib/onboarding.js";
import { handleCatalog } from "../functions/_lib/catalog.js";
import { onRequestGet } from "../functions/api/platform.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

const root = "/api/admin/universities";

test("onboarding migration is repeatable and preserves old directory rows and scopes", () => {
  const { sql } = database(8);
  seedAcademic(sql);
  const migration = readFileSync(new URL("../migrations/0009_university_onboarding.sql", import.meta.url), "utf8");
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
  const crossSite = signedRequest(sql, "/api/catalog/add", 1, { type: "university", name_ar: "محاولة خارجية" }, "https://foreign.test");
  assert.equal((await handleCatalog(crossSite, env)).status, 403);
  assert.equal((await (await read("universities?view=directory", 1)).json()).items.length, 2);
  assert.equal((await api(root, 1, { id: 1, action: "register", manager_id: 2 }, "https://foreign.test")).status, 403);
  assert.equal((await api(root, 1, { id: 2, action: "register", manager_id: 4 })).status, 409);
  assert.equal((await api(root, 1, { id: 1, action: "register", manager_id: 2 })).status, 200);
  assert.equal((await platform(1)).status, 404);
  assert.deepEqual((await (await read("subjects?department_id=1")).json()).items, []);
  assert.equal((await api(root, 1, { id: 1, action: "activate" })).status, 200);
  assert.equal((await api(root, 1, { id: 1, action: "activate" })).status, 409);
  const index = await (await read("index")).json();
  assert.deepEqual(index.u.map(item => item[0]), [1]);
  assert.deepEqual(index.c.map(item => item[0]), [1]);
  assert.deepEqual(index.d.map(item => item[0]), [1]);
  assert.equal((await read("subject?id=21")).status, 404);
  assert.equal((await platform(1)).status, 200);
  assert.equal((await platform(2)).status, 404);
  assert.deepEqual((await (await api(root, 1)).json()).totals, { directory: 2, active: 1, registered: 0, suspended: 0, not_onboarded: 1, waiting: 0 });
  assert.equal((await api(root, 1, { id: 1, action: "suspend" })).status, 200);
  assert.equal((await read("department?id=1")).status, 404);
  assert.equal((await (await api(root + "?filter=suspended", 1)).json()).items.length, 1);
  const audit = await (await api(root + "/audit", 1)).json();
  assert.deepEqual(audit.items.map(row => row.state), ["suspended", "active", "registered"]);
  assert.ok(audit.items.every(row => row.actor === "المالك"));
});

test("a student registering never activates a university; only authorized admins do", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  sql.exec("INSERT INTO users (id,google_sub,email,name,role,active,created_at) VALUES (9,'9','s9@example.test','طالب جديد','student',1,0)");
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  const read = (path, id) => handleCatalog(signedRequest(sql, "/api/catalog/" + path, id), env);
  const join = (id, body) => handleCatalog(signedRequest(sql, "/api/catalog/join", id, body), env);
  assert.equal((await read("universities?view=join")).status, 401);
  assert.deepEqual((await (await read("universities?view=join", 9)).json()).items.map(r => r.id).sort(), [1, 2]);
  assert.deepEqual((await (await read("universities", 9)).json()).items, []);
  assert.equal((await join(9, { department_id: 1, stage: 99 })).status, 400);
  assert.equal((await join(4, { department_id: 1, stage: 2 })).status, 401);
  // جامعة في الدليل وغير مفعّلة: يُحفظ التسجيل وتبقى الجامعة كما هي
  const ok = await join(9, { department_id: 1, stage: 2, state: "active", is_admin: true });
  assert.equal(ok.status, 200);
  const body = await ok.json();
  assert.equal(body.university_state, "pending");
  assert.equal(body.university_activated, false);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM university_onboarding").get().n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM university_onboarding_audit").get().n, 0);
  assert.deepEqual((await (await read("universities", 9)).json()).items, []);
  assert.equal(sql.prepare("SELECT role FROM users WHERE id=9").get().role, "student");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM scopes WHERE user_id=9").get().n, 0);
  const me = (await (await read("me", 9)).json()).profile;
  assert.equal(me.department_id, 1);
  assert.equal(me.university_state, "pending");
  assert.equal(me.membership, "pending");
  // جامعة فعّلتها الإدارة: تبقى ظاهرة، والتسجيل فيها يعيد active دون سجل تدقيق جديد
  sql.exec("INSERT INTO university_onboarding (university_id,state,manager_id,verified_at,updated_at,updated_by) VALUES (1,'active',1,1,1,1)");
  const audits = sql.prepare("SELECT COUNT(*) AS n FROM university_onboarding_audit").get().n;
  assert.equal((await (await join(9, { department_id: 1, stage: 3 })).json()).university_state, "active");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM university_onboarding_audit").get().n, audits);
  assert.deepEqual((await (await read("universities", 9)).json()).items.map(r => r.id), [1]);
  assert.equal((await (await read("me", 9)).json()).profile.university_state, "active");
  // المعلّقة مرفوضة وتبقى معلّقة
  sql.exec("UPDATE university_onboarding SET state='suspended' WHERE university_id=1");
  assert.equal((await join(9, { department_id: 1, stage: 3 })).status, 403);
  assert.equal(sql.prepare("SELECT state FROM university_onboarding WHERE university_id=1").get().state, "suspended");
  assert.deepEqual((await (await read("universities?view=join", 9)).json()).items.map(r => r.id), [2]);
});

test("university visibility: admin sees every directory row, activation never deletes or duplicates", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  sql.exec("INSERT INTO users (id,google_sub,email,name,role,active,created_at) VALUES (9,'9','s9@example.test','طالب','student',1,0)");
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  const api = (path, id, body) => handleOnboarding(signedRequest(sql, path, id, body), env);
  const cat = (path, id, body) => handleCatalog(signedRequest(sql, "/api/catalog/" + path, id, body), env);
  const count = table => sql.prepare("SELECT COUNT(*) AS n FROM " + table).get().n;
  const before = count("universities");
  // طالب ينضم إلى جامعة غير مفعّلة: تظهر للإدارة ضمن «غير مفعّلة» مع عدد المنتظرين
  await cat("join", 9, { department_id: 1, stage: 2 });
  const pending = await (await api(root + "?filter=not_onboarded", 1)).json();
  assert.deepEqual(pending.items.map(r => r.id).sort(), [1, 2]);
  assert.equal(pending.items.find(r => r.id === 1).students, 1);
  assert.equal(pending.totals.waiting, 1);
  assert.equal((await (await api(root + "?filter=directory", 1)).json()).items.length, before);
  // التفعيل مرتين: صف واحد، ولا حذف من الدليل
  assert.equal((await api(root, 1, { id: 1, action: "activate" })).status, 200);
  assert.equal((await api(root, 1, { id: 1, action: "activate" })).status, 409);
  assert.equal(count("university_onboarding"), 1);
  assert.equal(count("universities"), before);
  assert.deepEqual((await (await cat("universities", 9)).json()).items.map(r => r.id), [1]);
  assert.deepEqual((await (await api(root + "?filter=not_onboarded", 1)).json()).items.map(r => r.id), [2]);
  // غير المفعّلة محفوظة في القاعدة وتبقى في الدليل
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM universities WHERE id=2").get().n, 1);
  // جامعة مفعّلة لا تُحذف من الدليل حتى لو فرغت من الكليات
  sql.exec("INSERT INTO universities (id,slug,name_ar,is_active) VALUES (50,'x50','جامعة فارغة',1)");
  sql.exec("INSERT INTO university_onboarding (university_id,state,manager_id,verified_at,updated_at,updated_by) VALUES (50,'active',1,1,1,1)");
  assert.equal((await cat("delete", 1, { type: "university", id: 50 })).status, 409);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM universities WHERE id=50").get().n, 1);
  // دمج جامعة مفعّلة في أخرى بلا حالة: الحالة تنتقل ولا تختفي ولا تتكرر
  sql.exec("INSERT INTO universities (id,slug,name_ar,is_active) VALUES (51,'x51','جامعة الهدف',1)");
  assert.equal((await cat("import", 1, { merges: [["جامعة فارغة", "جامعة الهدف"]] })).status, 200);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM universities WHERE id=50").get().n, 0);
  assert.equal(sql.prepare("SELECT state FROM university_onboarding WHERE university_id=51").get().state, "active");
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM university_onboarding WHERE university_id=50").get().n, 0);
});

test("admin statistics count files and reports from their real store, and only enrolled students", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  sql.exec("INSERT INTO users (id,google_sub,email,name,role,active,created_at) VALUES (9,'9','s9@example.test','طالب','student',1,0)");
  sql.exec("INSERT INTO user_profile (user_id,college_id,stage_id) VALUES (9,1,NULL)"); // أُزيل من مرحلته: لا يُحسب طالباً
  const sid = sql.prepare(`SELECT sb.id FROM subjects sb JOIN terms t ON t.id=sb.term_id JOIN stages st ON st.id=t.stage_id
    JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id WHERE c.university_id=1 LIMIT 1`).get().id;
  const store = {
    "manifest.json": [{ id: "a", courseId: "s" + sid }, { id: "b", courseId: "s" + sid, status: "approved" },
      { id: "c", courseId: "s" + sid, status: "pending" }, { id: "d", courseId: "s" + sid, status: "rejected" }],
    "reports.json": [{ rid: "1", open: true }, { rid: "2", open: false }]
  };
  const env = { DB, ADMIN_EMAILS: "owner@example.test", LECTURES: { get: async (k) => store[k] ?? null } };
  const api = (path, id) => handleOnboarding(signedRequest(sql, path, id), env);
  const ov = (await (await api(root + "/overview", 1)).json()).totals;
  assert.deepEqual([ov.files, ov.pending, ov.reports, ov.students], [2, 1, 1, 0]);
  const row = (await (await api(root + "?filter=directory", 1)).json()).items.find(r => r.id === 1);
  assert.deepEqual([row.files, row.students], [2, 0]);
  // بلا ربط KV: لا تقدير، يبقى رقم الجدول
  delete env.LECTURES;
  assert.equal((await (await api(root + "/overview", 1)).json()).totals.files, 0);
});
