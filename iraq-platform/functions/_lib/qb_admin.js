// functions/_lib/qb_admin.js — واجهة إدارة بنك الأسئلة: /api/qb/admin/*. تُستدعى من qb.js بعد التحقق من الدخول والتفعيل.
// الصلاحيات من نطاقات المنصة الحالية (functions/_lib/scope.js) دون نظام موازٍ:
//   تحرير (أنشئ مسودات، أرسل للمراجعة)  = مساعد uploader فأعلى على المادة، أو مشرف.
//   مراجعة (اعتماد، نشر، أرشفة، حذف، دمج، بلاغات، تصحيح يدوي) = ممثل rep فأعلى على المادة، أو مشرف.
// كل فحص صلاحية على الخادم؛ إخفاء الأزرار في الواجهة ليس حماية.
import { policy, covers } from "./scope.js";
import { cleanContent, searchText, hashBasis, diffSummary, cleanMedia, safeUrl } from "./qb_content.js";
import { applyManualScores, normalizeText, seededShuffle, publicQuestion } from "./qb_grade.js";
import { validateRules, logicDisabled } from "./qb_logic.js";
import { HttpError, json, readJson, toInt, posInt, sha256Hex, parseJson, placeholders, selectIn, audit, randomId } from "./qb_util.js";

const TYPES = ["sba", "mcq", "mrq", "tf", "emq", "saq", "essay", "fill", "matching", "ordering", "numerical"];
const QSTATUS = ["draft", "pending", "approved", "published", "archived"];
const ITEM_KINDS = ["question", "heading", "text", "image", "video", "divider", "pagebreak"];
const MODES = ["practice", "exam"];
const SETTING_KEYS = ["shuffleQuestions", "shuffleOptions", "allowBack", "showResults", "allowReview", "showExplanations", "official"];
const MAX_ITEMS = 300, MAX_IMPORT = 500;

/* ---------- الصلاحيات ---------- */
const getPol = async (ctx) => (ctx.pol ||= await policy(ctx.env, ctx.user));
async function gate(ctx, subjectId, level = "edit") {
  const sid = posInt(subjectId);
  if (!sid) throw new HttpError(400, "subject_required");
  const memo = (ctx.memo ||= new Map());
  if (!memo.has(sid)) {
    const exists = await ctx.env.DB.prepare("SELECT id FROM subjects WHERE id=?").bind(sid).first();
    if (!exists) throw new HttpError(404, "subject_not_found");
    const pol = await getPol(ctx);
    const review = await pol.manageCourse("s" + sid);
    memo.set(sid, { edit: review || (await pol.upload("s" + sid)), review });
  }
  const g = memo.get(sid);
  if (!(level === "review" ? g.review : g.edit)) throw new HttpError(403, "forbidden");
  return { sid, review: g.review };
}
const ownerCanEdit = (row, userId) => row.created_by === userId && (row.status === "draft" || row.status === "pending");

async function loadRow(env, id) {
  const row = id && (await env.DB.prepare("SELECT * FROM qb_questions WHERE id=?").bind(id).first());
  if (!row) throw new HttpError(404, "not_found");
  return row;
}
const fullQuestion = (row, extra = {}) => ({ id: row.id, subject_id: row.subject_id, lecture_id: row.lecture_id, category_id: row.category_id, case_id: row.case_id, type: row.type, status: row.status, difficulty: row.difficulty, points: row.points, version: row.version, created_by: row.created_by, updated_by: row.updated_by, created_at: row.created_at, updated_at: row.updated_at, published_at: row.published_at, content: parseJson(row.content_json, {}), ...extra });

async function tagsFor(env, ids) {
  if (!ids.length) return {};
  const rows = await selectIn(env, "SELECT qt.question_id, t.name FROM qb_question_tags qt JOIN qb_tags t ON t.id=qt.tag_id WHERE qt.question_id IN", ids);
  const m = {}; for (const r of rows) (m[r.question_id] ||= []).push(r.name);
  return m;
}
const cleanTags = (v) => [...new Set((Array.isArray(v) ? v : []).map((t) => String(t || "").replace(/[\u0000-\u001f]/g, "").trim().slice(0, 30)).filter(Boolean))].slice(0, 12);
async function setTags(env, qid, tags) {
  const j = JSON.stringify(tags);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM qb_question_tags WHERE question_id=?").bind(qid),
    env.DB.prepare("INSERT OR IGNORE INTO qb_tags (name) SELECT value FROM json_each(?)").bind(j),
    env.DB.prepare("INSERT OR IGNORE INTO qb_question_tags (question_id, tag_id) SELECT ?, id FROM qb_tags WHERE name IN (SELECT value FROM json_each(?))").bind(qid, j)
  ]);
}

// يتحقق أن المحاضرة والتصنيف والحالة تخص المادة نفسها.
async function checkRefs(env, sid, { lecture_id, category_id, case_id }) {
  const out = {};
  if (lecture_id != null && lecture_id !== "") { const id = posInt(lecture_id); if (!id || !(await env.DB.prepare("SELECT 1 FROM lectures WHERE id=? AND subject_id=?").bind(id, sid).first())) throw new HttpError(400, "bad_lecture"); out.lecture_id = id; }
  if (category_id != null && category_id !== "") { const id = posInt(category_id); if (!id || !(await env.DB.prepare("SELECT 1 FROM qb_categories WHERE id=? AND subject_id=?").bind(id, sid).first())) throw new HttpError(400, "bad_category"); out.category_id = id; }
  if (case_id != null && case_id !== "") { const id = posInt(case_id); if (!id || !(await env.DB.prepare("SELECT 1 FROM qb_cases WHERE id=? AND subject_id=?").bind(id, sid).first())) throw new HttpError(400, "bad_case"); out.case_id = id; }
  return out;
}

async function prepared(type, rawContent, difficulty) {
  const c = cleanContent(type, rawContent);
  if (!c.ok) throw new HttpError(422, "invalid_question", { details: c.errors });
  return { content: c.content, hash: await sha256Hex(hashBasis(type, c.content)), search: searchText(c.content), difficulty: [1, 2, 3].includes(Number(difficulty)) ? Number(difficulty) : 2 };
}

/* ---------- /me ---------- */
async function me(ctx) {
  const { env } = ctx, pol = await getPol(ctx);
  const rows = (await env.DB.prepare("SELECT sb.id, sb.name_ar, sb.name_en, st.id AS stage, d.id AS department, c.id AS college, c.university_id AS university FROM subjects sb JOIN terms t ON t.id=sb.term_id JOIN stages st ON st.id=t.stage_id JOIN departments d ON d.id=st.department_id JOIN colleges c ON c.id=d.college_id ORDER BY sb.name_ar LIMIT 3000").all()).results;
  const subjects = [];
  for (const r of rows) {
    const review = pol.admin || covers(pol.scopes, r, true);
    if (review || covers(pol.scopes, r, false)) subjects.push({ id: r.id, name_ar: r.name_ar, name_en: r.name_en, level: review ? "review" : "edit" });
  }
  return json({ admin: !!pol.admin, user: { id: ctx.user.id, name: ctx.user.name }, subjects });
}

/* ---------- الأسئلة ---------- */
async function listQuestions(ctx) {
  const { env, url, user } = ctx, p = url.searchParams;
  const { sid, review } = await gate(ctx, p.get("subject"));
  const where = ["q.subject_id=?"], args = [sid];
  const status = p.get("status"); if (status && QSTATUS.includes(status)) { where.push("q.status=?"); args.push(status); }
  const type = p.get("type"); if (type && TYPES.includes(type)) { where.push("q.type=?"); args.push(type); }
  const diff = toInt(p.get("difficulty"), 0, 0, 3); if (diff) { where.push("q.difficulty=?"); args.push(diff); }
  const lecture = posInt(p.get("lecture")); if (lecture) { where.push("q.lecture_id=?"); args.push(lecture); }
  const cat = posInt(p.get("category")); if (cat) { where.push("q.category_id=?"); args.push(cat); }
  const cs = posInt(p.get("case")); if (cs) { where.push("q.case_id=?"); args.push(cs); }
  const tag = (p.get("tag") || "").trim().slice(0, 30); if (tag) { where.push("q.id IN (SELECT qt.question_id FROM qb_question_tags qt JOIN qb_tags t ON t.id=qt.tag_id WHERE t.name=?)"); args.push(tag); }
  if (p.get("mine") === "1") { where.push("q.created_by=?"); args.push(user.id); }
  const term = normalizeText(p.get("q") || "").slice(0, 80); if (term) { where.push("q.search_text LIKE ? ESCAPE '\\'"); args.push("%" + term.replace(/[\\%_]/g, (c) => "\\" + c) + "%"); }
  if (!review) { where.push("(q.created_by=? OR q.status IN ('published','approved'))"); args.push(user.id); }
  const sort = { updated: "q.updated_at DESC", created: "q.created_at DESC", difficulty: "q.difficulty DESC, q.id", uses: "COALESCE(s.attempts,0) DESC", hard: "(CASE WHEN COALESCE(s.attempts,0)=0 THEN 2 ELSE 1.0*s.correct/s.attempts END), q.id" }[p.get("sort")] || "q.updated_at DESC";
  const limit = toInt(p.get("limit"), 30, 1, 100), offset = toInt(p.get("offset"), 0, 0, 100000);
  const total = (await env.DB.prepare(`SELECT COUNT(*) n FROM qb_questions q WHERE ${where.join(" AND ")}`).bind(...args).first()).n;
  const rows = (await env.DB.prepare(`SELECT q.*, COALESCE(s.attempts,0) AS uses, COALESCE(s.correct,0) AS s_correct, (SELECT COUNT(*) FROM qb_reports r WHERE r.question_id=q.id AND r.status='open') AS reports_open FROM qb_questions q LEFT JOIN qb_question_stats s ON s.question_id=q.id WHERE ${where.join(" AND ")} ORDER BY ${sort} LIMIT ? OFFSET ?`).bind(...args, limit, offset).all()).results;
  const tags = await tagsFor(env, rows.map((r) => r.id));
  return json({ total, offset, can_review: review, questions: rows.map((r) => fullQuestion(r, { uses: r.uses, accuracy: r.uses ? Math.round((r.s_correct / r.uses) * 1000) / 10 : null, reports_open: r.reports_open, tags: tags[r.id] || [], editable: review || ownerCanEdit(r, user.id) })) });
}

