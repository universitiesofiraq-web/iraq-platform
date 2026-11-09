// C4 (تطوير 02-A): بناء أحداث الإشعارات بشكل نقي. لا يوجد جدول إشعارات بعد؛
// هذه الدالة تُنتج السجلات فقط، والحفظ/الإرسال يُربط لاحقًا.

export const EVENT_TYPES = Object.freeze({
  REQUEST_DECIDED: "rep_request_decided",
  REP_REVOKED: "rep_revoked",
  ANNOUNCEMENT: "announcement_published"
});

/* يبني حدثًا واحدًا؛ يرفض الأنواع المجهولة والمستلم الفارغ */
export function buildEvent(type, recipientId, payload = {}, now = new Date()) {
  if (!Object.values(EVENT_TYPES).includes(type)) return { ok: false, reason: "unknown_type" };
  if (!Number.isInteger(recipientId) || recipientId <= 0) return { ok: false, reason: "bad_recipient" };
  return { ok: true, event: { type, recipient_id: recipientId, payload: { ...payload }, created_at: now.toISOString() } };
}

/* إشعار قرار الطلب للطالب صاحب الطلب */
export function requestDecidedEvent(request, action, now = new Date()) {
  if (action !== "approve" && action !== "reject") return { ok: false, reason: "bad_action" };
  return buildEvent(EVENT_TYPES.REQUEST_DECIDED, request.user_id, {
    request_id: request.id, action, type: request.type, node_id: request.node_id
  }, now);
}
