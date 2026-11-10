import { currentUser } from "./auth.js";
import { chainOf, policy } from "./scope.js";
import { ACTIVE_UNIVERSITY } from "./onboarding.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
});
const fail = (error, status) => json({ ok: false, error }, status);
const positive = value => Number.isSafeInteger(value) && value > 0;

const scopeSql = {
  university: "u.id",
  college: "c.id",
  department: "d.id",
  stage: "st.id"
};
const joins = "FROM stages st JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id";

async function workspace(env, type, id, permission) {
  const chain = await chainOf(env, type, id);
  if (!chain) return fail("not_found", 404);
  const { results } = await env.DB.prepare(
    `SELECT st.id, st.number, d.id AS department_id, d.name_ar AS department,
      c.id AS college_id, c.name_ar AS college, u.id AS university_id, u.name_ar AS university,
      rep.id AS representative_id, rep.name AS representative, rep.active AS representative_active,
      (SELECT COUNT(*) FROM user_profile p JOIN users member ON member.id=p.user_id WHERE p.stage_id=st.id AND member.active=1) AS students,
      (SELECT COUNT(*) FROM terms t JOIN subjects sb ON sb.term_id=t.id WHERE t.stage_id=st.id) AS subjects
     ${joins}
     LEFT JOIN scopes sc ON sc.type='stage' AND sc.node_id=st.id AND sc.level='rep'
     LEFT JOIN users rep ON rep.id=sc.user_id
     WHERE ${scopeSql[type]}=? ORDER BY u.name_ar,c.name_ar,d.name_ar,st.number,st.id`
  ).bind(id).all();
  const labels = await env.DB.prepare(
    `SELECT u.name_ar AS university,c.name_ar AS college,d.name_ar AS department
     FROM universities u LEFT JOIN colleges c ON c.university_id=u.id AND c.id=?
     LEFT JOIN departments d ON d.college_id=c.id AND d.id=? WHERE u.id=?`
  ).bind(chain.college ?? null, chain.department ?? null, chain.university).first();
  const items = results || [];
  const canAssign = type !== "stage" || await permission.manage("stage", id, "stage");
  const subjects = type === "stage" ? (await env.DB.prepare(
    "SELECT sb.id,sb.name_ar,t.number AS term FROM subjects sb JOIN terms t ON t.id=sb.term_id WHERE t.stage_id=? ORDER BY t.number,sb.name_ar"
  ).bind(id).all()).results : undefined;
  return json({
    ok: true,
    scope: { type, id, ...labels, university_id: chain.university, college_id: chain.college,
      department_id: chain.department, stage: type === "stage" ? items[0]?.number : undefined },
    subjects,
    can_assign: canAssign,
    items
  });
}

