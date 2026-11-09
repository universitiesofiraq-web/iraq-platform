// functions/api/[[path]].js — نقطة دخول Cloudflare Pages Functions لمسارات /api/*.
// يتطلب ربط KV باسم LECTURES وسرّ UPLOAD_CODES من لوحة Cloudflare. بدون الربط: القائمة فارغة وبقية المسارات 503.
import { handle } from "../../netlify/lib/core.mjs";
import { kvStore } from "../_lib/kvstore.js";
import { handleAuth, uploadAccount } from "../_lib/auth.js";

export async function onRequest({ request, env }) {
  const authRes = await handleAuth(request, env, { ip: request.headers.get("CF-Connecting-IP") || "" });
  if (authRes) return authRes;
  if (!env.LECTURES) {
    const path = new URL(request.url).pathname;
    if (path.endsWith("/api/uploads.js")) {
      return new Response("window.UPLOADS = [];", {
        headers: { "content-type": "application/javascript; charset=utf-8", "cache-control": "no-store" }
      });
    }
    return new Response(JSON.stringify({ error: "not_configured" }), {
      status: 503,
      headers: { "content-type": "application/json; charset=utf-8" }
    });
  }
  return handle(request, {
    store: kvStore(env.LECTURES),
    env: (k) => env[k],
    ip: request.headers.get("CF-Connecting-IP") || "",
    now: () => Date.now(),
    account: uploadAccount(env) // رفع بالحساب لدور رافع أو ممثل الدفعة أو مشرف
  });
}
