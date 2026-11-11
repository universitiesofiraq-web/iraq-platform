// functions/_lib/dm.js — الرسائل الخاصة (منقولة من ميدكسا 2026-11-11). الطالب يراسل زملاء قسمه وممثليه، والممثل والمشرف يراسلان من في نطاقهما؛
// والرد مسموح دائماً في محادثة قائمة. لا إشعارات Push في هذه المنصة بعد.
//   GET  /api/dm/threads            محادثاتي (الأحدث أولاً) مع عدد غير المقروء
//   GET  /api/dm/messages?peer=ID&after=ID&since=T   رسائل محادثة (+ gone: المحذوفة منذ since)
//   GET  /api/dm/people?q=...       بحث عن طالب بالاسم الظاهر (حرفان فأكثر)
//   GET  /api/dm/staff              المشرفون والممثلون
//   GET  /api/dm/reports            (مشرف) بلاغات الرسائل الخاصة
//   POST /api/dm/send {peer, body} · read {peer} · delete {message_id} · block/unblock {peer} · report {message_id, reason}
// الخصوصية: لا يقرأ أحد محادثة غير محادثته. المشرف يرى نص الرسالة فقط إن أبلغ عنها أحد طرفيها.
import { currentUser } from "./auth.js";
import { isGlobalAdmin } from "./scope.js";

const json = (o, status = 200, extra = {}) => new Response(JSON.stringify(o), {
  status, headers: { "content-type": "application/json; charset=utf-8", "cache-control": "no-store", ...extra }
});
const fail = (error, status) => json({ ok: false, error }, status);
const MAX_BODY = 1000;
const clean = (s, n) => String(s == null ? "" : s).replace(/[\u0000-\u0008\u000b\u000c\u000e-\u001f‎‏‪-‮]/g, "").trim().slice(0, n);
const idOf = (v) => (Number.isSafeInteger(Number(v)) && Number(v) > 0 ? Number(v) : null);
const pair = (x, y) => (x < y ? [x, y] : [y, x]);
const short = (n) => String(n || "طالب").trim().split(/\s+/).slice(0, 2).join(" ");
/* اسم العرض: الاسم الظاهر إن وُجد وإلا أول كلمتين من اسم حساب Google */
const NAME = "COALESCE(NULLIF(av.display_name, ''), u.name)";
const PERSON = `u.id AS id, ${NAME} AS name, CASE WHEN av.avatar IS NULL THEN 0 ELSE av.updated_at END AS av`;
const person = (r) => r && ({ id: r.id, name: short(r.name), role: r.role || "student", av: r.av || 0 });
/* موقع الحساب: المرحلة والقسم والكلية والجامعة من ملفه الشخصي */
async function placeOf(db, uid) {
  return db.prepare(`SELECT p.stage_id AS st, s.department_id AS d, dp.college_id AS c, cl.university_id AS u
    FROM user_profile p LEFT JOIN stages s ON s.id=p.stage_id LEFT JOIN departments dp ON dp.id=s.department_id
    LEFT JOIN colleges cl ON cl.id=dp.college_id WHERE p.user_id=?`).bind(uid).first();
}
const COVER = "(s.type='stage' AND s.node_id=?) OR (s.type='department' AND s.node_id=?) OR (s.type='college' AND s.node_id=?) OR (s.type='university' AND s.node_id=?)";
const cover = (pl) => [pl && pl.st || -1, pl && pl.d || -1, pl && pl.c || -1, pl && pl.u || -1];