async function getQuestion(ctx, id) {
  const { env, user } = ctx, row = await loadRow(env, id);
  const { review } = await gate(ctx, row.subject_id);
  if (!review && row.created_by !== user.id && !["published", "approved"].includes(row.status)) throw new HttpError(404, "not_found");
  const [versions, reviews, stats, reports] = await Promise.all([
    env.DB.prepare("SELECT v.version, v.status, v.changed_by, v.changed_at, v.change_summary, u.name AS changed_by_name FROM qb_question_versions v LEFT JOIN users u ON u.id=v.changed_by WHERE v.question_id=? ORDER BY v.version DESC LIMIT 30").bind(id).all(),
    env.DB.prepare("SELECT r.from_status, r.to_status, r.note, r.created_at, u.name AS reviewer FROM qb_question_reviews r LEFT JOIN users u ON u.id=r.reviewer_id WHERE r.question_id=? ORDER BY r.created_at DESC LIMIT 30").bind(id).all(),
    env.DB.prepare("SELECT attempts, correct, partial, wrong, unanswered FROM qb_question_stats WHERE question_id=?").bind(id).first(),
    env.DB.prepare("SELECT COUNT(*) n FROM qb_reports WHERE question_id=? AND status='open'").bind(id).first()
  ]);
  return json({ question: fullQuestion(row, { tags: (await tagsFor(env, [id]))[id] || [], stats: stats || { attempts: 0, correct: 0, partial: 0, wrong: 0, unanswered: 0 }, reports_open: reports.n, editable: review || ownerCanEdit(row, user.id) }), versions: versions.results, reviews: reviews.results });
}

async function createQuestion(ctx) {
  const { env, user, now } = ctx, b = await readJson(ctx.request, 200000);
  const { sid } = await gate(ctx, b.subject_id);
  if (!TYPES.includes(b.type)) throw new HttpError(400, "bad_type");
  const refs = await checkRefs(env, sid, b);
  const pq = await prepared(b.type, b.content, b.difficulty);
  const dup = (await env.DB.prepare("SELECT id, status FROM qb_questions WHERE subject_id=? AND content_hash=? AND status != 'archived' LIMIT 5").bind(sid, pq.hash).all()).results;
  const status = b.submit ? "pending" : "draft";
  const r = await env.DB.prepare("INSERT INTO qb_questions (subject_id, lecture_id, category_id, case_id, type, status, difficulty, content_json, search_text, content_hash, points, version, created_by, updated_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,1,?,?,?,?)")
    .bind(sid, refs.lecture_id ?? null, refs.category_id ?? null, refs.case_id ?? null, b.type, status, pq.difficulty, JSON.stringify(pq.content), pq.search, pq.hash, pq.content.points, user.id, user.id, now, now).run();
  const id = Number(r.meta.last_row_id);
  await env.DB.prepare("INSERT INTO qb_question_versions (question_id, version, content_json, status, changed_by, changed_at, change_summary) VALUES (?,1,?,?,?,?,?)").bind(id, JSON.stringify(pq.content), status, user.id, now, "إنشاء السؤال").run();
  const tags = cleanTags(b.tags); if (tags.length) await setTags(env, id, tags);
  await audit(env, user.id, "question.create", "question", id, b.type);
  return json({ id, status, duplicates: dup }, 201);
}

async function updateQuestion(ctx, id) {
  const { env, user, now } = ctx, b = await readJson(ctx.request, 200000), row = await loadRow(env, id);
  const { review } = await gate(ctx, row.subject_id);
  if (!review && !ownerCanEdit(row, user.id)) throw new HttpError(403, "forbidden");
  const before = parseJson(row.content_json, {});
  const pq = await prepared(row.type, b.content ?? before, b.difficulty ?? row.difficulty);
  const refs = await checkRefs(env, row.subject_id, { lecture_id: b.lecture_id === undefined ? row.lecture_id : b.lecture_id, category_id: b.category_id === undefined ? row.category_id : b.category_id, case_id: b.case_id === undefined ? row.case_id : b.case_id });
  const summary = diffSummary(before, pq.content);
  const same = JSON.stringify(before) === JSON.stringify(pq.content) && pq.difficulty === row.difficulty && (refs.lecture_id ?? null) === row.lecture_id && (refs.category_id ?? null) === row.category_id && (refs.case_id ?? null) === row.case_id;
  const version = same ? row.version : row.version + 1;
  if (!same) {
    await env.DB.batch([
      env.DB.prepare("UPDATE qb_questions SET lecture_id=?, category_id=?, case_id=?, difficulty=?, content_json=?, search_text=?, content_hash=?, points=?, version=?, updated_by=?, updated_at=? WHERE id=?").bind(refs.lecture_id ?? null, refs.category_id ?? null, refs.case_id ?? null, pq.difficulty, JSON.stringify(pq.content), pq.search, pq.hash, pq.content.points, version, user.id, now, id),
      env.DB.prepare("INSERT INTO qb_question_versions (question_id, version, content_json, status, changed_by, changed_at, change_summary) VALUES (?,?,?,?,?,?,?)").bind(id, version, JSON.stringify(pq.content), row.status, user.id, now, summary)
    ]);
  }
  if (Array.isArray(b.tags)) await setTags(env, id, cleanTags(b.tags));
  const dup = (await env.DB.prepare("SELECT id, status FROM qb_questions WHERE subject_id=? AND content_hash=? AND id != ? AND status != 'archived' LIMIT 5").bind(row.subject_id, pq.hash, id).all()).results;
  if (!same) await audit(env, user.id, "question.update", "question", id, summary);
  return json({ ok: true, version, changed: !same, duplicates: dup });
}

const TRANSITIONS = { draft: { pending: "edit", approved: "review", published: "review", archived: "review" }, pending: { draft: "edit", approved: "review", published: "review", archived: "review" }, approved: { draft: "review", published: "review", archived: "review" }, published: { draft: "review", archived: "review" }, archived: { draft: "review" } };
async function changeStatus(ctx, id) {
  const { env, user, now } = ctx, b = await readJson(ctx.request, 8000), row = await loadRow(env, id);
  const { review } = await gate(ctx, row.subject_id);
  const to = b.to, need = TRANSITIONS[row.status] && TRANSITIONS[row.status][to];
  if (!QSTATUS.includes(to) || !need) throw new HttpError(409, "transition_not_allowed", { from: row.status, to });
  if (need === "review" && !review) throw new HttpError(403, "forbidden");
  if (need === "edit" && !review && row.created_by !== user.id) throw new HttpError(403, "forbidden");
  if (to === "published" && row.case_id) { const cs = await env.DB.prepare("SELECT status FROM qb_cases WHERE id=?").bind(row.case_id).first(); if (!cs || cs.status !== "published") throw new HttpError(409, "case_not_published"); }
  const note = String(b.note || "").trim().slice(0, 500);
  await env.DB.batch([
    env.DB.prepare("UPDATE qb_questions SET status=?, updated_by=?, updated_at=?, published_at=CASE WHEN ?='published' THEN ? ELSE published_at END WHERE id=?").bind(to, user.id, now, to, now, id),
    env.DB.prepare("INSERT INTO qb_question_reviews (question_id, reviewer_id, from_status, to_status, note, created_at) VALUES (?,?,?,?,?,?)").bind(id, user.id, row.status, to, note, now)
  ]);
  await audit(env, user.id, "question.status", "question", id, row.status + ">" + to);
  return json({ ok: true, status: to });
}

async function deleteQuestion(ctx, id) {
  const { env, user } = ctx, row = await loadRow(env, id);
  const { review } = await gate(ctx, row.subject_id);
  if (!review && !(row.created_by === user.id && row.status === "draft")) throw new HttpError(403, "forbidden");
  const used = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM qb_attempt_answers WHERE question_id=?) + (SELECT COUNT(*) FROM qb_quiz_items WHERE question_id=?) AS n").bind(id, id).first();
  if (used.n > 0) throw new HttpError(409, "question_in_use", { hint: "archive" });
  await env.DB.batch([env.DB.prepare("DELETE FROM qb_question_versions WHERE question_id=?").bind(id), env.DB.prepare("DELETE FROM qb_question_reviews WHERE question_id=?").bind(id), env.DB.prepare("DELETE FROM qb_question_stats WHERE question_id=?").bind(id), env.DB.prepare("DELETE FROM qb_questions WHERE id=?").bind(id)]);
  await audit(env, user.id, "question.delete", "question", id);
  return json({ ok: true });
}

