// C5: اختبارات سلبية على نقاط الفرق الفعلية (handleScopes) بقاعدة وهمية في الذاكرة.
// التشغيل: node tests/scope_endpoints.test.mjs
import { handleScopes } from "../functions/_lib/scope.js";
import assert from "node:assert/strict";

function makeDb() {
  const T = {
    users: [{ id: 1, email: "admin@x.com", name: "A", role: "user" }, { id: 5, email: "rep@x.com", name: "R", role: "user" },
            { id: 6, email: "other@x.com", name: "O", role: "user" }, { id: 7, email: "stu@x.com", name: "S", role: "user" }],
    departments: [{ id: 100, college_id: 10, name_ar: "قسم أ" }, { id: 999, college_id: 10, name_ar: "قسم ب" }],
    colleges: [{ id: 10, university_id: 1, name_ar: "كلية" }],
    universities: [{ id: 1, name_ar: "جامعة" }],
    scopes: [{ user_id: 5, type: "department", node_id: 100, level: "rep" }],
    rep_requests: [], scope_audit: []
  };
  const q = (sql, a) => {
    if (/^CREATE TABLE/.test(sql)) return { changes: 0 };
    if (/FROM departments d JOIN colleges c/.test(sql)) { const d = T.departments.find((x) => x.id === a[0]); return d ? { department: d.id, college: d.college_id, university: 1 } : null; }
    if (/SELECT name_ar FROM departments WHERE id=\?/.test(sql)) { const d = T.departments.find((x) => x.id === a[0]); return d ? { name_ar: d.name_ar } : null; }
    if (/SELECT id FROM users WHERE lower\(email\)=\?/.test(sql)) { const u = T.users.find((x) => x.email === a[0]); return u ? { id: u.id } : null; }
    if (/SELECT level FROM scopes WHERE user_id=\? AND type=\? AND node_id=\?/.test(sql)) { const x = T.scopes.find((r) => r.user_id === a[0] && r.type === a[1] && r.node_id === a[2]); return x ? { level: x.level } : null; }
    if (/FROM colleges c WHERE c.id=\?/.test(sql)) { const c = T.colleges.find((x) => x.id === a[0]); return c ? { department: null, college: c.id, university: c.university_id } : null; }
    if (/FROM universities u WHERE u.id=\?/.test(sql)) { const u = T.universities.find((x) => x.id === a[0]); return u ? { department: null, college: null, university: u.id } : null; }
    if (/SELECT name_ar FROM universities WHERE id=\?/.test(sql)) { const u = T.universities.find((x) => x.id === a[0]); return u ? { name_ar: u.name_ar } : null; }
    if (/SELECT name_ar FROM colleges WHERE id=\?/.test(sql)) { const c = T.colleges.find((x) => x.id === a[0]); return c ? { name_ar: c.name_ar } : null; }
    if (/SELECT type, node_id, level FROM scopes WHERE user_id=\?/.test(sql)) return { results: T.scopes.filter((s) => s.user_id === a[0]) };
    if (/^INSERT INTO scopes/.test(sql)) { const [uid, type, node, lvl] = a; const level = lvl ?? 'rep'; const ex = T.scopes.find((s) => s.user_id === uid && s.type === type && s.node_id === node); if (ex) ex.level = level; else T.scopes.push({ user_id: uid, type, node_id: node, level }); return { changes: 1 }; }
    if (/^DELETE FROM scopes/.test(sql)) { T.scopes = T.scopes.filter((s) => !(s.user_id === a[0] && s.type === a[1] && s.node_id === a[2])); return { changes: 1 }; }
    if (/SELECT id FROM rep_requests WHERE user_id=\? AND type=\? AND node_id=\? AND status='pending'/.test(sql)) return T.rep_requests.find((r) => r.user_id === a[0] && r.type === a[1] && r.node_id === a[2] && r.status === "pending") || null;
    if (/^INSERT INTO rep_requests/.test(sql)) { T.rep_requests.push({ id: T.rep_requests.length + 1, user_id: a[0], type: a[1], node_id: a[2], status: "pending" }); return { changes: 1 }; }
    if (/SELECT \* FROM rep_requests WHERE id=\? AND status='pending'/.test(sql)) return T.rep_requests.find((r) => r.id === a[0] && r.status === "pending") || null;
    if (/^UPDATE rep_requests SET status=\? WHERE id=\?/.test(sql)) { const r = T.rep_requests.find((x) => x.id === a[1]); if (r) r.status = a[0]; return { changes: 1 }; }
    if (/^INSERT INTO scope_audit/.test(sql)) { T.scope_audit.push({ actor_id: a[0], target_user_id: a[1], action: a[2], type: a[3], node_id: a[4] }); return { changes: 1 }; }
    throw new Error("unhandled SQL: " + sql.slice(0, 80));
  };
  const env = { ADMIN_EMAILS: "admin@x.com", DB: { prepare(sql) { let args = []; return { bind(...x) { args = x; return this; }, async first() { return q(sql, args); }, async all() { return q(sql, args) ?? { results: [] }; }, async run() { return q(sql, args); } }; } } };
  return { env, T };
}
const req = (method, body) => new Request("https://x.test/api", { method, body: body ? JSON.stringify(body) : undefined, headers: { "content-type": "application/json" } });
const rep = { id: 5, email: "rep@x.com", role: "user" }, admin = { id: 1, email: "admin@x.com", role: "user" }, stu = { id: 7, email: "stu@x.com", role: "user" };
const call = async (env, user, p, method, body) => { const r = await handleScopes(req(method, body), env, user, p); return { status: r.status, body: await r.json() }; };

