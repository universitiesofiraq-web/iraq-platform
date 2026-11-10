// functions/_lib/scope.js — فرق الإدارة المستقلة: لكل جامعة أو كلية أو قسم ممثلوه ورافعوه.
// جدول scopes(user_id, type, node_id, level): type = university|college|department، level = rep|uploader.
// ممثل (rep) على عقدة = كل صلاحيات المشرف داخل تلك العقدة وما تحتها (قبول/رفض/تعديل/حذف الملفات، المواد، الفريق).
// رافع (uploader) على عقدة = يرفع ملفات تظهر بعد موافقة ممثل. المشرف العام يتجاوز كل شيء.

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (error, status) => json({ ok: false, error }, status);

const TYPES = ["university", "college", "department"];
const TBL = { university: "universities", college: "colleges", department: "departments" };
let ready = false;

export async function ensureScopes(env) {
  if (ready || !env.DB) return;
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS scopes (user_id INTEGER NOT NULL, type TEXT NOT NULL, node_id INTEGER NOT NULL, level TEXT NOT NULL, PRIMARY KEY (user_id, type, node_id))"
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS rep_requests (id INTEGER PRIMARY KEY AUTOINCREMENT, user_id INTEGER NOT NULL, type TEXT NOT NULL, node_id INTEGER NOT NULL, status TEXT NOT NULL DEFAULT 'pending', created_at TEXT NOT NULL)"
  ).run();
  await env.DB.prepare(
    "CREATE TABLE IF NOT EXISTS scope_audit (id INTEGER PRIMARY KEY AUTOINCREMENT, actor_id INTEGER NOT NULL, target_user_id INTEGER NOT NULL, action TEXT NOT NULL, type TEXT, node_id INTEGER, created_at TEXT NOT NULL)"
  ).run();
  ready = true;
}

/* سجل تدقيق لكل منح أو سحب أو قرار على طلب (C3) */
export async function audit(env, actorId, targetUserId, action, type, nodeId) {
  await env.DB.prepare(
    "INSERT INTO scope_audit (actor_id, target_user_id, action, type, node_id, created_at) VALUES (?,?,?,?,?,?)"
  ).bind(actorId, targetUserId, action, type ?? null, nodeId ?? null, new Date().toISOString()).run();
}

export function isAdminUser(u, env) {
  if (!u) return false;
  const list = String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  // ADMIN_EMAILS is authoritative for every request, including existing sessions.
  return list.includes(String(u.email || "").toLowerCase());
}

export async function isGlobalAdmin(user, env) {
  if (!user || user.active === 0) return false;
  if (isAdminUser(user, env)) return true;
  if (!env.DB) return false;
  try {
    return !!(await env.DB.prepare("SELECT 1 FROM global_admins WHERE user_id=? AND active=1").bind(user.id).first());
  } catch (error) {
    // Migration-first rollout. A missing grants table confers no permissions.
    if (/no such table: (?:main\.)?global_admins/i.test(String(error?.message))) return false;
    throw error;
  }
}

/* سلسلة العقدة: { university, college, department } */
export async function chainOf(env, type, id) {
  const sql = {
    subject: "SELECT st.id AS stage, d.id AS department, c.id AS college, c.university_id AS university FROM subjects sb " +
              "JOIN terms t ON t.id=sb.term_id JOIN stages st ON st.id=t.stage_id " +
              "JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id WHERE sb.id=?",
    stage: "SELECT st.id AS stage, d.id AS department, c.id AS college, c.university_id AS university FROM stages st JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id WHERE st.id=?",
    department: "SELECT d.id AS department, c.id AS college, c.university_id AS university FROM departments d JOIN colleges c ON c.id=d.college_id WHERE d.id=?",
    college: "SELECT NULL AS department, c.id AS college, c.university_id AS university FROM colleges c WHERE c.id=?",
    university: "SELECT NULL AS department, NULL AS college, u.id AS university FROM universities u WHERE u.id=?"
  }[type];
  if (!sql || !Number.isInteger(id)) return null;
  return env.DB.prepare(sql).bind(id).first();
}

export async function userScopes(env, userId) {
  await ensureScopes(env);
  const r = await env.DB.prepare("SELECT type, node_id, level FROM scopes WHERE user_id=?").bind(userId).all();
  return r.results || [];
}

