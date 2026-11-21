// functions/_middleware.js — تقييد الموقع كله بتسجيل الدخول عند ضبط REQUIRE_LOGIN=1 (ويلزم ربط D1 باسم DB).
// بدونه يبقى الموقع مفتوحاً كما هو. يحمي الصفحات وملفات PDF لأن Cloudflare يشغّل هذا قبل الملفات الثابتة.
import { currentUser } from "./_lib/auth.js";
import { ensureSchema } from "./_lib/migrate.js";
import { serviceErrorResponse } from "./_lib/service-errors.js";

const OPEN = [/^\/(login|privacy|terms)\.html$/, /^\/css\//, /^\/js\//, /^\/assets\//, /^\/manifest\.webmanifest$/, /^\/sw\.js$/, /^\/api\/auth\//];

export async function onRequest({ request, env, next }) {
  try {
    return await route({ request, env, next });
  } catch (error) {
    return serviceErrorResponse(error);
  }
}

async function route({ request, env, next }) {
  // ترحيل قاعدة البيانات تلقائياً عند أول طلب API بعد النشر (لا يعطّل الموقع إن فشل)
  if (env.DB && new URL(request.url).pathname.startsWith("/api/")) await ensureSchema(env).catch(() => {});
  const path = new URL(request.url).pathname;
  if (request.method === "GET" && /^\/(?:pdf-notes|dafter)(?:\.html)?\/?$/.test(path)) {
    const user = await currentUser(request, env);
    if (user || env.REQUIRE_LOGIN !== "1" || !env.DB) {
      const response = await next();
      if (!response.ok || !response.headers.get("content-type")?.includes("text/html")) return response;
      const owner = user ? String(user.id) : "guest";
      const page = new HTMLRewriter().on("html", {
        element(el) { el.setAttribute("data-reader-owner", owner); }
      }).transform(response);
      page.headers.set("Cache-Control", "private, no-store");
      return page;
    }
  }
  if (env.REQUIRE_LOGIN !== "1" || !env.DB) return await next();
  const url = new URL(request.url);
  if (OPEN.some((re) => re.test(url.pathname))) return await next();
  if (await currentUser(request, env)) return await next();
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
