// functions/_lib/auth.js — الدخول بحساب Google ومزامنة بيانات الطالب على Cloudflare D1.
// يحتاج ربط D1 باسم DB ومتغير GOOGLE_CLIENT_ID. اختياري: ADMIN_EMAILS (بريد المشرفين مفصولاً بفاصلة)،
// REQUIRE_LOGIN=1 (يقيّد الموقع كله؛ يطبّقه functions/_middleware.js).
// المسارات: GET /api/auth/config، POST /api/auth/google|logout، GET /api/auth/me، GET|PUT /api/sync،
//           GET /api/auth/users وPOST /api/auth/user (للمشرف فقط: إيقاف/تفعيل وتعيين الدور).
//           GET /api/announcements (عام)، POST /api/announcements وPOST /api/announcements/delete (ممثل الدفعة أو المشرف).
// الأدوار: student (الأصل) | uploader (رفع الملفات) | rep (ممثل الدفعة: رفع + تبليغات) | admin (من ADMIN_EMAILS).

import { handleScopes, policy, userScopes, isAdminUser } from "./scope.js";

export const SYNC_KEYS = ["ms.fav", "ms.read", "ms.last", "ms.exam", "ms.review", "ms.study", "iq.dept"];
export const ROLES = ["student", "uploader", "rep"];          // يعيّنها المشرف؛ admin يأتي من ADMIN_EMAILS فقط
export const UPLOAD_ROLES = ["uploader", "rep", "admin"];
export const ANNOUNCE_ROLES = ["admin"]; // التبليغات عامة للمنصة: للمشرف العام فقط (الممثل مقيّد بنطاقه)
const MAX_TITLE = 120;
const MAX_BODY = 2000;
const SESSION_MS = 30 * 24 * 3600 * 1000;
const MAX_VALUE = 200 * 1024;
const COOKIE = "ms_session";

const enc = new TextEncoder();
const hex = (u8) => Array.from(u8, (b) => b.toString(16).padStart(2, "0")).join("");
const unhex = (s) => Uint8Array.from(s.match(/../g) || [], (h) => parseInt(h, 16));
async function sha(s) { return hex(new Uint8Array(await crypto.subtle.digest("SHA-256", enc.encode(s)))); }
function b64u(str) {
  const b = atob(str.replace(/-/g, "+").replace(/_/g, "/").padEnd(Math.ceil(str.length / 4) * 4, "="));
  return Uint8Array.from(b, (c) => c.charCodeAt(0));
}
const dec = new TextDecoder();
const rand = (n) => hex(crypto.getRandomValues(new Uint8Array(n)));

function json(body, status = 200, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers }
  });
}
const fail = (error, status) => json({ ok: false, error }, status);

function cookieHeader(token, req, maxAge) {
  const secure = new URL(req.url).protocol === "https:" ? "; Secure" : "";
  return `${COOKIE}=${token}; Path=/; HttpOnly; SameSite=Lax; Max-Age=${maxAge}${secure}`;
}
export function readCookie(req) {
  const m = (req.headers.get("cookie") || "").match(new RegExp("(?:^|; )" + COOKIE + "=([0-9a-f]{64})"));
  return m ? m[1] : null;
}

/* المستخدم الحالي من الجلسة، أو null */
export async function currentUser(req, env, now = Date.now()) {
  const token = readCookie(req);
  if (!token || !env.DB) return null;
  const row = await env.DB.prepare(
    "SELECT u.id, u.email, u.name, u.role, u.active FROM sessions s JOIN users u ON u.id = s.user_id WHERE s.token_hash = ? AND s.expires_at > ?"
  ).bind(await sha(token), now).first();
  return row && row.active ? row : null;
}

async function startSession(env, userId, req, now) {
  const token = rand(32);
  await env.DB.prepare("INSERT INTO sessions (token_hash, user_id, expires_at) VALUES (?, ?, ?)")
    .bind(await sha(token), userId, now + SESSION_MS).run();
  await env.DB.prepare("DELETE FROM sessions WHERE expires_at < ?").bind(now).run();
  return cookieHeader(token, req, SESSION_MS / 1000);
}

