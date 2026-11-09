// functions/_middleware.js — تقييد الموقع كله بتسجيل الدخول عند ضبط REQUIRE_LOGIN=1 (ويلزم ربط D1 باسم DB).
// بدونه يبقى الموقع مفتوحاً كما هو. يحمي الصفحات وملفات PDF لأن Cloudflare يشغّل هذا قبل الملفات الثابتة.
import { currentUser } from "./_lib/auth.js";

const OPEN = [/^\/(login|privacy|terms)\.html$/, /^\/css\//, /^\/js\//, /^\/assets\//, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/api\/auth\//];

export async function onRequest({ request, env, next }) {
  if (env.REQUIRE_LOGIN !== "1" || !env.DB) return next();
  const url = new URL(request.url);
  if (OPEN.some((re) => re.test(url.pathname))) return next();
  if (await currentUser(request, env)) return next();
  const wantsPage = request.method === "GET" && (request.headers.get("accept") || "").includes("text/html");
  if (wantsPage) {
    const back = encodeURIComponent(url.pathname + url.search);
    return Response.redirect(url.origin + "/login.html?next=" + back, 302);
  }
  return new Response(JSON.stringify({ ok: false, error: "unauthorized" }), {
    status: 401,
    headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store" }
  });
}
