// functions/api/[[path]].js — نقطة دخول Cloudflare Pages Functions لمسارات /api/*.
// يتطلب ربط KV باسم LECTURES وسرّ UPLOAD_CODES من لوحة Cloudflare. بدون الربط: القائمة فارغة وبقية المسارات 503.
import { handle } from "../../netlify/lib/core.mjs";
import { kvStore } from "../_lib/kvstore.js";
import { handleAuth, uploadAccount, currentUser } from "../_lib/auth.js";
import { handlePdfNotes } from "../_lib/pdfnotes.js";
import { handleAi } from "../_lib/ai.js";
import { handleCatalog } from "../_lib/catalog.js";

export async function onRequest({ request, env }) {
  const authRes = await handleAuth(request, env, { ip: request.headers.get("CF-Connecting-IP") || "" });
  if (authRes) return authRes;
  const catRes = await handleCatalog(request, env);
  if (catRes) return catRes;
  const pnRes = await handlePdfNotes(request, env); // كتابة الطالب وتظليله على ملفات PDF: صفوفه هو فقط
  if (pnRes) return pnRes;
  const aiRes = await handleAi(request, env, { currentUser }); // ترجمة/شرح النص المحدد في قارئ PDF (يحتاج ربط Workers AI باسم AI)
  if (aiRes) return aiRes;
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
