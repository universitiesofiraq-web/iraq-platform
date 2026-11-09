// functions/_lib/catalog.js — دليل الجامعات والكليات والأقسام والمواد (D1).
// قراءة عامة: GET /api/catalog/{universities|colleges|departments|subjects}
//   colleges?university_id=  departments?college_id=  subjects?department_id=[&stage=&term=]
// إضافة (للمشرف فقط): POST /api/catalog/add  { type, ...حقول }
//   university {name_ar,name_en?,city?}  college {university_id,name_ar}  department {college_id,name_ar}
//   subject {department_id,stage,term,name_ar,name_en?,professor?}
// حذف (للمشرف): POST /api/catalog/delete { type, id }  (university|college|department|subject)
import { currentUser } from "./auth.js";

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

async function isAdmin(req, env) {
  const u = await currentUser(req, env);
  if (!u) return false;
  const list = String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map((x) => x.trim());
  return u.role === "admin" || list.includes(String(u.email || "").toLowerCase());
}

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
      if (part === "index") {
        const [u, c, d] = await Promise.all([
          all(env, "SELECT id, name_ar, name_en, city FROM universities ORDER BY name_ar"),
          all(env, "SELECT id, university_id, name_ar, name_en FROM colleges ORDER BY name_ar"),
          all(env, "SELECT id, college_id, name_ar FROM departments ORDER BY name_ar")
        ]);
        return new Response(
          JSON.stringify({
            ok: true,
            u: u.map((r) => [r.id, r.name_ar, r.name_en, r.city]),
            c: c.map((r) => [r.id, r.university_id, r.name_ar, r.name_en]),
            d: d.map((r) => [r.id, r.college_id, r.name_ar])
          }),
          { headers: { "content-type": "application/json; charset=utf-8", "cache-control": "public, max-age=120" } }
        );
      }
      if (part === "universities")
        return json({ ok: true, items: await all(env, "SELECT id, slug, name_ar, name_en, city FROM universities ORDER BY name_ar") });
      if (part === "colleges") {
        const id = num(q.get("university_id"));
        if (!id) return fail("bad_request", 400);
        return json({ ok: true, items: await all(env, "SELECT id, name_ar, name_en FROM colleges WHERE university_id=? ORDER BY name_ar", id) });
      }
      if (part === "departments") {
        const id = num(q.get("college_id"));
        if (!id) return fail("bad_request", 400);
        return json({ ok: true, items: await all(env, "SELECT id, name_ar, name_en FROM departments WHERE college_id=? ORDER BY name_ar", id) });
      }
      if (part === "subjects") {
        const id = num(q.get("department_id"));
        if (!id) return fail("bad_request", 400);
        const items = await all(
          env,
          `SELECT sb.id, sb.name_ar, sb.name_en, sb.professor, st.number AS stage, t.number AS term
           FROM subjects sb JOIN terms t ON t.id=sb.term_id JOIN stages st ON st.id=t.stage_id
           WHERE st.department_id=? ORDER BY st.number, t.number, sb.name_ar`, id);
        return json({ ok: true, items });
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
           JOIN universities u ON u.id=c.university_id WHERE sb.id=?`).bind(id).first();
        return row ? json({ ok: true, item: row }) : fail("not_found", 404);
      }
      return fail("not_found", 404);
    }

    if (req.method !== "POST" || !["add", "delete"].includes(part)) return fail("not_found", 404);
    if (!(await isAdmin(req, env))) return fail("forbidden", 403);
    let b;
    try { b = await req.json(); } catch { return fail("bad_request", 400); }
    const type = String(b.type || "");

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
