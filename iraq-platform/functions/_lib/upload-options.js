import { currentUser } from "./auth.js";
import { policy } from "./scope.js";
import { serviceErrorResponse } from "./service-errors.js";

const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status,
  headers: { "content-type": "application/json; charset=utf-8", "cache-control": "private, no-store", "vary": "Cookie" }
});
const fail = (error, status) => json({ ok: false, error }, status);
const hierarchy = `FROM universities u LEFT JOIN colleges c ON c.university_id=u.id
  LEFT JOIN departments d ON d.college_id=c.id`;
const joins = hierarchy + " LEFT JOIN stages st ON st.department_id=d.id";
const grant = level => `EXISTS (SELECT 1 FROM scopes sc WHERE sc.user_id=? AND ${level}
  AND ((sc.type='university' AND sc.node_id=u.id) OR (sc.type='college' AND sc.node_id=c.id)
    OR (sc.type='department' AND sc.node_id=d.id) OR (sc.type='stage' AND sc.node_id=st.id)))`;
const universityScope = `u.id IN (
  SELECT node_id FROM grants WHERE type='university'
  UNION SELECT c.university_id FROM grants g JOIN colleges c ON c.id=g.node_id WHERE g.type='college'
  UNION SELECT c.university_id FROM grants g JOIN departments d ON d.id=g.node_id
    JOIN colleges c ON c.id=d.college_id WHERE g.type='department'
  UNION SELECT c.university_id FROM grants g JOIN stages st ON st.id=g.node_id
    JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id WHERE g.type='stage')`;

export async function handleUploadOptions(request, env) {
  const url = new URL(request.url);
  if (url.pathname !== "/api/upload-options") return null;
  if (request.method !== "GET") return fail("method_not_allowed", 405);
  if (!env.DB) return fail("not_configured", 503);
  try {
    const user = await currentUser(request, env);
    if (!user) return fail("unauthorized", 401);
    const permission = await policy(env, user);
    if (!permission.admin && !permission.scopes.some(s => ["rep", "uploader"].includes(s.level) &&
        ["university", "college", "department", "stage"].includes(s.type))) return fail("forbidden", 403);
    const ids = {};
    for (const key of ["university_id", "college_id", "department_id", "stage_id", "subject_id"]) {
      if (!url.searchParams.has(key)) continue;
      const id = Number(url.searchParams.get(key));
      if (!Number.isSafeInteger(id) || id < 1) return fail("bad_request", 400);
      ids[key] = id;
    }
    const allowed = permission.admin ? "1=1" : grant("sc.level IN ('rep','uploader')");
    const publish = permission.admin ? "1" : grant("sc.level='rep'");
    const filters = [allowed];
    const args = permission.admin ? [] : [user.id];
    for (const [key, column] of Object.entries({ university_id: "u.id", college_id: "c.id", department_id: "d.id", stage_id: "st.id" })) {
      if (ids[key]) { filters.push(column + "=?"); args.push(ids[key]); }
    }
    if (ids.department_id || ids.subject_id) {
      const subjectFilters = filters.concat(ids.subject_id ? ["sb.id=?"] : []);
      const subjectArgs = args.concat(ids.subject_id ? [ids.subject_id] : []);
      if (!ids.subject_id) {
        const parent = await env.DB.prepare(`SELECT d.id ${joins} WHERE ${filters.join(" AND ")} LIMIT 1`).bind(...args).first();
        if (!parent) return fail("forbidden", 403);
      }
      const { results } = await env.DB.prepare(`SELECT sb.id,sb.name_ar,sb.name_en,sb.professor,
        st.id AS stage_id,st.number AS stage,t.number AS term,d.id AS department_id,
        c.id AS college_id,u.id AS university_id,${publish} AS can_publish
        FROM subjects sb JOIN terms t ON t.id=sb.term_id JOIN stages st ON st.id=t.stage_id
        JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id
        JOIN universities u ON u.id=c.university_id WHERE ${subjectFilters.join(" AND ")}
        ORDER BY st.number,t.number,sb.name_ar`).bind(...(permission.admin ? [] : [user.id]), ...subjectArgs).all();
      if (ids.subject_id && !results?.length) return fail("forbidden", 403);
      return json({ ok: true, items: (results || []).map(item => ({ ...item, can_publish: !!item.can_publish })) });
    }
    // Narrow the tree by indexed ancestors before expanding descendants.
    const cte = permission.admin ? "" : "WITH grants AS (SELECT type,node_id FROM scopes WHERE user_id=? AND level IN ('rep','uploader'))";
    if (!permission.admin) filters.push(universityScope);
    const rootJoins = permission.admin && !ids.stage_id ? hierarchy : joins;
    const { results } = await env.DB.prepare(`${cte} SELECT DISTINCT u.id AS university_id,u.name_ar AS university,
      c.id AS college_id,c.name_ar AS college,d.id AS department_id,d.name_ar AS department
      ${rootJoins} WHERE ${filters.join(" AND ")} ORDER BY u.name_ar,c.name_ar,d.name_ar`)
      .bind(...(permission.admin ? [] : [user.id]), ...args).all();
    if (ids.stage_id && !results?.length) return fail("forbidden", 403);
    const universities = new Map(), colleges = new Map(), departments = new Map();
    for (const row of results || []) {
      universities.set(row.university_id, { id: row.university_id, name_ar: row.university });
      if (row.college_id) colleges.set(row.college_id, { id: row.college_id, university_id: row.university_id, name_ar: row.college });
      if (row.department_id) departments.set(row.department_id, { id: row.department_id, college_id: row.college_id, name_ar: row.department });
    }
    return json({ ok: true, admin: permission.admin, universities: [...universities.values()],
      colleges: [...colleges.values()], departments: [...departments.values()] });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}
