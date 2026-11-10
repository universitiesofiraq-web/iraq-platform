const PAGE_SIZE = 25;
const lists = {
  requests: `SELECT r.user_id AS id, u.name, u.email, r.requested_at,
      (u.active=1 AND COALESCE(p.stage_id=g.stage_id,0)) AS eligible
    FROM chat_join_requests r JOIN users u ON u.id=r.user_id
    JOIN chat_groups g ON g.id=r.group_id LEFT JOIN user_profile p ON p.user_id=u.id
    WHERE r.group_id=? AND r.user_id>? AND r.status='pending' ORDER BY r.user_id`,
  members: `SELECT m.user_id AS id, u.name, u.email, m.joined_at
    FROM chat_members m JOIN users u ON u.id=m.user_id
    WHERE m.group_id=? AND m.user_id>? ORDER BY m.user_id`,
  reports: `SELECT r.id, r.reason, r.created_at, m.body, m.deleted_at, u.name AS sender
    FROM chat_reports r JOIN chat_messages m ON m.id=r.message_id
    JOIN users u ON u.id=m.sender_id LEFT JOIN chat_report_reviews v ON v.report_id=r.id
    WHERE m.group_id=? AND r.id>? AND v.report_id IS NULL ORDER BY r.id`
};

export async function manageGroupChat(req, url, db, user, canManageStage, tools) {
  const { json, fail, idOf, bodyOf, secret, now } = tools;
  if (req.method === "GET" && !url.searchParams.has("room_id")) {
    const stageId = idOf(url.searchParams.get("stage_id"));
    if (!stageId) return fail("bad_request", 400);
    if (!(await canManageStage(stageId))) return fail("forbidden", 403);
    const stage = await db.prepare(`SELECT s.id, s.number, d.name_ar AS department, c.name_ar AS college
      FROM stages s JOIN departments d ON d.id=s.department_id JOIN colleges c ON c.id=d.college_id
      WHERE s.id=?`).bind(stageId).first();
    if (!stage) return fail("not_found", 404);
    const { results } = await db.prepare("SELECT id,name FROM chat_groups WHERE stage_id=? AND active=1 ORDER BY id DESC")
      .bind(stageId).all();
    return json({ ok: true, stage, items: results || [] });
  }
  const body = req.method === "POST" ? await bodyOf(req) : null;
  const groupId = idOf(req.method === "GET" ? url.searchParams.get("room_id") : body?.room_id);
  if (!groupId) return fail("bad_request", 400);
  const group = await db.prepare("SELECT id,stage_id FROM chat_groups WHERE id=? AND active=1").bind(groupId).first();
  if (!group || !(await canManageStage(group.stage_id))) return fail("forbidden", 403);

  if (req.method === "GET") {
    const kind = url.searchParams.get("kind");
    const after = url.searchParams.has("after") ? idOf(url.searchParams.get("after")) : 0;
    if (!Object.hasOwn(lists, kind) || after === null) return fail("bad_request", 400);
    const { results = [] } = await db.prepare(lists[kind] + " LIMIT ?").bind(groupId, after, PAGE_SIZE + 1).all();
    const items = results.slice(0, PAGE_SIZE);
    return json({ ok: true, items, next: results.length > PAGE_SIZE ? items.at(-1).id : null });
  }
  const action = body.action;
  if (action === "rotate-code") {
    const invite = await secret();
    await db.prepare("UPDATE chat_groups SET invite_hash=? WHERE id=?").bind(invite.hash, groupId).run();
    return json({ ok: true, invite_code: invite.code });
  }
  const target = idOf(body.id);
  if (!target) return fail("bad_request", 400);
  if (action === "approve") {
    const [decision] = await db.batch([
      db.prepare(`UPDATE chat_join_requests SET status='approved',reviewed_by=?,reviewed_at=?
        WHERE group_id=? AND user_id=? AND status='pending' AND EXISTS (
          SELECT 1 FROM users u JOIN user_profile p ON p.user_id=u.id
          WHERE u.id=? AND u.active=1 AND p.stage_id=?)`)
        .bind(user.id, now, groupId, target, target, group.stage_id),
      db.prepare(`INSERT OR IGNORE INTO chat_members(group_id,user_id,joined_at)
        SELECT group_id,user_id,reviewed_at FROM chat_join_requests
        WHERE group_id=? AND user_id=? AND status='approved'`).bind(groupId, target)
    ]);
    if (!decision.meta.changes) return fail("request_unavailable", 409);
  } else if (action === "reject") {
    const result = await db.prepare(`UPDATE chat_join_requests SET status='rejected',reviewed_by=?,reviewed_at=?
      WHERE group_id=? AND user_id=? AND status='pending'`).bind(user.id, now, groupId, target).run();
    if (!result.meta.changes) return fail("request_unavailable", 409);
  } else if (action === "revoke") {
    const [, result] = await db.batch([
      db.prepare(`INSERT INTO chat_join_requests(group_id,user_id,status,requested_at,reviewed_by,reviewed_at)
        SELECT group_id,user_id,'revoked',joined_at,?,? FROM chat_members WHERE group_id=? AND user_id=?
        ON CONFLICT(group_id,user_id) DO UPDATE SET status='revoked',reviewed_by=excluded.reviewed_by,reviewed_at=excluded.reviewed_at`)
        .bind(user.id, now, groupId, target),
      db.prepare("DELETE FROM chat_members WHERE group_id=? AND user_id=?").bind(groupId, target)
    ]);
    if (!result.meta.changes) return fail("request_unavailable", 409);
  } else if (action === "dismiss" || action === "remove") {
    const statements = [];
    if (action === "remove") statements.push(db.prepare(`UPDATE chat_messages
      SET body='',deleted_at=?,pinned_at=NULL,pinned_by=NULL WHERE group_id=? AND deleted_at IS NULL AND id=(
        SELECT r.message_id FROM chat_reports r WHERE r.id=?
        AND NOT EXISTS (SELECT 1 FROM chat_report_reviews v WHERE v.report_id=r.id))`).bind(now, groupId, target));
    statements.push(db.prepare(`INSERT OR IGNORE INTO chat_report_reviews(report_id,decision,reviewed_by,reviewed_at)
      SELECT r.id,?,?,? FROM chat_reports r JOIN chat_messages m ON m.id=r.message_id
      WHERE r.id=? AND m.group_id=?`).bind(action, user.id, now, target, groupId));
    const results = await db.batch(statements);
    if (!results.at(-1).meta.changes) return fail("request_unavailable", 409);
  } else {
    return fail("bad_request", 400);
  }
  return json({ ok: true });
}
