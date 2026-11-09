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
  ready = true;
}

export function isAdminUser(u, env) {
  if (!u) return false;
  const list = String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);
  return u.role === "admin" || list.includes(String(u.email || "").toLowerCase());
}

/* سلسلة العقدة: { university, college, department } */
export async function chainOf(env, type, id) {
  const sql = {
    subject: `SELECT d.id AS department, c.id AS college, c.university_id AS university FROM subjects sb
              JOIN terms t ON t.id=sb.term_id JOIN stages st ON st.id=t.stage_id
              JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id WHERE sb.id=?`,
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
  return scopes.some((s) => (!repOnly || s.level === "rep") && s.type !== skip && chain[s.type] === s.node_id);
}

/* صلاحيات المستخدم: { admin, scopes, manage(type,id,skip), upload(courseId), manageCourse(courseId) } */
export async function policy(env, user) {
  const admin = isAdminUser(user, env);
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
    legacyUploader: !!user && (user.role === "uploader" || user.role === "rep"),
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
      if (admin || this.legacyUploader) return true;
      if (!scopes.length) return false;
      return covers(scopes, await subjChain(courseId), false);
    }
  };
}

async function nodeName(env, type, id) {
  const r = await env.DB.prepare(`SELECT name_ar FROM ${TBL[type]} WHERE id=?`).bind(id).first();
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
      const manageable = await pol.manage(r.type, r.node_id);
      if (!mine && !manageable) continue;
      out.push({ email: r.email, name: r.name, type: r.type, node_id: r.node_id, level: r.level, node: await nodeName(env, r.type, r.node_id), can_edit: manageable });
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
    if (action === "remove") {
      await env.DB.prepare("DELETE FROM scopes WHERE user_id=? AND type=? AND node_id=?").bind(t.id, type, id).run();
    } else {
      if (!(await nodeName(env, type, id))) return fail("not_found", 404);
      await env.DB.prepare(
        "INSERT INTO scopes (user_id, type, node_id, level) VALUES (?,?,?,?) ON CONFLICT(user_id, type, node_id) DO UPDATE SET level=excluded.level"
      ).bind(t.id, type, id, level).run();
    }
    return json({ ok: true });
  }
  return null;
}