const publicUser = (u) => ({ id: u.id, email: u.email, name: u.name, role: u.role });
const adminList = (env) => String(env.ADMIN_EMAILS || "").toLowerCase().split(",").map((x) => x.trim()).filter(Boolean);

async function readJson(req) {
  if (!(req.headers.get("content-type") || "").includes("application/json")) return null;
  try { return await req.json(); } catch { return null; }
}

/* حماية CSRF: الطلبات المغيّرة يجب أن تأتي من نفس الموقع */
function sameOrigin(req) {
  const o = req.headers.get("origin");
  return !o || o === new URL(req.url).origin;
}

/* ---------- التحقق من رمز Google (ID token) ---------- */
const CERTS_URL = "https://www.googleapis.com/oauth2/v3/certs";
let certCache = { keys: null, exp: 0 };
async function googleKeys(opts, now) {
  if (certCache.keys && certCache.exp > now) return certCache.keys;
  const res = await (opts.fetch || fetch)(CERTS_URL);
  if (!res.ok) throw new Error("certs_unavailable");
  const keys = (await res.json()).keys || [];
  certCache = { keys, exp: now + 3600 * 1000 };
  return keys;
}

export async function verifyGoogleToken(token, clientId, opts = {}, now = Date.now()) {
  const parts = String(token || "").split(".");
  if (parts.length !== 3 || !clientId) return null;
  let header, payload;
  try {
    header = JSON.parse(dec.decode(b64u(parts[0])));
    payload = JSON.parse(dec.decode(b64u(parts[1])));
  } catch { return null; }
  if (header.alg !== "RS256" || !header.kid) return null;
  let keys = await googleKeys(opts, now);
  let jwk = keys.find((k) => k.kid === header.kid);
  if (!jwk) { certCache = { keys: null, exp: 0 }; keys = await googleKeys(opts, now); jwk = keys.find((k) => k.kid === header.kid); }
  if (!jwk) return null;
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64u(parts[2]), enc.encode(parts[0] + "." + parts[1]));
  if (!ok) return null;
  if (payload.iss !== "https://accounts.google.com" && payload.iss !== "accounts.google.com") return null;
  if (payload.aud !== clientId) return null;
  if (typeof payload.exp !== "number" || payload.exp * 1000 <= now) return null;
  if (payload.email_verified !== true && payload.email_verified !== "true") return null;
  if (typeof payload.sub !== "string" || !payload.sub || typeof payload.email !== "string") return null;
  return payload;
}

async function googleLogin(req, env, now, opts) {
  if (!env.GOOGLE_CLIENT_ID) return fail("not_configured", 503);
  const b = await readJson(req);
  if (!b || typeof b.credential !== "string") return fail("bad_request", 400);
  let p;
  try { p = await verifyGoogleToken(b.credential, env.GOOGLE_CLIENT_ID, opts, now); } catch { return fail("google_unavailable", 502); }
  if (!p) return fail("bad_token", 401);
  const email = p.email.toLowerCase();
  const name = String(p.name || email.split("@")[0]).trim().slice(0, 60) || "المنصة العراقية";
  const isAdmin = adminList(env).includes(email);

  let u = await env.DB.prepare("SELECT * FROM users WHERE google_sub = ?").bind(p.sub).first();
  if (!u) {
    const r = await env.DB.prepare("INSERT INTO users (google_sub, email, name, role, active, created_at) VALUES (?, ?, ?, ?, 1, ?)")
      .bind(p.sub, email, name, isAdmin ? "admin" : "student", now).run();
    u = { id: r.meta && r.meta.last_row_id, email, name, role: isAdmin ? "admin" : "student", active: 1 };
  } else {
    if (!u.active) return fail("disabled", 403);
    // Revoke any previously stored admin role when removed from ADMIN_EMAILS.
    const role = isAdmin ? "admin" : u.role === "admin" ? "student" : u.role;
    await env.DB.prepare("UPDATE users SET email = ?, name = ?, role = ? WHERE id = ?").bind(email, name, role, u.id).run();
    u = { ...u, email, name, role };
  }
  const cookie = await startSession(env, u.id, req, now);
  return json({ ok: true, user: publicUser(u) }, 200, { "set-cookie": cookie });
}

