// functions/_lib/dept_stats.js — لوحة الممثل: GET /api/dept-stats?department_id=
// أعداد فقط (بلا أسماء ولا بريد): الطلاب لكل مرحلة، المنضمون في آخر 7 أيام، وبلاغات الملفات المفتوحة.
// لمن يدير القسم فقط (ممثل قسم/كلية/جامعة أو مشرف).
import { currentUser } from "./auth.js";
import { policy } from "./scope.js";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (error, status) => json({ ok: false, error }, status);

export async function handleDeptStats(req, env, opts = {}) {
  const url = new URL(req.url);
  if (url.pathname !== "/api/dept-stats" && url.pathname !== "/api/dept-stats/") return null;
  if (req.method !== "GET") return fail("not_found", 404);
  if (!env.DB) return fail("not_configured", 503);
  const did = Number(url.searchParams.get("department_id"));
  if (!Number.isSafeInteger(did) || did <= 0) return fail("bad_request", 400);
  try {
    const user = await (opts.currentUser || currentUser)(req, env);
    if (!user) return fail("unauthorized", 401);
    const pol = await policy(env, user);
    if (!(await pol.manage("department", did))) return fail("forbidden", 403);
    const now = (opts.now || Date.now)();
    const stages = (await env.DB.prepare(
      `SELECT st.number AS stage, COUNT(p.user_id) AS students
       FROM stages st LEFT JOIN user_profile p ON p.stage_id=st.id
       WHERE st.department_id=? GROUP BY st.id ORDER BY st.number`).bind(did).all()).results || [];
    const week = await env.DB.prepare(
      `SELECT COUNT(*) AS n FROM signup_events e JOIN stages st ON st.id=e.stage_id WHERE st.department_id=? AND e.created_at>=?`)
      .bind(did, now - 7 * 86400000).first();
    return json({ ok: true, stages, total: stages.reduce((s, x) => s + x.students, 0), joined_week: week ? week.n : 0 });
  } catch (e) {
    console.error("dept-stats", String(e && e.message).slice(0, 200));
    return fail("server_error", 500);
  }
}
