// functions/_lib/college_logo.js — شعار الكلية.
//   (نفس الواجهة لشعار الجامعة: /api/university-logo/<id>، ويديره مشرف عام أو ممثل الجامعة)
//   GET  /api/college-logo/<id>   الصورة (عامة، تُخزَّن في المتصفح)؛ 404 إن لم يوجد
//   POST /api/college-logo/<id>   {image:"data:image/(png|jpeg|webp);base64,..."} أو {remove:true}
//                                  لمن يدير الكلية (مشرف عام أو ممثل جامعة/كلية) فقط
import { currentUser } from "./auth.js";
import { isGlobalAdmin } from "./scope.js";

const json = (o, status = 200) => new Response(JSON.stringify(o), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
const fail = (error, status) => json({ ok: false, error }, status);
const MAX_B64 = 140000; // نحو 100KB بعد فك الترميز
const MAGIC = { "image/png": [0x89, 0x50, 0x4e], "image/jpeg": [0xff, 0xd8, 0xff], "image/webp": [0x52, 0x49, 0x46] };

async function managesUniversity(env, user, uniId) {
  if (await isGlobalAdmin(user, env)) return true;
  const r = await env.DB.prepare("SELECT 1 FROM scopes WHERE user_id=? AND level='rep' AND type='university' AND node_id=?").bind(user.id, uniId).first();
  return !!r;
}

async function manages(env, user, collegeId) {
  if (await isGlobalAdmin(user, env)) return true;
  const rows = await env.DB.prepare("SELECT s.type, s.node_id FROM scopes s WHERE s.user_id=? AND s.level='rep' AND s.type IN ('university','college')").bind(user.id).all();
  const c = await env.DB.prepare("SELECT university_id FROM colleges WHERE id=?").bind(collegeId).first();
  if (!c) return false;
  return (rows.results || []).some((r) => (r.type === "college" && r.node_id === collegeId) || (r.type === "university" && r.node_id === c.university_id));
}

export async function handleCollegeLogo(req, env, opts = {}) {
  const url = new URL(req.url);
  const m = /^\/api\/(college|university)-logo\/(\d{1,9})\/?$/.exec(url.pathname);
  if (!m) return null;
  if (!env.DB) return fail("not_configured", 503);
  const uni = m[1] === "university", id = Number(m[2]);
  const T = uni ? "university_logos" : "college_logos", K = uni ? "university_id" : "college_id", OWNER = uni ? "universities" : "colleges";
  try {
    if (req.method === "GET") {
      const row = await env.DB.prepare(`SELECT mime, data, updated_at FROM ${T} WHERE ${K}=?`).bind(id).first();
      if (!row) return new Response("", { status: 404, headers: { "cache-control": "public, max-age=300" } });
      const bin = Uint8Array.from(atob(row.data), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { "content-type": row.mime, "cache-control": "public, max-age=86400", "x-content-type-options": "nosniff", etag: '"' + row.updated_at + '"' } });
    }
    if (req.method !== "POST") return fail("not_found", 404);
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return fail("forbidden", 403);
    const user = await (opts.currentUser || currentUser)(req, env, (opts.now || Date.now)());
    if (!user) return fail("unauthorized", 401);
    if (!(await (uni ? managesUniversity : manages)(env, user, id))) return fail("forbidden", 403);
    let b = null; try { b = await req.json(); } catch { /* فارغ */ }
    if (!b || typeof b !== "object") return fail("bad_request", 400);
    const now = (opts.now || Date.now)();
    if (b.remove === true) { await env.DB.prepare(`DELETE FROM ${T} WHERE ${K}=?`).bind(id).run(); return json({ ok: true }); }
    const mm = typeof b.image === "string" && /^data:(image\/(?:png|jpeg|webp));base64,([A-Za-z0-9+/]+={0,2})$/.exec(b.image);
    if (!mm || mm[2].length > MAX_B64 || mm[2].length < 100) return fail("bad_image", 400);
    let head; try { head = atob(mm[2].slice(0, 8)); } catch { return fail("bad_image", 400); }
    if (!MAGIC[mm[1]].every((v, i) => head.charCodeAt(i) === v)) return fail("bad_image", 400);
    if (!(await env.DB.prepare(`SELECT 1 FROM ${OWNER} WHERE id=?`).bind(id).first())) return fail("not_found", 404);
    await env.DB.prepare(`INSERT INTO ${T}(${K},mime,data,updated_by,updated_at) VALUES(?,?,?,?,?) ON CONFLICT(${K}) DO UPDATE SET mime=excluded.mime,data=excluded.data,updated_by=excluded.updated_by,updated_at=excluded.updated_at`)
      .bind(id, mm[1], mm[2], user.id, now).run();
    return json({ ok: true, updated_at: now });
  } catch (e) {
    console.error("college-logo", String(e && e.message).slice(0, 200));
    return fail("server_error", 500);
  }
}