async function bulk(ctx) {
  const { env, user, now } = ctx, b = await readJson(ctx.request, 60000);
  const ids = [...new Set((Array.isArray(b.ids) ? b.ids : []).map(posInt).filter(Boolean))].slice(0, 200);
  if (!ids.length) throw new HttpError(400, "ids_required");
  const rows = await selectIn(env, "SELECT id, subject_id, status, created_by FROM qb_questions WHERE id IN", ids);
  const failed = [], okIds = [], allowedAction = ["status", "category", "difficulty", "lecture", "tags_add", "tags_remove"];
  if (!allowedAction.includes(b.action)) throw new HttpError(400, "bad_action");
  const seenIds = new Set(rows.map((r) => r.id)); ids.filter((i) => !seenIds.has(i)).forEach((i) => failed.push({ id: i, reason: "not_found" }));
  for (const r of rows) {
    let g; try { g = await gate(ctx, r.subject_id); } catch { failed.push({ id: r.id, reason: "forbidden" }); continue; }
    if (b.action === "status") {
      const need = TRANSITIONS[r.status] && TRANSITIONS[r.status][b.value];
      if (!need) { failed.push({ id: r.id, reason: "transition_not_allowed" }); continue; }
      if ((need === "review" && !g.review) || (need === "edit" && !g.review && r.created_by !== user.id)) { failed.push({ id: r.id, reason: "forbidden" }); continue; }
    } else if (!g.review && !(r.created_by === user.id && ["draft", "pending"].includes(r.status))) { failed.push({ id: r.id, reason: "forbidden" }); continue; }
    okIds.push(r);
  }
  const target = okIds.map((r) => r.id);
  if (target.length) {
    const sameSubject = new Set(okIds.map((r) => r.subject_id)).size === 1 ? okIds[0].subject_id : null;
    if (b.action === "status") {
      for (let i = 0; i < target.length; i += 80) {
        const part = target.slice(i, i + 80), ph = placeholders(part.length);
        await env.DB.batch([
          env.DB.prepare(`INSERT INTO qb_question_reviews (question_id, reviewer_id, from_status, to_status, note, created_at) SELECT id, ?, status, ?, ?, ? FROM qb_questions WHERE id IN (${ph})`).bind(user.id, b.value, String(b.note || "").slice(0, 500), now, ...part),
          env.DB.prepare(`UPDATE qb_questions SET status=?, updated_by=?, updated_at=?, published_at=CASE WHEN ?='published' THEN ? ELSE published_at END WHERE id IN (${ph})`).bind(b.value, user.id, now, b.value, now, ...part)
        ]);
      }
    } else if (b.action === "difficulty") {
      const d = [1, 2, 3].includes(Number(b.value)) ? Number(b.value) : null; if (!d) throw new HttpError(400, "bad_value");
      for (let i = 0; i < target.length; i += 80) { const part = target.slice(i, i + 80); await env.DB.prepare(`UPDATE qb_questions SET difficulty=?, updated_by=?, updated_at=? WHERE id IN (${placeholders(part.length)})`).bind(d, user.id, now, ...part).run(); }
    } else if (b.action === "category" || b.action === "lecture") {
      if (!sameSubject) throw new HttpError(400, "single_subject_required");
      const refs = await checkRefs(env, sameSubject, b.action === "category" ? { category_id: b.value } : { lecture_id: b.value });
      const col = b.action === "category" ? "category_id" : "lecture_id", val = refs[col] ?? null;
      for (let i = 0; i < target.length; i += 80) { const part = target.slice(i, i + 80); await env.DB.prepare(`UPDATE qb_questions SET ${col}=?, updated_by=?, updated_at=? WHERE id IN (${placeholders(part.length)})`).bind(val, user.id, now, ...part).run(); }
    } else {
      const tags = cleanTags(Array.isArray(b.value) ? b.value : [b.value]); if (!tags.length) throw new HttpError(400, "bad_value");
      const j = JSON.stringify(tags), t = JSON.stringify(target);
      if (b.action === "tags_add") await env.DB.batch([env.DB.prepare("INSERT OR IGNORE INTO qb_tags (name) SELECT value FROM json_each(?)").bind(j), env.DB.prepare("INSERT OR IGNORE INTO qb_question_tags (question_id, tag_id) SELECT q.value, g.id FROM json_each(?) q, qb_tags g WHERE g.name IN (SELECT value FROM json_each(?))").bind(t, j)]);
      else await env.DB.prepare("DELETE FROM qb_question_tags WHERE question_id IN (SELECT value FROM json_each(?)) AND tag_id IN (SELECT id FROM qb_tags WHERE name IN (SELECT value FROM json_each(?)))").bind(t, j).run();
    }
    await audit(env, user.id, "question.bulk." + b.action, "question", target.length + " items", String(b.value ?? "").slice(0, 100));
  }
  return json({ ok: true, done: target.length, failed });
}

async function duplicates(ctx) {
  const { env, url } = ctx; const { sid } = await gate(ctx, url.searchParams.get("subject"), "review");
  const groups = (await env.DB.prepare("SELECT content_hash, COUNT(*) n, GROUP_CONCAT(id) ids FROM qb_questions WHERE subject_id=? AND status != 'archived' GROUP BY content_hash HAVING COUNT(*) > 1 ORDER BY n DESC LIMIT 100").bind(sid).all()).results;
  const ids = groups.flatMap((g) => g.ids.split(",").map(Number));
  const rows = ids.length ? await selectIn(env, "SELECT id, status, type, version, content_json, updated_at FROM qb_questions WHERE id IN", ids) : [];
  const by = new Map(rows.map((r) => [r.id, r]));
  return json({ groups: groups.map((g) => ({ n: g.n, questions: g.ids.split(",").map(Number).map((i) => by.get(i)).filter(Boolean).map((r) => ({ id: r.id, status: r.status, type: r.type, version: r.version, text: String(parseJson(r.content_json, {}).text || "").slice(0, 160), updated_at: r.updated_at })) })) });
}

async function merge(ctx) {
  const { env, user } = ctx, b = await readJson(ctx.request, 8000);
  const keep = posInt(b.keep_id), drop = [...new Set((Array.isArray(b.merge_ids) ? b.merge_ids : []).map(posInt).filter((x) => x && x !== keep))].slice(0, 20);
  if (!keep || !drop.length) throw new HttpError(400, "ids_required");
  const krow = await loadRow(env, keep); await gate(ctx, krow.subject_id, "review");
  const rows = await selectIn(env, "SELECT id, subject_id FROM qb_questions WHERE id IN", drop);
  if (rows.length !== drop.length || rows.some((r) => r.subject_id !== krow.subject_id)) throw new HttpError(400, "same_subject_required");
  const j = JSON.stringify(drop);
  await env.DB.batch([
    env.DB.prepare("DELETE FROM qb_quiz_items WHERE question_id IN (SELECT value FROM json_each(?)) AND quiz_id IN (SELECT quiz_id FROM qb_quiz_items WHERE question_id=?)").bind(j, keep),
    env.DB.prepare("UPDATE qb_quiz_items SET question_id=? WHERE question_id IN (SELECT value FROM json_each(?))").bind(keep, j),
    env.DB.prepare("INSERT OR IGNORE INTO qb_bookmarks (user_id, question_id, created_at) SELECT user_id, ?, created_at FROM qb_bookmarks WHERE question_id IN (SELECT value FROM json_each(?))").bind(keep, j),
    env.DB.prepare("DELETE FROM qb_bookmarks WHERE question_id IN (SELECT value FROM json_each(?))").bind(j),
    env.DB.prepare("UPDATE qb_questions SET status='archived', updated_by=?, updated_at=? WHERE id IN (SELECT value FROM json_each(?))").bind(user.id, ctx.now, j)
  ]);
  await audit(env, user.id, "question.merge", "question", keep, "merged " + drop.join(","));
  return json({ ok: true, kept: keep, archived: drop });
}

/* ---------- التصنيفات والوسوم ---------- */
async function categories(ctx, parts) {
  const { env, request, now, user, url } = ctx, m = request.method;
  if (m === "GET") { const { sid } = await gate(ctx, url.searchParams.get("subject")); return json({ categories: (await env.DB.prepare("SELECT c.id, c.name, c.parent_id, (SELECT COUNT(*) FROM qb_questions q WHERE q.category_id=c.id) AS questions FROM qb_categories c WHERE c.subject_id=? ORDER BY c.name").bind(sid).all()).results }); }
  if (m === "POST") {
    const b = await readJson(request, 4000), { sid } = await gate(ctx, b.subject_id);
    const name = String(b.name || "").trim().slice(0, 80); if (!name) throw new HttpError(400, "name_required");
    let parent = null; if (b.parent_id) { parent = posInt(b.parent_id); if (!parent || !(await env.DB.prepare("SELECT 1 FROM qb_categories WHERE id=? AND subject_id=?").bind(parent, sid).first())) throw new HttpError(400, "bad_parent"); }
    const ex = await env.DB.prepare("SELECT id FROM qb_categories WHERE subject_id=? AND IFNULL(parent_id,0)=? AND name=?").bind(sid, parent || 0, name).first();
    if (ex) return json({ id: ex.id, existed: true });
    const r = await env.DB.prepare("INSERT INTO qb_categories (subject_id, parent_id, name, created_at) VALUES (?,?,?,?)").bind(sid, parent, name, now).run();
    return json({ id: Number(r.meta.last_row_id) }, 201);
  }
  const id = posInt(parts[2]), row = id && (await env.DB.prepare("SELECT * FROM qb_categories WHERE id=?").bind(id).first());
  if (!row) throw new HttpError(404, "not_found");
  await gate(ctx, row.subject_id, "review");
  if (m === "PUT") { const name = String((await readJson(request, 2000)).name || "").trim().slice(0, 80); if (!name) throw new HttpError(400, "name_required"); await env.DB.prepare("UPDATE qb_categories SET name=? WHERE id=?").bind(name, id).run(); return json({ ok: true }); }
  if (m === "DELETE") {
    const used = await env.DB.prepare("SELECT (SELECT COUNT(*) FROM qb_questions WHERE category_id=?) + (SELECT COUNT(*) FROM qb_categories WHERE parent_id=?) AS n").bind(id, id).first();
    if (used.n) throw new HttpError(409, "category_in_use");
    await env.DB.prepare("DELETE FROM qb_categories WHERE id=?").bind(id).run(); await audit(env, user.id, "category.delete", "category", id);
    return json({ ok: true });
  }
  throw new HttpError(405, "method_not_allowed");
}

