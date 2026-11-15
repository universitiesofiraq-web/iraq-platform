// functions/_lib/activation.js — طلب تفعيل قسم/جامعة من الطالب.
//   GET  /api/activation-request?department_id=   حالة طلبي (sent: true/false)
//   POST /api/activation-request {department_id}  يرسل الطلب (مرة واحدة لكل قسم)
//   GET  /api/admin/activation-requests           (مشرف عام) الجامعات غير المفعّلة وعدد الطلبات وأقسامها
import { currentUser } from "./auth.js";
import { isGlobalAdmin } from "./scope.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const fail = (error, status) => json({ ok: false, error }, status);

export async function handleActivation(req, env, { now = Date.now } = {}) {
  const url = new URL(req.url);
  if (url.pathname !== "/api/activation-request" && url.pathname !== "/api/admin/activation-requests") return null;
  if (!env.DB) return fail("not_configured", 503);
  const user = await currentUser(req, env);
  if (!user) return fail("unauthorized", 401);

  if (url.pathname === "/api/admin/activation-requests") {
    if (req.method !== "GET") return fail("method_not_allowed", 405);
    if (!(await isGlobalAdmin(user, env))) return fail("forbidden", 403);
    const { results } = await env.DB.prepare(
      `SELECT u.id AS university_id, u.name_ar AS university, c.name_ar AS college, d.id AS department_id, d.name_ar AS department,
              COUNT(*) AS requests, MAX(r.created_at) AS last_at
       FROM activation_requests r JOIN departments d ON d.id=r.department_id JOIN colleges c ON c.id=d.college_id
       JOIN universities u ON u.id=c.university_id
       WHERE NOT EXISTS (SELECT 1 FROM university_onboarding o WHERE o.university_id=u.id AND o.state='active')
       GROUP BY d.id ORDER BY u.name_ar, c.name_ar, d.name_ar`).all();
    const map = new Map();
    for (const r of results || []) {
      const u = map.get(r.university_id) || { university_id: r.university_id, university: r.university, requests: 0, last_at: 0, departments: [] };
      u.requests += r.requests; u.last_at = Math.max(u.last_at, r.last_at);
      u.departments.push({ id: r.department_id, name: r.college + " — " + r.department, requests: r.requests });
      map.set(r.university_id, u);
    }
    return json({ ok: true, items: [...map.values()].sort((a, b) => b.requests - a.requests) });
  }

  if (req.method === "GET") {
    const id = Number(url.searchParams.get("department_id"));
    if (!Number.isSafeInteger(id) || id < 1) return fail("bad_request", 400);
    const row = await env.DB.prepare("SELECT 1 AS x FROM activation_requests WHERE user_id=? AND department_id=?").bind(user.id, id).first();
    return json({ ok: true, sent: !!row });
  }
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  if (req.headers.get("origin") !== url.origin || !req.headers.get("content-type")?.includes("application/json")) return fail("forbidden", 403);
  const body = await req.json().catch(() => null);
  const id = body && Number(body.department_id);
  if (!Number.isSafeInteger(id) || id < 1) return fail("bad_request", 400);
  const dep = await env.DB.prepare(
    `SELECT d.id, o.state FROM departments d JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id
     LEFT JOIN university_onboarding o ON o.university_id=u.id WHERE d.id=?`).bind(id).first();
  if (!dep) return fail("not_found", 404);
  if (dep.state === "active") return fail("already_active", 409);
  await env.DB.prepare("INSERT OR IGNORE INTO activation_requests(user_id,department_id,created_at) VALUES(?,?,?)").bind(user.id, id, now()).run();
  return json({ ok: true, sent: true });
}