async function stageRep(env, user, body) {
  const { stage_id: stageId, expected_user_id: expected } = body;
  if (!positive(stageId) || !Number.isSafeInteger(expected) || expected < 0) return fail("bad_request", 400);
  if (!(await (await policy(env, user)).manage("stage", stageId, "stage"))) return fail("forbidden", 403);
  if (!(await chainOf(env, "stage", stageId))) return fail("not_found", 404);
  let target = body.user_id;
  if (target === undefined && typeof body.user_email === "string") {
    const email = body.user_email.trim().toLowerCase();
    if (!email || email.length > 254) return fail("bad_request", 400);
    const account = await env.DB.prepare("SELECT id FROM users WHERE lower(email)=? AND active=1").bind(email).first();
    if (!account) return fail("assignment_conflict", 409);
    target = account.id;
  }
  if (!Number.isSafeInteger(target) || target < 0 || expected === target) return fail("bad_request", 400);
  let mutation;
  if (!target) {
    mutation = env.DB.prepare("DELETE FROM scopes WHERE type='stage' AND level='rep' AND node_id=? AND user_id=?").bind(stageId, expected);
  } else if (!expected) {
    mutation = env.DB.prepare(
      `INSERT INTO scopes(user_id,type,node_id,level)
       SELECT id,'stage',?,'rep' FROM users WHERE id=? AND active=1
       ON CONFLICT DO NOTHING`
    ).bind(stageId, target);
  } else {
    mutation = env.DB.prepare(
      `UPDATE OR IGNORE scopes SET user_id=? WHERE type='stage' AND level='rep' AND node_id=? AND user_id=?
       AND EXISTS(SELECT 1 FROM users WHERE id=? AND active=1)`
    ).bind(target, stageId, expected, target);
  }
  const at = new Date().toISOString();
  const statements = [mutation];
  if (expected) statements.push(env.DB.prepare(
    "INSERT INTO scope_audit(actor_id,target_user_id,action,type,node_id,created_at) SELECT ?,?,'revoke','stage',?,? WHERE changes()=1"
  ).bind(user.id, expected, stageId, at));
  if (target) statements.push(env.DB.prepare(
    "INSERT INTO scope_audit(actor_id,target_user_id,action,type,node_id,created_at) SELECT ?,?,'grant','stage',?,? WHERE changes()=1"
  ).bind(user.id, target, stageId, at));
  const [result] = await env.DB.batch(statements);
  return result.meta.changes === 1 ? json({ ok: true }) : fail("assignment_conflict", 409);
}

async function stageAnnouncements(req, env, user, permission, stageId, student) {
  if (student) {
    const requested = stageId;
    const member = await env.DB.prepare(
      `SELECT st.id AS stage_id FROM user_profile p JOIN stages st ON st.id=p.stage_id
       JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id
       JOIN universities u ON u.id=c.university_id WHERE p.user_id=? AND ${ACTIVE_UNIVERSITY}`
    ).bind(user.id).first();
    if (requested !== null && (!positive(requested) || member?.stage_id !== requested)) return fail("forbidden", 403);
    if (!member) return json({ ok: true, items: [] });
    stageId = member.stage_id;
  } else {
    if (!positive(stageId)) return fail("bad_request", 400);
    if (!(await permission.manage("stage", stageId))) return fail("forbidden", 403);
  }

  if (req.method === "GET") {
    const { results } = await env.DB.prepare(
      `SELECT a.id,a.title,a.body,a.created_at AS at,u.name AS by
       FROM stage_announcements a JOIN users u ON u.id=a.author_id
       WHERE a.stage_id=? ORDER BY a.id DESC LIMIT 50`
    ).bind(stageId).all();
    return json({ ok: true, items: results || [] });
  }
  const body = await req.json().catch(() => null);
  const title = typeof body?.title === "string" ? body.title.trim() : "";
  const content = typeof body?.body === "string" ? body.body.trim() : "";
  if (!title || title.length > 120 || content.length > 2000) return fail("bad_request", 400);
  if (!(await chainOf(env, "stage", stageId))) return fail("not_found", 404);
  const result = await env.DB.prepare(
    "INSERT INTO stage_announcements(stage_id,author_id,title,body,created_at) VALUES(?,?,?,?,?)"
  ).bind(stageId, user.id, title, content, Date.now()).run();
  return json({ ok: true, id: result.meta.last_row_id });
}