async function tags(ctx) {
  const q = (ctx.url.searchParams.get("q") || "").trim().slice(0, 30).replace(/[\\%_]/g, (c) => "\\" + c);
  const rows = (await ctx.env.DB.prepare("SELECT t.name, COUNT(qt.question_id) n FROM qb_tags t LEFT JOIN qb_question_tags qt ON qt.tag_id=t.id WHERE t.name LIKE ? ESCAPE '\\' GROUP BY t.id ORDER BY n DESC, t.name LIMIT 50").bind(q + "%").all()).results;
  return json({ tags: rows });
}

/* ---------- الحالات السريرية ---------- */
function cleanCase(b) {
  const clip = (v, n) => String(v ?? "").replace(/\u0000/g, "").trim().slice(0, n);
  const body = { history: clip(b.history, 4000), exam: clip(b.exam, 4000), vitals: clip(b.vitals, 1000), labs: clip(b.labs, 3000), diagnosis: clip(b.diagnosis, 1000), text: clip(b.text, 8000), images: cleanMedia(b.images) };
  const t = b.labsTable; if (t && Array.isArray(t.head) && Array.isArray(t.rows)) body.labsTable = { head: t.head.slice(0, 8).map((c) => clip(c, 80)), rows: t.rows.slice(0, 30).map((r) => (Array.isArray(r) ? r : []).slice(0, 8).map((c) => clip(c, 120))) };
  return body;
}
async function cases(ctx, parts) {
  const { env, request, now, user, url } = ctx, m = request.method;
  if (m === "GET" && !parts[2]) {
    const { sid, review } = await gate(ctx, url.searchParams.get("subject"));
    const rows = (await env.DB.prepare(`SELECT c.*, (SELECT COUNT(*) FROM qb_questions q WHERE q.case_id=c.id) AS questions FROM qb_cases c WHERE c.subject_id=? ${review ? "" : "AND (c.created_by=? OR c.status='published')"} ORDER BY c.updated_at DESC LIMIT 200`).bind(...(review ? [sid] : [sid, user.id])).all()).results;
    return json({ cases: rows.map((r) => ({ id: r.id, subject_id: r.subject_id, lecture_id: r.lecture_id, title: r.title, status: r.status, questions: r.questions, body: parseJson(r.body_json, {}), created_by: r.created_by })) });
  }
  if (m === "POST" && !parts[2]) {
    const b = await readJson(request, 100000), { sid } = await gate(ctx, b.subject_id), title = String(b.title || "").trim().slice(0, 200);
    if (!title) throw new HttpError(400, "title_required");
    const refs = await checkRefs(env, sid, { lecture_id: b.lecture_id });
    const r = await env.DB.prepare("INSERT INTO qb_cases (subject_id, lecture_id, title, body_json, status, created_by, created_at, updated_at) VALUES (?,?,?,?, 'draft', ?,?,?)").bind(sid, refs.lecture_id ?? null, title, JSON.stringify(cleanCase(b.body || {})), user.id, now, now).run();
    return json({ id: Number(r.meta.last_row_id) }, 201);
  }
  const id = posInt(parts[2]), row = id && (await env.DB.prepare("SELECT * FROM qb_cases WHERE id=?").bind(id).first());
  if (!row) throw new HttpError(404, "not_found");
  const { review } = await gate(ctx, row.subject_id);
  if (m === "GET") return json({ case: { id: row.id, subject_id: row.subject_id, lecture_id: row.lecture_id, title: row.title, status: row.status, body: parseJson(row.body_json, {}) } });
  if (!review && !(row.created_by === user.id && row.status === "draft")) throw new HttpError(403, "forbidden");
  if (m === "PUT") {
    const b = await readJson(request, 100000), title = String(b.title ?? row.title).trim().slice(0, 200);
    if (!title) throw new HttpError(400, "title_required");
    let status = row.status;
    if (b.status !== undefined) { if (!["draft", "published", "archived"].includes(b.status)) throw new HttpError(400, "bad_status"); if (b.status !== "draft" && !review) throw new HttpError(403, "forbidden"); status = b.status; }
    await env.DB.prepare("UPDATE qb_cases SET title=?, body_json=?, status=?, updated_at=? WHERE id=?").bind(title, JSON.stringify(b.body ? cleanCase(b.body) : parseJson(row.body_json, {})), status, now, id).run();
    return json({ ok: true, status });
  }
  if (m === "DELETE") {
    const n = (await env.DB.prepare("SELECT COUNT(*) n FROM qb_questions WHERE case_id=?").bind(id).first()).n;
    if (n) throw new HttpError(409, "case_in_use");
    await env.DB.prepare("DELETE FROM qb_cases WHERE id=?").bind(id).run(); return json({ ok: true });
  }
  throw new HttpError(405, "method_not_allowed");
}

/* ---------- الاختبارات ---------- */
const settingsOf = (v) => { const o = parseJson(typeof v === "string" ? v : JSON.stringify(v || {}), {}), out = {}; for (const k of SETTING_KEYS) if (typeof o[k] === "boolean") out[k] = o[k]; return out; };

async function quizDoc(env, quiz) {
  const [sections, items, conds] = await Promise.all([
    env.DB.prepare("SELECT id, title, description, position FROM qb_quiz_sections WHERE quiz_id=? ORDER BY position").bind(quiz.id).all(),
    env.DB.prepare("SELECT i.id, i.section_id, i.kind, i.question_id, i.content_json, i.position, i.points_override, i.required, q.type, q.status AS qstatus, q.difficulty, q.points AS qpoints, q.content_json AS qcontent, q.case_id FROM qb_quiz_items i LEFT JOIN qb_questions q ON q.id=i.question_id WHERE i.quiz_id=? ORDER BY i.position").bind(quiz.id).all(),
    env.DB.prepare("SELECT id, kind, source_item_id, op, value_json, target_item_id FROM qb_quiz_conditions WHERE quiz_id=?").bind(quiz.id).all()
  ]);
  const used = (await env.DB.prepare("SELECT COUNT(*) n FROM qb_attempts WHERE quiz_id=?").bind(quiz.id).first()).n;
  return {
    quiz: { id: quiz.id, subject_id: quiz.subject_id, lecture_id: quiz.lecture_id, title: quiz.title, description: quiz.description, status: quiz.status, mode: quiz.mode, settings: parseJson(quiz.settings_json, {}), pass_score: quiz.pass_score, duration_min: quiz.duration_sec ? Math.round(quiz.duration_sec / 60) : null, attempts_allowed: quiz.attempts_allowed, starts_at: quiz.starts_at, ends_at: quiz.ends_at, target: quiz.target, version: quiz.version, created_by: quiz.created_by, attempts: used },
    sections: sections.results,
    items: items.results.map((i) => ({ id: i.id, section_id: i.section_id, kind: i.kind, question_id: i.question_id, content: parseJson(i.content_json, {}), position: i.position, points_override: i.points_override, required: !!i.required, question: i.question_id ? { type: i.type, status: i.qstatus, difficulty: i.difficulty, points: i.qpoints, text: String(parseJson(i.qcontent, {}).text || "").slice(0, 300), case_id: i.case_id } : undefined })),
    conditions: conds.results.map((c) => ({ id: c.id, kind: c.kind, source: c.source_item_id, op: c.op, value: parseJson(c.value_json, null), target: c.target_item_id }))
  };
}
async function loadQuiz(env, id) { const q = id && (await env.DB.prepare("SELECT * FROM qb_quizzes WHERE id=?").bind(id).first()); if (!q) throw new HttpError(404, "not_found"); return q; }

async function listQuizzes(ctx) {
  const { env, url } = ctx; const { sid, review } = await gate(ctx, url.searchParams.get("subject"));
  const st = url.searchParams.get("status");
  const rows = (await env.DB.prepare(`SELECT z.id, z.title, z.status, z.mode, z.lecture_id, z.version, z.starts_at, z.ends_at, z.duration_sec, z.attempts_allowed, z.created_by, z.updated_at, (SELECT COUNT(*) FROM qb_quiz_items i WHERE i.quiz_id=z.id AND i.kind='question') AS question_count, (SELECT COUNT(*) FROM qb_attempts a WHERE a.quiz_id=z.id) AS attempts FROM qb_quizzes z WHERE z.subject_id=? ${st ? "AND z.status=?" : ""} ${review ? "" : `AND z.created_by=${Number(ctx.user.id)}`} ORDER BY z.updated_at DESC LIMIT 200`).bind(...(st ? [sid, st] : [sid])).all()).results;
  return json({ quizzes: rows, can_review: review });
}

async function createQuiz(ctx) {
  const { env, user, now } = ctx, b = await readJson(ctx.request, 20000), { sid } = await gate(ctx, b.subject_id);
  const title = String(b.title || "").trim().slice(0, 200); if (!title) throw new HttpError(400, "title_required");
  const refs = await checkRefs(env, sid, { lecture_id: b.lecture_id });
  let settings = {}, mode = "practice", duration = null, attempts = 1, pass = null;
  if (b.template_id) {
    const t = await env.DB.prepare("SELECT settings_json FROM qb_templates WHERE id=?").bind(posInt(b.template_id)).first();
    if (!t) throw new HttpError(404, "template_not_found");
    const s = parseJson(t.settings_json, {}); settings = settingsOf(s); mode = MODES.includes(s.mode) ? s.mode : "practice"; duration = s.duration_min > 0 ? Math.round(s.duration_min * 60) : null; attempts = Number.isFinite(s.attempts_allowed) ? s.attempts_allowed : 1;
  }
  const r = await env.DB.prepare("INSERT INTO qb_quizzes (subject_id, lecture_id, title, mode, settings_json, pass_score, duration_sec, attempts_allowed, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?)").bind(sid, refs.lecture_id ?? null, title, mode, JSON.stringify(settings), pass, duration, attempts, user.id, now, now).run();
  const id = Number(r.meta.last_row_id); await audit(env, user.id, "quiz.create", "quiz", id, title);
  return json({ id }, 201);
}

