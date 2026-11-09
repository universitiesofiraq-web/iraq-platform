// C5 (تطوير 02-A): اختبارات أمنية وسلوكية لطبقة الصلاحيات والطلبات والإشعارات.
// التشغيل: node tests/rep_v2.test.mjs
import { authorize, scopeCovers } from "../functions/_lib/authz.js";
import { transitionRequest, canRequest, revokeRep } from "../functions/_lib/rep_lifecycle.js";
import { requestDecidedEvent, EVENT_TYPES, buildEvent } from "../functions/_lib/notify_events.js";
import assert from "node:assert/strict";

const chain = { university: 1, college: 10, department: 100 };
const user = { id: 5 };
const rep = [{ type: "department", node_id: 100, level: "rep" }];
const upl = [{ type: "college", node_id: 10, level: "uploader" }];
const ok = (o) => authorize({ user, isAdmin: false, chain, ...o }).ok;
const cases = [];
const t = (name, fn) => cases.push([name, fn]);

t("الممثل يدير قسمه", () => assert.equal(ok({ scopes: rep, action: "manage_content" }), true));
t("ممثل قسم لا يدير قسمًا آخر", () => assert.equal(ok({ scopes: rep, action: "manage_content", chain: { ...chain, department: 999 } }), false));
t("الرافع يرفع ولا يدير المحتوى", () => { assert.equal(ok({ scopes: upl, action: "upload" }), true); assert.equal(ok({ scopes: upl, action: "manage_content" }), false); });
t("ممثل الكلية يراجع أقسامها", () => assert.equal(ok({ scopes: [{ type: "college", node_id: 10, level: "rep" }], action: "review" }), true));
t("لا تصعيد: الرافع لا يتحول إلى مدير عبر الاسم", () => assert.equal(ok({ scopes: [{ type: "college", node_id: 10, level: "uploader" }], action: "manage_reps" }), false));
t("الإعلانات للمشرف فقط", () => { assert.equal(ok({ scopes: rep, action: "announce" }), false); assert.equal(authorize({ user, isAdmin: true, action: "announce" }).ok, true); });
t("مجهول: لا كتابة", () => assert.equal(authorize({ user: null, action: "upload" }).reason, "unauthorized"));
t("القراءة العامة مسموحة للمجهول", () => assert.equal(authorize({ user: null, action: "read" }).ok, true));
t("إجراء مجهول مرفوض", () => assert.equal(authorize({ user, action: "__proto__" }).reason, "unknown_action"));
t("سلسلة فارغة لا تُمنح", () => assert.equal(scopeCovers(rep, null, "rep"), false));
t("لا انتقال من approved", () => assert.equal(transitionRequest("approved", "reject").reason, "invalid_transition"));
t("لا انتقال بخاصية موروثة", () => assert.equal(transitionRequest("pending", "__proto__").reason, "invalid_transition"));
t("لا طلب مكرر لعقدة معلّقة", () => assert.equal(canRequest({ existingRequests: [{ type: "department", node_id: 1, status: "pending" }], type: "department", nodeId: 1 }).reason, "already_pending"));
t("سحب rep لا يمسّ uploader", () => assert.deepEqual(revokeRep([{ type: "d", node_id: 1, level: "rep" }, { type: "d", node_id: 1, level: "uploader" }], "d", 1), [{ type: "d", node_id: 1, level: "uploader" }]));
t("إشعار قرار للطالب الصحيح", () => { const r = requestDecidedEvent({ id: 7, user_id: 5, type: "department", node_id: 3 }, "approve", new Date(0)); assert.equal(r.event.recipient_id, 5); assert.equal(r.event.type, EVENT_TYPES.REQUEST_DECIDED); });
t("إشعار بمستلم غير صالح يُرفض", () => assert.equal(buildEvent(EVENT_TYPES.ANNOUNCEMENT, "5").reason, "bad_recipient"));

let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log("ok  -", name); } catch (e) { failed++; console.log("FAIL-", name, "
   ", e.message.split("
")[0]); }
}
console.log(`\n${cases.length - failed}/${cases.length} passed`);
process.exit(failed ? 1 : 0);
