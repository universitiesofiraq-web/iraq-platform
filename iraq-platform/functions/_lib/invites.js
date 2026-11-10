// functions/_lib/invites.js — روابط الدعوة لقسم أو مرحلة.
//   GET  /api/invite?code=           (عام) يحلّ الرابط إلى جامعة/كلية/قسم/مرحلة
//   GET  /api/admin/invites?type=&id= قائمة روابط عقدة يديرها المستخدم
//   POST /api/admin/invites           { action: "create", type, id } | { action: "revoke", code }
import { currentUser } from "./auth.js";
import { chainOf, policy } from "./scope.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const fail = (error, status) => json({ ok: false, error }, status);
const ALPHABET = "ABCDEFGHJKLMNPQRSTUVWXYZ23456789";
const MAX_ACTIVE = 10;
const positive = (v) => Number.isSafeInteger(v) && v > 0;

export function newCode() {
  const bytes = crypto.getRandomValues(new Uint8Array(10));
  return Array.from(bytes, (b) => ALPHABET[b % ALPHABET.length]).join("");
}

// يحلّ رمزاً صالحاً (غير موقوف، جامعته غير موقوفة) إلى مكانه في الدليل، وإلا null
export async function resolveInvite(env, code) {
  if (typeof code !== "string" || !/^[A-Z2-9]{10}$/.test(code)) return null;
  const row = await env.DB.prepare(
    `SELECT i.code, i.type, d.id AS department_id, d.name_ar AS department, c.id AS college_id, c.name_ar AS college,
            u.id AS university_id, u.name_ar AS university, st.id AS stage_id, st.number AS stage, o.state
     FROM invitations i
     LEFT JOIN stages st ON i.type='stage' AND st.id=i.node_id
     JOIN departments d ON d.id=CASE i.type WHEN 'department' THEN i.node_id ELSE st.department_id END
     JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id
     LEFT JOIN university_onboarding o ON o.university_id=u.id
     WHERE i.code=? AND i.revoked_at IS NULL`
  ).bind(code).first();
  if (!row || row.state === "suspended") return null;
  return row;
}

export async function handleInvites(req, env) {
  const url = new URL(req.url);
  const route = url.pathname;
  if (route !== "/api/invite" && route !== "/api/admin/invites") return null;
  if (!env.DB) return fail("not_configured", 503);

  if (route === "/api/invite") {
    if (req.method !== "GET") return fail("method_not_allowed", 405);
    const row = await resolveInvite(env, String(url.searchParams.get("code") || "").toUpperCase());
    if (!row) return fail("not_found", 404);
    const { state, code, ...info } = row;
    return json({ ok: true, ...info });
  }

  const user = await currentUser(req, env);
  if (!user) return fail("unauthorized", 401);
  const permission = await policy(env, user);

  if (req.method === "GET") {
    const type = url.searchParams.get("type"), id = Number(url.searchParams.get("id"));
    if (!["department", "stage"].includes(type) || !positive(id)) return fail("bad_request", 400);
    if (!(await permission.manage(type, id))) return fail("forbidden", 403);
    const { results } = await env.DB.prepare(
      `SELECT i.code, i.created_at, i.revoked_at, u.name AS creator,
              (SELECT COUNT(*) FROM signup_events e WHERE e.invite_code=i.code) AS uses
       FROM invitations i JOIN users u ON u.id=i.created_by
       WHERE i.type=? AND i.node_id=? ORDER BY i.created_at DESC, i.code LIMIT 30`
    ).bind(type, id).all();
    return json({ ok: true, items: results || [] });
  }

  if (req.method !== "POST") return fail("method_not_allowed", 405);
  if (req.headers.get("origin") !== url.origin || !req.headers.get("content-type")?.includes("application/json")) return fail("forbidden", 403);
  const body = await req.json().catch(() => null);
  if (!body) return fail("bad_request", 400);

  if (body.action === "create") {
    const { type, id } = body;
    if (!["department", "stage"].includes(type) || !positive(id)) return fail("bad_request", 400);
    if (!(await permission.manage(type, id))) return fail("forbidden", 403);
    if (!(await chainOf(env, type, id))) return fail("not_found", 404);
    const active = await env.DB.prepare("SELECT COUNT(*) AS n FROM invitations WHERE type=? AND node_id=? AND revoked_at IS NULL").bind(type, id).first();
    if (active.n >= MAX_ACTIVE) return fail("too_many_invites", 409);
    const code = newCode();
    await env.DB.prepare("INSERT INTO invitations (code,type,node_id,created_by,created_at) VALUES (?,?,?,?,?)")
      .bind(code, type, id, user.id, Date.now()).run();
    return json({ ok: true, code });
  }
  if (body.action === "revoke") {
    const code = typeof body.code === "string" ? body.code.toUpperCase() : "";
    const row = await env.DB.prepare("SELECT type,node_id FROM invitations WHERE code=? AND revoked_at IS NULL").bind(code).first();
    if (!row) return fail("not_found", 404);
    if (!(await permission.manage(row.type, row.node_id))) return fail("forbidden", 403);
    await env.DB.prepare("UPDATE invitations SET revoked_at=? WHERE code=? AND revoked_at IS NULL").bind(Date.now(), code).run();
    return json({ ok: true });
  }
  return fail("bad_request", 400);
}