async function saveQuiz(ctx, id) {
  const { env, user, now } = ctx, b = await readJson(ctx.request, 900000), quiz = await loadQuiz(env, id);
  const { review } = await gate(ctx, quiz.subject_id);
  if (!review && !(quiz.created_by === user.id && quiz.status === "draft")) throw new HttpError(403, "forbidden");
  const meta = b.meta || {}, sid = quiz.subject_id;
  const title = String(meta.title ?? quiz.title).trim().slice(0, 200); if (!title) throw new HttpError(400, "title_required");
  const mode = MODES.includes(meta.mode) ? meta.mode : quiz.mode;
  const settings = meta.settings !== undefined ? settingsOf(meta.settings) : parseJson(quiz.settings_json, {});
  const dur = meta.duration_min === null ? null : meta.duration_min !== undefined ? Math.round(Number(meta.duration_min) * 60) : quiz.duration_sec;
  if (dur !== null && !(Number.isFinite(dur) && dur >= 60 && dur <= 14400)) throw new HttpError(422, "bad_duration");
  const attempts = meta.attempts_allowed !== undefined ? toInt(meta.attempts_allowed, 1, 0, 50) : quiz.attempts_allowed;
  const pass = meta.pass_score === null ? null : meta.pass_score !== undefined ? Number(meta.pass_score) : quiz.pass_score;
  if (pass !== null && !(Number.isFinite(pass) && pass >= 0)) throw new HttpError(422, "bad_pass_score");
  const startsAt = meta.starts_at === null ? null : meta.starts_at !== undefined ? toInt(meta.starts_at, null, 0) : quiz.starts_at, endsAt = meta.ends_at === null ? null : meta.ends_at !== undefined ? toInt(meta.ends_at, null, 0) : quiz.ends_at;
  if (startsAt && endsAt && endsAt <= startsAt) throw new HttpError(422, "bad_window");
  const refs = await checkRefs(env, sid, { lecture_id: meta.lecture_id === undefined ? quiz.lecture_id : meta.lecture_id });

  const secIn = Array.isArray(b.sections) ? b.sections : [], itemIn = Array.isArray(b.items) ? b.items : [], condIn = Array.isArray(b.conditions) ? b.conditions : [];
  if (itemIn.length > MAX_ITEMS || secIn.length > 50) throw new HttpError(422, "too_many_items");
  const exSec = new Set((await env.DB.prepare("SELECT id FROM qb_quiz_sections WHERE quiz_id=?").bind(id).all()).results.map((r) => r.id));
  const exItem = new Set((await env.DB.prepare("SELECT id FROM qb_quiz_items WHERE quiz_id=?").bind(id).all()).results.map((r) => r.id));
  let nextSec = ((await env.DB.prepare("SELECT COALESCE(MAX(id),0) m FROM qb_quiz_sections").first()).m) + 1;
  let nextItem = ((await env.DB.prepare("SELECT COALESCE(MAX(id),0) m FROM qb_quiz_items").first()).m) + 1;
  const secMap = new Map(), itemMap = new Map(), idMap = { sections: {}, items: {} };
  const sections = secIn.map((s, i) => { const key = String(s.id ?? s.key ?? "n" + i); const real = Number.isSafeInteger(s.id) && exSec.has(s.id) ? s.id : nextSec++; secMap.set(key, real); idMap.sections[key] = real; return { id: real, title: String(s.title || "قسم " + (i + 1)).trim().slice(0, 200), description: String(s.description || "").slice(0, 1000), position: i + 1 }; });
  const qids = [...new Set(itemIn.filter((i) => i && i.kind === "question").map((i) => posInt(i.question_id)))];
  if (qids.includes(null)) throw new HttpError(422, "bad_question_id");
  const qrows = qids.length ? await selectIn(env, "SELECT id, subject_id FROM qb_questions WHERE id IN", qids) : [];
  if (qrows.length !== qids.length || qrows.some((r) => r.subject_id !== sid)) throw new HttpError(422, "question_not_in_subject");
  const seenQ = new Set();
  const items = itemIn.map((it, i) => {
    if (!it || !ITEM_KINDS.includes(it.kind)) throw new HttpError(422, "bad_item_kind");
    const key = String(it.id ?? it.key ?? "n" + i), real = Number.isSafeInteger(it.id) && exItem.has(it.id) ? it.id : nextItem++;
    itemMap.set(key, real); idMap.items[key] = real;
    let content = {}, qid = null;
    if (it.kind === "question") { qid = posInt(it.question_id); if (seenQ.has(qid)) throw new HttpError(422, "duplicate_question_in_quiz"); seenQ.add(qid); }
    else if (it.kind === "image" || it.kind === "video") { const url = safeUrl(it.content && it.content.url); if (!url) throw new HttpError(422, "bad_media_url"); content = { url, caption: String((it.content && it.content.caption) || "").slice(0, 300) }; }
    else if (it.kind === "heading" || it.kind === "text") content = { text: String((it.content && it.content.text) || "").slice(0, 4000) };
    const sec = it.section_id != null || it.section != null ? secMap.get(String(it.section ?? it.section_id)) ?? null : null;
    const po = it.points_override === null || it.points_override === undefined || it.points_override === "" ? null : Number(it.points_override);
    if (po !== null && !(Number.isFinite(po) && po > 0 && po <= 1000)) throw new HttpError(422, "bad_points");
    return { id: real, section_id: sec, kind: it.kind, question_id: qid, content_json: JSON.stringify(content), position: i + 1, points_override: po, required: it.required ? 1 : 0 };
  });
  const rules = condIn.map((c) => ({ kind: c.kind, source: itemMap.get(String(c.source)), op: c.op, value: c.value, target: itemMap.get(String(c.target)) }));
  const rv = validateRules(items.map((i) => ({ id: i.id, kind: i.kind, position: i.position })), rules, { mode, official: !!settings.official });
  if (!rv.ok) throw new HttpError(422, "invalid_rules", { details: rv.errors });

  const jItems = JSON.stringify(items), jSecs = JSON.stringify(sections), jConds = JSON.stringify(rules.map((r) => ({ k: r.kind, s: r.source, o: r.op, v: JSON.stringify(r.value ?? null), t: r.target })));
  await env.DB.batch([
    env.DB.prepare("DELETE FROM qb_quiz_conditions WHERE quiz_id=?").bind(id),
    env.DB.prepare("DELETE FROM qb_quiz_items WHERE quiz_id=? AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))").bind(id, jItems),
    env.DB.prepare("DELETE FROM qb_quiz_sections WHERE quiz_id=? AND id NOT IN (SELECT json_extract(value,'$.id') FROM json_each(?))").bind(id, jSecs),
    env.DB.prepare("INSERT INTO qb_quiz_sections (id, quiz_id, title, description, position) SELECT json_extract(value,'$.id'), ?, json_extract(value,'$.title'), json_extract(value,'$.description'), json_extract(value,'$.position') FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET title=excluded.title, description=excluded.description, position=excluded.position WHERE qb_quiz_sections.quiz_id=excluded.quiz_id").bind(id, jSecs),
    env.DB.prepare("INSERT INTO qb_quiz_items (id, quiz_id, section_id, kind, question_id, content_json, position, points_override, required) SELECT json_extract(value,'$.id'), ?, json_extract(value,'$.section_id'), json_extract(value,'$.kind'), json_extract(value,'$.question_id'), json_extract(value,'$.content_json'), json_extract(value,'$.position'), json_extract(value,'$.points_override'), json_extract(value,'$.required') FROM json_each(?) WHERE true ON CONFLICT(id) DO UPDATE SET section_id=excluded.section_id, kind=excluded.kind, question_id=excluded.question_id, content_json=excluded.content_json, position=excluded.position, points_override=excluded.points_override, required=excluded.required WHERE qb_quiz_items.quiz_id=excluded.quiz_id").bind(id, jItems),
    env.DB.prepare("INSERT INTO qb_quiz_conditions (quiz_id, kind, source_item_id, op, value_json, target_item_id) SELECT ?, json_extract(value,'$.k'), json_extract(value,'$.s'), json_extract(value,'$.o'), json_extract(value,'$.v'), json_extract(value,'$.t') FROM json_each(?)").bind(id, jConds),
    env.DB.prepare("UPDATE qb_quizzes SET title=?, description=?, lecture_id=?, mode=?, settings_json=?, pass_score=?, duration_sec=?, attempts_allowed=?, starts_at=?, ends_at=?, target=?, updated_at=? WHERE id=?").bind(title, String(meta.description ?? quiz.description).slice(0, 2000), refs.lecture_id ?? null, mode, JSON.stringify(settings), pass, dur, attempts, startsAt, endsAt, String(meta.target ?? quiz.target).slice(0, 200), now, id)
  ]);
  return json({ ok: true, ids: idMap, updated_at: now });
}

