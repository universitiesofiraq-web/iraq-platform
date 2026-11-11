// Development 07 — group-scoped chat for Cloudflare Pages + D1.
// Explicit membership is mandatory. Invite secrets are revealed only when created/rotated.
import { currentUser } from "./auth.js";
import { policy } from "./scope.js";
import { manageGroupChat } from "./group_chat_moderation.js";
import { serviceErrorResponse } from "./service-errors.js";

const MAX_BODY = 2000;
const json = (body, status = 200) => new Response(JSON.stringify(body), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", "x-content-type-options": "nosniff" }
});
const fail = (error, status) => json({ ok: false, error }, status);
const idOf = (x) => Number.isSafeInteger(Number(x)) && Number(x) > 0 ? Number(x) : null;
const safeName = (x, max) => typeof x === "string" && x.trim().length > 0 && x.trim().length <= max ? x.trim() : null;

function sameOrigin(req) {
  const origin = req.headers.get("origin");
  const site = req.headers.get("sec-fetch-site");
  if (origin && origin !== new URL(req.url).origin) return false;
  if (site === "cross-site") return false;
  return !!origin || site === "same-origin" || site === "none";
}
async function bodyOf(req) {
  if (!(req.headers.get("content-type") || "").toLowerCase().includes("application/json")) return null;
  if (Number(req.headers.get("content-length") || 0) > 12000) return null;
  try { const text = await req.text(); return text.length <= 12000 ? JSON.parse(text) : null; } catch { return null; }
}
async function secret() {
  const bytes = crypto.getRandomValues(new Uint8Array(18));
  const code = Array.from(bytes, x => x.toString(16).padStart(2, "0")).join("");
  return { code, hash: await hashCode(code) };
}
async function hashCode(code) {
  const digest = await crypto.subtle.digest("SHA-256", new TextEncoder().encode(code));
  return Array.from(new Uint8Array(digest), x => x.toString(16).padStart(2, "0")).join("");
}
async function room(env, userId, groupId) {
  return env.DB.prepare(`SELECT g.id, g.name, g.stage_id, g.created_by, p.stage_id AS profile_stage_id
    FROM chat_groups g JOIN chat_members m ON m.group_id=g.id AND m.user_id=?
    LEFT JOIN user_profile p ON p.user_id=m.user_id
    WHERE g.id=? AND g.active=1`).bind(userId, groupId).first();
}

/* الاسم الظاهر والصورة (user_avatars، ترحيل 0022) بدل اسم Google إن وضعهما الطالب */
const msgSelect = `SELECT m.id, m.group_id, m.sender_id, COALESCE(NULLIF(av.display_name,''), u.name) AS sender, m.body, m.reply_to,
    p.body AS reply_body, COALESCE(NULLIF(pav.display_name,''), pu.name) AS reply_sender, p.deleted_at AS reply_deleted,
    m.created_at, m.edited_at, m.deleted_at, m.pinned_at, CASE WHEN av.avatar IS NULL THEN 0 ELSE av.updated_at END AS av
    FROM chat_messages m JOIN users u ON u.id=m.sender_id LEFT JOIN user_avatars av ON av.user_id=m.sender_id
    LEFT JOIN chat_messages p ON p.id=m.reply_to LEFT JOIN users pu ON pu.id=p.sender_id LEFT JOIN user_avatars pav ON pav.user_id=p.sender_id`;