/* هل تغطي إحدى نطاقات المستخدم هذه السلسلة؟ repOnly: يلزم مستوى ممثل. skip: نوع يُتجاهل (للحذف: لا يحذف الممثل عقدته نفسها) */
export function covers(scopes, chain, repOnly, skip) {
  if (!chain) return false;
  return scopes.some((s) => (s.level === "rep" || (!repOnly && s.level === "uploader")) &&
    s.type !== skip && Number.isSafeInteger(chain[s.type]) && chain[s.type] === s.node_id);
}

/* صلاحيات المستخدم: { admin, scopes, manage(type,id,skip), upload(courseId), manageCourse(courseId) } */
export async function policy(env, user) {
  const admin = await isGlobalAdmin(user, env);
  const scopes = user ? await userScopes(env, user.id) : [];
  const memo = new Map();
  const subjChain = async (courseId) => {
    const m = /^s(\d+)$/.exec(String(courseId || ""));
    if (!m) return null;
    const k = m[1];
    if (!memo.has(k)) memo.set(k, await chainOf(env, "subject", Number(k)));
    return memo.get(k);
  };
  return {
    admin, scopes,
    async manage(type, id, skip) {
      if (admin) return true;
      if (!scopes.length) return false;
      return covers(scopes, await chainOf(env, type, id), true, skip);
    },
    async manageCourse(courseId) {
      if (admin) return true;
      if (!scopes.length) return false;
      return covers(scopes, await subjChain(courseId), true);
    },
    async upload(courseId) {
      if (admin) return true; // Older global roles must not bypass academic scopes.
      if (!scopes.length) return false;
      return covers(scopes, await subjChain(courseId), false);
    }
  };
}

async function nodeName(env, type, id) {
  if (type === "stage") {
    const row = await env.DB.prepare("SELECT number FROM stages WHERE id=?").bind(id).first();
    return row ? "المرحلة " + row.number : "";
  }
  if (!Object.hasOwn(TBL, type)) return "";
  const r = await env.DB.prepare("SELECT name_ar FROM " + TBL[type] + " WHERE id=?").bind(id).first();
  return r ? r.name_ar : "";
}

