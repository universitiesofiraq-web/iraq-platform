// C3/C5: اختبارات سلبية لإسناد الممثلين. التشغيل: node tests/rep_assignments.test.mjs
import { canAssign, grantCapabilities, transferMain, isDuplicateActive } from "../functions/_lib/rep_assignments.js";
import assert from "node:assert/strict";
const node = { type: "department", node_id: 100 };
const main = { id: 1, assignments: [{ ...node, user_id: 1, role: "main", active: true }] };
const asst = { id: 2, assignments: [{ ...node, user_id: 2, role: "assistant", active: true }] };
const stranger = { id: 3, assignments: [] };
const cases = [
  ["الممثل الرئيسي يعيّن على عقدته", () => assert.equal(canAssign(main, node).ok, true)],
  ["المساعد لا يعيّن", () => assert.equal(canAssign(asst, node).ok, false)],
  ["المساعد لا يمنح نفسه صلاحيات", () => assert.equal(grantCapabilities([], ["manage_reps"]).reason, "escalation_denied")],
  ["المفوِّض لا يمنح أكثر مما يملك", () => assert.equal(grantCapabilities(["review"], ["review", "upload"]).reason, "escalation_denied")],
  ["صلاحية غير معروفة مرفوضة", () => assert.equal(grantCapabilities(["review"], ["root"]).reason, "unknown_capability")],
  ["تفويض فارغ مرفوض", () => assert.equal(grantCapabilities(["review"], []).reason, "bad_request")],
  ["تفويض ضمن الصلاحيات مقبول", () => assert.deepEqual(grantCapabilities(["review", "upload"], ["upload"]).capabilities, ["upload"])],
  ["غريب بلا تعيين لا يعيّن", () => assert.equal(canAssign(stranger, node).ok, false)],
  ["مشرف عام يعيّن", () => assert.equal(canAssign(stranger, node, { isAdmin: true }).ok, true)],
  ["نقل المسؤولية: من غير الحالي مرفوض", () => assert.equal(transferMain(main.assignments, node, 2, 3).reason, "not_current_main")],
  ["نقل المسؤولية: لا يبقى إلا ممثل واحد نشط", () => {
    const r = transferMain(main.assignments, node, 1, 3);
    assert.equal(r.ok, true);
    assert.equal(r.assignments.filter((a) => a.role === "main" && a.active).length, 1);
    assert.equal(r.assignments.find((a) => a.user_id === 3).role, "main");
  }],
  ["نقل المسؤولية لنفس المستخدم مرفوض", () => assert.equal(transferMain(main.assignments, node, 1, 1).reason, "same_user")],
  ["منع تكرار التعيين النشط", () => assert.equal(isDuplicateActive(main.assignments, node, 1), true)],
  ["التعيين الملغى لا يُعدّ تكرارًا", () => assert.equal(isDuplicateActive([{ ...node, user_id: 1, role: "main", active: false }], node, 1), false)],
];
let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log("ok  -", name); } catch (e) { failed++; console.log("FAIL-", name, "\n   ", e.message.split("\n")[0]); }
}
console.log("\n" + (cases.length - failed) + "/" + cases.length + " passed");
process.exit(failed ? 1 : 0);
