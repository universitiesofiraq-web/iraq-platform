// functions/_lib/catalog.js — دليل الجامعات والكليات والأقسام والمواد (D1).
// قراءة عامة: GET /api/catalog/{universities|colleges|departments|subjects}
//   colleges?university_id=  departments?college_id=  subjects?department_id=[&stage=&term=]
// إضافة (للمشرف فقط): POST /api/catalog/add  { type, ...حقول }
//   university {name_ar,name_en?,city?}  college {university_id,name_ar}  department {college_id,name_ar}
//   subject {department_id,stage,term,name_ar,name_en?,professor?}
// حذف (للمشرف): POST /api/catalog/delete { type, id }  (university|college|department|subject)
import { currentUser } from "./auth.js";
import { policy, isGlobalAdmin } from "./scope.js";
import { ACTIVE_UNIVERSITY } from "./onboarding.js";
import { resolveInvite } from "./invites.js";

const NOT_SUSPENDED =
  "NOT EXISTS (SELECT 1 FROM university_onboarding o WHERE o.university_id=u.id AND o.state='suspended')";

const json = (body, status = 200) =>
  new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
const fail = (error, status) => json({ ok: false, error }, status);
const num = (v) => (Number.isInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
const txt = (v, max = 120) => String(v || "").trim().slice(0, max);
const slugify = (s) =>
  "u" + Math.abs([...s].reduce((h, c) => (h * 31 + c.charCodeAt(0)) | 0, 7)).toString(36);

async function all(env, sql, ...args) {
  const r = await env.DB.prepare(sql).bind(...args).all();
  return r.results || [];
}

export async function handleCatalog(req, env) {
  const url = new URL(req.url);
  const m = url.pathname.match(/^\/api\/catalog\/([a-z]+)$/);
  if (!m) return null;
  if (!env.DB) return fail("not_configured", 503);
  const part = m[1];
  const q = url.searchParams;

  try {
    if (req.method === "GET") {
      const directory = q.get("view") === "directory";
      const joining = q.get("view") === "join"; // التسجيل: كل جامعات الدليل عدا المعلّقة، للمستخدم المسجّل دخوله
      if (directory && !(await isGlobalAdmin(await currentUser(req, env), env))) return fail("forbidden", 403);
      if (joining && !(await currentUser(req, env))) return fail("unauthorized", 401);
      const visible = directory ? "1=1" : joining ? NOT_SUSPENDED : ACTIVE_UNIVERSITY;
      if (part === "me") return await myProfile(req, env);
      if (part === "stages") {
        const id = num(q.get("department_id"));
        if (!id) return fail("bad_request", 400);
        return json({ ok: true, items: await all(env, `SELECT st.id, st.number FROM stages st JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id WHERE st.department_id=? AND ${visible} ORDER BY st.number`, id) });
      }
      if (part === "index") {
        const [u, c, d] = await Promise.all([
          all(env, `SELECT u.id, u.name_ar, u.name_en, u.city, u.kind FROM universities u WHERE ${visible} ORDER BY u.name_ar`)
            .catch(() => all(env, `SELECT u.id, u.name_ar, u.name_en, u.city, NULL AS kind FROM universities u WHERE ${visible} ORDER BY u.name_ar`)),
          all(env, `SELECT c.id, c.university_id, c.name_ar, c.name_en FROM colleges c JOIN universities u ON u.id=c.university_id WHERE ${visible} ORDER BY c.name_ar`),
          all(env, `SELECT d.id, d.college_id, d.name_ar FROM departments d JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id WHERE ${visible} ORDER BY d.name_ar`)
        ]);
        return json({
          ok: true,
          u: u.map((r) => [r.id, r.name_ar, r.name_en, r.city, r.kind || ""]),
          c: c.map((r) => [r.id, r.university_id, r.name_ar, r.name_en]),
          d: d.map((r) => [r.id, r.college_id, r.name_ar])
        });
      }
      if (part === "universities")
        return json({ ok: true, items: await all(env, `SELECT u.id, u.slug, u.name_ar, u.name_en, u.city FROM universities u WHERE ${visible} ORDER BY u.name_ar`) });
      if (part === "colleges") {
        const id = num(q.get("university_id"));
        if (!id) return fail("bad_request", 400);
        return json({ ok: true, items: await all(env, `SELECT c.id, c.name_ar, c.name_en FROM colleges c JOIN universities u ON u.id=c.university_id WHERE c.university_id=? AND ${visible} ORDER BY c.name_ar`, id) });
      }
      if (part === "departments") {
        const id = num(q.get("college_id"));
        if (!id) return fail("bad_request", 400);
        return json({ ok: true, items: await all(env, `SELECT d.id, d.name_ar, d.name_en FROM departments d JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id WHERE d.college_id=? AND ${visible} ORDER BY CASE WHEN d.name_ar LIKE 'المرحلة %' THEN d.id ELSE 0 END, d.name_ar`, id) });
      }
      if (part === "subjects") {
        const id = num(q.get("department_id"));
        if (!id) return fail("bad_request", 400);
        const items = await all(
          env,
          `SELECT sb.id, sb.name_ar, sb.name_en, sb.professor, st.number AS stage, t.number AS term
           FROM subjects sb JOIN terms t ON t.id=sb.term_id JOIN stages st ON st.id=t.stage_id
           JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id
           JOIN universities u ON u.id=c.university_id
           WHERE st.department_id=? AND ${visible} ORDER BY st.number, t.number, sb.name_ar`, id);
        return json({ ok: true, items });
      }
      if (part === "department") {
        const id = num(q.get("id"));
        if (!id) return fail("bad_request", 400);
        const row = await env.DB.prepare(
          `SELECT d.id, d.name_ar, c.id AS college_id, c.name_ar AS college, u.id AS university_id, u.name_ar AS university
           FROM departments d JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id WHERE d.id=? AND ${visible}`).bind(id).first();
        if (!row) return fail("not_found", 404);
        const me = await currentUser(req, env);
        const pol = me ? await policy(env, me) : null;
        return json({ ok: true, item: row, can: !!(pol && (await pol.manage("department", id))) });
      }
      if (part === "subject") {
        const id = num(q.get("id"));
        if (!id) return fail("bad_request", 400);
        const row = await env.DB.prepare(
          `SELECT sb.id, sb.name_ar, sb.name_en, sb.professor, st.number AS stage, t.number AS term,
                  d.id AS department_id, d.name_ar AS department, c.id AS college_id, c.name_ar AS college,
                  u.id AS university_id, u.name_ar AS university
           FROM subjects sb JOIN terms t ON t.id=sb.term_id JOIN stages st ON st.id=t.stage_id
           JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id
           JOIN universities u ON u.id=c.university_id WHERE sb.id=? AND ${visible}`).bind(id).first();
        if (!row) return fail("not_found", 404);
        const me = await currentUser(req, env);
        const pol = me ? await policy(env, me) : null;
        return json({ ok: true, item: row, can: !!(pol && (await pol.manageCourse("s" + id))), can_upload: !!(pol && (await pol.upload("s" + id))) });
      }
      return fail("not_found", 404);
    }

    if (req.method === "POST" && part === "join") return await join(req, env, url);
    if (req.method !== "POST" || !["add", "delete", "import"].includes(part)) return fail("not_found", 404);
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return fail("forbidden", 403);
    if (!req.headers.get("content-type")?.includes("application/json")) return fail("bad_request", 400);
    const me = await currentUser(req, env);
    if (!me) return fail("forbidden", 403);
    const admin = await isGlobalAdmin(me, env);
    let b;
    try { b = await req.json(); } catch { return fail("bad_request", 400); }
    const type = String(b.type || "");
    if (part === "import") return admin ? await importData(env, b) : fail("forbidden", 403);
    if (!admin) { // ممثل نطاق: يضيف/يحذف داخل نطاقه فقط
      const pol = await policy(env, me);
      let ok = false;
      if (part === "add") {
        const par = { college: ["university", num(b.university_id)], department: ["college", num(b.college_id)], subject: ["department", num(b.department_id)] }[type];
        ok = !!par && !!par[1] && (await pol.manage(par[0], par[1]));
      } else if (["college", "department", "subject"].includes(type)) {
        ok = !!num(b.id) && (await pol.manage(type, num(b.id), type)); // الحذف يتطلب نطاقاً أعلى من العقدة نفسها
        if (type === "subject") ok = !!num(b.id) && (await pol.manage("subject", num(b.id)));
      }
      if (!ok) return fail("forbidden", 403);
    }

    if (part === "delete") {
      const id = num(b.id);
      const tbl = { university: "universities", college: "colleges", department: "departments", subject: "subjects" }[type];
      if (!id || !tbl) return fail("bad_request", 400);
      const kids = { university: "colleges WHERE university_id", college: "departments WHERE college_id" }[type];
      if (kids) {
        const c = await env.DB.prepare(`SELECT COUNT(*) AS n FROM ${kids}=?`).bind(id).first();
        if (c && c.n) return fail("not_empty", 409);
      }
      await env.DB.prepare(`DELETE FROM ${tbl} WHERE id=?`).bind(id).run();
      return json({ ok: true });
    }

    const name = txt(b.name_ar);
    if (!name) return fail("bad_request", 400);
    const en = txt(b.name_en) || null;
    let r;
    if (type === "university") {
      r = await env.DB.prepare("INSERT INTO universities (slug,name_ar,name_en,city,is_active) VALUES (?,?,?,?,1)")
        .bind(slugify(name + Date.now()), name, en, txt(b.city) || null).run();
    } else if (type === "college") {
      const uid = num(b.university_id);
      if (!uid) return fail("bad_request", 400);
      r = await env.DB.prepare("INSERT INTO colleges (university_id,slug,name_ar,name_en,is_active) VALUES (?,?,?,?,1)")
        .bind(uid, slugify(name + Date.now()), name, en).run();
    } else if (type === "department") {
      const cid = num(b.college_id);
      if (!cid) return fail("bad_request", 400);
      r = await env.DB.prepare("INSERT INTO departments (college_id,name_ar,name_en) VALUES (?,?,?)").bind(cid, name, en).run();
    } else if (type === "subject") {
      const did = num(b.department_id), stage = num(b.stage), term = num(b.term);
      if (!did || !stage || stage > 8 || !term || term > 3) return fail("bad_request", 400);
      await env.DB.prepare("INSERT OR IGNORE INTO stages (department_id,number) VALUES (?,?)").bind(did, stage).run();
      const st = await env.DB.prepare("SELECT id FROM stages WHERE department_id=? AND number=?").bind(did, stage).first();
      await env.DB.prepare("INSERT OR IGNORE INTO terms (stage_id,number) VALUES (?,?)").bind(st.id, term).run();
      const tm = await env.DB.prepare("SELECT id FROM terms WHERE stage_id=? AND number=?").bind(st.id, term).first();
      r = await env.DB.prepare("INSERT INTO subjects (term_id,name_ar,name_en,professor) VALUES (?,?,?,?)")
        .bind(tm.id, name, en, txt(b.professor) || null).run();
    } else return fail("bad_request", 400);
    return json({ ok: true, id: r.meta && r.meta.last_row_id });
  } catch (e) {
    console.error("catalog error", e);
    return fail("server", 500);
  }
}

// استيراد جماعي (للمشرف): { unis:[[اسم,مدينة,نوع]], renames:[[قديم,جديد]], merges:[[من,إلى]], tree:[{u,colleges:[{n,deps:[..]}]}] }
const nz = (s) =>
  String(s || "").replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه").replace(/\s+/g, " ").trim();
async function importData(env, b) {
  const out = { added: 0, updated: 0, renamed: 0, merged: 0, colleges: 0, departments: 0 };
  try { await env.DB.prepare("ALTER TABLE universities ADD COLUMN kind TEXT").run(); } catch (e) { /* موجود */ }
  const chunk = async (stmts) => { for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40)); };
  const loadU = async () => { const m = new Map(); for (const r of await all(env, "SELECT id, name_ar, city, kind FROM universities")) m.set(nz(r.name_ar), r); return m; };
  for (const [oldN, newN] of b.renames || []) {
    const r = await env.DB.prepare("UPDATE universities SET name_ar=? WHERE name_ar=?").bind(txt(newN), txt(oldN)).run();
    out.renamed += (r.meta && r.meta.changes) || 0;
  }
  for (const [from, to] of b.merges || []) {
    const m = await loadU(); const f = m.get(nz(from)), t = m.get(nz(to));
    if (f && t && f.id !== t.id) {
      await env.DB.batch([
        env.DB.prepare("UPDATE colleges SET university_id=? WHERE university_id=?").bind(t.id, f.id),
        env.DB.prepare("DELETE FROM universities WHERE id=?").bind(f.id)
      ]);
      out.merged++;
    }
  }
  if (b.unis && b.unis.length) {
    const m = await loadU(); const stmts = [];
    for (const [name, city, kind] of b.unis) {
      const n = txt(name), ex = m.get(nz(n));
      if (ex) {
        stmts.push(env.DB.prepare("UPDATE universities SET kind=?, city=COALESCE(NULLIF(?, ''), city) WHERE id=?").bind(kind || null, txt(city), ex.id)); out.updated++;
      } else {
        stmts.push(env.DB.prepare("INSERT INTO universities (slug,name_ar,city,kind,is_active) VALUES (?,?,?,?,1)").bind(slugify(n + Date.now() + stmts.length), n, txt(city) || null, kind || null)); out.added++;
      }
    }
    await chunk(stmts);
  }
  for (const t of b.tree || []) {
    const m = await loadU(); const u = m.get(nz(t.u)); if (!u) continue;
    const cols = new Map();
    for (const r of await all(env, "SELECT id, name_ar FROM colleges WHERE university_id=?", u.id)) cols.set(nz(r.name_ar), r.id);
    const newCols = [];
    for (const c of t.colleges || []) if (!cols.has(nz(c.n))) { newCols.push(c); cols.set(nz(c.n), -1); }
    await chunk(newCols.map((c, i) => env.DB.prepare("INSERT INTO colleges (university_id,slug,name_ar,is_active) VALUES (?,?,?,1)").bind(u.id, slugify(c.n + Date.now() + i), txt(c.n))));
    out.colleges += newCols.length;
    const idOf = new Map();
    for (const r of await all(env, "SELECT id, name_ar FROM colleges WHERE university_id=?", u.id)) idOf.set(nz(r.name_ar), r.id);
    const have = new Set();
    for (const r of await all(env, "SELECT d.college_id, d.name_ar FROM departments d JOIN colleges c ON c.id=d.college_id WHERE c.university_id=?", u.id)) have.add(r.college_id + "|" + nz(r.name_ar));
    const ins = [];
    for (const c of t.colleges || []) {
      const cid = idOf.get(nz(c.n)); if (!cid) continue;
      for (const d of c.deps || []) { const k = cid + "|" + nz(d); if (!have.has(k)) { have.add(k); ins.push(env.DB.prepare("INSERT INTO departments (college_id,name_ar) VALUES (?,?)").bind(cid, txt(d, 160))); } }
    }
    await chunk(ins); out.departments += ins.length;
  }
  return json({ ok: true, ...out });
}