/* GET /api/auth/scopes → صفوف الفريق المرئية للمستخدم؛ POST /api/auth/scope → إضافة/إزالة */
export async function handleScopes(req, env, user, p) {
  await ensureScopes(env);
  const pol = await policy(env, user);

  if (p === "/api/auth/scopes" && req.method === "GET") {
    const rows = (await env.DB.prepare(
      "SELECT s.user_id, s.type, s.node_id, s.level, u.email, u.name FROM scopes s JOIN users u ON u.id=s.user_id ORDER BY s.type, s.node_id, s.level"
    ).all()).results || [];
    const out = [];
    for (const r of rows) {
      const mine = r.user_id === user.id;
      const manageable = await pol.manage(r.type, r.node_id, r.type === "stage" ? "stage" : undefined);
      if (!mine && !manageable) continue;
      const ch = await chainOf(env, r.type, r.node_id);
      const uni = ch && ch.university ? await env.DB.prepare("SELECT name_ar FROM universities WHERE id=?").bind(ch.university).first() : null;
      out.push({ user_id: r.user_id, email: r.email, name: r.name, type: r.type, node_id: r.node_id, level: r.level, node: await nodeName(env, r.type, r.node_id), can_edit: manageable, university_id: ch ? ch.university : null, university: uni ? uni.name_ar : "" });
    }
    return json({ ok: true, admin: pol.admin, items: out });
  }

  if (p === "/api/auth/scope" && req.method === "POST") {
    let b; try { b = await req.json(); } catch { return fail("bad_request", 400); }
    const type = String(b.type || ""), id = Number(b.id), level = String(b.level || ""), action = String(b.action || "add");
    const email = String(b.email || "").trim().toLowerCase();
    if (!TYPES.includes(type) || !Number.isInteger(id) || !["rep", "uploader"].includes(level) || !["add", "remove"].includes(action) || !email) return fail("bad_request", 400);
    if (!(await pol.manage(type, id))) return fail("forbidden", 403);
    const t = await env.DB.prepare("SELECT id FROM users WHERE lower(email)=?").bind(email).first();
    if (!t) return fail("user_not_found", 404);
    /* هرمية التعيين: المسؤول لا يعيّن ولا يزيل ولا يغيّر مسؤولاً إلا في نطاق أدنى من نطاقه (strictly below).
       الرافع يُعيَّن في نطاق المسؤول نفسه أو ما تحته. المشرف العام يتجاوز. */
    const cur = await env.DB.prepare("SELECT level FROM scopes WHERE user_id=? AND type=? AND node_id=?").bind(t.id, type, id).first();
    if ((level === "rep" || (cur && cur.level === "rep")) && !(await pol.manage(type, id, type))) return fail("forbidden", 403);
    if (type === "department" && cur?.level === "rep" && (action === "remove" || level !== "rep") &&
        !(await pol.manage(type, id, "college"))) return fail("superior_approval_required", 403);
    if (action === "remove") {
      await env.DB.prepare("DELETE FROM scopes WHERE user_id=? AND type=? AND node_id=?").bind(t.id, type, id).run();
      await audit(env, user.id, t.id, "revoke", type, id);
    } else {
      if (!(await nodeName(env, type, id))) return fail("not_found", 404);
      await env.DB.prepare(
        "INSERT INTO scopes (user_id, type, node_id, level) VALUES (?,?,?,?) ON CONFLICT(user_id, type, node_id) DO UPDATE SET level=excluded.level"
      ).bind(t.id, type, id, level).run();
      await audit(env, user.id, t.id, "grant", type, id);
    }
    return json({ ok: true });
  }

  if (p === "/api/auth/rep-request" && req.method === "POST") {
    if (!user) return fail("unauthorized", 401);
    let b; try { b = await req.json(); } catch { return fail("bad_request", 400); }
    const type = String(b.type || "department"), id = Number(b.id);
    if (!TYPES.includes(type) || !Number.isInteger(id)) return fail("bad_request", 400);
    if (!(await nodeName(env, type, id))) return fail("not_found", 404);
    const dup = await env.DB.prepare("SELECT id FROM rep_requests WHERE user_id=? AND type=? AND node_id=? AND status='pending'").bind(user.id, type, id).first();
    if (dup) return json({ ok: true, duplicate: true });
    await env.DB.prepare("INSERT INTO rep_requests (user_id, type, node_id, status, created_at) VALUES (?,?,?,'pending',?)").bind(user.id, type, id, new Date().toISOString()).run();
    return json({ ok: true });
  }

  if (p === "/api/auth/rep-requests" && req.method === "GET") {
    if (!user) return fail("unauthorized", 401);
    const sql = "SELECT r.id, r.type, r.node_id, r.status, r.created_at, u.email, u.name FROM rep_requests r JOIN users u ON u.id=r.user_id";
    const rows = pol.admin
      ? ((await env.DB.prepare(sql + " WHERE r.status='pending' ORDER BY r.id").all()).results || [])
      : ((await env.DB.prepare(sql + " WHERE r.user_id=? ORDER BY r.id DESC LIMIT 50").bind(user.id).all()).results || []);
    const out = [];
    for (const r of rows) out.push({ ...r, node: await nodeName(env, r.type, r.node_id) });
    return json({ ok: true, admin: pol.admin, items: out });
  }

  if (p === "/api/auth/rep-request/decide" && req.method === "POST") {
    if (!pol.admin) return fail("forbidden", 403);
    let b; try { b = await req.json(); } catch { return fail("bad_request", 400); }
    const id = Number(b.id), action = String(b.action || "");
    if (!Number.isInteger(id) || !["approve", "reject"].includes(action)) return fail("bad_request", 400);
    const r = await env.DB.prepare("SELECT * FROM rep_requests WHERE id=? AND status='pending'").bind(id).first();
    if (!r) return fail("not_found", 404);
    if (action === "approve") {
      await env.DB.prepare("INSERT INTO scopes (user_id, type, node_id, level) VALUES (?,?,?,'rep') ON CONFLICT(user_id, type, node_id) DO UPDATE SET level='rep'").bind(r.user_id, r.type, r.node_id).run();
    }
    await env.DB.prepare("UPDATE rep_requests SET status=? WHERE id=?").bind(action === "approve" ? "approved" : "rejected", id).run();
    await audit(env, user.id, r.user_id, action === "approve" ? "approve" : "reject", r.type, r.node_id);
    return json({ ok: true });
  }
  return null;
}