async function quizStatus(ctx, id) {
  const { env, user, now } = ctx, b = await readJson(ctx.request, 4000), quiz = await loadQuiz(env, id);
  await gate(ctx, quiz.subject_id, "review");
  const to = b.to;
  if (!["draft", "published", "scheduled", "closed", "archived"].includes(to)) throw new HttpError(400, "bad_status");
  let finalStatus = to;
  if (to === "published" || to === "scheduled") {
    const doc = await quizDoc(env, quiz), qs = doc.items.filter((i) => i.kind === "question");
    if (!qs.length) throw new HttpError(409, "quiz_has_no_questions");
    const bad = qs.filter((i) => i.question.status !== "published");
    if (bad.length) throw new HttpError(409, "questions_not_published", { question_ids: bad.map((i) => i.question_id) });
    const caseIds = [...new Set(qs.map((i) => i.question.case_id).filter(Boolean))];
    if (caseIds.length) { const cs = await selectIn(env, "SELECT id FROM qb_cases WHERE status='published' AND id IN", caseIds); if (cs.length !== caseIds.length) throw new HttpError(409, "case_not_published"); }
    const rv = validateRules(doc.items.map((i) => ({ id: i.id, kind: i.kind, position: i.position })), doc.conditions.map((c) => ({ kind: c.kind, source: c.source, op: c.op, value: c.value, target: c.target })), { mode: quiz.mode, official: !!doc.quiz.settings.official });
    if (!rv.ok) throw new HttpError(409, "invalid_rules", { details: rv.errors });
    finalStatus = to === "scheduled" && quiz.starts_at && quiz.starts_at > now ? "scheduled" : "published";
    if (quiz.ends_at && quiz.ends_at <= now) throw new HttpError(409, "window_ended");
    const version = quiz.version + (quiz.status === "published" || quiz.status === "closed" ? 1 : 0);
    await env.DB.batch([
      env.DB.prepare("UPDATE qb_quizzes SET status=?, version=?, updated_at=? WHERE id=?").bind(finalStatus, version, now, id),
      env.DB.prepare("INSERT OR REPLACE INTO qb_quiz_versions (quiz_id, version, snapshot_json, published_by, published_at) VALUES (?,?,?,?,?)").bind(id, version, JSON.stringify(doc), user.id, now)
    ]);
  } else await env.DB.prepare("UPDATE qb_quizzes SET status=?, updated_at=? WHERE id=?").bind(to, now, id).run();
  await audit(env, user.id, "quiz.status", "quiz", id, quiz.status + ">" + finalStatus);
  return json({ ok: true, status: finalStatus });
}

async function deleteQuiz(ctx, id) {
  const { env, user } = ctx, quiz = await loadQuiz(env, id), { review } = await gate(ctx, quiz.subject_id);
  if (!review && !(quiz.created_by === user.id && quiz.status === "draft")) throw new HttpError(403, "forbidden");
  const n = (await env.DB.prepare("SELECT COUNT(*) n FROM qb_attempts WHERE quiz_id=?").bind(id).first()).n;
  if (n || quiz.status === "published") throw new HttpError(409, "quiz_in_use", { hint: "archive" });
  await env.DB.batch([env.DB.prepare("DELETE FROM qb_quiz_conditions WHERE quiz_id=?").bind(id), env.DB.prepare("DELETE FROM qb_quiz_items WHERE quiz_id=?").bind(id), env.DB.prepare("DELETE FROM qb_quiz_sections WHERE quiz_id=?").bind(id), env.DB.prepare("DELETE FROM qb_quiz_versions WHERE quiz_id=?").bind(id), env.DB.prepare("DELETE FROM qb_quizzes WHERE id=?").bind(id)]);
  await audit(env, user.id, "quiz.delete", "quiz", id);
  return json({ ok: true });
}

async function duplicateQuiz(ctx, id) {
  const { env, user, now } = ctx, quiz = await loadQuiz(env, id); await gate(ctx, quiz.subject_id);
  const doc = await quizDoc(env, quiz);
  const r = await env.DB.prepare("INSERT INTO qb_quizzes (subject_id, lecture_id, title, description, mode, settings_json, pass_score, duration_sec, attempts_allowed, target, created_by, created_at, updated_at) VALUES (?,?,?,?,?,?,?,?,?,?,?,?,?)").bind(quiz.subject_id, quiz.lecture_id, (quiz.title + " (نسخة)").slice(0, 200), quiz.description, quiz.mode, quiz.settings_json, quiz.pass_score, quiz.duration_sec, quiz.attempts_allowed, quiz.target, user.id, now, now).run();
  const nid = Number(r.meta.last_row_id);
  // نسخ المحتوى بحفظ كامل عبر الدالة نفسها لتوليد معرّفات جديدة
  const key = (x) => "k" + x;
  const body = { sections: doc.sections.map((s) => ({ id: key(s.id), title: s.title, description: s.description })), items: doc.items.map((i) => ({ id: key(i.id), kind: i.kind, question_id: i.question_id, content: i.content, section: i.section_id ? key(i.section_id) : null, points_override: i.points_override, required: i.required })), conditions: doc.conditions.map((c) => ({ kind: c.kind, source: key(c.source), op: c.op, value: c.value, target: key(c.target) })) };
  const req = new Request(ctx.request.url, { method: "PUT", headers: { "content-type": "application/json" }, body: JSON.stringify(body) });
  await saveQuiz({ ...ctx, request: req }, nid);
  return json({ id: nid }, 201);
}

// يختار أسئلة منشورة من البنك حسب التصنيف والصعوبة (للتوليد التلقائي في المحرر).
async function generate(ctx) {
  const { env } = ctx, b = await readJson(ctx.request, 8000), { sid } = await gate(ctx, b.subject_id);
  const ints = (v) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 50) : []);
  const where = ["subject_id=?", "status='published'"], args = [sid];
  const lec = ints(b.lectures), cat = ints(b.categories), types = (Array.isArray(b.types) ? b.types : []).filter((t) => TYPES.includes(t)), excl = ints(b.exclude_ids);
  if (lec.length) { where.push(`lecture_id IN (${placeholders(lec.length)})`); args.push(...lec); }
  if (cat.length) { where.push(`category_id IN (${placeholders(cat.length)})`); args.push(...cat); }
  if (types.length) { where.push(`type IN (${placeholders(types.length)})`); args.push(...types); }
  const pool = (await env.DB.prepare(`SELECT id, difficulty, content_hash FROM qb_questions WHERE ${where.join(" AND ")} LIMIT 3000`).bind(...args).all()).results.filter((r) => !excl.includes(r.id));
  const seed = randomId(6), count = toInt(b.count, 10, 1, 200);
  const mix = b.difficulty && typeof b.difficulty === "object" && !Array.isArray(b.difficulty) ? b.difficulty : null;
  const picked = [], seen = new Set(), take = (rows, n) => { for (const r of seededShuffle(rows, seed)) { if (n <= 0) break; if (seen.has(r.content_hash)) continue; seen.add(r.content_hash); picked.push(r.id); n--; } return n; };
  let shortfall = 0;
  if (mix) for (const d of [1, 2, 3]) shortfall += take(pool.filter((r) => r.difficulty === d), toInt(mix[d], 0, 0, 200)); else shortfall = take(pool, count);
  return json({ ids: picked, shortfall, available: pool.length });
}

async function quizStats(ctx, id) {
  const { env } = ctx, quiz = await loadQuiz(env, id); await gate(ctx, quiz.subject_id, "review");
  const [sum, perQ, dist] = await Promise.all([
    env.DB.prepare("SELECT COUNT(*) n, COALESCE(AVG(percent),0) avg, COALESCE(MIN(percent),0) lo, COALESCE(MAX(percent),0) hi, SUM(CASE WHEN final=0 THEN 1 ELSE 0 END) pending FROM qb_attempts WHERE quiz_id=? AND status IN ('submitted','graded')").bind(id).first(),
    env.DB.prepare("SELECT aa.question_id, COUNT(*) n, SUM(CASE WHEN aa.status='correct' THEN 1 ELSE 0 END) correct, SUM(CASE WHEN aa.status='unanswered' THEN 1 ELSE 0 END) unanswered FROM qb_attempt_answers aa JOIN qb_attempts a ON a.id=aa.attempt_id WHERE a.quiz_id=? GROUP BY aa.question_id ORDER BY (1.0*SUM(CASE WHEN aa.status='correct' THEN 1 ELSE 0 END)/COUNT(*)) LIMIT 100").bind(id).all(),
    env.DB.prepare("SELECT CAST(MIN(percent,99.99)/10 AS INTEGER) bucket, COUNT(*) n FROM qb_attempts WHERE quiz_id=? AND status IN ('submitted','graded') AND percent IS NOT NULL GROUP BY bucket").bind(id).all()
  ]);
  let passRate = null;
  if (quiz.pass_score != null && sum.n) passRate = Math.round(((await env.DB.prepare("SELECT COUNT(*) n FROM qb_attempts WHERE quiz_id=? AND final=1 AND score>=?").bind(id, quiz.pass_score).first()).n / sum.n) * 1000) / 10;
  return json({ attempts: sum.n, avg_percent: Math.round(sum.avg * 10) / 10, min: sum.lo, max: sum.hi, pending_review: sum.pending || 0, pass_rate: passRate, per_question: perQ.results.map((r) => ({ question_id: r.question_id, n: r.n, correct_percent: Math.round((r.correct / r.n) * 1000) / 10, unanswered: r.unanswered })), distribution: dist.results });
}

/* ---------- القوالب ---------- */
async function templates(ctx, parts) {
  const { env, request, user, now } = ctx, m = request.method;
  if (m === "GET") return json({ templates: (await env.DB.prepare("SELECT id, name, kind, settings_json, builtin FROM qb_templates ORDER BY builtin DESC, id LIMIT 100").all()).results.map((t) => ({ id: t.id, name: t.name, kind: t.kind, builtin: !!t.builtin, settings: parseJson(t.settings_json, {}) })) });
  if (m === "POST") {
    const b = await readJson(request, 8000), pol = await getPol(ctx);
    if (!pol.admin && !pol.scopes.length) throw new HttpError(403, "forbidden");
    const name = String(b.name || "").trim().slice(0, 80); if (!name) throw new HttpError(400, "name_required");
    const s = b.settings || {}, settings = { ...settingsOf(s), mode: MODES.includes(s.mode) ? s.mode : "practice" };
    if (s.duration_min > 0) settings.duration_min = Math.min(240, Number(s.duration_min)); if (Number.isFinite(s.attempts_allowed)) settings.attempts_allowed = toInt(s.attempts_allowed, 1, 0, 50);
    const r = await env.DB.prepare("INSERT INTO qb_templates (name, kind, settings_json, builtin, created_by, created_at) VALUES (?, 'custom', ?, 0, ?, ?)").bind(name, JSON.stringify(settings), user.id, now).run();
    return json({ id: Number(r.meta.last_row_id) }, 201);
  }
  if (m === "DELETE") {
    const id = posInt(parts[2]), t = id && (await env.DB.prepare("SELECT * FROM qb_templates WHERE id=?").bind(id).first());
    if (!t) throw new HttpError(404, "not_found"); if (t.builtin) throw new HttpError(403, "builtin_template");
    const pol = await getPol(ctx); if (!pol.admin && t.created_by !== user.id) throw new HttpError(403, "forbidden");
    await env.DB.prepare("DELETE FROM qb_templates WHERE id=?").bind(id).run(); return json({ ok: true });
  }
  throw new HttpError(405, "method_not_allowed");
}