// ملف الطالب: جامعته وكليته وقسمه ومرحلته
async function myProfile(req, env) {
  const me = await currentUser(req, env);
  if (!me) return fail("unauthorized", 401);
  const row = await env.DB.prepare(
    `SELECT st.number AS stage, d.id AS department_id, d.name_ar AS department, c.id AS college_id, c.name_ar AS college,
            u.id AS university_id, u.name_ar AS university,
            CASE WHEN o.state='active' THEN 'active' WHEN o.state='suspended' THEN 'suspended' ELSE 'pending' END AS university_state
     FROM user_profile p JOIN stages st ON st.id=p.stage_id JOIN departments d ON d.id=st.department_id
     JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id
     LEFT JOIN university_onboarding o ON o.university_id=u.id WHERE p.user_id=?`).bind(me.id).first();
  return json({ ok: true, profile: row || null });
}

// تسجيل الطالب في قسمه ومرحلته: يُحفظ اختياره فقط. لا يفعّل الجامعة ولا يمنح أي صلاحية؛ الجامعة المعلّقة مرفوضة.
async function join(req, env, url) {
  const origin = req.headers.get("origin");
  if (origin && origin !== url.origin) return fail("forbidden", 403);
  if (!req.headers.get("content-type")?.includes("application/json")) return fail("bad_request", 400);
  const me = await currentUser(req, env);
  if (!me) return fail("unauthorized", 401);
  let b;
  try { b = await req.json(); } catch { return fail("bad_request", 400); }
  const did = num(b.department_id), stage = num(b.stage);
  if (!did || !stage || stage > 8) return fail("bad_request", 400);
  const dep = await env.DB.prepare(
    `SELECT d.id, c.id AS college_id, c.university_id, o.state FROM departments d JOIN colleges c ON c.id=d.college_id
     LEFT JOIN university_onboarding o ON o.university_id=c.university_id WHERE d.id=?`).bind(did).first();
  if (!dep) return fail("not_found", 404);
  if (dep.state === "suspended") return fail("suspended", 403);
  const now = Date.now();
  await env.DB.prepare("INSERT OR IGNORE INTO stages (department_id,number) VALUES (?,?)").bind(did, stage).run();
  const st = await env.DB.prepare("SELECT id FROM stages WHERE department_id=? AND number=?").bind(did, stage).first();
  // مصدر التسجيل: رابط دعوة صالح لنفس القسم (ولنفس المرحلة إن كان رابط مرحلة)، وإلا تسجيل مباشر
  let inviteCode = null;
  if (typeof b.invite === "string") {
    const inv = await resolveInvite(env, b.invite.toUpperCase());
    if (inv && inv.department_id === did && (inv.type === "department" || inv.stage === stage)) inviteCode = b.invite.toUpperCase();
  }
  await env.DB.batch([
    env.DB.prepare(`INSERT INTO user_profile (user_id,college_id,stage_id) VALUES (?,?,?)
      ON CONFLICT(user_id) DO UPDATE SET college_id=excluded.college_id, stage_id=excluded.stage_id`).bind(me.id, dep.college_id, st.id),
    env.DB.prepare("INSERT OR IGNORE INTO signup_events (user_id,stage_id,invite_code,created_at) VALUES (?,?,?,?)").bind(me.id, st.id, inviteCode, now)
  ]);
  // التسجيل لا يغيّر حالة الجامعة: التفعيل والتعليق للإدارة المخوّلة فقط (onboarding.js)
  return json({ ok: true, department_id: did, university_state: dep.state === "active" ? "active" : "pending", university_activated: false });
}
