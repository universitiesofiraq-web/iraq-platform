// functions/api/platform.js — GET /api/platform?dept=ID
// يبني بيانات منصة القسم بنفس شكل data/courses.js القديم (SITE, SEMESTERS, CATEGORIES, COURSES).
// الأقسام المسمّاة "المرحلة ..." (كليات الطب) تُجمع مراحل الكلية كلها في منصة واحدة.
import { ACTIVE_UNIVERSITY } from "../_lib/onboarding.js";

const ORD = { "الأولى": 1, "الثانية": 2, "الثالثة": 3, "الرابعة": 4, "الخامسة": 5, "السادسة": 6 };
const AR_NUM = ["", "الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة"];
const json = (b, s = 200) => new Response(JSON.stringify(b), { status: s, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const stageOf = (n) => { const m = /المرحلة\s+(\S+)/.exec(n || ""); return m && ORD[m[1]] ? ORD[m[1]] : 0; };

export async function onRequestGet({ request, env }) {
  if (!env.DB) return json({ ok: false, error: "not_configured" }, 503);
  const id = Number(new URL(request.url).searchParams.get("dept"));
  if (!Number.isInteger(id) || id <= 0) return json({ ok: false, error: "bad_request" }, 400);
  const d = await env.DB.prepare(
    `SELECT d.id, d.name_ar, d.college_id, c.name_ar AS college, c.university_id, u.name_ar AS university FROM departments d JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id WHERE d.id=? AND ${ACTIVE_UNIVERSITY}`
  ).bind(id).first();
  if (!d) return json({ ok: false, error: "not_found" }, 404);

  const staged = stageOf(d.name_ar) > 0;
  const deps = staged
    ? (await env.DB.prepare("SELECT id, name_ar FROM departments WHERE college_id=? AND name_ar LIKE 'المرحلة %'").bind(d.college_id).all()).results || []
    : [{ id: d.id, name_ar: d.name_ar }];
  const depIds = deps.map((x) => x.id);
  const depName = new Map(deps.map((x) => [x.id, x.name_ar]));

  const rows = depIds.length ? ((await env.DB.prepare(
    `SELECT sb.id, sb.name_ar, sb.name_en, sb.professor, st.number AS stage, t.number AS term, st.department_id AS dep
     FROM subjects sb JOIN terms t ON t.id=sb.term_id JOIN stages st ON st.id=t.stage_id
     WHERE st.department_id IN (${depIds.map(() => "?").join(",")}) ORDER BY st.number, t.number, sb.name_ar`
  ).bind(...depIds).all()).results || []) : [];

  const sem = new Map();
  const courses = rows.map((r) => {
    const stage = staged ? (stageOf(depName.get(r.dep)) || r.stage) : r.stage;
    const sid = stage * 10 + r.term;
    if (!sem.has(sid)) sem.set(sid, { id: sid, name: "المرحلة " + (AR_NUM[stage] || stage) + " — الكورس " + (r.term === 1 ? "الأول" : "الثاني"), nameEn: "Stage " + stage + " · Semester " + r.term });
    return {
      id: "s" + r.id, semester: sid, category: "general", icon: "book",
      name: r.name_en || r.name_ar, nameAr: r.name_ar, code: "",
      professors: r.professor ? [{ name: r.professor }] : [], lectures: []
    };
  });
  if (!sem.size) sem.set(11, { id: 11, name: "المرحلة الأولى — الكورس الأول", nameEn: "Stage 1 · Semester 1" });
  const semesters = [...sem.values()].sort((a, b) => a.id - b.id);
  semesters[0].current = true;

  return json({
    ok: true,
    dept: { id: d.id, name: staged ? d.college : d.name_ar },
    site: { university: d.university, college: d.college, department: staged ? d.college : d.name_ar },
    semesters, courses
  });
}
