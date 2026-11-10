// functions/_lib/pdfnotes.js — مزامنة كتابة الطالب وتظليله وبطاقاته على ملفات PDF مع حسابه (Step 63، بطلب محمد 2026-10-19).
// كل طالب يقرأ ويكتب صفوفه فقط. الملف يُعرَّف ببصمة مساره (24 حرفاً سداسياً يحسبها المتصفح)، والجزء:
//   ink:<صفحة> (خطوط وتظليل ونصوص الصفحة) · study (بطاقات وملاحظات وأقنعة وأسئلة) · layout (هوامش وصفحات فارغة) · occl (أقنعة الحجب)
//
//   GET  /api/pdfnotes?doc=<معرّف>   صفوف الملف [{k, d, t}] + الاستهلاك
//   GET  /api/pdfnotes                الاستهلاك فقط
//   PUT  /api/pdfnotes                {doc, rows:[{k, d, base}]} حفظ بتفاؤل: base = t الذي قرأه الجهاز (أو null لصف جديد).
//                                     إن تغيّر الصف من جهاز آخر ← conflict بلا كتابة، ويدمج المتصفح عند فتح الصفحة التالية.
import { currentUser } from "./auth.js";

export const USER_LIMIT = 5 * 1024 * 1024;   // مجموع ما يحفظه الطالب (محارف)
const ROW_MAX = { ink: 400 * 1024, study: 800 * 1024, layout: 64 * 1024, occl: 400 * 1024 };
const MAX_ROWS = 60;
const MAX_BODY = 4 * 1024 * 1024;
// صور الكتابة (Step 66): حتى 3 ميغا للصورة بعد الضغط، 20 ميغا لكل الطالب، وتُقسَّم إلى أجزاء 48 كيلوبايت.
const ASSET_MAX = 3 * 1024 * 1024, ASSET_LIMIT = 20 * 1024 * 1024, PART = 48 * 1024;
const ASSET_TYPES = ["image/jpeg", "image/png"];
const validAsset = (s) => typeof s === "string" && /^img_[0-9a-f]{32}$/.test(s);

function json(body, status = 200) {
  return new Response(JSON.stringify(body), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" } });
}
const fail = (error, status, extra = {}) => json({ ok: false, error, ...extra }, status);
function sameOrigin(req) { const o = req.headers.get("origin"); return !o || o === new URL(req.url).origin; }
const notMigrated = (e) => /no such table|no such column/i.test(String(e && e.message));

export const validDoc = (s) => typeof s === "string" && /^[0-9a-f]{24}$/.test(s);
export function keyKind(k) {
  if (typeof k !== "string") return null;
  if (/^ink:(0|[1-9]\d{0,3})$/.test(k)) return "ink";
  return k === "study" || k === "layout" || k === "occl" ? k : null;
}

async function usage(env, userId) {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(LENGTH(d)), 0) AS bytes, COUNT(DISTINCT doc) AS docs FROM pdf_notes WHERE user_id = ?").bind(userId).first();
  return { bytes: (r && r.bytes) || 0, docs: (r && r.docs) || 0, limit: USER_LIMIT };
}

async function readDoc(env, me, doc) {
  const rows = ((await env.DB.prepare("SELECT k, d, t FROM pdf_notes WHERE user_id = ? AND doc = ? ORDER BY k").bind(me.id, doc).all()).results || []);
  return json({ ok: true, rows: rows.map((r) => ({ k: r.k, d: r.d, t: r.t })), usage: await usage(env, me.id) });
}

async function writeRows(req, env, me, now) {
  const text = await req.text();
  if (text.length > MAX_BODY) return fail("too_large", 413);
  let b; try { b = JSON.parse(text); } catch { b = null; }
  if (!b || !validDoc(b.doc) || !Array.isArray(b.rows) || !b.rows.length || b.rows.length > MAX_ROWS) return fail("bad_request", 400);
  const u = await usage(env, me.id);
  let total = u.bytes;
  const results = [];
  for (const r of b.rows) {
    const k = r && r.k, kind = keyKind(k);
    if (!kind) { results.push({ k: String(k).slice(0, 20), error: "bad_key" }); continue; }
    if (typeof r.d !== "string") { results.push({ k, error: "bad_data" }); continue; }
    if (r.d.length > ROW_MAX[kind]) { results.push({ k, error: "too_large" }); continue; }
    const base = Number.isInteger(r.base) ? r.base : null;
    const cur = await env.DB.prepare("SELECT t, LENGTH(d) AS n FROM pdf_notes WHERE user_id = ? AND doc = ? AND k = ?").bind(me.id, b.doc, k).first();
    const oldLen = cur ? cur.n : 0;
    if (total - oldLen + r.d.length > USER_LIMIT) { results.push({ k, error: "quota" }); continue; }
    const t = Math.max(now, (cur ? cur.t : 0) + 1);
    let changed = 0;
    if (!cur) {
      if (base !== null) { results.push({ k, conflict: true, t: 0 }); continue; }  // الصف غير موجود لكن الجهاز يظنه موجوداً
      const w = await env.DB.prepare("INSERT INTO pdf_notes (user_id, doc, k, d, t) VALUES (?, ?, ?, ?, ?) ON CONFLICT(user_id, doc, k) DO NOTHING").bind(me.id, b.doc, k, r.d, t).run();
      changed = (w.meta && w.meta.changes) || 0;
    } else if (base === cur.t) {
      const w = await env.DB.prepare("UPDATE pdf_notes SET d = ?, t = ? WHERE user_id = ? AND doc = ? AND k = ? AND t = ?").bind(r.d, t, me.id, b.doc, k, cur.t).run();
      changed = (w.meta && w.meta.changes) || 0;
    }
    if (!changed) { const now2 = await env.DB.prepare("SELECT t FROM pdf_notes WHERE user_id = ? AND doc = ? AND k = ?").bind(me.id, b.doc, k).first(); results.push({ k, conflict: true, t: now2 ? now2.t : 0 }); continue; }
    total += r.d.length - oldLen;
    results.push({ k, ok: true, t });
  }
  return json({ ok: true, results, usage: { bytes: total, docs: u.docs, limit: USER_LIMIT } });
}

