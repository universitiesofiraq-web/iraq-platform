import { currentUser } from "./auth.js";
import { isGlobalAdmin } from "./scope.js";

// Queries using this predicate bind the same alias to the university's primary key.
export const ACTIVE_UNIVERSITY =
  "EXISTS (SELECT 1 FROM university_onboarding o WHERE o.university_id=u.id AND o.state='active')";

const filters = {
  active: "o.state='active'",
  registered: "o.state='registered'",
  suspended: "o.state='suspended'",
  directory: "1=1"
};
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const fail = (error, status) => json({ ok: false, error }, status);

async function list(env, filter) {
  const rows = await env.DB.prepare(
    `SELECT u.id, u.name_ar, u.name_en, u.city, COALESCE(o.state, 'not_onboarded') AS state,
            o.manager_id, m.name AS manager_name, o.verified_at, o.updated_at,
            (SELECT COUNT(*) FROM colleges c WHERE c.university_id=u.id) AS colleges,
            (SELECT COUNT(*) FROM departments d JOIN colleges c ON c.id=d.college_id WHERE c.university_id=u.id) AS departments,
            (SELECT COUNT(*) FROM user_profile p JOIN colleges c ON c.id=p.college_id WHERE c.university_id=u.id) AS students,
            (SELECT COUNT(*) FROM files f JOIN subjects sb ON sb.id=f.subject_id JOIN terms t ON t.id=sb.term_id
               JOIN stages st ON st.id=t.stage_id JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id
               WHERE c.university_id=u.id AND f.status='approved') AS files
     FROM universities u LEFT JOIN university_onboarding o ON o.university_id=u.id
     LEFT JOIN users m ON m.id=o.manager_id WHERE ${filters[filter]} ORDER BY u.name_ar, u.id`
  ).all();
  const totals = await env.DB.prepare(
    `SELECT COUNT(*) AS directory,
            COUNT(CASE WHEN o.state='active' THEN 1 END) AS active,
            COUNT(CASE WHEN o.state='registered' THEN 1 END) AS registered,
            COUNT(CASE WHEN o.state='suspended' THEN 1 END) AS suspended
     FROM universities u LEFT JOIN university_onboarding o ON o.university_id=u.id`
  ).first();
  return json({ ok: true, filter, totals, items: rows.results || [] });
}

const managerExists = `EXISTS (SELECT 1 FROM users m JOIN scopes s ON s.user_id=m.id
  WHERE m.active=1 AND s.type='university' AND s.level='rep'`;

async function change(req, env, user) {
  const body = await req.json().catch(() => null);
  if (!body || !Number.isSafeInteger(body.id) || body.id < 1) return fail("bad_request", 400);
  const { id, action, manager_id: managerId } = body;
  const now = Date.now();
  let statement;
  if (action === "register" || action === "assign_manager") {
    if (!Number.isSafeInteger(managerId) || managerId < 1) return fail("bad_request", 400);
    statement = action === "register"
      ? env.DB.prepare(`INSERT INTO university_onboarding (university_id,state,manager_id,updated_at,updated_by)
          SELECT u.id,'registered',?,?,? FROM universities u
          WHERE u.id=? AND ${managerExists} AND m.id=? AND s.node_id=u.id)
          ON CONFLICT(university_id) DO NOTHING`).bind(managerId, now, user.id, id, managerId)
      : env.DB.prepare(`UPDATE university_onboarding SET manager_id=?,updated_at=?,updated_by=?
          WHERE university_id=? AND manager_id<>?
          AND ${managerExists} AND m.id=? AND s.node_id=university_onboarding.university_id)`)
        .bind(managerId, now, user.id, id, managerId, managerId);
  } else if (action === "edit_profile") {
    const name = typeof body.name_ar === "string" ? body.name_ar.trim() : "";
    const city = typeof body.city === "string" ? body.city.trim() : "";
    if (!name || name.length > 120 || city.length > 120) return fail("bad_request", 400);
    statement = env.DB.prepare("UPDATE universities SET name_ar=?,city=? WHERE id=?").bind(name, city || null, id);
  } else if (action === "verify") {
    statement = env.DB.prepare(`UPDATE university_onboarding SET verified_at=?,updated_at=?,updated_by=?
      WHERE university_id=? AND state='registered' AND verified_at IS NULL
      AND ${managerExists} AND m.id=university_onboarding.manager_id AND s.node_id=university_onboarding.university_id)`)
      .bind(now, now, user.id, id);
  } else if (action === "activate") {
    // تفعيل مباشر بيد الإدارة: الجامعة غير المسجّلة تُسجَّل وتُفعَّل، والمعلّقة أو المسجّلة تُفعَّل
    statement = env.DB.prepare(`INSERT INTO university_onboarding (university_id,state,manager_id,verified_at,updated_at,updated_by)
      SELECT u.id,'active',?,?,?,? FROM universities u WHERE u.id=?
      ON CONFLICT(university_id) DO UPDATE SET state='active', verified_at=COALESCE(university_onboarding.verified_at, excluded.verified_at),
        updated_at=excluded.updated_at, updated_by=excluded.updated_by
      WHERE university_onboarding.state IN ('registered','suspended')`)
      .bind(user.id, now, now, user.id, id);
  } else if (action === "suspend") {
    statement = env.DB.prepare(`UPDATE university_onboarding SET state='suspended',updated_at=?,updated_by=?
      WHERE university_id=? AND state='active'`).bind(now, user.id, id);
  } else return fail("bad_request", 400);
  const result = await statement.run();
  if (!result.meta.changes) return fail("onboarding_transition_conflict", 409);
  return json({ ok: true });
}

