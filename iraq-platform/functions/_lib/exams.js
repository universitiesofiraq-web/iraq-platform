// functions/_lib/exams.js — تقويم الامتحانات.
//   GET  /api/exams?department_id=&stage=   قادم الامتحانات (عام للجامعات المفعّلة)
//   POST /api/exams            {department_id, stage?, title, exam_date:"YYYY-MM-DD", exam_time?, place?}
//   POST /api/exams/delete     {id}
// الإضافة والحذف لمن يدير القسم (ممثل قسم/كلية/جامعة أو مشرف) أو ممثل المرحلة نفسها.
import { currentUser } from "./auth.js";
import { policy } from "./scope.js";
import { ACTIVE_UNIVERSITY } from "./onboarding.js";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (error, status) => json({ ok: false, error }, status);
const num = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : 0; };
const clean = (v, max) => String(v == null ? "" : v).replace(/\s+/g, " ").trim().slice(0, max);
const dayOf = (ms) => new Date(ms).toISOString().slice(0, 10);

async function canManage(env, user, did, stage) {
  const pol = await policy(env, user);
  if (await pol.manage("department", did)) return true;
  if (stage) {
    const st = await env.DB.prepare("SELECT id FROM stages WHERE department_id=? AND number=?").bind(did, stage).first();
    if (st && (await pol.manage("stage", st.id))) return true;
  }
  return false;
}

export async function handleExams(req, env, opts = {}) {
  const url = new URL(req.url);
  const m = /^\/api\/exams(\/delete)?\/?$/.exec(url.pathname);
  if (!m) return null;
  if (!env.DB) return fail("not_configured", 503);
  const now = (opts.now || Date.now)();
  try {
    if (req.method === "GET" && !m[1]) {
      const did = num(url.searchParams.get("department_id")), stage = num(url.searchParams.get("stage"));
      if (!did) return fail("bad_request", 400);
      const from = dayOf(now - 86400000); // يبقى امتحان اليوم ظاهراً طوال يومه
      const rows = (await env.DB.prepare(
        `SELECT e.id, e.stage, e.title, e.exam_date, e.exam_time, e.place
         FROM exams e JOIN departments d ON d.id=e.department_id JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id
         WHERE e.department_id=? AND e.exam_date>=? AND ${ACTIVE_UNIVERSITY} AND (? = 0 OR e.stage IS NULL OR e.stage=?)
         ORDER BY e.exam_date, e.exam_time LIMIT 60`).bind(did, from, stage, stage).all()).results || [];
      return json({ ok: true, items: rows, today: dayOf(now) });
    }
    if (req.method !== "POST") return fail("not_found", 404);
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return fail("forbidden", 403);
    const user = await (opts.currentUser || currentUser)(req, env);
    if (!user) return fail("unauthorized", 401);
    let b = null; try { b = await req.json(); } catch { /* فارغ */ }
    if (!b || typeof b !== "object") return fail("bad_request", 400);
    if (m[1]) {
      const id = num(b.id);
      const row = id && (await env.DB.prepare("SELECT department_id, stage FROM exams WHERE id=?").bind(id).first());
      if (!row) return fail("not_found", 404);
      if (!(await canManage(env, user, row.department_id, row.stage))) return fail("forbidden", 403);
      await env.DB.prepare("DELETE FROM exams WHERE id=?").bind(id).run();
      return json({ ok: true });
    }
    const did = num(b.department_id), stage = b.stage == null || b.stage === "" ? null : num(b.stage);
    const title = clean(b.title, 120), date = clean(b.exam_date, 10), time = clean(b.exam_time, 5), place = clean(b.place, 80);
    if (!did || !title || (stage !== null && (!stage || stage > 8))) return fail("bad_request", 400);
    if (!/^\d{4}-\d{2}-\d{2}$/.test(date) || Number.isNaN(Date.parse(date))) return fail("bad_date", 400);
    if (date < dayOf(now - 86400000) || date > dayOf(now + 400 * 86400000)) return fail("bad_date", 400);
    if (time && !/^([01]\d|2[0-3]):[0-5]\d$/.test(time)) return fail("bad_time", 400);
    if (!(await env.DB.prepare("SELECT 1 FROM departments WHERE id=?").bind(did).first())) return fail("not_found", 404);
    if (!(await canManage(env, user, did, stage))) return fail("forbidden", 403);
    const r = await env.DB.prepare("INSERT INTO exams (department_id,stage,title,exam_date,exam_time,place,created_by,created_at) VALUES (?,?,?,?,?,?,?,?)")
      .bind(did, stage, title, date, time || null, place || null, user.id, now).run();
    return json({ ok: true, id: r.meta && r.meta.last_row_id });
  } catch (e) {
    console.error("exams", String(e && e.message).slice(0, 200));
    return fail("server_error", 500);
  }
}