function b64of(u8) { let s = ""; for (let i = 0; i < u8.length; i += 0x8000) s += String.fromCharCode.apply(null, u8.subarray(i, i + 0x8000)); return btoa(s); }
function u8of(b64) { const bin = atob(b64), u = new Uint8Array(bin.length); for (let i = 0; i < bin.length; i++) u[i] = bin.charCodeAt(i); return u; }

async function assetUsage(env, userId) {
  const r = await env.DB.prepare("SELECT COALESCE(SUM(LENGTH(d)), 0) AS bytes FROM pdf_assets WHERE user_id = ?").bind(userId).first();
  return (r && r.bytes) || 0;
}

// PUT /api/pdfnotes/asset?id=img_…  (جسم الطلب = بايتات الصورة، نوعها في content-type). الصورة تُحفظ مرة واحدة فقط: المعرّف بصمة محتواها.
async function putAsset(req, env, me, url) {
  const id = url.searchParams.get("id"), type = (req.headers.get("content-type") || "").split(";")[0].trim();
  if (!validAsset(id) || !ASSET_TYPES.includes(type)) return fail("bad_request", 400);
  const have = await env.DB.prepare("SELECT 1 AS x FROM pdf_assets WHERE user_id = ? AND id = ? LIMIT 1").bind(me.id, id).first();
  if (have) return json({ ok: true, dup: true });
  const buf = new Uint8Array(await req.arrayBuffer());
  if (!buf.length) return fail("bad_request", 400);
  if (buf.length > ASSET_MAX) return fail("too_large", 413);
  if ((await assetUsage(env, me.id)) + buf.length * 4 / 3 > ASSET_LIMIT) return fail("quota", 413);
  const b64 = b64of(buf), stmts = [];
  for (let i = 0, part = 0; i < b64.length; i += PART, part++) {
    stmts.push(env.DB.prepare("INSERT INTO pdf_assets (user_id, id, part, type, d) VALUES (?, ?, ?, ?, ?)").bind(me.id, id, part, type, b64.slice(i, i + PART)));
  }
  await env.DB.prepare("DELETE FROM pdf_assets WHERE user_id = ? AND id = ?").bind(me.id, id).run();
  for (let i = 0; i < stmts.length; i += 40) await env.DB.batch(stmts.slice(i, i + 40));
  return json({ ok: true, parts: stmts.length });
}

// GET /api/pdfnotes/asset?id=img_…  صور الطالب نفسه فقط
async function getAsset(env, me, url) {
  const id = url.searchParams.get("id");
  if (!validAsset(id)) return fail("bad_request", 400);
  const rows = ((await env.DB.prepare("SELECT part, type, d FROM pdf_assets WHERE user_id = ? AND id = ? ORDER BY part").bind(me.id, id).all()).results) || [];
  if (!rows.length) return fail("not_found", 404);
  const u = u8of(rows.map((r) => r.d).join(""));
  return new Response(u, { status: 200, headers: { "content-type": rows[0].type, "cache-control": "private, max-age=31536000, immutable" } });
}

export async function handlePdfNotes(req, env, opts = {}) {
  const url = new URL(req.url), p = url.pathname.replace(/\/+$/, "");
  if (p !== "/api/pdfnotes" && p !== "/api/pdfnotes/asset") return null;
  if (!env.DB) return fail("not_configured", 503);
  if (req.method !== "GET" && !sameOrigin(req)) return fail("forbidden", 403);
  const now = (opts.now || Date.now)();
  const me = await currentUser(req, env, now);
  if (!me) return fail("unauthorized", 401);
  try {
    if (p === "/api/pdfnotes/asset") {
      if (req.method === "GET") return await getAsset(env, me, url);
      if (req.method === "PUT") return await putAsset(req, env, me, url);
      return fail("not_found", 404);
    }
    if (req.method === "GET") {
      const doc = url.searchParams.get("doc");
      if (!doc) return json({ ok: true, usage: await usage(env, me.id) });
      if (!validDoc(doc)) return fail("bad_request", 400);
      return await readDoc(env, me, doc);
    }
    if (req.method === "PUT") return await writeRows(req, env, me, now);
    return fail("not_found", 404);
  } catch (e) {
    if (notMigrated(e)) return fail("not_migrated", 503);
    throw e;
  }
}
