// C3 (تطوير 02-A): إسناد الممثلين — منطق نقي بلا قاعدة بيانات.
// الأدوار على العقدة: main (ممثل رئيسي) و assistant (مساعد). لكل عقدة ممثل رئيسي واحد نشط.
// المساعد لا يمنح صلاحيات. الممثل الرئيسي يفوّض فقط ما يملكه هو.

export const ROLES = Object.freeze(["main", "assistant"]);
export const CAPABILITIES = Object.freeze(["review", "manage_content", "upload", "manage_reps"]);

const sameNode = (a, b) => a.type === b.type && a.node_id === b.node_id;

/* هل يحق للمنفّذ تعيين ممثل/تفويض صلاحيات على العقدة؟ */
export function canAssign(actor, node, { isAdmin = false } = {}) {
  if (isAdmin) return { ok: true, reason: "admin" };
  const mine = actor?.assignments?.find((a) => sameNode(a, node) && a.active);
  if (mine?.role === "main") return { ok: true, reason: "main" };
  return { ok: false, reason: "forbidden" };
}

/* التفويض: لا يمنح إلا ما يملكه المفوِّض. المساعد لا يفوّض أبدًا. */
export function grantCapabilities(delegatorCaps, requested) {
  if (!Array.isArray(requested) || requested.length === 0) return { ok: false, reason: "bad_request" };
  if (requested.some((c) => !CAPABILITIES.includes(c))) return { ok: false, reason: "unknown_capability" };
  const allowed = new Set(delegatorCaps);
  if (requested.some((c) => !allowed.has(c))) return { ok: false, reason: "escalation_denied" };
  return { ok: true, capabilities: [...new Set(requested)] };
}

/* نقل المسؤولية الرئيسية: يُنهي تعيين السابق ويُنشئ تعيين الجديد، ولا يترك عقدة بلا ممثل رئيسي أو بأكثر من واحد */
export function transferMain(assignments, node, fromUserId, toUserId) {
  if (fromUserId === toUserId) return { ok: false, reason: "same_user" };
  const current = assignments.find((a) => sameNode(a, node) && a.role === "main" && a.active);
  if (!current || current.user_id !== fromUserId) return { ok: false, reason: "not_current_main" };
  const next = assignments.map((a) =>
    a === current ? { ...a, active: false, ended: true } : a
  );
  next.push({ ...node, user_id: toUserId, role: "main", active: true, capabilities: current.capabilities });
  return { ok: true, assignments: next };
}

/* هل تكرّر تعيين نشط لنفس المستخدم والعقدة؟ */
export function isDuplicateActive(assignments, node, userId) {
  return assignments.some((a) => sameNode(a, node) && a.user_id === userId && a.active);
}
