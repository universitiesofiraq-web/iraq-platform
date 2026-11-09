// اختبار الربط: قاعدة بيانات وهمية تطابق الاستعلامات التي تستخدمها scope.js.
// التشغيل: node tests/authz_bridge.test.mjs
import { canAct } from "../functions/_lib/authz_bridge.js";
import assert from "node:assert/strict";

function fakeEnv({ scopes = [], admins = "" } = {}) {
  const tree = { 100: { department: 100, college: 10, university: 1 }, 999: { department: 999, college: 10, university: 1 } };
  const db = {
    prepare(sql) {
      const stmt = {
        bind(...args) { stmt.args = args; return stmt; },
        async run() { return {}; },
        async first() {
          if (/FROM departments d JOIN colleges/.test(sql)) return tree[stmt.args[0]] ? { ...tree[stmt.args[0]] } : null;
          return null;
        },
        async all() {
          if (/FROM scopes WHERE user_id/.test(sql)) return { results: scopes.filter((s) => s.user_id === stmt.args[0]) };
          return { results: [] };
        }
      };
      return stmt;
    }
  };
  return { DB: db, ADMIN_EMAILS: admins };
}
const u = { id: 5, email: "a@x.com", role: "user" };
const repDept100 = [{ user_id: 5, type: "department", node_id: 100, level: "rep" }];

const cases = [
  ["ممثل يدير قسمه", async () => assert.equal((await canAct(fakeEnv({ scopes: repDept100 }), u, "manage_content", "department", 100)).ok, true)],
  ["ممثل لا يدير قسمًا آخر", async () => assert.equal((await canAct(fakeEnv({ scopes: repDept100 }), u, "manage_content", "department", 999)).ok, false)],
  ["بلا نطاق: مرفوض", async () => assert.equal((await canAct(fakeEnv(), u, "upload", "department", 100)).ok, false)],
  ["مشرف عام يتجاوز", async () => assert.equal((await canAct(fakeEnv({ admins: "a@x.com" }), u, "announce", "department", 999)).ok, true)],
  ["مجهول: لا كتابة", async () => assert.equal((await canAct(fakeEnv(), null, "upload", "department", 100)).ok, false)],
  ["عقدة غير موجودة: لا تُمنح", async () => assert.equal((await canAct(fakeEnv({ scopes: repDept100 }), u, "review", "department", 12345)).ok, false)],
];
let failed = 0;
for (const [name, fn] of cases) {
  try { await fn(); console.log("ok  -", name); } catch (e) { failed++; console.log("FAIL-", name, "\n   ", e.message.split("\n")[0]); }
}
console.log("\n" + (cases.length - failed) + "/" + cases.length + " passed");
process.exit(failed ? 1 : 0);
