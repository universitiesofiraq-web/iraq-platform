// functions/api/[[path]].js — نقطة دخول Cloudflare Pages Functions لمسارات /api/*.
// يتطلب ربط KV باسم LECTURES وسرّ UPLOAD_CODES من لوحة Cloudflare. بدون الربط: القائمة فارغة وبقية المسارات 503.
import { handle } from "../../netlify/lib/core.mjs";
import { kvStore } from "../_lib/kvstore.js";
import { d1Manifest } from "../_lib/d1manifest.js";
import { handleAuth, uploadAccount, currentUser } from "../_lib/auth.js";
import { handlePdfNotes } from "../_lib/pdfnotes.js";
import { handleAi } from "../_lib/ai.js";
import { handleOnboarding } from "../_lib/onboarding.js";
import { handleAdminWorkspace } from "../_lib/admin-workspace.js";
import { handleUploadOptions } from "../_lib/upload-options.js";
import { handleCatalog } from "../_lib/catalog.js";
import { handleInvites } from "../_lib/invites.js";
import { handleGroupChat } from "../_lib/group_chat.js";
import { handleAvatar } from "../_lib/avatar.js";
import { handleCollegeLogo } from "../_lib/college_logo.js";
import { handleDm } from "../_lib/dm.js";

export async function onRequest({ request, env }) {
  const authRes = await handleAuth(request, env, { ip: request.headers.get("CF-Connecting-IP") || "" });
  if (authRes) return authRes;
  const onboardingRes = await handleOnboarding(request, env);
  if (onboardingRes) return onboardingRes;
  const workspaceRes = await handleAdminWorkspace(request, env);
  if (workspaceRes) return workspaceRes;
  const inviteRes = await handleInvites(request, env);
  if (inviteRes) return inviteRes;
  const uploadOptions = await handleUploadOptions(request, env);
  if (uploadOptions) return uploadOptions;
  const catRes = await handleCatalog(request, env);
  if (catRes) return catRes;
  const logoRes = await handleCollegeLogo(request, env, { currentUser }); // شعار الكلية
  if (logoRes) return logoRes;
  const avRes = await handleAvatar(request, env, { currentUser }); // صورة الطالب واسمه الظاهر (منقول من ميدكسا)
  if (avRes) return avRes;
  const dmRes = await handleDm(request, env, { currentUser }); // الرسائل الخاصة
  if (dmRes) return dmRes;
  const chatRes = await handleGroupChat(request, env, { currentUser });
  if (chatRes) return chatRes;
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
    manifest: env.DB ? d1Manifest(env.DB, env.LECTURES) : undefined, // القائمة في D1 (تُستورد من KV مرة واحدة)
    env: (k) => env[k],
    ip: request.headers.get("CF-Connecting-IP") || "",
    now: () => Date.now(),
    account: uploadAccount(env) // رفع بالحساب لدور رافع أو ممثل الدفعة أو مشرف
  });
}
