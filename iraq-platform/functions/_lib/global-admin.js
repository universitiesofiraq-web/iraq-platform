import { isAdminUser } from "./scope.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const fail = (error, status) => json({ ok: false, error }, status);

export async function handleGlobalAdmins(req, env, user) {
  if (!isAdminUser(user, env)) return fail("forbidden", 403);
  if (req.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT u.id, u.email, u.name, u.active AS user_active, g.active, g.changed_at
       FROM global_admins g JOIN users u ON u.id=g.user_id ORDER BY u.name, u.id`
    ).all();
    const { results: audit } = await env.DB.prepare(
      `SELECT a.id, a.action, a.created_at, target.name AS target, actor.name AS actor
       FROM global_admin_audit a LEFT JOIN users target ON target.id=a.user_id
       LEFT JOIN users actor ON actor.id=a.actor_id ORDER BY a.id DESC LIMIT 50`
    ).all();
    return json({ ok: true, items: results || [], audit: audit || [] });
  }
  if (req.method !== "POST") return fail("method_not_allowed", 405);
  if (req.headers.get("origin") !== new URL(req.url).origin ||
      !req.headers.get("content-type")?.includes("application/json")) return fail("forbidden", 403);
  const body = await req.json().catch(() => null);
  if (!body || !Number.isSafeInteger(body.user_id) || body.user_id < 1 || !["grant", "revoke"].includes(body.action)) {
    return fail("bad_request", 400);
  }
  const target = await env.DB.prepare("SELECT id,email,active FROM users WHERE id=?").bind(body.user_id).first();
  if (!target) return fail("not_found", 404);
  if (isAdminUser(target, env)) return fail("admin_locked", 409);
  const now = Date.now();
  if (body.action === "grant") {
    if (!target.active) return fail("inactive_account", 409);
    await env.DB.prepare(
      `INSERT INTO global_admins(user_id,active,changed_by,changed_at)
       SELECT id,1,?,? FROM users WHERE id=? AND active=1
       ON CONFLICT(user_id) DO UPDATE SET active=1, changed_by=excluded.changed_by, changed_at=excluded.changed_at
       WHERE global_admins.active=0`
    ).bind(user.id, now, target.id).run();
  } else {
    await env.DB.prepare(
      "UPDATE global_admins SET active=0,changed_by=?,changed_at=? WHERE user_id=? AND active=1"
    ).bind(user.id, now, target.id).run();
  }
  return json({ ok: true });
}