async function logout(req, env) {
  const token = readCookie(req);
  if (token) await env.DB.prepare("DELETE FROM sessions WHERE token_hash = ?").bind(await sha(token)).run();
  return json({ ok: true }, 200, { "set-cookie": cookieHeader("", req, 0) });
}

async function syncGet(user, env) {
  const rows = await env.DB.prepare("SELECT k, v, t FROM user_data WHERE user_id = ?").bind(user.id).all();
  const data = {};
  for (const r of rows.results || []) {
    try { data[r.k] = { v: JSON.parse(r.v), t: r.t }; } catch { /* قيمة تالفة تُهمل */ }
  }
  return json({ ok: true, data });
}

async function syncPut(req, user, env) {
  const b = await readJson(req);
  if (!b || typeof b.items !== "object" || !b.items) return fail("bad_request", 400);
  const stmts = [];
  for (const k of Object.keys(b.items)) {
    if (!SYNC_KEYS.includes(k)) continue;
    const it = b.items[k];
    if (!it || typeof it.t !== "number") continue;
    const v = JSON.stringify(it.v === undefined ? null : it.v);
    if (v.length > MAX_VALUE) return fail("too_large", 413);
    // الأحدث يفوز: لا نكتب فوق قيمة أحدث منها
    stmts.push(env.DB.prepare(
      "INSERT INTO user_data (user_id, k, v, t) VALUES (?, ?, ?, ?) ON CONFLICT(user_id, k) DO UPDATE SET v = excluded.v, t = excluded.t WHERE excluded.t > user_data.t"
    ).bind(user.id, k, v, Math.floor(it.t)));
  }
  if (stmts.length) await env.DB.batch(stmts);
  return syncGet(user, env);
}

async function adminUsers(env) {
  const rows = await env.DB.prepare("SELECT id, email, name, role, active, created_at FROM users ORDER BY id").all();
  const admins = new Set(adminList(env));
  const users = (rows.results || []).map((u) => ({
    ...u,
    role: admins.has(String(u.email || "").toLowerCase()) ? "admin" : u.role === "admin" ? "student" : u.role
  }));
  return json({ ok: true, users });
}

async function adminUpdate(req, env) {
  const b = await readJson(req);
  if (!b || !Number.isInteger(b.id)) return fail("bad_request", 400);
  const target = await env.DB.prepare("SELECT email FROM users WHERE id = ?").bind(b.id).first();
  if (!target) return fail("not_found", 404);
  // Neither role nor active state of listed administrators may be edited here.
  if (adminList(env).includes(String(target.email || "").toLowerCase())) return fail("admin_locked", 409);
  if (b.role !== undefined) {
    if (!ROLES.includes(b.role)) return fail("bad_role", 400);
    await env.DB.prepare("UPDATE users SET role = ? WHERE id = ?").bind(b.role, b.id).run();
  }
  if (typeof b.active === "boolean") {
    await env.DB.prepare("UPDATE users SET active = ? WHERE id = ?").bind(b.active ? 1 : 0, b.id).run();
    if (!b.active) await env.DB.prepare("DELETE FROM sessions WHERE user_id = ?").bind(b.id).run();
  }
  return json({ ok: true });
}

/* ---------- التبليغات ---------- */
async function announcementsList(env) {
  if (!env.DB) return json({ ok: true, items: [] });
  const rows = await env.DB.prepare("SELECT id, title, body, author_name, created_at FROM announcements ORDER BY created_at DESC, id DESC LIMIT 30").all();
  const items = (rows.results || []).map((r) => ({ id: r.id, title: r.title, body: r.body, by: r.author_name, at: r.created_at }));
  return json({ ok: true, items });
}