/* ---------- البلاغات ---------- */
async function reports(ctx, parts) {
  const { env, request, user, now, url } = ctx;
  if (request.method === "GET") {
    const status = ["open", "resolved", "dismissed"].includes(url.searchParams.get("status")) ? url.searchParams.get("status") : "open";
    const subject = posInt(url.searchParams.get("subject"));
    if (subject) await gate(ctx, subject, "review");
    const rows = (await env.DB.prepare(`SELECT r.id, r.question_id, r.reason, r.details, r.status, r.created_at, r.resolution_note, q.subject_id, q.content_json, q.status AS qstatus, sb.name_ar AS subject FROM qb_reports r JOIN qb_questions q ON q.id=r.question_id LEFT JOIN subjects sb ON sb.id=q.subject_id WHERE r.status=? ${subject ? "AND q.subject_id=?" : ""} ORDER BY r.created_at DESC LIMIT 200`).bind(...(subject ? [status, subject] : [status])).all()).results;
    const out = [];
    for (const r of rows) { try { await gate(ctx, r.subject_id, "review"); out.push({ id: r.id, question_id: r.question_id, reason: r.reason, details: r.details, status: r.status, created_at: r.created_at, note: r.resolution_note, subject: r.subject, subject_id: r.subject_id, question_status: r.qstatus, text: String(parseJson(r.content_json, {}).text || "").slice(0, 200) }); } catch { /* خارج نطاقك */ } }
    return json({ reports: out });
  }
  const id = posInt(parts[2]), row = id && (await env.DB.prepare("SELECT r.*, q.subject_id FROM qb_reports r JOIN qb_questions q ON q.id=r.question_id WHERE r.id=?").bind(id).first());
  if (!row) throw new HttpError(404, "not_found");
  await gate(ctx, row.subject_id, "review");
  const b = await readJson(request, 4000), status = ["resolved", "dismissed", "open"].includes(b.status) ? b.status : null;
  if (!status) throw new HttpError(400, "bad_status");
  await env.DB.prepare("UPDATE qb_reports SET status=?, resolved_by=?, resolved_at=?, resolution_note=? WHERE id=?").bind(status, user.id, now, String(b.note || "").slice(0, 500), id).run();
  await audit(env, user.id, "report." + status, "report", id);
  return json({ ok: true });
}

/* ---------- التصحيح اليدوي ---------- */
async function gradingList(ctx) {
  const { env, url } = ctx, subject = posInt(url.searchParams.get("subject")); if (!subject) throw new HttpError(400, "subject_required");
  await gate(ctx, subject, "review");
  const rows = (await env.DB.prepare("SELECT a.id, a.submitted_at, a.user_id, u.name, z.title, z.id AS quiz_id FROM qb_attempts a JOIN qb_quizzes z ON z.id=a.quiz_id LEFT JOIN users u ON u.id=a.user_id WHERE z.subject_id=? AND a.status='submitted' AND a.final=0 ORDER BY a.submitted_at LIMIT 200").bind(subject).all()).results;
  return json({ attempts: rows });
}
async function attemptForGrading(ctx, id) {
  const att = /^[0-9a-f]{32}$/.test(id || "") && (await ctx.env.DB.prepare("SELECT a.*, z.subject_id FROM qb_attempts a JOIN qb_quizzes z ON z.id=a.quiz_id WHERE a.id=?").bind(id).first());
  if (!att) throw new HttpError(404, "not_found");
  await gate(ctx, att.subject_id, "review");
  return att;
}
async function gradingGet(ctx, id) {
  const att = await attemptForGrading(ctx, id), snap = parseJson(att.snapshot_json, {}), result = parseJson(att.result_json, {}), answers = parseJson(att.answers_json, {});
  const pending = (result.perQuestion || []).filter((r) => r.status === "pending");
  return json({ attempt: { id: att.id, submitted_at: att.submitted_at, final: !!att.final }, pending: pending.map((r) => { const q = snap.questions[r.id].q; return { qid: r.id, text: q.text, max: r.max, type: q.type, answer: answers[r.id] ?? "", model_answers: q.accepted || [], explanation: q.explanation || null }; }) });
}
async function gradingPost(ctx, id) {
  const { env, user, now } = ctx, att = await attemptForGrading(ctx, id), b = await readJson(ctx.request, 8000);
  if (att.status !== "submitted") throw new HttpError(409, "not_pending");
  const snap = parseJson(att.snapshot_json, {}), answers = parseJson(att.answers_json, {});
  const vis = new Set(parseJson(att.result_json, {}).hidden || []);
  const questions = snap.items.filter((i) => i.kind === "question" && !vis.has(i.qid)).map((i) => snap.questions[i.qid].q);
  const res = applyManualScores(questions, answers, b.scores || {}, { passScore: snap.quiz && snap.quiz.pass_score != null ? snap.quiz.pass_score : undefined });
  const old = parseJson(att.result_json, {}), per = res.perQuestion.map((r) => ({ id: r.id, score: r.score, max: r.max, status: r.status }));
  const result = { ...old, score: res.score, max: res.max, percent: res.percent, correct: res.correct, partial: res.partial, wrong: res.wrong, pending: res.pending, final: res.final, passed: res.passed ?? null, perQuestion: per };
  const rows = res.perQuestion.filter((r) => r.manual).map((r) => ({ q: Number(r.id), s: r.score, st: r.status }));
  await env.DB.batch([
    env.DB.prepare("UPDATE qb_attempts SET score=?, percent=?, final=?, status=?, result_json=?, rev=rev+1 WHERE id=? AND status='submitted'").bind(res.score, res.percent, res.final ? 1 : 0, res.final ? "graded" : "submitted", JSON.stringify(result), att.id),
    env.DB.prepare("UPDATE qb_attempt_answers SET score=(SELECT json_extract(value,'$.s') FROM json_each(?) WHERE json_extract(value,'$.q')=question_id), status=(SELECT json_extract(value,'$.st') FROM json_each(?) WHERE json_extract(value,'$.q')=question_id), manual=1 WHERE attempt_id=? AND question_id IN (SELECT json_extract(value,'$.q') FROM json_each(?))").bind(JSON.stringify(rows), JSON.stringify(rows), att.id, JSON.stringify(rows))
  ]);
  await audit(env, user.id, "attempt.grade", "attempt", att.id, "final=" + res.final);
  return json({ ok: true, final: res.final, score: res.score, max: res.max, percent: res.percent });
}

/* ---------- الاستيراد والتصدير ---------- */
async function importPreview(ctx) {
  const { env } = ctx, b = await readJson(ctx.request, 1500000), { sid } = await gate(ctx, b.subject_id);
  const items = Array.isArray(b.items) ? b.items.slice(0, MAX_IMPORT) : [];
  if (!items.length) throw new HttpError(400, "items_required");
  const hashes = [], seenInBatch = new Map(), out = [];
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {}, type = it.type;
    const c = cleanContent(type, it.content || it);
    if (!c.ok) { out.push({ index: i, ok: false, errors: c.errors, type }); hashes.push(null); continue; }
    const hash = await sha256Hex(hashBasis(type, c.content)); hashes.push(hash);
    const dupInBatch = seenInBatch.has(hash) ? seenInBatch.get(hash) : null; seenInBatch.set(hash, dupInBatch ?? i);
    out.push({ index: i, ok: true, type, text: c.content.text.slice(0, 160), points: c.content.points, duplicate_in_batch: dupInBatch, needs_review: it.needs_review ? String(it.needs_review).slice(0, 200) : undefined });
  }
  const valid = [...new Set(hashes.filter(Boolean))];
  const existing = valid.length ? await selectIn(env, `SELECT id, content_hash FROM qb_questions WHERE subject_id=${sid} AND status != 'archived' AND content_hash IN`, valid) : [];
  const byHash = new Map(); existing.forEach((r) => (byHash.get(r.content_hash) || byHash.set(r.content_hash, []).get(r.content_hash)).push(r.id));
  out.forEach((o, i) => { if (o.ok && byHash.has(hashes[i])) o.duplicate_of = byHash.get(hashes[i]).slice(0, 5); });
  return json({ total: items.length, valid: out.filter((o) => o.ok).length, invalid: out.filter((o) => !o.ok).length, duplicates: out.filter((o) => o.duplicate_of || o.duplicate_in_batch !== null && o.duplicate_in_batch !== undefined).length, items: out });
}

