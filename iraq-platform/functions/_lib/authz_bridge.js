// C2 (ربط): يربط محرك authz.js النقي ببيانات الوقت الحقيقي (المشرف، السلسلة، النطاقات).
// لا يعدّل scope.js؛ يستخدم دواله القائمة فقط: isAdminUser و chainOf و userScopes.
import { authorize } from "./authz.js";
import { isAdminUser, chainOf, userScopes } from "./scope.js";

/* canAct(env, user, action, type, nodeId) -> { ok, reason } */
export async function canAct(env, user, action, type, nodeId) {
  const isAdmin = isAdminUser(user, env);
  if (!user || isAdmin) return authorize({ user, isAdmin, action });
  const chain = await chainOf(env, type, nodeId);
  const scopes = await userScopes(env, user.id);
  return authorize({ user, isAdmin, scopes, chain, action });
}
