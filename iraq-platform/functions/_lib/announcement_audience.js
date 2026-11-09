// C4 (تطوير 02-A): عزل جمهور الإعلانات حسب النطاق الأكاديمي — منطق نقي.
// الإعلان ينتمي إلى عقدة واحدة: university | college | department (أو عام: scope = null).
// المستلم يرى الإعلان فقط إذا كان ضمن سلسلته الأكاديمية. لا يمنح الإعلان صلاحية.

export const PRIORITIES = Object.freeze(["low", "normal", "high", "urgent"]);
export const CATEGORIES = Object.freeze(["exam", "lecture", "admin", "general"]);

/* يتحقق من صحة بيانات الإعلان قبل حفظه */
export function validateAnnouncement(a) {
  if (!a || typeof a !== "object") return { ok: false, reason: "bad_request" };
  if (typeof a.title !== "string" || a.title.trim().length === 0 || a.title.length > 200) return { ok: false, reason: "bad_title" };
  if (!PRIORITIES.includes(a.priority)) return { ok: false, reason: "bad_priority" };
  if (!CATEGORIES.includes(a.category)) return { ok: false, reason: "bad_category" };
  if (a.scope !== null && a.scope !== undefined) {
    if (!["university", "college", "department"].includes(a.scope.type)) return { ok: false, reason: "bad_scope" };
    if (!Number.isInteger(a.scope.id) || a.scope.id <= 0) return { ok: false, reason: "bad_scope" };
  }
  return { ok: true };
}

/* هل يرى المستلم هذا الإعلان؟ chain = سلسلة المستلم الأكاديمية {university, college, department} */
export function canSee(announcement, chain) {
  if (!announcement.scope) return true;
  if (!chain) return false;
  return chain[announcement.scope.type] === announcement.scope.id;
}

/* يُرشّح قائمة الإعلانات لمستلم واحد */
export function visibleFor(announcements, chain) {
  return announcements.filter((a) => canSee(a, chain));
}