export async function handleDm(req, env, opts = {}) {
  const url = new URL(req.url);
  const m = /^\/api\/dm\/(threads|messages|send|read|people|staff|block|unblock|report|delete|reports)$/.exec(url.pathname.replace(/\/+$/, ""));
  if (!m) return null;
  if (env.DM_ENABLED === "0") return fail("not_found", 404);
  if (!env.DB) return fail("not_configured", 503);
  const op = m[1];
  const now = (opts.now || Date.now)();
  const me = await (opts.currentUser || currentUser)(req, env, now);
  if (!me) return fail("unauthorized", 401);
  const db = env.DB;
  const getUser = (id) => db.prepare(`SELECT ${PERSON}, u.active AS active,
    CASE WHEN EXISTS (SELECT 1 FROM scopes s WHERE s.user_id=u.id AND s.level='rep') THEN 'rep' ELSE 'student' END AS role
    FROM users u LEFT JOIN user_avatars av ON av.user_id=u.id WHERE u.id=?`).bind(id).first();
  const mod = await isGlobalAdmin(me, env).catch(() => false);
  const myPlace = await placeOf(db, me.id);
  const iAmRep = !!(await db.prepare("SELECT 1 AS x FROM scopes WHERE user_id=? AND level='rep' LIMIT 1").bind(me.id).first());

  try {
    if (req.method === "GET") {
      if (op === "threads") {
        const rows = (await db.prepare(
          `SELECT t.a_id, t.b_id, t.last_id, t.last_at, t.last_sender, t.last_body,
                  (SELECT COUNT(*) FROM dm_messages d WHERE d.a_id=t.a_id AND d.b_id=t.b_id AND d.sender_id!=?1 AND d.deleted_at IS NULL
                     AND d.id>COALESCE((SELECT last_read FROM dm_reads r WHERE r.user_id=?1 AND r.peer_id=CASE WHEN t.a_id=?1 THEN t.b_id ELSE t.a_id END),0)) AS unread
           FROM dm_threads t WHERE t.a_id=?1 OR t.b_id=?1 ORDER BY t.last_at DESC LIMIT 50`
        ).bind(me.id).all()).results || [];
        const out = [];
        for (const t of rows) {
          const pid = t.a_id === me.id ? t.b_id : t.a_id;
          const p = await getUser(pid);
          if (p) out.push({ peer: person(p), last: { body: t.last_body, at: t.last_at, mine: t.last_sender === me.id }, unread: t.unread || 0 });
        }
        return json({ ok: true, items: out, me: { id: me.id, mod } });
      }
      if (op === "messages") {
        const peer = idOf(url.searchParams.get("peer"));
        if (!peer || peer === me.id) return fail("bad_request", 400);
        const [a, b] = pair(me.id, peer);
        const after = Number(url.searchParams.get("after")) || 0, since = Number(url.searchParams.get("since")) || 0;
        const items = ((await db.prepare("SELECT id, sender_id, body, created_at FROM dm_messages WHERE a_id=? AND b_id=? AND id>? AND deleted_at IS NULL ORDER BY id DESC LIMIT 60").bind(a, b, after).all()).results || []).reverse();
        const gone = since ? ((await db.prepare("SELECT id FROM dm_messages WHERE a_id=? AND b_id=? AND id>? AND deleted_at>? LIMIT 100").bind(a, b, Math.max(after - 1000, 0), since).all()).results || []).map((x) => x.id) : [];
        const p = await getUser(peer);
        if (!p) return fail("not_found", 404);
        const blocked = !!(await db.prepare("SELECT 1 AS x FROM dm_blocks WHERE blocker_id=? AND blocked_id=?").bind(me.id, peer).first());
        return json({ ok: true, items, gone, now: Date.now(), peer: person(p), blocked, me: me.id });
      }
      if (op === "staff") { // ممثلو نطاقي: المرحلة ثم القسم ثم الكلية ثم الجامعة
        const rows = (await db.prepare(`SELECT DISTINCT ${PERSON}, 'rep' AS role FROM scopes s JOIN users u ON u.id=s.user_id LEFT JOIN user_avatars av ON av.user_id=u.id
          WHERE s.level='rep' AND u.active=1 AND u.id!=? AND (${COVER}) LIMIT 30`).bind(me.id, ...cover(myPlace)).all()).results || [];
        return json({ ok: true, items: rows.map(person) });
      }
      if (op === "people") {
        const q = clean(url.searchParams.get("q"), 40).replace(/[%_\\]/g, "");
        if (q.length < 2) return json({ ok: true, items: [] });
        const like = "%" + q + "%";
        if (!myPlace || !myPlace.d) return json({ ok: true, items: [] }); // البحث داخل قسمي فقط
        const rows = (await db.prepare(`SELECT ${PERSON} FROM user_profile p JOIN stages s ON s.id=p.stage_id JOIN users u ON u.id=p.user_id LEFT JOIN user_avatars av ON av.user_id=u.id
          WHERE s.department_id=? AND u.active=1 AND u.id!=? AND (u.name LIKE ? OR av.display_name LIKE ?) ORDER BY u.id LIMIT 20`).bind(myPlace.d, me.id, like, like).all()).results || [];
        return json({ ok: true, items: rows.map(person) });
      }
      if (op === "reports") {
        if (!mod) return fail("forbidden", 403);
        const rows = (await db.prepare("SELECT r.id, r.body, r.reason, r.created_at, r.sender_id, r.reporter_id, su.name AS sender_name, ru.name AS reporter_name FROM dm_reports r LEFT JOIN users su ON su.id=r.sender_id LEFT JOIN users ru ON ru.id=r.reporter_id ORDER BY r.id DESC LIMIT 50").all()).results || [];
        return json({ ok: true, items: rows.map((r) => ({ ...r, sender_name: short(r.sender_name), reporter_name: short(r.reporter_name) })) });
      }
      return fail("not_found", 404);
    }

    if (req.method !== "POST") return fail("not_found", 404);
    const origin = req.headers.get("origin");
    if (origin && origin !== url.origin) return fail("forbidden", 403);
    let b = null;
    try { b = await req.json(); } catch { /* فارغ */ }
    if (!b) return fail("bad_request", 400);

    if (op === "send") {
      const peer = idOf(b.peer), body = clean(b.body, MAX_BODY);
      if (!peer || peer === me.id || !body) return fail("bad_request", 400);
      const p = await getUser(peer);
      if (!p || !p.active) return fail("not_found", 404);
      const iBlocked = await db.prepare("SELECT 1 AS x FROM dm_blocks WHERE blocker_id=? AND blocked_id=?").bind(me.id, peer).first();
      if (iBlocked) return fail("you_blocked", 403);
      const theyBlocked = await db.prepare("SELECT 1 AS x FROM dm_blocks WHERE blocker_id=? AND blocked_id=?").bind(peer, me.id).first();
      if (theyBlocked) return fail("cant_message", 403);
      const recent = await db.prepare("SELECT created_at FROM dm_messages WHERE sender_id=? ORDER BY id DESC LIMIT 1").bind(me.id).first();
      if (recent && now - recent.created_at < 1200) return fail("slow_down", 429);
      const hourly = await db.prepare("SELECT COUNT(*) AS n FROM dm_messages WHERE sender_id=? AND created_at>?").bind(me.id, now - 3600000).first();
      if (hourly && hourly.n >= 60) return fail("slow_down", 429);
      const [a, c] = pair(me.id, peer);
      const exists = await db.prepare("SELECT 1 AS x FROM dm_threads WHERE a_id=? AND b_id=?").bind(a, c).first();
      if (!exists && !mod && !iAmRep) { // محادثة جديدة من طالب: زميل في قسمه أو ممثل يغطّيه فقط
        const pp = await placeOf(db, peer);
        const sameDept = myPlace && pp && myPlace.d && myPlace.d === pp.d;
        const staff = !sameDept && await db.prepare(`SELECT 1 AS x FROM scopes s WHERE s.user_id=? AND s.level='rep' AND (${COVER}) LIMIT 1`).bind(peer, ...cover(myPlace)).first();
        if (!sameDept && !staff) return fail("cant_message", 403);
      }
      if (!exists && !mod && !iAmRep) { // منع الإزعاج: عدد المحادثات الجديدة يومياً للطالب
        const fresh = await db.prepare("SELECT COUNT(*) AS n FROM (SELECT 1 FROM dm_messages WHERE sender_id=? AND created_at>? GROUP BY a_id, b_id)").bind(me.id, now - 86400000).first();
        if (fresh && fresh.n >= 15) return fail("slow_down", 429);
      }
      const r = await db.prepare("INSERT INTO dm_messages(a_id,b_id,sender_id,body,created_at) VALUES(?,?,?,?,?)").bind(a, c, me.id, body, now).run();
      const id = Number(r.meta.last_row_id);
      await db.prepare("INSERT INTO dm_threads(a_id,b_id,last_id,last_at,last_sender,last_body) VALUES(?,?,?,?,?,?) ON CONFLICT(a_id,b_id) DO UPDATE SET last_id=excluded.last_id,last_at=excluded.last_at,last_sender=excluded.last_sender,last_body=excluded.last_body")
        .bind(a, c, id, now, me.id, body.slice(0, 80)).run();
      await db.prepare("INSERT INTO dm_reads(user_id,peer_id,last_read) VALUES(?,?,?) ON CONFLICT(user_id,peer_id) DO UPDATE SET last_read=excluded.last_read").bind(me.id, peer, id).run();
      return json({ ok: true, item: { id, sender_id: me.id, body, created_at: now } }, 201);
    }
    if (op === "read") {
      const peer = idOf(b.peer); if (!peer) return fail("bad_request", 400);
      const [a, c] = pair(me.id, peer);
      const last = await db.prepare("SELECT MAX(id) AS m FROM dm_messages WHERE a_id=? AND b_id=?").bind(a, c).first();
      await db.prepare("INSERT INTO dm_reads(user_id,peer_id,last_read) VALUES(?,?,?) ON CONFLICT(user_id,peer_id) DO UPDATE SET last_read=excluded.last_read").bind(me.id, peer, (last && last.m) || 0).run();
      return json({ ok: true });
    }
    if (op === "block" || op === "unblock") {
      const peer = idOf(b.peer); if (!peer || peer === me.id) return fail("bad_request", 400);
      if (op === "block") await db.prepare("INSERT OR IGNORE INTO dm_blocks(blocker_id,blocked_id,created_at) VALUES(?,?,?)").bind(me.id, peer, now).run();
      else await db.prepare("DELETE FROM dm_blocks WHERE blocker_id=? AND blocked_id=?").bind(me.id, peer).run();
      return json({ ok: true });
    }
    if (op === "delete") {
      const id = idOf(b.message_id); if (!id) return fail("bad_request", 400);
      const msg = await db.prepare("SELECT sender_id, deleted_at FROM dm_messages WHERE id=?").bind(id).first();
      if (!msg || msg.deleted_at) return fail("not_found", 404);
      if (msg.sender_id !== me.id) return fail("forbidden", 403);
      await db.prepare("UPDATE dm_messages SET deleted_at=? WHERE id=?").bind(now, id).run();
      return json({ ok: true });
    }
    if (op === "report") {
      const id = idOf(b.message_id), reason = clean(b.reason, 300);
      if (!id || !reason) return fail("bad_request", 400);
      const msg = await db.prepare("SELECT a_id, b_id, sender_id, body FROM dm_messages WHERE id=? AND deleted_at IS NULL").bind(id).first();
      if (!msg || (msg.a_id !== me.id && msg.b_id !== me.id) || msg.sender_id === me.id) return fail("not_found", 404);
      const rc = await db.prepare("SELECT COUNT(*) AS n FROM dm_reports WHERE reporter_id=? AND created_at>?").bind(me.id, now - 86400000).first();
      if (rc && rc.n >= 20) return fail("slow_down", 429);
      await db.prepare("INSERT OR IGNORE INTO dm_reports(message_id,reporter_id,sender_id,body,reason,created_at) VALUES(?,?,?,?,?,?)").bind(id, me.id, msg.sender_id, msg.body, reason, now).run();
      return json({ ok: true });
    }
  } catch (e) {
    console.error("dm", String(e && e.message).slice(0, 200));
    return fail("server", 500);
  }
  return fail("not_found", 404);
}
