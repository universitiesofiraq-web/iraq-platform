// C4/C5: عزل جمهور الإعلانات. التشغيل: node tests/announcement_audience.test.mjs
import { validateAnnouncement, canSee, visibleFor } from "../functions/_lib/announcement_audience.js";
import assert from "node:assert/strict";
const base = { title: "امتحان", priority: "high", category: "exam" };
const chainA = { university: 1, college: 10, department: 100 };
const chainB = { university: 2, college: 20, department: 200 };
const ann = [
  { ...base, id: 1, scope: { type: "department", id: 100 } },
  { ...base, id: 2, scope: { type: "university", id: 2 } },
  { ...base, id: 3, scope: null },
];
const cases = [
  ["إعلان قسم يُعرض لطلاب القسم فقط", () => assert.equal(canSee(ann[0], chainA), true)],
  ["طالب جامعة أخرى لا يرى إعلان القسم", () => assert.equal(canSee(ann[0], chainB), false)],
  ["إعلان جامعة لا يصل إلى جامعة أخرى", () => assert.deepEqual(visibleFor(ann, chainB).map((a) => a.id), [2, 3])],
  ["الإعلان العام يصل للجميع", () => assert.equal(canSee(ann[2], null), true)],
  ["مستلم بلا سلسلة لا يرى إعلان نطاق", () => assert.equal(canSee(ann[0], null), false)],
  ["تصفية القسم الصحيح", () => assert.deepEqual(visibleFor(ann, chainA).map((a) => a.id), [1, 3])],
  ["عنوان فارغ مرفوض", () => assert.equal(validateAnnouncement({ ...base, title: "  ", scope: null }).reason, "bad_title")],
  ["أولوية غير معروفة مرفوضة", () => assert.equal(validateAnnouncement({ ...base, priority: "critical", scope: null }).reason, "bad_priority")],
  ["فئة غير معروفة مرفوضة", () => assert.equal(validateAnnouncement({ ...base, category: "x", scope: null }).reason, "bad_category")],
  ["نوع نطاق غير معروف مرفوض", () => assert.equal(validateAnnouncement({ ...base, scope: { type: "users", id: 1 } }).reason, "bad_scope")],
  ["معرّف نطاق غير صالح مرفوض", () => assert.equal(validateAnnouncement({ ...base, scope: { type: "department", id: "1; DROP" } }).reason, "bad_scope")],
  ["إعلان صالح مقبول", () => assert.equal(validateAnnouncement({ ...base, scope: { type: "department", id: 100 } }).ok, true)],
];
let failed = 0;
for (const [name, fn] of cases) {
  try { fn(); console.log("ok  -", name); } catch (e) { failed++; console.log("FAIL-", name, "\n   ", e.message.split("\n")[0]); }
}
console.log("\n" + (cases.length - failed) + "/" + cases.length + " passed");
process.exit(failed ? 1 : 0);