export async function handleOnboarding(req, env) {
  const url = new URL(req.url);
  if (!["/api/admin/universities", "/api/admin/universities/audit", "/api/admin/universities/managers", "/api/admin/universities/overview"].includes(url.pathname)) return null;
  if (!env.DB) return fail("not_configured", 503);
  const user = await currentUser(req, env);
  if (!user) return fail("unauthorized", 401);
  if (!(await isGlobalAdmin(user, env))) return fail("forbidden", 403);
  if (url.pathname.endsWith("/managers")) {
    if (req.method !== "GET") return fail("method_not_allowed", 405);
    const id = Number(url.searchParams.get("university_id"));
    if (!Number.isSafeInteger(id) || id < 1) return fail("bad_request", 400);
    const { results } = await env.DB.prepare(
      `SELECT u.id,u.name,u.email FROM users u JOIN scopes s ON s.user_id=u.id
       WHERE s.type='university' AND s.node_id=? AND s.level='rep' AND u.active=1 ORDER BY u.name,u.id`
    ).bind(id).all();
    return json({ ok: true, items: results || [] });
  }
  if (req.method === "GET" && url.pathname.endsWith("/overview")) return overview(env);
  if (req.method === "GET" && url.pathname.endsWith("/audit")) {
    const { results } = await env.DB.prepare(
      `SELECT a.id, a.university_id, u.name_ar AS university, p.name AS actor, a.previous_state,
              a.state, a.verified_at, a.created_at
       FROM university_onboarding_audit a LEFT JOIN users p ON p.id=a.actor_id
       LEFT JOIN universities u ON u.id=a.university_id ORDER BY a.id DESC LIMIT 50`
    ).all();
    return json({ ok: true, items: results || [] });
  }
  if (url.pathname.endsWith("/audit")) return fail("method_not_allowed", 405);
  if (req.method === "GET") {
    const filter = url.searchParams.get("filter") || "active";
    return Object.hasOwn(filters, filter) ? list(env, filter) : fail("bad_request", 400);
  }
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  if (req.headers.get("origin") !== url.origin || !req.headers.get("content-type")?.includes("application/json")) {
    return fail("forbidden", 403);
  }
  return change(req, env, user);
}

// نظرة عامة للوحة الإدارة: أرقام رئيسية وآخر الطلاب المسجّلين
async function overview(env) {
  const one = (sql) => env.DB.prepare(sql).first().then((r) => (r ? r.n : 0)).catch(() => 0);
  const [students, users, active, files, pending, reports, reps] = await Promise.all([
    one("SELECT COUNT(*) AS n FROM user_profile WHERE stage_id IS NOT NULL"),
    one("SELECT COUNT(*) AS n FROM users WHERE active=1"),
    one("SELECT COUNT(*) AS n FROM university_onboarding WHERE state='active'"),
    one("SELECT COUNT(*) AS n FROM files WHERE status='approved'"),
    one("SELECT COUNT(*) AS n FROM files WHERE status='pending'"),
    one("SELECT COUNT(*) AS n FROM reports WHERE status='open'"),
    one("SELECT COUNT(DISTINCT user_id) AS n FROM scopes WHERE level='rep'")
  ]);
  const { results } = await env.DB.prepare(
    `SELECT m.id, m.name, m.email, m.created_at, st.number AS stage, d.id AS department_id, d.name_ar AS department,
            c.name_ar AS college, un.name_ar AS university
     FROM user_profile p JOIN users m ON m.id=p.user_id JOIN stages st ON st.id=p.stage_id
     JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id JOIN universities un ON un.id=c.university_id
     ORDER BY m.created_at DESC, m.id DESC LIMIT 30`
  ).all().catch(() => ({ results: [] }));
  return json({ ok: true, totals: { students, users, active, files, pending, reports, reps }, recent: results || [] });
}