const cases = [
  ["ممثل يمنح صلاحية لقسم آخر خارج نطاقه: مرفوض", async () => { const { env } = makeDb(); const r = await call(env, rep, "/api/auth/scope", "POST", { type: "department", id: 999, level: "rep", email: "other@x.com" }); assert.equal(r.status, 403); }],
  ["ممثل يمنح في نطاقه: مقبول + سجل تدقيق", async () => { const { env, T } = makeDb(); const r = await call(env, rep, "/api/auth/scope", "POST", { type: "department", id: 100, level: "uploader", email: "other@x.com" }); assert.equal(r.status, 200); assert.equal(T.scope_audit.length, 1); assert.equal(T.scope_audit[0].action, "grant"); }],
  ["طالب بلا نطاق لا يمنح أحدًا", async () => { const { env } = makeDb(); const r = await call(env, stu, "/api/auth/scope", "POST", { type: "department", id: 100, level: "rep", email: "stu@x.com" }); assert.equal(r.status, 403); }],
  ["مستوى صلاحية غير معروف مرفوض", async () => { const { env } = makeDb(); const r = await call(env, rep, "/api/auth/scope", "POST", { type: "department", id: 100, level: "admin", email: "other@x.com" }); assert.equal(r.status, 400); }],
  ["نوع عقدة غير معروف مرفوض", async () => { const { env } = makeDb(); const r = await call(env, rep, "/api/auth/scope", "POST", { type: "users", id: 100, level: "rep", email: "other@x.com" }); assert.equal(r.status, 400); }],
  ["بريد غير موجود: 404", async () => { const { env } = makeDb(); const r = await call(env, rep, "/api/auth/scope", "POST", { type: "department", id: 100, level: "rep", email: "nobody@x.com" }); assert.equal(r.status, 404); }],
  ["إزالة الصلاحية تُسجَّل وتُنفَّذ (المشرف)", async () => { const { env, T } = makeDb(); const r = await call(env, admin, "/api/auth/scope", "POST", { type: "department", id: 100, level: "rep", email: "rep@x.com", action: "remove" }); assert.equal(r.status, 200); assert.equal(T.scopes.length, 0); assert.equal(T.scope_audit[0].action, "revoke"); }],
  ["طلب مكرر لا يُنشئ صفًا ثانيًا", async () => { const { env, T } = makeDb(); await call(env, stu, "/api/auth/rep-request", "POST", { type: "department", id: 100 }); const r = await call(env, stu, "/api/auth/rep-request", "POST", { type: "department", id: 100 }); assert.equal(r.body.duplicate, true); assert.equal(T.rep_requests.length, 1); }],
  ["طلب لعقدة غير موجودة: 404", async () => { const { env } = makeDb(); const r = await call(env, stu, "/api/auth/rep-request", "POST", { type: "department", id: 12345 }); assert.equal(r.status, 404); }],
  ["طلب بلا تسجيل دخول: 401", async () => { const { env } = makeDb(); const r = await call(env, null, "/api/auth/rep-request", "POST", { type: "department", id: 100 }); assert.equal(r.status, 401); }],
  ["الطالب لا يقرّر طلبات (ترقية ذاتية مرفوضة)", async () => { const { env, T } = makeDb(); await call(env, stu, "/api/auth/rep-request", "POST", { type: "department", id: 100 }); const r = await call(env, stu, "/api/auth/rep-request/decide", "POST", { id: 1, action: "approve" }); assert.equal(r.status, 403); assert.equal(T.rep_requests[0].status, "pending"); }],
  ["ممثل قائم لا يقرّر طلبات", async () => { const { env } = makeDb(); const r = await call(env, rep, "/api/auth/rep-request/decide", "POST", { id: 1, action: "approve" }); assert.equal(r.status, 403); }],
  ["المشرف يوافق: تُنشأ صلاحية ويُسجَّل التدقيق", async () => { const { env, T } = makeDb(); await call(env, stu, "/api/auth/rep-request", "POST", { type: "department", id: 100 }); const r = await call(env, admin, "/api/auth/rep-request/decide", "POST", { id: 1, action: "approve" }); assert.equal(r.status, 200); assert.ok(T.scopes.some((s) => s.user_id === 7 && s.level === "rep")); assert.equal(T.scope_audit.at(-1).action, "approve"); }],
  ["القرار على طلب مُقرَّر مرة أخرى مرفوض", async () => { const { env } = makeDb(); await call(env, stu, "/api/auth/rep-request", "POST", { type: "department", id: 100 }); await call(env, admin, "/api/auth/rep-request/decide", "POST", { id: 1, action: "reject" }); const r = await call(env, admin, "/api/auth/rep-request/decide", "POST", { id: 1, action: "approve" }); assert.equal(r.status, 404); }],
  ["إجراء قرار غير معروف مرفوض", async () => { const { env } = makeDb(); const r = await call(env, admin, "/api/auth/rep-request/decide", "POST", { id: 1, action: "delete" }); assert.equal(r.status, 400); }],
  ["هرمية: مسؤول القسم لا يعيّن مسؤولاً في قسمه نفسه", async () => { const { env } = makeDb(); const r = await call(env, rep, "/api/auth/scope", "POST", { type: "department", id: 100, level: "rep", email: "other@x.com" }); assert.equal(r.status, 403); }],
  ["هرمية: مسؤول القسم لا يزيل ولا يخفّض مسؤولاً نظيراً", async () => { const { env, T } = makeDb(); T.scopes.push({ user_id: 6, type: "department", node_id: 100, level: "rep" }); const a = await call(env, rep, "/api/auth/scope", "POST", { type: "department", id: 100, level: "rep", email: "other@x.com", action: "remove" }); const b = await call(env, rep, "/api/auth/scope", "POST", { type: "department", id: 100, level: "uploader", email: "other@x.com" }); assert.equal(a.status, 403); assert.equal(b.status, 403); assert.equal(T.scopes.find((x) => x.user_id === 6).level, "rep"); }],
  ["هرمية: مسؤول الكلية يعيّن مسؤول قسم تحته", async () => { const { env, T } = makeDb(); T.scopes.push({ user_id: 6, type: "college", node_id: 10, level: "rep" }); const r = await call(env, { id: 6, email: "other@x.com", role: "user" }, "/api/auth/scope", "POST", { type: "department", id: 100, level: "rep", email: "stu@x.com" }); assert.equal(r.status, 200); assert.ok(T.scopes.some((x) => x.user_id === 7 && x.type === "department" && x.level === "rep")); }],
  ["هرمية: مسؤول الكلية لا يعيّن مسؤول كلية بنفس مستواه", async () => { const { env, T } = makeDb(); T.scopes.push({ user_id: 6, type: "college", node_id: 10, level: "rep" }); const r = await call(env, { id: 6, email: "other@x.com", role: "user" }, "/api/auth/scope", "POST", { type: "college", id: 10, level: "rep", email: "stu@x.com" }); assert.equal(r.status, 403); }],
  ["هرمية: المشرف العام يعيّن مسؤول جامعة", async () => { const { env } = makeDb(); const r = await call(env, admin, "/api/auth/scope", "POST", { type: "university", id: 1, level: "rep", email: "stu@x.com" }); assert.equal(r.status, 200); }],
];
let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log("ok  -", name); } catch (e) { failed++; console.log("FAIL-", name, "\n   ", e.message.split("\n")[0]); }
}
console.log("\n" + (cases.length - failed) + "/" + cases.length + " passed");
process.exit(failed ? 1 : 0);
