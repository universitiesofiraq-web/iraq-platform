import { currentUser } from "../../_lib/auth.js";

function json(body, status, headers = {}) {
  return new Response(JSON.stringify(body), {
    status,
    headers: {
      "Content-Type": "application/json; charset=utf-8",
      "Cache-Control": "private, no-store",
      "X-Content-Type-Options": "nosniff",
      ...headers
    }
  });
}

export async function onRequest({ request, env }) {
  if (request.method !== "GET") {
    return json({ ok: false, error: "method_not_allowed" }, 405, { Allow: "GET" });
  }
  if (!env.DB) return json({ ok: false, error: "not_configured" }, 503);

  try {
    const user = await currentUser(request, env);
    if (!user) return json({ ok: false, error: "unauthorized" }, 401);
    return json({ ok: true, user: { id: user.id, name: user.name } }, 200);
  } catch {
    return json({ ok: false, error: "session_unavailable" }, 503);
  }
}
