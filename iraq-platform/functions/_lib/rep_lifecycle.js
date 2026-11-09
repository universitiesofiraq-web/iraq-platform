// C3 (تطوير 02-A): دورة حياة طلب التمثيل وإسناد الممثل — انتقالات نقية.
// الحالات: pending → approved | rejected. لا عودة من approved/rejected.
// الطلب لا يمنح صلاحية وحده؛ الموافقة فقط تُنشئ نطاق rep (يُنفَّذ في scope.js).

export const REQUEST_STATES = Object.freeze(["pending", "approved", "rejected"]);
const TRANSITIONS = Object.freeze({
  pending: Object.freeze({ approve: "approved", reject: "rejected" }),
  approved: Object.freeze({}),
  rejected: Object.freeze({})
});

/* ينتقل الطلب بإجراء؛ يعيد { ok, status } أو { ok:false, reason } */
export function transitionRequest(status, action) {
  if (!Object.hasOwn(TRANSITIONS, status)) return { ok: false, reason: "bad_state" };
  const next = Object.hasOwn(TRANSITIONS[status], action) ? TRANSITIONS[status][action] : undefined;
  if (!next) return { ok: false, reason: "invalid_transition" };
  return { ok: true, status: next };
}

/* هل يمكن للمستخدم تقديم طلب جديد على العقدة؟ (لا تكرار لطلب معلّق أو لصلاحية موجودة) */
export function canRequest({ existingRequests = [], scopes = [], type, nodeId }) {
  const pending = existingRequests.some((r) => r.type === type && r.node_id === nodeId && r.status === "pending");
  if (pending) return { ok: false, reason: "already_pending" };
  const has = scopes.some((s) => s.type === type && s.node_id === nodeId && s.level === "rep");
  if (has) return { ok: false, reason: "already_rep" };
  return { ok: true };
}

/* سحب الممثل من عقدة: يُزيل نطاق rep فقط ولا يمسّ نطاق uploader */
export function revokeRep(scopes, type, nodeId) {
  return scopes.filter((s) => !(s.type === type && s.node_id === nodeId && s.level === "rep"));
}