async function importCommit(ctx) {
  const { env, user, now } = ctx, b = await readJson(ctx.request, 1500000), { sid } = await gate(ctx, b.subject_id);
  const items = Array.isArray(b.items) ? b.items.slice(0, MAX_IMPORT) : [];
  if (!items.length) throw new HttpError(400, "items_required");
  const refs = await checkRefs(env, sid, { lecture_id: b.lecture_id, category_id: b.category_id });
  const rows = [], skipped = [], seen = new Set();
  for (let i = 0; i < items.length; i++) {
    const it = items[i] || {}, c = cleanContent(it.type, it.content || it);
    if (!c.ok) { skipped.push({ index: i, reason: "invalid", errors: c.errors }); continue; }
    const hash = await sha256Hex(hashBasis(it.type, c.content));
    if (seen.has(hash)) { skipped.push({ index: i, reason: "duplicate_in_batch" }); continue; }
    seen.add(hash);
    rows.push({ type: it.type, diff: [1, 2, 3].includes(Number(it.difficulty)) ? Number(it.difficulty) : 2, content: JSON.stringify(c.content), search: searchText(c.content), hash, points: c.content.points, tags: cleanTags(it.tags), index: i });
  }
  let kept = rows;
  if (b.skip_duplicates !== false && rows.length) {
    const ex = new Set((await selectIn(env, `SELECT content_hash FROM qb_questions WHERE subject_id=${sid} AND status != 'archived' AND content_hash IN`, rows.map((r) => r.hash))).map((r) => r.content_hash));
    kept = rows.filter((r) => { if (ex.has(r.hash)) { skipped.push({ index: r.index, reason: "duplicate_existing" }); return false; } return true; });
  }
  if (!kept.length) return json({ ok: true, created: 0, skipped }, 200);
  const maxBefore = (await env.DB.prepare("SELECT COALESCE(MAX(id),0) m FROM qb_questions").first()).m;
  const j = JSON.stringify(kept);
  // الأسئلة المستوردة مسودات دائماً: لا نشر تلقائي قبل مراجعة المشرف
  await env.DB.prepare("INSERT INTO qb_questions (subject_id, lecture_id, category_id, type, status, difficulty, content_json, search_text, content_hash, points, version, created_by, updated_by, created_at, updated_at) SELECT ?,?,?, json_extract(value,'$.type'), 'draft', json_extract(value,'$.diff'), json_extract(value,'$.content'), json_extract(value,'$.search'), json_extract(value,'$.hash'), json_extract(value,'$.points'), 1, ?, ?, ?, ? FROM json_each(?)").bind(sid, refs.lecture_id ?? null, refs.category_id ?? null, user.id, user.id, now, now, j).run();
  const ids = (await env.DB.prepare("SELECT id FROM qb_questions WHERE id > ? AND created_by=? AND created_at=? ORDER BY id").bind(maxBefore, user.id, now).all()).results.map((r) => r.id);
  const links = ids.flatMap((id, n) => (kept[n] ? kept[n].tags : []).map((t) => ({ q: id, t })));
  const stmts = [env.DB.prepare("INSERT INTO qb_question_versions (question_id, version, content_json, status, changed_by, changed_at, change_summary) SELECT id, 1, content_json, 'draft', ?, ?, 'استيراد' FROM qb_questions WHERE id > ? AND created_by=? AND created_at=?").bind(user.id, now, maxBefore, user.id, now)];
  if (links.length) { const lj = JSON.stringify(links); stmts.push(env.DB.prepare("INSERT OR IGNORE INTO qb_tags (name) SELECT DISTINCT json_extract(value,'$.t') FROM json_each(?)").bind(lj), env.DB.prepare("INSERT OR IGNORE INTO qb_question_tags (question_id, tag_id) SELECT json_extract(l.value,'$.q'), t.id FROM json_each(?) l JOIN qb_tags t ON t.name=json_extract(l.value,'$.t')").bind(lj)); }
  await env.DB.batch(stmts);
  await audit(env, user.id, "question.import", "subject", sid, kept.length + " drafts");
  return json({ ok: true, created: ids.length, ids, skipped }, 201);
}

async function exportQuestions(ctx) {
  const { env, url, user } = ctx, p = url.searchParams, { sid, review } = await gate(ctx, p.get("subject"));
  const where = ["subject_id=?"], args = [sid], st = p.get("status");
  if (st && QSTATUS.includes(st)) { where.push("status=?"); args.push(st); }
  const lec = posInt(p.get("lecture")); if (lec) { where.push("lecture_id=?"); args.push(lec); }
  if (!review) { where.push("(created_by=? OR status IN ('published','approved'))"); args.push(user.id); }
  const rows = (await env.DB.prepare(`SELECT * FROM qb_questions WHERE ${where.join(" AND ")} ORDER BY id LIMIT 5000`).bind(...args).all()).results;
  const tg = await tagsFor(env, rows.map((r) => r.id));
  return json({ format: "iraq-platform-qb", version: 1, exported_at: ctx.now, subject_id: sid, count: rows.length, questions: rows.map((r) => ({ id: r.id, type: r.type, status: r.status, difficulty: r.difficulty, lecture_id: r.lecture_id, category_id: r.category_id, tags: tg[r.id] || [], content: parseJson(r.content_json, {}) })) });
}

async function stats(ctx) {
  const { env, url } = ctx, { sid } = await gate(ctx, url.searchParams.get("subject"));
  const [st, ty, df, rep, qz, rev] = await Promise.all([
    env.DB.prepare("SELECT status, COUNT(*) n FROM qb_questions WHERE subject_id=? GROUP BY status").bind(sid).all(),
    env.DB.prepare("SELECT type, COUNT(*) n FROM qb_questions WHERE subject_id=? AND status != 'archived' GROUP BY type").bind(sid).all(),
    env.DB.prepare("SELECT difficulty, COUNT(*) n FROM qb_questions WHERE subject_id=? AND status != 'archived' GROUP BY difficulty").bind(sid).all(),
    env.DB.prepare("SELECT COUNT(*) n FROM qb_reports r JOIN qb_questions q ON q.id=r.question_id WHERE q.subject_id=? AND r.status='open'").bind(sid).first(),
    env.DB.prepare("SELECT status, COUNT(*) n FROM qb_quizzes WHERE subject_id=? GROUP BY status").bind(sid).all(),
    env.DB.prepare("SELECT COUNT(*) n FROM qb_attempts a JOIN qb_quizzes z ON z.id=a.quiz_id WHERE z.subject_id=? AND a.status='submitted' AND a.final=0").bind(sid).first()
  ]);
  return json({ questions_by_status: st.results, questions_by_type: ty.results, questions_by_difficulty: df.results, open_reports: rep.n, quizzes_by_status: qz.results, awaiting_grading: rev.n });
}

async function auditLog(ctx) {
  const pol = await getPol(ctx); if (!pol.admin) throw new HttpError(403, "forbidden");
  const rows = (await ctx.env.DB.prepare("SELECT a.id, a.actor_id, u.name AS actor, a.action, a.entity, a.entity_id, a.detail, a.at FROM qb_audit a LEFT JOIN users u ON u.id=a.actor_id ORDER BY a.id DESC LIMIT ?").bind(toInt(ctx.url.searchParams.get("limit"), 100, 1, 500)).all()).results;
  return json({ audit: rows });
}

// معاينة سؤال كما يراه الطالب (بلا مفاتيح) لمحرر الأسئلة.
async function previewQuestion(ctx) {
  const b = await readJson(ctx.request, 100000);
  const c = cleanContent(b.type, b.content);
  if (!c.ok) throw new HttpError(422, "invalid_question", { details: c.errors });
  return json({ question: publicQuestion({ ...c.content, id: "preview", shuffle: !!b.shuffle }, randomId(4)) });
}

/* ---------- الموجّه ---------- */
export async function handleQbAdmin(ctx) {
  const { parts, request } = ctx, m = request.method, [, x, y, z] = parts;
  if (m !== "GET" && (request.headers.get("content-type") || "").indexOf("json") < 0 && m !== "DELETE") throw new HttpError(415, "json_required");
  const id = posInt(y);
  if (x === "me" && m === "GET") return me(ctx);
  if (x === "stats" && m === "GET") return stats(ctx);
  if (x === "audit" && m === "GET") return auditLog(ctx);
  if (x === "questions") {
    if (m === "GET" && !y) return listQuestions(ctx);
    if (m === "POST" && !y) return createQuestion(ctx);
    if (m === "POST" && y === "bulk") return bulk(ctx);
  }
  if (x === "question" && id) {
    if (m === "GET") return getQuestion(ctx, id);
    if (m === "PUT") return updateQuestion(ctx, id);
    if (m === "DELETE") return deleteQuestion(ctx, id);
    if (m === "POST" && z === "status") return changeStatus(ctx, id);
  }
  if (x === "preview" && m === "POST") return previewQuestion(ctx);
  if (x === "duplicates" && m === "GET") return duplicates(ctx);
  if (x === "merge" && m === "POST") return merge(ctx);
  if (x === "categories") return categories(ctx, parts);
  if (x === "tags" && m === "GET") return tags(ctx);
  if (x === "cases") return cases(ctx, parts);
  if (x === "quizzes") { if (m === "GET") return listQuizzes(ctx); if (m === "POST" && !y) return createQuiz(ctx); if (m === "POST" && y === "generate") return generate(ctx); }
  if (x === "quiz" && id) {
    if (m === "GET" && !z) { const q = await loadQuiz(ctx.env, id); const { review } = await gate(ctx, q.subject_id); if (!review && q.created_by !== ctx.user.id && q.status === "draft") throw new HttpError(404, "not_found"); return json({ ...(await quizDoc(ctx.env, q)), can_review: review }); }
    if (m === "PUT" && !z) return saveQuiz(ctx, id);
    if (m === "DELETE" && !z) return deleteQuiz(ctx, id);
    if (m === "POST" && z === "status") return quizStatus(ctx, id);
    if (m === "POST" && z === "duplicate") return duplicateQuiz(ctx, id);
    if (m === "GET" && z === "stats") return quizStats(ctx, id);
  }
  if (x === "templates") return templates(ctx, parts);
  if (x === "reports") return reports(ctx, parts);
  if (x === "grading" && m === "GET" && !y) return gradingList(ctx);
  if (x === "attempt" && y) { if (m === "GET") return gradingGet(ctx, y); if (m === "POST" && z === "grade") return gradingPost(ctx, y); }
  if (x === "import" && m === "POST") { if (y === "preview") return importPreview(ctx); if (y === "commit") return importCommit(ctx); }
  if (x === "export" && m === "GET") return exportQuestions(ctx);
  throw new HttpError(404, "not_found");
}
