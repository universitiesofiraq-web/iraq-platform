// functions/_lib/avatar.js — صورة الطالب واسمه الظاهر في الدردشة والقائمة.
//   GET  /api/avatar/<id>          صورة JPEG (لمن سجّل الدخول فقط؛ تُخزَّن في المتصفح، والرابط فيه ?v=<updated_at>)
//   GET  /api/profile/public       {display_name, has_avatar, updated_at} للحساب الحالي
//   POST /api/profile/public       {name?} أو {image?: "data:image/jpeg;base64,..."} أو {remove: true}
// لا يغيّر الاسم الحقيقي ولا رقم الجواز ولا بيانات الدرجات: هذا اسم عرض فقط.
import { currentUser } from "./auth.js";

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
});
const fail = (error, status) => json({ ok: false, error }, status);
const MAX_B64 = 90000;                   // نحو 67KB بعد فك الترميز
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u001f\u007f‎‏‪-‮⁦-⁩]/g, "").replace(/\s+/g, " ").trim().slice(0, n);

export async function handleAvatar(req, env, opts = {}) {
  const url = new URL(req.url);
  const path = url.pathname.replace(/\/+$/, "");
  const img = /^\/api\/avatar\/(\d{1,12})$/.exec(path);
  const isPub = path === "/api/profile/public";
  if (!img && !isPub) return null;
  if (!env.DB) return fail("not_configured", 503);
  const now = (opts.now || Date.now)();
  const user = await (opts.currentUser || currentUser)(req, env, now);
  if (!user) return fail("unauthorized", 401);

  try {
    if (img && req.method === "GET") {
      const row = await env.DB.prepare("SELECT avatar FROM user_avatars WHERE user_id=?").bind(Number(img[1])).first();
      if (!row || !row.avatar) return new Response("", { status: 404, headers: { "cache-control": "no-store" } });
      const bin = Uint8Array.from(atob(row.avatar), (c) => c.charCodeAt(0));
      return new Response(bin, { headers: { "content-type": "image/jpeg", "cache-control": "private, max-age=604800", "x-content-type-options": "nosniff" } });
    }
    if (!isPub) return fail("not_found", 404);
    if (req.method === "GET") {
      const row = await env.DB.prepare("SELECT display_name, avatar IS NOT NULL AS has, updated_at FROM user_avatars WHERE user_id=?").bind(user.id).first();
      return json({ ok: true, display_name: (row && row.display_name) || "", has_avatar: !!(row && row.has), updated_at: (row && row.updated_at) || 0 });
    }
    if (req.method !== "POST") return fail("not_found", 404);
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return fail("forbidden", 403);
    let b = null;
    try { b = await req.json(); } catch { /* فارغ */ }
    if (!b || typeof b !== "object") return fail("bad_request", 400);
    const cur = await env.DB.prepare("SELECT updated_at FROM user_avatars WHERE user_id=?").bind(user.id).first();
    if (cur && now - cur.updated_at < 3000) return fail("slow_down", 429);

    if (b.remove === true) {
      await env.DB.prepare("UPDATE user_avatars SET avatar=NULL, updated_at=? WHERE user_id=?").bind(now, user.id).run();
      return json({ ok: true, updated_at: now });
    }
    if (typeof b.image === "string") {
      const m = /^data:image\/jpeg;base64,([A-Za-z0-9+/]+={0,2})$/.exec(b.image);
      if (!m || m[1].length > MAX_B64 || m[1].length < 100) return fail("bad_image", 400);
      let head;
      try { head = atob(m[1].slice(0, 8)); } catch { return fail("bad_image", 400); }
      if (head.charCodeAt(0) !== 0xff || head.charCodeAt(1) !== 0xd8 || head.charCodeAt(2) !== 0xff) return fail("bad_image", 400);
      await env.DB.prepare("INSERT INTO user_avatars(user_id, avatar, updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET avatar=excluded.avatar, updated_at=excluded.updated_at")
        .bind(user.id, m[1], now).run();
      return json({ ok: true, updated_at: now });
    }
    if (typeof b.name === "string") {
      const name = clean(b.name, 30);
      if (name.length === 1 || (b.name.trim() && !name)) return fail("bad_name", 400);
      await env.DB.prepare("INSERT INTO user_avatars(user_id, display_name, updated_at) VALUES(?,?,?) ON CONFLICT(user_id) DO UPDATE SET display_name=excluded.display_name, updated_at=excluded.updated_at")
        .bind(user.id, name || null, now).run();
      return json({ ok: true, display_name: name, updated_at: now });
    }
    return fail("bad_request", 400);
  } catch (e) {
    console.error("avatar", String(e && e.message).slice(0, 200));
    return fail("server", 500);
  }
}
