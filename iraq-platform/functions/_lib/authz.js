// C2 (تطوير 02-A): محرك صلاحيات نقي (بلا قاعدة بيانات) — يطابق covers() في scope.js.
// القرار يعتمد على: المستخدم (admin?)، نطاقاته، وسلسلة العقدة {university, college, department}.

// أدنى مستوى نطاق يسمح بالإجراء، ونوع العقدة الذي يُقاس عليه.
export const ACTIONS = Object.freeze({
  read:           { minLevel: null },            // عام
  upload:         { minLevel: "uploader" },
  review:         { minLevel: "rep" },
  manage_content: { minLevel: "rep" },
  publish:        { minLevel: "rep" },
  manage_reps:    { minLevel: "rep" },           // تعيين/سحب ممثلين على عقدة
  announce:       { minLevel: null, adminOnly: true },
  admin:          { minLevel: null, adminOnly: true }
});

const RANK = { uploader: 1, rep: 2 };

/* هل تغطي نطاقات المستخدم هذه السلسلة بمستوى كافٍ؟ */
export function scopeCovers(scopes, chain, minLevel) {
  if (!chain || !Array.isArray(scopes)) return false;
  const need = minLevel ? RANK[minLevel] : 0;
  return scopes.some((s) => (RANK[s.level] || 0) >= need && chain[s.type] === s.node_id);
}

/* القرار النهائي: { ok, reason } */
export function authorize({ user, isAdmin, scopes = [], chain = null, action }) {
  const rule = Object.hasOwn(ACTIONS, action) ? ACTIONS[action] : undefined;
  if (!rule) return { ok: false, reason: "unknown_action" };
  if (isAdmin) return { ok: true, reason: "admin" };
  if (rule.minLevel === null && !rule.adminOnly) return { ok: true, reason: "public" };
  if (!user) return { ok: false, reason: "unauthorized" };
  if (rule.adminOnly) return { ok: false, reason: "forbidden" };
  if (scopeCovers(scopes, chain, rule.minLevel)) return { ok: true, reason: "scope" };
  return { ok: false, reason: "forbidden" };
}