async function changeStageMembership(req, env, actor, permission, stageId) {
  if (!(await permission.manage("stage", stageId, "stage"))) return fail("forbidden", 403);
  const body = await req.json().catch(() => null);
  const email = typeof body?.email === "string" ? body.email.trim().toLowerCase() : "";
  if (!email || email.length > 254 || !["enroll", "unenroll"].includes(body.action)) return fail("bad_request", 400);
  const [chain, target] = await Promise.all([
    chainOf(env, "stage", stageId),
    env.DB.prepare(
      `SELECT u.id,u.active,p.stage_id FROM users u LEFT JOIN user_profile p ON p.user_id=u.id
       WHERE lower(u.email)=?`
    ).bind(email).first()
  ]);
  if (!chain) return fail("not_found", 404);
  if (!target) return fail("membership_conflict", 409);
  let statement;
  if (body.action === "unenroll") {
    statement = env.DB.prepare("UPDATE user_profile SET stage_id=NULL WHERE user_id=? AND stage_id=?").bind(target.id, stageId);
  } else {
    if (!target.active || target.stage_id === stageId) return fail("membership_conflict", 409);
    if (target.stage_id && !(await permission.manage("stage", target.stage_id, "stage"))) return fail("forbidden", 403);
    statement = env.DB.prepare(
      `INSERT INTO user_profile(user_id,college_id,stage_id) VALUES(?,?,?)
       ON CONFLICT(user_id) DO UPDATE SET college_id=excluded.college_id,stage_id=excluded.stage_id
       WHERE user_profile.stage_id IS ?`
    ).bind(target.id, chain.college, stageId, target.stage_id);
  }
  const audit = env.DB.prepare(
    "INSERT INTO scope_audit(actor_id,target_user_id,action,type,node_id,created_at) SELECT ?,?,?,'stage',?,? WHERE changes()=1"
  ).bind(actor.id, target.id, "stage_" + body.action, stageId, new Date().toISOString());
  const [result] = await env.DB.batch([statement, audit]);
  return result.meta.changes === 1 ? json({ ok: true }) : fail("membership_conflict", 409);
}

export async function handleAdminWorkspace(req, env) {
  const url = new URL(req.url);
  const route = url.pathname;
  if (!["/api/admin/workspace", "/api/admin/stage-representative",
    "/api/admin/stage-announcements", "/api/stage-announcements", "/api/admin/stage-students"].includes(route)) return null;
  if (!env.DB) return fail("not_configured", 503);
  const user = await currentUser(req, env);
  if (!user) return fail("unauthorized", 401);
  if (req.method === "POST" && (req.headers.get("origin") !== url.origin ||
      !req.headers.get("content-type")?.includes("application/json"))) return fail("forbidden", 403);
  if (route === "/api/admin/stage-representative") {
    if (req.method !== "POST") return fail("method_not_allowed", 405);
    const body = await req.json().catch(() => null);
    return body ? stageRep(env, user, body) : fail("bad_request", 400);
  }
  const permission = await policy(env, user);
  if (route === "/api/admin/workspace") {
    if (req.method !== "GET") return fail("method_not_allowed", 405);
    const type = url.searchParams.get("type"), id = Number(url.searchParams.get("id"));
    if (!Object.hasOwn(scopeSql, type) || !positive(id)) return fail("bad_request", 400);
    if (!(await permission.manage(type, id))) return fail("forbidden", 403);
    return workspace(env, type, id, permission);
  }
  if (route === "/api/admin/stage-students") {
    const stageId = Number(url.searchParams.get("stage_id")), after = Number(url.searchParams.get("after") || 0);
    if (!positive(stageId) || !Number.isSafeInteger(after) || after < 0) return fail("bad_request", 400);
    if (req.method === "POST") return changeStageMembership(req, env, user, permission, stageId);
    if (req.method !== "GET") return fail("method_not_allowed", 405);
    if (!(await permission.manage("stage", stageId))) return fail("forbidden", 403);
    const { results } = await env.DB.prepare(
      `SELECT u.id,u.name FROM user_profile p JOIN users u ON u.id=p.user_id
       WHERE p.stage_id=? AND u.active=1 AND u.id>? ORDER BY u.id LIMIT 51`
    ).bind(stageId, after).all();
    const page = (results || []).slice(0, 50);
    return json({ ok: true, items: page.map(({ name }) => ({ name })), next: results?.length > 50 ? page.at(-1).id : null });
  }
  const student = route === "/api/stage-announcements";
  if (req.method !== "GET" && (student || req.method !== "POST")) return fail("method_not_allowed", 405);
  const stageId = url.searchParams.get("stage_id");
  return stageAnnouncements(req, env, user, permission, stageId === null ? null : Number(stageId), student);
}