/* مرفق داخل الرسالة: سطر أول "[[att]]{json}" (ملف من ملفات المنصة أو تبليغ). روابط داخلية فقط. */
const ATT = "[[att]]";
const ATT_HREF = /^(course\.html\?id=[A-Za-z0-9_-]{1,80}(&dept=\d{1,9})?(#lec-\d{1,4})?|api\/file\/[A-Za-z0-9_-]{1,80}|platform\.html\?dept=\d{1,9}(&stage=\d{1,2})?#(announcements|latest))$/;
export function cleanAttach(a) {
  if (!a || typeof a !== "object" || Array.isArray(a)) return null;
  const type = a.type === "file" || a.type === "announcement" ? a.type : null;
  const title = typeof a.title === "string" ? a.title.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 120) : "";
  const sub = typeof a.sub === "string" ? a.sub.replace(/[\u0000-\u001f]/g, " ").trim().slice(0, 160) : "";
  const href = typeof a.href === "string" && ATT_HREF.test(a.href) ? a.href : null;
  if (!type || !title || !href) return null;
  return { type, title, sub, href };
}
const formatMsg = (r) => ({ ...r, body: r.deleted_at ? null : r.body,
  reply_body: r.reply_deleted ? null : r.reply_body });
async function message(env, id) {
  const r = await env.DB.prepare(msgSelect + " WHERE m.id=?").bind(id).first();
  return r ? formatMsg(r) : null;
}
async function audit(env, groupId, messageId, actorId, action, now) {
  await env.DB.prepare("INSERT INTO chat_moderation_audit(group_id,message_id,actor_id,action,created_at) VALUES(?,?,?,?,?)")
    .bind(groupId, messageId, actorId, action, now).run();
}

/* بلا رمز دعوة: لكل مرحلة في كل قسم مجموعة افتراضية تُنشأ عند دخول أول طالب مؤكَّد، وينضم إليها الطالب المؤكَّد تلقائياً
   (إلا من رُفض أو أُلغيت عضويته من المشرف). العضوية تبقى مشروطة بمرحلة ملفه الشخصي. */
const DEFAULT_GROUP = "مجموعة المرحلة";
async function autoJoin(env, userId, now) {
  const p = await env.DB.prepare("SELECT stage_id FROM user_profile WHERE user_id=?").bind(userId).first();
  if (!p || !p.stage_id) return;
  const stage = p.stage_id;
  /* لا انضمام تلقائي إلا بعد أن يؤكّد ممثل المرحلة الطالب (student_verification)، فاختيار المرحلة وحده لا يكفي */
  const ok = await env.DB.prepare("SELECT 1 AS x FROM student_verification WHERE user_id=? AND stage_id=?").bind(userId, stage).first();
  if (!ok) return;
  const has = await env.DB.prepare("SELECT 1 AS x FROM chat_groups WHERE stage_id=? AND active=1 LIMIT 1").bind(stage).first();
  if (!has) {
    if (!(await env.DB.prepare("SELECT id FROM stages WHERE id=?").bind(stage).first())) return;
    const inv = await secret();
    await env.DB.prepare("INSERT OR IGNORE INTO chat_groups(stage_id,name,invite_hash,created_by,created_at) VALUES(?,?,?,?,?)")
      .bind(stage, DEFAULT_GROUP, inv.hash, userId, now).run();
  }
  await env.DB.prepare(`INSERT INTO chat_members(group_id,user_id,joined_at)
    SELECT g.id,?,? FROM chat_groups g
    WHERE g.stage_id=? AND g.active=1
      AND NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.group_id=g.id AND m.user_id=?)
      AND NOT EXISTS (SELECT 1 FROM chat_join_requests r WHERE r.group_id=g.id AND r.user_id=? AND r.status IN ('rejected','revoked'))`)
    .bind(userId, now, stage, userId, userId).run();
}

async function archiveBody(env, messageId, reason, now) {
  try {
    await env.DB.prepare("INSERT INTO chat_message_archive(message_id,body,reason,created_at) SELECT id,body,?,? FROM chat_messages WHERE id=? AND length(body)>0").bind(reason, now, messageId).run();
  } catch (_) { /* قبل تنفيذ 0017 لا نمنع الحذف */ }
}

export async function handleGroupChat(req, env, opts = {}) {
  const url = new URL(req.url);
  const match = /^\/api\/group-chat\/(rooms|create|join|manage|messages|send|edit|delete|pin|read|mute|rotate-code|report|silence)$/.exec(url.pathname.replace(/\/$/, ""));
  if (!match) return null;
  if (env.GROUP_CHAT_ENABLED !== "1") return fail("feature_disabled", 503);
  if (!env.DB) return fail("not_configured", 503);
  if (req.method !== "GET" && (req.method !== "POST" || !sameOrigin(req))) return fail("forbidden", 403);
  const user = await (opts.currentUser || currentUser)(req, env);
  if (!user) return fail("unauthorized", 401);
  const op = match[1];
  let accessPolicy;
  async function canManage(type, id) {
    accessPolicy ??= (opts.policy || policy)(env, user);
    return (await accessPolicy).manage(type, id);
  }
  const canAccessStage = (g) => g.profile_stage_id === g.stage_id || canManage("stage", g.stage_id);
  try {
    const now = (opts.now || Date.now)();
    if (op === "manage") {
      return await manageGroupChat(req, url, env.DB, user, id => canManage("stage", id),
        { json, fail, idOf, bodyOf, secret, now });
    }
    if (op === "rooms" && req.method === "GET") {
      if (env.GROUP_CHAT_AUTO !== "0") await autoJoin(env, user.id, now);
      const rows = await env.DB.prepare(`SELECT g.id, g.name, g.created_by, g.stage_id, p.stage_id AS profile_stage_id, s.number AS stage,
        d.id AS department_id, d.name_ar AS department, c.id AS college_id, c.name_ar AS college,
        u.id AS university_id, u.name_ar AS university, cm.muted,
        (SELECT COUNT(*) FROM chat_messages x WHERE x.group_id=g.id AND x.id>cm.last_read_id AND x.sender_id<>? AND x.deleted_at IS NULL) AS unread
        FROM chat_groups g JOIN chat_members cm ON cm.group_id=g.id
        LEFT JOIN user_profile p ON p.user_id=cm.user_id
        JOIN stages s ON s.id=g.stage_id JOIN departments d ON d.id=s.department_id
        JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id
        WHERE cm.user_id=? AND g.active=1 ORDER BY g.id DESC`)
        .bind(user.id, user.id).all();
      const items = [];
      for (const { profile_stage_id, ...item } of rows.results || []) {
        if (await canAccessStage({ stage_id: item.stage_id, profile_stage_id })) items.push(item);
      }
      const requests = await env.DB.prepare(`SELECT g.name, r.status FROM chat_join_requests r
        JOIN chat_groups g ON g.id=r.group_id JOIN user_profile p ON p.user_id=r.user_id AND p.stage_id=g.stage_id
        WHERE r.user_id=? AND r.status IN ('pending','rejected','revoked') AND g.active=1
        ORDER BY r.requested_at DESC LIMIT 25`).bind(user.id).all();
      return json({ ok: true, items, requests: requests.results || [] });
    }
    if (op === "messages" && req.method === "GET") {
      const groupId = idOf(url.searchParams.get("room_id"));
      if (!groupId) return fail("bad_request", 400);
      const g = await room(env, user.id, groupId);
      if (!g || !(await canAccessStage(g))) return fail("forbidden", 403);
      const after = url.searchParams.get("after");
      const before = url.searchParams.get("before");
      if (after !== null && before !== null) return fail("bad_request", 400);
      let rows;
      if (after !== null) {
        const cursor = Number(after);
        if (!Number.isSafeInteger(cursor) || cursor < 0) return fail("bad_request", 400);
        rows = await env.DB.prepare(msgSelect + " WHERE m.group_id=? AND m.id>? ORDER BY m.id ASC LIMIT 100")
          .bind(groupId, cursor).all();
        return json({ ok: true, items: (rows.results || []).map(formatMsg) });
      }
      if (before !== null && !idOf(before)) return fail("bad_request", 400);
      rows = before === null
        ? await env.DB.prepare(msgSelect + " WHERE m.group_id=? ORDER BY m.id DESC LIMIT 41").bind(groupId).all()
        : await env.DB.prepare(msgSelect + " WHERE m.group_id=? AND m.id<? ORDER BY m.id DESC LIMIT 41").bind(groupId, Number(before)).all();
      const list = rows.results || [];
      const page = { ok: true, items: list.slice(0, 40).reverse().map(formatMsg), has_more: list.length > 40 };
      if (before === null) {
        const revision = await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE group_id=? AND deleted_at IS NOT NULL")
          .bind(groupId).first();
        page.removed_count = revision.n;
      }
      return json(page);
    }
    const b = await bodyOf(req);
    if (!b || Array.isArray(b) || typeof b !== "object") return fail("bad_request", 400);
    if (op === "create") {
      const stageId = idOf(b.stage_id), name = safeName(b.name, 64);
      if (!stageId || !name) return fail("bad_request", 400);
      if (!(await canManage("stage", stageId))) return fail("forbidden", 403);
      if (!(await env.DB.prepare("SELECT id FROM stages WHERE id=?").bind(stageId).first())) return fail("not_found", 404);
      const invite = await secret();
      await env.DB.batch([
        env.DB.prepare("INSERT INTO chat_groups(stage_id,name,invite_hash,created_by,created_at) VALUES(?,?,?,?,?)").bind(stageId, name, invite.hash, user.id, now),
        env.DB.prepare("INSERT INTO chat_members(group_id,user_id,joined_at) SELECT id,?,? FROM chat_groups WHERE invite_hash=?").bind(user.id, now, invite.hash)
      ]);
      const g = await env.DB.prepare("SELECT id FROM chat_groups WHERE invite_hash=?").bind(invite.hash).first();
      return json({ ok: true, id: g.id, invite_code: invite.code }, 201);
    }
    if (op === "join") {
      const code = typeof b.invite_code === "string" ? b.invite_code.trim().toLowerCase() : "";
      if (!/^[0-9a-f]{36}$/.test(code)) return fail("bad_request", 400);
      const hash = await hashCode(code);
      const g = await env.DB.prepare(`SELECT g.id, g.stage_id, p.stage_id AS profile_stage_id
        FROM chat_groups g LEFT JOIN user_profile p ON p.user_id=?
        WHERE g.invite_hash=? AND g.active=1`).bind(user.id, hash).first();
      if (!g) return fail("invalid_invite", 404);
      const existing = await room(env, user.id, g.id);
      if (existing && await canAccessStage(existing)) return json({ ok: true, id: g.id, status: "member" });
      if (g.profile_stage_id !== g.stage_id) return fail("forbidden", 403);
      await env.DB.prepare(`INSERT INTO chat_join_requests(group_id,user_id,status,requested_at)
        SELECT g.id,p.user_id,'pending',? FROM chat_groups g JOIN user_profile p ON p.stage_id=g.stage_id
        WHERE g.id=? AND g.invite_hash=? AND g.active=1 AND p.user_id=?
          AND NOT EXISTS (SELECT 1 FROM chat_members m WHERE m.group_id=g.id AND m.user_id=p.user_id)
        ON CONFLICT(group_id,user_id) DO UPDATE SET status='pending',requested_at=excluded.requested_at,
          reviewed_by=NULL,reviewed_at=NULL WHERE chat_join_requests.status IN ('rejected','revoked')`)
        .bind(now, g.id, hash, user.id).run();
      const state = await env.DB.prepare(`SELECT r.status FROM chat_join_requests r JOIN chat_groups g ON g.id=r.group_id
        JOIN user_profile p ON p.user_id=r.user_id AND p.stage_id=g.stage_id
        WHERE r.group_id=? AND r.user_id=? AND g.invite_hash=? AND g.active=1`).bind(g.id, user.id, hash).first();
      if (state?.status === "approved") return json({ ok: true, id: g.id, status: "member" });
      if (state?.status !== "pending") return fail("invalid_invite", 404);
      return json({ ok: true, status: "pending" }, 202);
    }
    const groupId = idOf(b.room_id);
    if (!groupId) return fail("bad_request", 400);
    const g = await room(env, user.id, groupId);
    if (!g || !(await canAccessStage(g))) return fail("forbidden", 403);
    if (op === "send") {
      let body = typeof b.body === "string" ? b.body.trim().slice(0, MAX_BODY) : "";
      const clientId = String(b.client_id || "");
      if (body.startsWith(ATT)) body = body.replace(/^(\[\[att\]\])+/, ""); // لا يُقبل مرفق مزوّر داخل النص
      if (b.attach != null) {
        const att = cleanAttach(b.attach);
        if (!att) return fail("bad_request", 400);
        body = (ATT + JSON.stringify(att) + (body ? "\n" + body : "")).slice(0, MAX_BODY);
      }
      if (!body || !/^[a-zA-Z0-9-]{16,64}$/.test(clientId)) return fail("bad_request", 400);
      const duplicate = await env.DB.prepare("SELECT id FROM chat_messages WHERE sender_id=? AND client_id=?").bind(user.id, clientId).first();
      if (duplicate) {
        const old = await message(env, duplicate.id);
        return old && old.group_id === groupId ? json({ ok: true, item: old, deduplicated: true }) : fail("duplicate_client_id", 409);
      }
      if (b.reply_to != null) {
        const parentId = idOf(b.reply_to);
        if (!parentId) return fail("bad_request", 400);
        const parent = await env.DB.prepare("SELECT group_id, deleted_at FROM chat_messages WHERE id=?").bind(parentId).first();
        if (!parent || parent.group_id !== groupId || parent.deleted_at) return fail("bad_reply", 400);
      }
      const sil = await env.DB.prepare("SELECT until_at FROM chat_silence WHERE group_id=? AND user_id=?").bind(groupId, user.id).first().catch(() => null);
      if (sil && sil.until_at > now) return fail("silenced", 403);
      const hourly = await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_messages WHERE sender_id=? AND created_at>?").bind(user.id, now - 3600000).first();
      if (hourly && hourly.n >= 120) return fail("slow_down", 429);
      const recent = await env.DB.prepare("SELECT created_at FROM chat_messages WHERE sender_id=? ORDER BY id DESC LIMIT 1").bind(user.id).first();
      if (recent && now - recent.created_at < 1200) return fail("slow_down", 429);
      const ins = await env.DB.prepare("INSERT INTO chat_messages(group_id,sender_id,client_id,body,reply_to,created_at) VALUES(?,?,?,?,?,?)")
        .bind(groupId, user.id, clientId, body, b.reply_to == null ? null : Number(b.reply_to), now).run();
      return json({ ok: true, item: await message(env, Number(ins.meta.last_row_id)) }, 201);
    }
    if (op === "read" || op === "mute") {
      if (op === "mute") {
        if (typeof b.muted !== "boolean") return fail("bad_request", 400);
        await env.DB.prepare("UPDATE chat_members SET muted=? WHERE group_id=? AND user_id=?")
          .bind(b.muted ? 1 : 0, groupId, user.id).run();
      } else {
        const last = Number(b.last_read_id);
        if (!Number.isSafeInteger(last) || last < 0) return fail("bad_request", 400);
        const valid = last === 0 || await env.DB.prepare("SELECT id FROM chat_messages WHERE id=? AND group_id=?")
          .bind(last, groupId).first();
        if (!valid) return fail("bad_request", 400);
        await env.DB.prepare(`UPDATE chat_members SET last_read_id=MAX(last_read_id,?) WHERE group_id=? AND user_id=?`)
          .bind(last, groupId, user.id).run();
      }
      return json({ ok: true });
    }
    if (op === "rotate-code") {
      if (!(await canManage("stage", g.stage_id))) return fail("forbidden", 403);
      const inv = await secret();
      await env.DB.prepare("UPDATE chat_groups SET invite_hash=? WHERE id=?").bind(inv.hash, groupId).run();
      return json({ ok: true, invite_code: inv.code });
    }
    if (op === "silence") {
      if (!(await canManage("stage", g.stage_id))) return fail("forbidden", 403);
      const target = idOf(b.user_id), mins = Math.min(Math.max(Number(b.minutes) || 0, 0), 60 * 24 * 30);
      if (!target || target === user.id) return fail("bad_request", 400);
      if (!mins) await env.DB.prepare("DELETE FROM chat_silence WHERE group_id=? AND user_id=?").bind(groupId, target).run();
      else await env.DB.prepare("INSERT OR REPLACE INTO chat_silence(group_id,user_id,until_at,set_by,created_at) VALUES(?,?,?,?,?)").bind(groupId, target, now + mins * 60000, user.id, now).run();
      await audit(env, groupId, null, user.id, mins ? "silence:" + target : "unsilence:" + target, now);
      return json({ ok: true });
    }
    const messageId = idOf(b.message_id);
    if (!messageId) return fail("bad_request", 400);
    const m = await env.DB.prepare("SELECT id, group_id, sender_id, created_at, deleted_at, pinned_at FROM chat_messages WHERE id=?")
      .bind(messageId).first();
    if (!m || m.group_id !== groupId) return fail("not_found", 404);
    if (op === "report") {
      if (m.deleted_at) return fail("not_found", 404);
      const reason = safeName(b.reason, 500);
      if (!reason) return fail("bad_request", 400);
      const rc = await env.DB.prepare("SELECT COUNT(*) AS n FROM chat_reports WHERE reporter_id=? AND created_at>?").bind(user.id, now - 86400000).first();
      if (rc && rc.n >= 20) return fail("slow_down", 429);
      await env.DB.prepare("INSERT OR IGNORE INTO chat_reports(message_id,reporter_id,reason,created_at) VALUES(?,?,?,?)")
        .bind(messageId, user.id, reason, now).run();
      return json({ ok: true });
    }
    const canMod = await canManage("stage", g.stage_id);
    const ownRecent = m.sender_id === user.id && now - m.created_at <= 15 * 60 * 1000;
    if (op === "edit") {
      if (m.deleted_at || !ownRecent) return fail("forbidden", 403);
      const newBody = safeName(b.body, MAX_BODY);
      if (!newBody) return fail("bad_request", 400);
      await archiveBody(env, messageId, "edit", now);
      await env.DB.prepare("UPDATE chat_messages SET body=?,edited_at=? WHERE id=?").bind(newBody, now, messageId).run();
      return json({ ok: true, item: await message(env, messageId) });
    }
    if (op === "delete") {
      if (m.deleted_at || (!ownRecent && !canMod)) return fail("forbidden", 403);
      await archiveBody(env, messageId, "delete", now);
      await env.DB.prepare("UPDATE chat_messages SET body='',deleted_at=?,pinned_at=NULL,pinned_by=NULL WHERE id=?")
        .bind(now, messageId).run();
      await audit(env, groupId, messageId, user.id, "delete", now);
      return json({ ok: true, item: await message(env, messageId) });
    }
    if (op === "pin") {
      if (m.deleted_at || !canMod || typeof b.pinned !== "boolean") return fail("forbidden", 403);
      await env.DB.prepare("UPDATE chat_messages SET pinned_at=?,pinned_by=? WHERE id=?")
        .bind(b.pinned ? now : null, b.pinned ? user.id : null, messageId).run();
      await audit(env, groupId, messageId, user.id, b.pinned ? "pin" : "unpin", now);
      return json({ ok: true, item: await message(env, messageId) });
    }
    return fail("not_found", 404);
  } catch (err) {
    if (/unique constraint|SQLITE_CONSTRAINT_UNIQUE|UNIQUE constraint failed/i.test(String(err))) return fail("conflict", 409);
    return serviceErrorResponse(err);
  }
}