async function announcementAdd(req, user, env, now) {
  const b = await readJson(req);
  if (!b) return fail("bad_request", 400);
  const title = String(b.title || "").trim();
  const body = String(b.body || "").trim();
  if (!title || title.length > MAX_TITLE || body.length > MAX_BODY) return fail("bad_request", 400);
  const r = await env.DB.prepare("INSERT INTO announcements (title, body, author_id, author_name, created_at) VALUES (?, ?, ?, ?, ?)")
    .bind(title, body, user.id, user.name, now).run();
  return json({ ok: true, id: r.meta && r.meta.last_row_id });
}

async function announcementDelete(req, env) {
  const b = await readJson(req);
  if (!b || !Number.isInteger(b.id)) return fail("bad_request", 400);
  await env.DB.prepare("DELETE FROM announcements WHERE id = ?").bind(b.id).run();
  return json({ ok: true });
}

/* رفع بالحساب: يستعمله core.mjs عبر deps.account. الدور رافع أو ممثل أو مشرف، وطلبات POST من نفس الموقع فقط */
export function uploadAccount(env) {
  return async (req) => {
    if (!env.DB) return null;
    const o = req.headers.get("origin");
    if (req.method !== "GET" && o && o !== new URL(req.url).origin) return null;
    const u = await currentUser(req, env);
    if (!u) return null;
    const pol = await policy(env, u);
    const anyRep = pol.scopes.some((s) => s.level === "rep");
    if (!pol.admin && !pol.scopes.length) return null;
    return {
      name: u.name,
      role: pol.admin ? "admin" : anyRep ? "rep" : "uploader",
      can: (courseId) => pol.manageCourse(courseId),
      canUpload: (courseId) => pol.upload(courseId)
    };
  };
}

/* نقطة الدخول: يعيد null إن لم يكن المسار من اختصاصه */
export async function handleAuth(req, env, opts = {}) {
  const url = new URL(req.url);
  const p = url.pathname.replace(/\/+$/, "");
  const isAnn = p === "/api/announcements" || p === "/api/announcements/delete";
  if (!p.startsWith("/api/auth/") && p !== "/api/sync" && !isAnn) return null;
  const now = (opts.now || Date.now)();
  if (p === "/api/announcements" && req.method === "GET") return announcementsList(env);
  if (p === "/api/auth/config" && req.method === "GET") return json({ ok: true, googleClientId: env.GOOGLE_CLIENT_ID || "", ready: !!(env.DB && env.GOOGLE_CLIENT_ID) });
  if (!env.DB) return fail("not_configured", 503);

  if (req.method !== "GET" && !sameOrigin(req)) return fail("forbidden", 403);

  if (p === "/api/auth/google" && req.method === "POST") return googleLogin(req, env, now, opts);
  if (p === "/api/auth/logout" && req.method === "POST") return logout(req, env);

  const user = await currentUser(req, env, now);
  if (p === "/api/auth/me" && req.method === "GET") {
    if (!user) return fail("unauthorized", 401);
    const sc = await userScopes(env, user.id);
    return json({ ok: true, user: { ...publicUser(user), scopes: sc, admin: isAdminUser(user, env) } });
  }
  if (!user) return fail("unauthorized", 401);

  if (p === "/api/sync" && req.method === "GET") return syncGet(user, env);
  if (p === "/api/sync" && req.method === "PUT") return syncPut(req, user, env);

  if (isAnn && req.method === "POST") {
    if (!isAdminUser(user, env)) return fail("forbidden", 403);
    return p === "/api/announcements" ? announcementAdd(req, user, env, now) : announcementDelete(req, env);
  }

  if (p === "/api/auth/scopes" || p === "/api/auth/scope" || p.startsWith("/api/auth/rep-request")) {
    const r = await handleScopes(req, env, user, p);
    if (r) return r;
  }

  if (!isAdminUser(user, env)) return fail("forbidden", 403);
  if (p === "/api/auth/users" && req.method === "GET") return adminUsers(env);
  if (p === "/api/auth/user" && req.method === "POST") return adminUpdate(req, env);
  return fail("not_found", 404);
}
