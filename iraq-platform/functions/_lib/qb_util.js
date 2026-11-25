// functions/_lib/qb_util.js — أدوات مشتركة لواجهة بنك الأسئلة.
export const json = (data, status = 200, headers = {}) => new Response(JSON.stringify(data), { status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...headers } });
export const fail = (status, code, extra = {}) => json({ error: code, ...extra }, status);

export class HttpError extends Error { constructor(status, code, extra) { super(code); this.status = status; this.code = code; this.extra = extra || {}; } }

// الطلبات المغيّرة تأتي من نفس الموقع فقط (حماية CSRF؛ الكوكي SameSite=Lax أيضاً).
export const sameOrigin = (req) => { const o = req.headers.get("origin"); return !o || o === new URL(req.url).origin; };

export async function readJson(req, max = 262144) {
  if (!(req.headers.get("content-type") || "").includes("application/json")) throw new HttpError(415, "json_required");
  const len = Number(req.headers.get("content-length") || 0);
  if (len > max) throw new HttpError(413, "too_large");
  const text = await req.text();
  if (text.length > max) throw new HttpError(413, "too_large");
  try { const v = JSON.parse(text); if (v === null || typeof v !== "object") throw 0; return v; } catch { throw new HttpError(400, "bad_json"); }
}

export const toInt = (v, def, min = 0, max = Number.MAX_SAFE_INTEGER) => {
  const n = Number.parseInt(v, 10);
  return Number.isFinite(n) ? Math.min(max, Math.max(min, n)) : def;
};
export const posInt = (v) => { const n = Number(v); return Number.isSafeInteger(n) && n > 0 ? n : null; };

export async function sha256Hex(text) {
  const buf = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(text));
  return [...new Uint8Array(buf)].map((b) => b.toString(16).padStart(2, "0")).join("");
}
export const randomId = (bytes = 16) => [...crypto.getRandomValues(new Uint8Array(bytes))].map((b) => b.toString(16).padStart(2, "0")).join("");

// حد معدل بنافذة ثابتة. يعيد true إن سُمح بالطلب.
export async function rateLimit(env, userId, bucket, limit, windowMs, now = Date.now()) {
  const win = Math.floor(now / windowMs);
  const row = await env.DB.prepare("INSERT INTO qb_rate (user_id, bucket, win, n) VALUES (?,?,?,1) ON CONFLICT(user_id, bucket, win) DO UPDATE SET n = n + 1 RETURNING n").bind(userId, bucket, win).first();
  if (Math.random() < 0.01) await env.DB.prepare("DELETE FROM qb_rate WHERE win < ?").bind(win - 2).run().catch(() => {});
  return !row || row.n <= limit;
}

export const parseJson = (text, fallback) => { try { return text ? JSON.parse(text) : fallback; } catch { return fallback; } };
export const placeholders = (n) => Array.from({ length: n }, () => "?").join(",");
// IN (...) على دفعات حتى لا نتجاوز حدود المتغيرات.
export async function selectIn(env, sqlPrefix, ids, sqlSuffix = "", chunk = 80) {
  const out = [];
  for (let i = 0; i < ids.length; i += chunk) {
    const part = ids.slice(i, i + chunk);
    const r = await env.DB.prepare(`${sqlPrefix} (${placeholders(part.length)}) ${sqlSuffix}`).bind(...part).all();
    out.push(...(r.results || []));
  }
  return out;
}
export const audit = (env, actor, action, entity, entityId, detail = "") =>
  env.DB.prepare("INSERT INTO qb_audit (actor_id, action, entity, entity_id, detail, at) VALUES (?,?,?,?,?,?)").bind(actor, action, entity, String(entityId), String(detail).slice(0, 500), Date.now()).run();
