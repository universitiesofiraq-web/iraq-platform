// functions/_lib/qb.js — واجهة API لبنك الأسئلة (جانب الطالب) + الموجّه العام. مسارات /api/qb/*.
// الأمان: لا يعمل شيء بلا QB_ENABLED=1؛ كل المسارات تتطلب تسجيل الدخول؛ التصحيح على الخادم فقط؛ مفاتيح الإجابة لا تغادر الخادم
// إلا في وضع التدريب بعد إجابة الطالب، أو بعد تسليم الامتحان وفق إعدادات الاختبار؛ المحاولة لا يراها إلا صاحبها (وإلا 404).
import { qbEnabled, ensureQbSchema, qbReady } from "./qb_schema.js";
import { gradeAttempt, gradeAnswer, publicQuestion, revealQuestion, seededShuffle } from "./qb_grade.js";
import { computeVisible, logicDisabled } from "./qb_logic.js";
import { normalizeText } from "./qb_grade.js";
import { HttpError, json, fail, sameOrigin, readJson, toInt, posInt, randomId, rateLimit, parseJson, placeholders, selectIn } from "./qb_util.js";
import { handleQbAdmin } from "./qb_admin.js";

export const GRACE_MS = 5000;           // سماح لتأخر الشبكة بعد انتهاء الوقت المحدد من الخادم
export const MAX_ANSWER_BYTES = 8000;   // حد حجم إجابة سؤال واحد
const MAX_ATTEMPT_BYTES = 400000;
const BOX_DAYS = [0, 1, 3, 7, 14, 30];
const DAY = 86400000;

/* ---------- تحويل الصفوف ---------- */
export const rowToQuestion = (row) => ({ ...parseJson(row.content_json, {}), id: String(row.id), type: row.type, points: row.points });
const qMeta = (row, catName) => ({ cat: row.category_id || 0, catName: catName || "", diff: row.difficulty, lecture: row.lecture_id || 0, subject: row.subject_id, caseId: row.case_id || 0 });

export function effectiveQuizStatus(q, now) {
  if (q.status === "scheduled") return q.starts_at && now >= q.starts_at ? (q.ends_at && now > q.ends_at ? "closed" : "published") : "scheduled";
  if (q.status === "published") {
    if (q.ends_at && now > q.ends_at) return "closed";
    if (q.starts_at && now < q.starts_at) return "scheduled";
  }
  return q.status;
}
export const quizSettings = (row) => ({ allowBack: true, showResults: true, allowReview: true, showExplanations: true, ...parseJson(row.settings_json, {}) });

/* ---------- اللقطة والعرض ---------- */
// يبني لقطة ثابتة من أسئلة جاهزة. items: [{id, kind, qid?, content?, section?, required?, points_override?}] بترتيبها.
export function buildSnapshot({ quiz, kind, mode, settings, sections = [], items, rules = [], questions, cases = {}, seed }) {
  const official = logicDisabled(settings, mode);
  let list = items.map((it, i) => ({ ...it, position: i + 1 }));
  if (settings.shuffleQuestions) {
    // نخلط الأسئلة داخل كل قسم ونثبّت بقية العناصر
    const groups = new Map();
    list.forEach((it) => { const k = it.section || "_"; if (!groups.has(k)) groups.set(k, []); groups.get(k).push(it); });
    const out = [];
    for (const [k, g] of groups) {
      const qs = seededShuffle(g.filter((x) => x.kind === "question"), seed + ":sec:" + k);
      let n = 0; out.push(...g.map((x) => (x.kind === "question" ? qs[n++] : x)));
    }
    list = out.map((it, i) => ({ ...it, position: i + 1 }));
  }
  const qmap = {};
  for (const it of list) if (it.kind === "question") {
    const base = questions[it.qid];
    qmap[it.qid] = { q: { ...base.q, points: it.points_override > 0 ? it.points_override : base.q.points, shuffle: !!settings.shuffleOptions || !!base.q.shuffle }, meta: base.meta };
  }
  return {
    v: 1, kind, mode,
    quiz: quiz ? { id: quiz.id, title: quiz.title, version: quiz.version, pass_score: quiz.pass_score ?? null, duration_sec: quiz.duration_sec ?? null } : null,
    settings: { allowBack: settings.allowBack !== false, showResults: settings.showResults !== false, allowReview: settings.allowReview !== false, showExplanations: settings.showExplanations !== false, official: !!settings.official, shuffleOptions: !!settings.shuffleOptions },
    sections: sections.map((s) => ({ id: String(s.id), title: s.title, description: s.description || "" })),
    items: list.map((it) => ({ id: String(it.id), kind: it.kind, qid: it.kind === "question" ? String(it.qid) : undefined, content: it.content, position: it.position, section: it.section ? String(it.section) : undefined, required: !!it.required })),
    rules: official ? [] : rules,
    questions: qmap, cases
  };
}

const answersByItem = (snap, answers) => Object.fromEntries(snap.items.filter((i) => i.kind === "question" && Object.prototype.hasOwnProperty.call(answers, i.qid)).map((i) => [i.id, answers[i.qid]]));
export const visibleItems = (snap, answers) => computeVisible(snap.items, snap.rules, answersByItem(snap, answers), { disabled: logicDisabled(snap.settings, snap.mode) });
const visibleQuestions = (snap, answers) => { const vis = visibleItems(snap, answers); return snap.items.filter((i) => i.kind === "question" && vis.has(i.id)).map((i) => snap.questions[i.qid].q); };

export function publicAttempt(att, snap, now) {
  return {
    id: att.id, kind: att.kind, mode: att.mode, status: att.status, rev: att.rev,
    started_at: att.started_at, deadline_at: att.deadline_at, server_now: now,
    quiz: snap.quiz, settings: snap.settings, sections: snap.sections, rules: snap.rules,
    cases: snap.cases,
    items: snap.items.map((i) => i.kind === "question"
      ? { id: i.id, kind: "question", qid: i.qid, section: i.section, required: i.required, q: { ...publicQuestion(snap.questions[i.qid].q, att.seed), difficulty: snap.questions[i.qid].meta.diff, caseId: snap.questions[i.qid].meta.caseId || undefined } }
      : { id: i.id, kind: i.kind, content: i.content, section: i.section }),
    answers: parseJson(att.answers_json, {}), flags: parseJson(att.flags_json, [])
  };
}

/* ---------- التسليم والتصحيح ---------- */
function breakdown(snap, per) {
  const byQ = new Map(per.map((r) => [r.id, r]));
  const groups = (keyOf, nameOf) => {
    const m = new Map();
    for (const [qid, e] of Object.entries(snap.questions)) {
      const r = byQ.get(qid); if (!r) continue;
      const k = keyOf(e.meta), g = m.get(k) || { key: k, name: nameOf(e.meta), score: 0, max: 0, correct: 0, total: 0 };
      g.max += r.max; g.score += Math.max(0, typeof r.score === "number" ? r.score : 0); g.total += 1; if (r.status === "correct") g.correct += 1;
      m.set(k, g);
    }
    return [...m.values()].map((g) => ({ ...g, score: Math.round(g.score * 100) / 100, percent: g.max ? Math.round((g.score / g.max) * 1000) / 10 : 0 }));
  };
  const cats = groups((m) => m.cat, (m) => m.catName || "بدون تصنيف").sort((a, b) => a.percent - b.percent);
  const diffs = groups((m) => m.diff, (m) => ({ 1: "سهل", 2: "متوسط", 3: "صعب" }[m.diff] || "متوسط")).sort((a, b) => a.key - b.key);
  return { categories: cats, difficulty: diffs, strengths: cats.filter((c) => c.percent >= 80 && c.total >= 1).map((c) => c.name), review: cats.filter((c) => c.percent < 60).map((c) => c.name) };
}

export async function submitAttempt(env, att, extra, now) {
  const snap = parseJson(att.snapshot_json, null);
  if (!snap) throw new HttpError(500, "corrupt_attempt");
  const open = !att.deadline_at || now <= att.deadline_at + GRACE_MS;
  const answers = { ...parseJson(att.answers_json, {}) };
  if (open && extra && typeof extra === "object") for (const [k, v] of Object.entries(extra)) if (snap.questions[k] && JSON.stringify(v ?? null).length <= MAX_ANSWER_BYTES) { if (v === null) delete answers[k]; else answers[k] = v; }
  const questions = visibleQuestions(snap, answers);
  const res = gradeAttempt(questions, answers, { passScore: snap.quiz && snap.quiz.pass_score != null ? snap.quiz.pass_score : undefined });
  const seconds = Math.max(0, Math.round((Math.min(now, att.deadline_at ? att.deadline_at : now) - att.started_at) / 1000));
  const answered = res.correct + res.partial + res.wrong;
  const result = {
    score: res.score, max: res.max, percent: res.percent, correct: res.correct, partial: res.partial, wrong: res.wrong, unanswered: res.unanswered, pending: res.pending, final: res.final,
    passed: res.passed ?? null, seconds, avgSeconds: answered ? Math.round(seconds / answered) : 0,
    perQuestion: res.perQuestion.map((r) => ({ id: r.id, score: r.score, max: r.max, status: r.status })),
    breakdown: breakdown(snap, res.perQuestion), hidden: snap.items.filter((i) => i.kind === "question" && !questions.some((q) => q.id === i.qid)).map((i) => i.qid)
  };
  const upd = await env.DB.prepare("UPDATE qb_attempts SET status=?, answers_json=?, submitted_at=?, score=?, max_score=?, percent=?, final=?, result_json=?, rev=rev+1 WHERE id=? AND status='in_progress'")
    .bind(res.final ? "graded" : "submitted", JSON.stringify(answers), now, res.score, res.max, res.percent, res.final ? 1 : 0, JSON.stringify(result), att.id).run();
  if (!(upd.meta && upd.meta.changes === 1)) return null; // سبقه تسليم آخر: يُعاد المخزَّن
  await recordResults(env, att, snap, answers, res.perQuestion, now);
  return result;
}

// صفوف الإجابات والإحصاءات بعدد ثابت من الاستعلامات (json_each) تحسباً لحدود الخطة المجانية.
async function recordResults(env, att, snap, answers, per, now) {
  const rows = per.map((r) => {
    const e = snap.questions[r.id], seen = r.status === "correct" || r.status === "partial" || r.status === "wrong";
    return { q: Number(r.id), a: JSON.stringify(answers[r.id] ?? null), s: r.score, m: r.max, st: r.status, subj: e.meta.subject, cat: e.meta.cat, diff: e.meta.diff, ok: r.status === "correct" ? 1 : 0, seen: seen ? 1 : 0, c: r.status === "correct" ? 1 : 0, p: r.status === "partial" ? 1 : 0, w: r.status === "wrong" ? 1 : 0, u: r.status === "unanswered" ? 1 : 0 };
  });
  if (!rows.length) return;
  const j = JSON.stringify(rows);
  await env.DB.batch([
    env.DB.prepare("INSERT OR REPLACE INTO qb_attempt_answers (attempt_id, question_id, answer_json, score, max_score, status) SELECT ?, json_extract(value,'$.q'), json_extract(value,'$.a'), json_extract(value,'$.s'), json_extract(value,'$.m'), json_extract(value,'$.st') FROM json_each(?)").bind(att.id, j),
    env.DB.prepare("INSERT INTO qb_question_stats (question_id, attempts, correct, partial, wrong, unanswered, updated_at) SELECT json_extract(value,'$.q'), 1, json_extract(value,'$.c'), json_extract(value,'$.p'), json_extract(value,'$.w'), json_extract(value,'$.u'), ? FROM json_each(?) WHERE true ON CONFLICT(question_id) DO UPDATE SET attempts=attempts+1, correct=correct+excluded.correct, partial=partial+excluded.partial, wrong=wrong+excluded.wrong, unanswered=unanswered+excluded.unanswered, updated_at=excluded.updated_at").bind(now, j),
    env.DB.prepare("INSERT INTO qb_student_stats (user_id, subject_id, category_id, difficulty, answered, correct, updated_at) SELECT ?, json_extract(value,'$.subj'), json_extract(value,'$.cat'), json_extract(value,'$.diff'), SUM(json_extract(value,'$.seen')), SUM(json_extract(value,'$.ok')), ? FROM json_each(?) GROUP BY json_extract(value,'$.subj'), json_extract(value,'$.cat'), json_extract(value,'$.diff') HAVING SUM(json_extract(value,'$.seen')) > 0 ON CONFLICT(user_id, subject_id, category_id, difficulty) DO UPDATE SET answered=answered+excluded.answered, correct=correct+excluded.correct, updated_at=excluded.updated_at").bind(att.user_id, now, j),
    env.DB.prepare("INSERT INTO qb_seen (user_id, question_id, last_correct, seen_count, wrong_count, last_at) SELECT ?, json_extract(value,'$.q'), json_extract(value,'$.ok'), 1, 1 - json_extract(value,'$.ok'), ? FROM json_each(?) WHERE json_extract(value,'$.seen') = 1 ON CONFLICT(user_id, question_id) DO UPDATE SET last_correct=excluded.last_correct, seen_count=seen_count+1, wrong_count=wrong_count+excluded.wrong_count, last_at=excluded.last_at").bind(att.user_id, now, j)
  ]);
}

// عرض النتيجة حسب إعدادات الاختبار. للتدريب: كل شيء ظاهر.
export function resultView(att, snap) {
  const r = parseJson(att.result_json, null);
  if (!r) return null;
  const practice = att.mode === "practice";
  const s = snap.settings;
  const base = { attempt_id: att.id, status: att.status, mode: att.mode, final: !!r.final, submitted_at: att.submitted_at, quiz: snap.quiz };
  if (!practice && !s.showResults) return { ...base, hidden: true, message: "تم تسليم الاختبار. النتيجة غير معروضة حسب إعدادات الاختبار." };
  const out = { ...base, score: r.score, max: r.max, percent: r.percent, correct: r.correct, partial: r.partial, wrong: r.wrong, unanswered: r.unanswered, pending: r.pending, passed: r.final ? r.passed : null, seconds: r.seconds, avgSeconds: r.avgSeconds, breakdown: r.breakdown };
  if (!r.final) out.note = "النتيجة غير نهائية: توجد أسئلة تنتظر التصحيح اليدوي.";
  if (practice || s.allowReview) {
    const answers = parseJson(att.answers_json, {});
    const byQ = new Map(r.perQuestion.map((p) => [p.id, p]));
    out.review = snap.items.filter((i) => i.kind === "question" && byQ.has(i.qid)).map((i) => {
      const e = snap.questions[i.qid], p = byQ.get(i.qid), rv = revealQuestion(e.q);
      if (!practice && !s.showExplanations) { rv.explanation = null; rv.feedbackCorrect = null; rv.feedbackWrong = null; }
      return { qid: i.qid, question: publicQuestion(e.q, att.seed), answer: answers[i.qid] ?? null, score: p.score, max: p.max, status: p.status, reveal: rv, caseId: e.meta.caseId || undefined };
    });
  }
  return out;
}

/* ---------- جلب الأسئلة والحالات ---------- */
const COLS = "q.id, q.subject_id, q.lecture_id, q.category_id, q.case_id, q.type, q.status, q.difficulty, q.content_json, q.points, q.version";
export async function loadQuestions(env, ids, { onlyPublished = false } = {}) {
  const rows = await selectIn(env, `SELECT ${COLS}, c.name AS cat_name FROM qb_questions q LEFT JOIN qb_categories c ON c.id=q.category_id WHERE ${onlyPublished ? "q.status='published' AND " : ""}q.id IN`, ids);
  return Object.fromEntries(rows.map((r) => [String(r.id), { q: rowToQuestion(r), meta: qMeta(r, r.cat_name), row: r }]));
}
export async function loadCases(env, ids, onlyPublished = true) {
  const uniq = [...new Set(ids.filter(Boolean))];
  if (!uniq.length) return {};
  const rows = await selectIn(env, `SELECT id, title, body_json FROM qb_cases WHERE ${onlyPublished ? "status='published' AND " : ""}id IN`, uniq);
  return Object.fromEntries(rows.map((r) => [String(r.id), { id: r.id, title: r.title, ...parseJson(r.body_json, {}) }]));
}
const studentQuestion = (e) => ({ ...publicQuestion(e.q, "list"), difficulty: e.meta.diff, lecture: e.meta.lecture || null, category: e.meta.cat || null, caseId: e.meta.caseId || null });

/* ---------- الاختبار الذكي ---------- */
async function pickSmart(env, user, o, seed, now) {
  const subject = posInt(o.subject_id);
  if (!subject) throw new HttpError(400, "subject_required");
  const where = ["q.subject_id=?", "q.status='published'"], args = [subject];
  const ints = (v) => (Array.isArray(v) ? v.map(Number).filter((n) => Number.isSafeInteger(n) && n > 0).slice(0, 50) : []);
  const lectures = ints(o.lectures), cats = ints(o.categories), diffs = ints(o.difficulty).filter((d) => d >= 1 && d <= 3);
  const types = Array.isArray(o.types) ? o.types.filter((t) => typeof t === "string" && /^[a-z]{2,10}$/.test(t)).slice(0, 12) : [];
  if (lectures.length) { where.push(`q.lecture_id IN (${placeholders(lectures.length)})`); args.push(...lectures); }
  if (cats.length) { where.push(`q.category_id IN (${placeholders(cats.length)})`); args.push(...cats); }
  if (diffs.length) { where.push(`q.difficulty IN (${placeholders(diffs.length)})`); args.push(...diffs); }
  if (types.length) { where.push(`q.type IN (${placeholders(types.length)})`); args.push(...types); }
  const filter = ["all", "new", "wrong", "bookmarked", "unfinished"].includes(o.filter) ? o.filter : "all";
  let join = "";
  if (filter === "new") where.push("NOT EXISTS (SELECT 1 FROM qb_seen s WHERE s.user_id=? AND s.question_id=q.id)"), args.push(user.id);
  if (filter === "wrong") join = " JOIN qb_seen s ON s.question_id=q.id AND s.user_id=? AND s.last_correct=0", args.unshift(user.id);
  if (filter === "bookmarked") join = " JOIN qb_bookmarks b ON b.question_id=q.id AND b.user_id=?", args.unshift(user.id);
  if (filter === "unfinished") where.push("EXISTS (SELECT 1 FROM qb_attempt_answers aa JOIN qb_attempts at ON at.id=aa.attempt_id WHERE at.user_id=? AND aa.question_id=q.id AND aa.status='unanswered')"), args.push(user.id);
  const pool = (await env.DB.prepare(`SELECT q.id, q.content_hash FROM qb_questions q${join} WHERE ${where.join(" AND ")} LIMIT 2000`).bind(...args).all()).results || [];
  const count = toInt(o.count, 10, 1, 100);
  const seen = new Set(), picked = [];
  for (const r of seededShuffle(pool, seed)) { if (seen.has(r.content_hash)) continue; seen.add(r.content_hash); picked.push(r.id); if (picked.length >= count) break; }
  return picked;
}

/* ---------- المسارات ---------- */
async function createAttempt(ctx) {
  const { env, user, now } = ctx, body = await readJson(ctx.request);
  if (!(await rateLimit(env, user.id, "attempt", 60, 3600000, now))) throw new HttpError(429, "rate_limited");
  const seed = randomId(8), id = randomId(16);
  let quiz = null, settings, mode, kind, items = [], sections = [], rules = [], duration = null;
  if (body.quiz_id !== undefined) {
    const qid = posInt(body.quiz_id);
    quiz = qid && await env.DB.prepare("SELECT * FROM qb_quizzes WHERE id=?").bind(qid).first();
    if (!quiz) throw new HttpError(404, "quiz_not_found");
    const st = effectiveQuizStatus(quiz, now);
    if (st !== "published") throw new HttpError(403, st === "scheduled" ? "quiz_not_open_yet" : "quiz_closed");
    // محاولة جارية صالحة؟ نكملها بدل إنشاء مكررة. منتهية؟ نسلّمها أولاً.
    const open = await env.DB.prepare("SELECT * FROM qb_attempts WHERE quiz_id=? AND user_id=? AND status='in_progress' ORDER BY started_at DESC LIMIT 1").bind(quiz.id, user.id).first();
    if (open) {
      if (open.deadline_at && now > open.deadline_at + GRACE_MS) await submitAttempt(env, open, null, now);
      else return json({ attempt: publicAttempt(open, parseJson(open.snapshot_json, {}), now), resumed: true });
    }
    const used = (await env.DB.prepare("SELECT COUNT(*) n FROM qb_attempts WHERE quiz_id=? AND user_id=?").bind(quiz.id, user.id).first()).n;
    if (quiz.attempts_allowed > 0 && used >= quiz.attempts_allowed) throw new HttpError(403, "attempts_exhausted");
    settings = quizSettings(quiz); mode = quiz.mode; kind = "quiz"; duration = quiz.duration_sec;
    sections = (await env.DB.prepare("SELECT id, title, description FROM qb_quiz_sections WHERE quiz_id=? ORDER BY position").bind(quiz.id).all()).results;
    const its = (await env.DB.prepare("SELECT id, section_id, kind, question_id, content_json, points_override, required FROM qb_quiz_items WHERE quiz_id=? ORDER BY position").bind(quiz.id).all()).results;
    rules = (await env.DB.prepare("SELECT kind, source_item_id, op, value_json, target_item_id FROM qb_quiz_conditions WHERE quiz_id=?").bind(quiz.id).all()).results.map((r) => ({ kind: r.kind, source: String(r.source_item_id), op: r.op, value: parseJson(r.value_json, null), target: String(r.target_item_id) }));
    items = its.map((i) => ({ id: i.id, kind: i.kind, qid: i.question_id ? String(i.question_id) : undefined, content: parseJson(i.content_json, {}), section: i.section_id || undefined, required: i.required, points_override: i.points_override }));
  } else if (body.smart && typeof body.smart === "object") {
    mode = body.smart.mode === "exam" ? "exam" : "practice"; kind = "smart";
    settings = { allowBack: true, showResults: true, allowReview: true, showExplanations: true, shuffleOptions: true };
    duration = body.smart.duration_min > 0 ? Math.min(240, Number(body.smart.duration_min)) * 60 : null;
    const ids = await pickSmart(env, user, body.smart, seed, now);
    if (!ids.length) throw new HttpError(404, "no_matching_questions");
    items = ids.map((q) => ({ id: "i" + q, kind: "question", qid: String(q) }));
  } else throw new HttpError(400, "quiz_or_smart_required");

  const qids = [...new Set(items.filter((i) => i.kind === "question").map((i) => i.qid))];
  if (!qids.length) throw new HttpError(409, "quiz_has_no_questions");
  const questions = await loadQuestions(env, qids, { onlyPublished: !quiz });
  if (quiz && qids.some((q) => !questions[q])) throw new HttpError(409, "quiz_has_missing_questions");
  items = items.filter((i) => i.kind !== "question" || questions[i.qid]);
  const cases = await loadCases(env, Object.values(questions).map((e) => e.meta.caseId));
  const snap = buildSnapshot({ quiz, kind, mode, settings, sections, items, rules, questions, cases, seed });
  const deadline = duration ? now + duration * 1000 : null;
  await env.DB.prepare("INSERT INTO qb_attempts (id, quiz_id, user_id, kind, mode, status, snapshot_json, seed, started_at, deadline_at) VALUES (?,?,?,?,?, 'in_progress', ?,?,?,?)")
    .bind(id, quiz ? quiz.id : null, user.id, kind, mode, JSON.stringify(snap), seed, now, deadline).run();
  const att = { id, user_id: user.id, kind, mode, status: "in_progress", rev: 0, seed, started_at: now, deadline_at: deadline, answers_json: "{}", flags_json: "[]" };
  return json({ attempt: publicAttempt(att, snap, now), resumed: false }, 201);
}

async function ownAttempt(ctx, id) {
  if (!/^[0-9a-f]{32}$/.test(id || "")) throw new HttpError(404, "not_found");
  const att = await ctx.env.DB.prepare("SELECT * FROM qb_attempts WHERE id=? AND user_id=?").bind(id, ctx.user.id).first();
  if (!att) throw new HttpError(404, "not_found"); // لا نفرّق بين غير موجود وملك غيره
  return att;
}
const finish = async (ctx, att) => { const r = await submitAttempt(ctx.env, att, null, ctx.now); return r ? att.id : att.id; };

async function attemptRoutes(ctx, id, sub) {
  const { env, request, now, user } = ctx, method = request.method;
  let att = await ownAttempt(ctx, id);
  if (att.status === "in_progress" && att.deadline_at && now > att.deadline_at + GRACE_MS) { await finish(ctx, att); att = await ownAttempt(ctx, id); }
  const snap = parseJson(att.snapshot_json, null);
  if (!snap) throw new HttpError(500, "corrupt_attempt");

  if (!sub && method === "GET") {
    if (att.status !== "in_progress") return json({ attempt: { id: att.id, status: att.status, mode: att.mode }, result: resultView(att, snap) });
    return json({ attempt: publicAttempt(att, snap, now) });
  }
  if (sub === "result" && method === "GET") {
    if (att.status === "in_progress") throw new HttpError(409, "not_submitted");
    return json({ result: resultView(att, snap) });
  }
  if (sub === "answers" && method === "PUT") {
    if (!sameOrigin(request)) throw new HttpError(403, "bad_origin");
    if (att.status !== "in_progress") throw new HttpError(409, "closed");
    if (!(await rateLimit(env, user.id, "save", 3000, 3600000, now))) throw new HttpError(429, "rate_limited");
    const body = await readJson(request, 120000);
    const answers = parseJson(att.answers_json, {}), incoming = body.answers && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : {};
    for (const [k, v] of Object.entries(incoming)) {
      if (!snap.questions[k]) continue;
      if (v === null) { delete answers[k]; continue; }
      if (JSON.stringify(v).length > MAX_ANSWER_BYTES) throw new HttpError(413, "answer_too_large");
      answers[k] = v;
    }
    let flags = parseJson(att.flags_json, []);
    if (Array.isArray(body.flags)) flags = [...new Set(body.flags.map(String))].filter((f) => snap.questions[f]).slice(0, 500);
    const text = JSON.stringify(answers);
    if (text.length > MAX_ATTEMPT_BYTES) throw new HttpError(413, "attempt_too_large");
    const r = await env.DB.prepare("UPDATE qb_attempts SET answers_json=?, flags_json=?, rev=rev+1 WHERE id=? AND status='in_progress'").bind(text, JSON.stringify(flags), att.id).run();
    if (!(r.meta && r.meta.changes === 1)) throw new HttpError(409, "closed");
    return json({ ok: true, rev: att.rev + 1, server_now: now, deadline_at: att.deadline_at });
  }
  if (sub === "check" && method === "POST") {
    if (!sameOrigin(request)) throw new HttpError(403, "bad_origin");
    if (att.mode !== "practice") throw new HttpError(403, "not_available_in_exam");
    if (att.status !== "in_progress") throw new HttpError(409, "closed");
    const body = await readJson(request, 20000), qid = String(body.qid ?? "");
    const e = snap.questions[qid];
    if (!e) throw new HttpError(404, "question_not_found");
    const res = gradeAnswer(e.q, body.answer);
    const answers = parseJson(att.answers_json, {});
    if (body.answer !== undefined && body.answer !== null && JSON.stringify(body.answer).length <= MAX_ANSWER_BYTES) { answers[qid] = body.answer; await env.DB.prepare("UPDATE qb_attempts SET answers_json=?, rev=rev+1 WHERE id=? AND status='in_progress'").bind(JSON.stringify(answers), att.id).run(); }
    return json({ result: res, reveal: revealQuestion(e.q) });
  }
  if (sub === "submit" && method === "POST") {
    if (!sameOrigin(request)) throw new HttpError(403, "bad_origin");
    if (att.status === "in_progress") {
      const body = await readJson(request, 400000).catch(() => ({}));
      await submitAttempt(env, att, body && typeof body.answers === "object" && !Array.isArray(body.answers) ? body.answers : null, now);
      att = await ownAttempt(ctx, id); // إن سبقه تسليم آخر فالنتيجة المخزّنة هي المعتمدة
    }
    return json({ result: resultView(att, snap) });
  }
  throw new HttpError(404, "not_found");
}

/* ---------- قوائم الطالب ---------- */
async function listSubjects(ctx) {
  const r = await ctx.env.DB.prepare("SELECT sb.id, sb.name_ar, sb.name_en, (SELECT COUNT(*) FROM qb_questions q WHERE q.subject_id=sb.id AND q.status='published') AS questions, (SELECT COUNT(*) FROM qb_quizzes z WHERE z.subject_id=sb.id AND z.status IN ('published','scheduled')) AS quizzes FROM subjects sb WHERE sb.id IN (SELECT subject_id FROM qb_questions WHERE status='published' UNION SELECT subject_id FROM qb_quizzes WHERE status IN ('published','scheduled')) ORDER BY sb.name_ar LIMIT 500").all();
  return json({ subjects: r.results });
}

async function subjectDetail(ctx, sid) {
  const { env, now, user } = ctx;
  const subject = await env.DB.prepare("SELECT id, name_ar, name_en FROM subjects WHERE id=?").bind(sid).first();
  if (!subject) throw new HttpError(404, "not_found");
  const [lectures, categories, types, quizzes, due] = await Promise.all([
    env.DB.prepare("SELECT l.id, l.number, l.title, (SELECT COUNT(*) FROM qb_questions q WHERE q.lecture_id=l.id AND q.status='published') AS questions FROM lectures l WHERE l.subject_id=? ORDER BY l.number").bind(sid).all(),
    env.DB.prepare("SELECT c.id, c.name, c.parent_id, (SELECT COUNT(*) FROM qb_questions q WHERE q.category_id=c.id AND q.status='published') AS questions FROM qb_categories c WHERE c.subject_id=? ORDER BY c.name").bind(sid).all(),
    env.DB.prepare("SELECT type, difficulty, COUNT(*) n FROM qb_questions WHERE subject_id=? AND status='published' GROUP BY type, difficulty").bind(sid).all(),
    env.DB.prepare("SELECT z.*, (SELECT COUNT(*) FROM qb_quiz_items i WHERE i.quiz_id=z.id AND i.kind='question') AS question_count, (SELECT COUNT(*) FROM qb_attempts a WHERE a.quiz_id=z.id AND a.user_id=?) AS used FROM qb_quizzes z WHERE z.subject_id=? AND z.status IN ('published','scheduled','closed') ORDER BY z.created_at DESC LIMIT 100").bind(user.id, sid).all(),
    env.DB.prepare("SELECT COUNT(*) n FROM qb_card_state cs JOIN qb_questions q ON q.id=cs.question_id WHERE cs.user_id=? AND cs.due_at<=? AND q.subject_id=? AND q.status='published'").bind(user.id, now, sid).first()
  ]);
  return json({
    subject, lectures: lectures.results, categories: categories.results, types: types.results, cards_due: due ? due.n : 0,
    quizzes: quizzes.results.map((z) => ({ id: z.id, title: z.title, description: z.description, mode: z.mode, status: effectiveQuizStatus(z, now), duration_sec: z.duration_sec, attempts_allowed: z.attempts_allowed, used: z.used, starts_at: z.starts_at, ends_at: z.ends_at, question_count: z.question_count, lecture_id: z.lecture_id })).filter((z) => z.status !== "draft" && z.status !== "archived")
  });
}

async function listQuestions(ctx) {
  const { env, user, url } = ctx, p = url.searchParams;
  const subject = posInt(p.get("subject"));
  if (!subject) throw new HttpError(400, "subject_required");
  const where = ["q.subject_id=?", "q.status='published'"], args = [subject];
  const lecture = posInt(p.get("lecture")), cat = posInt(p.get("category")), diff = toInt(p.get("difficulty"), 0, 0, 3);
  if (lecture) { where.push("q.lecture_id=?"); args.push(lecture); }
  if (cat) { where.push("q.category_id=?"); args.push(cat); }
  if (diff) { where.push("q.difficulty=?"); args.push(diff); }
  const type = p.get("type"); if (type && /^[a-z]{2,10}$/.test(type)) { where.push("q.type=?"); args.push(type); }
  const term = normalizeText(p.get("q") || "").slice(0, 80);
  if (term) { where.push("q.search_text LIKE ? ESCAPE '\\'"); args.push("%" + term.replace(/[\\%_]/g, (c) => "\\" + c) + "%"); }
  const limit = toInt(p.get("limit"), 20, 1, 50), offset = toInt(p.get("offset"), 0, 0, 100000);
  const total = (await env.DB.prepare(`SELECT COUNT(*) n FROM qb_questions q WHERE ${where.join(" AND ")}`).bind(...args).first()).n;
  const rows = (await env.DB.prepare(`SELECT ${COLS}, c.name AS cat_name FROM qb_questions q LEFT JOIN qb_categories c ON c.id=q.category_id WHERE ${where.join(" AND ")} ORDER BY q.lecture_id, q.id LIMIT ? OFFSET ?`).bind(...args, limit, offset).all()).results;
  const ids = rows.map((r) => r.id);
  const marks = ids.length ? await selectIn(env, `SELECT question_id FROM qb_bookmarks WHERE user_id=${Number(user.id)} AND question_id IN`, ids) : [];
  const seen = ids.length ? await selectIn(env, `SELECT question_id, last_correct FROM qb_seen WHERE user_id=${Number(user.id)} AND question_id IN`, ids) : [];
  const bm = new Set(marks.map((m) => m.question_id)), sn = new Map(seen.map((s) => [s.question_id, s.last_correct]));
  const cases = await loadCases(env, rows.map((r) => r.case_id));
  return json({ total, offset, questions: rows.map((r) => ({ ...studentQuestion({ q: rowToQuestion(r), meta: qMeta(r, r.cat_name) }), bookmarked: bm.has(r.id), seen: sn.has(r.id), lastCorrect: sn.has(r.id) ? !!sn.get(r.id) : null })), cases });
}

// تدريب سؤال واحد من البنك: يكشف الإجابة بعد أن يجيب الطالب (وضع التدريب).
async function checkQuestion(ctx) {
  const { env, user, now } = ctx, body = await readJson(ctx.request, 20000);
  if (!(await rateLimit(env, user.id, "check", 900, 3600000, now))) throw new HttpError(429, "rate_limited");
  const id = posInt(body.question_id);
  const e = id && (await loadQuestions(env, [id], { onlyPublished: true }))[String(id)];
  if (!e) throw new HttpError(404, "not_found");
  if (body.answer === undefined || body.answer === null || JSON.stringify(body.answer).length > MAX_ANSWER_BYTES) throw new HttpError(400, "answer_required");
  const res = gradeAnswer(e.q, body.answer);
  const seen = res.status === "correct" || res.status === "partial" || res.status === "wrong";
  if (seen) {
    const ok = res.status === "correct" ? 1 : 0;
    await env.DB.batch([
      env.DB.prepare("INSERT INTO qb_seen (user_id, question_id, last_correct, seen_count, wrong_count, last_at) VALUES (?,?,?,1,?,?) ON CONFLICT(user_id, question_id) DO UPDATE SET last_correct=excluded.last_correct, seen_count=seen_count+1, wrong_count=wrong_count+excluded.wrong_count, last_at=excluded.last_at").bind(user.id, id, ok, 1 - ok, now),
      env.DB.prepare("INSERT INTO qb_student_stats (user_id, subject_id, category_id, difficulty, answered, correct, updated_at) VALUES (?,?,?,?,1,?,?) ON CONFLICT(user_id, subject_id, category_id, difficulty) DO UPDATE SET answered=answered+1, correct=correct+excluded.correct, updated_at=excluded.updated_at").bind(user.id, e.meta.subject, e.meta.cat, e.meta.diff, ok, now),
      env.DB.prepare("INSERT INTO qb_question_stats (question_id, attempts, correct, partial, wrong, unanswered, updated_at) VALUES (?,1,?,?,?,0,?) ON CONFLICT(question_id) DO UPDATE SET attempts=attempts+1, correct=correct+excluded.correct, partial=partial+excluded.partial, wrong=wrong+excluded.wrong, updated_at=excluded.updated_at").bind(id, ok, res.status === "partial" ? 1 : 0, res.status === "wrong" ? 1 : 0, now)
    ]);
  }
  return json({ result: res, reveal: revealQuestion(e.q) });
}

async function bookmarks(ctx, parts) {
  const { env, user, request, now } = ctx;
  if (request.method === "GET") {
    const rows = (await env.DB.prepare(`SELECT ${COLS}, c.name AS cat_name FROM qb_bookmarks b JOIN qb_questions q ON q.id=b.question_id AND q.status='published' LEFT JOIN qb_categories c ON c.id=q.category_id WHERE b.user_id=? ORDER BY b.created_at DESC LIMIT 200`).bind(user.id).all()).results;
    return json({ questions: rows.map((r) => ({ ...studentQuestion({ q: rowToQuestion(r), meta: qMeta(r, r.cat_name) }), bookmarked: true, subject: r.subject_id })), cases: await loadCases(env, rows.map((r) => r.case_id)) });
  }
  if (!sameOrigin(request)) throw new HttpError(403, "bad_origin");
  const id = posInt(parts[1]);
  if (!id) throw new HttpError(400, "bad_id");
  if (request.method === "PUT") {
    const q = await env.DB.prepare("SELECT 1 FROM qb_questions WHERE id=? AND status='published'").bind(id).first();
    if (!q) throw new HttpError(404, "not_found");
    const n = (await env.DB.prepare("SELECT COUNT(*) n FROM qb_bookmarks WHERE user_id=?").bind(user.id).first()).n;
    if (n >= 2000) throw new HttpError(409, "bookmark_limit");
    await env.DB.prepare("INSERT OR IGNORE INTO qb_bookmarks (user_id, question_id, created_at) VALUES (?,?,?)").bind(user.id, id, now).run();
    return json({ ok: true, bookmarked: true });
  }
  if (request.method === "DELETE") { await env.DB.prepare("DELETE FROM qb_bookmarks WHERE user_id=? AND question_id=?").bind(user.id, id).run(); return json({ ok: true, bookmarked: false }); }
  throw new HttpError(405, "method_not_allowed");
}

async function reportQuestion(ctx) {
  const { env, user, now } = ctx, body = await readJson(ctx.request, 8000);
  if (!(await rateLimit(env, user.id, "report", 30, 86400000, now))) throw new HttpError(429, "rate_limited");
  const id = posInt(body.question_id), reason = ["wrong_answer", "typo", "unclear", "outdated", "other"].includes(body.reason) ? body.reason : null;
  if (!id || !reason) throw new HttpError(400, "invalid_report");
  const q = await env.DB.prepare("SELECT 1 FROM qb_questions WHERE id=? AND status='published'").bind(id).first();
  if (!q) throw new HttpError(404, "not_found");
  const details = String(body.details || "").trim().slice(0, 1000);
  await env.DB.prepare("INSERT INTO qb_reports (question_id, user_id, reason, details, created_at) VALUES (?,?,?,?,?) ON CONFLICT(question_id, user_id, reason) DO UPDATE SET details=excluded.details, status='open', created_at=excluded.created_at").bind(id, user.id, reason, details, now).run();
  return json({ ok: true }, 201);
}

// مراجعة: أخطاء، غير مجابة، محفوظة.
async function reviewList(ctx) {
  const { env, user, url } = ctx, p = url.searchParams, kind = p.get("kind") || "wrong", subject = posInt(p.get("subject"));
  const limit = toInt(p.get("limit"), 30, 1, 50);
  const sub = subject ? " AND q.subject_id=" + subject : "";
  let sql;
  if (kind === "wrong") sql = `SELECT ${COLS}, c.name AS cat_name FROM qb_seen s JOIN qb_questions q ON q.id=s.question_id AND q.status='published'${sub} LEFT JOIN qb_categories c ON c.id=q.category_id WHERE s.user_id=? AND s.last_correct=0 ORDER BY s.last_at DESC LIMIT ?`;
  else if (kind === "unanswered") sql = `SELECT DISTINCT ${COLS}, c.name AS cat_name FROM qb_attempt_answers aa JOIN qb_attempts at ON at.id=aa.attempt_id JOIN qb_questions q ON q.id=aa.question_id AND q.status='published'${sub} LEFT JOIN qb_categories c ON c.id=q.category_id WHERE at.user_id=? AND aa.status='unanswered' LIMIT ?`;
  else throw new HttpError(400, "bad_kind");
  const rows = (await env.DB.prepare(sql).bind(user.id, limit).all()).results;
  return json({ questions: rows.map((r) => ({ ...studentQuestion({ q: rowToQuestion(r), meta: qMeta(r, r.cat_name) }), subject: r.subject_id })), cases: await loadCases(env, rows.map((r) => r.case_id)) });
}

// بطاقات تعليمية (تكرار متباعد): المستحقة أولاً ثم الجديدة.
async function cards(ctx, parts) {
  const { env, user, now, request, url } = ctx, sub = parts[1];
  if (request.method === "GET" && !sub) {
    const subject = posInt(url.searchParams.get("subject")); if (!subject) throw new HttpError(400, "subject_required");
    const limit = toInt(url.searchParams.get("limit"), 20, 1, 50);
    const due = (await env.DB.prepare(`SELECT ${COLS}, c.name AS cat_name, cs.box FROM qb_card_state cs JOIN qb_questions q ON q.id=cs.question_id AND q.status='published' AND q.subject_id=? LEFT JOIN qb_categories c ON c.id=q.category_id WHERE cs.user_id=? AND cs.due_at<=? ORDER BY cs.due_at LIMIT ?`).bind(subject, user.id, now, limit).all()).results;
    const room = limit - due.length;
    const fresh = room > 0 ? (await env.DB.prepare(`SELECT ${COLS}, c.name AS cat_name, 0 AS box FROM qb_questions q LEFT JOIN qb_categories c ON c.id=q.category_id WHERE q.subject_id=? AND q.status='published' AND q.type != 'essay' AND NOT EXISTS (SELECT 1 FROM qb_card_state cs WHERE cs.user_id=? AND cs.question_id=q.id) ORDER BY q.id LIMIT ?`).bind(subject, user.id, room).all()).results : [];
    const rows = [...due, ...fresh];
    const total = (await env.DB.prepare("SELECT COUNT(*) n FROM qb_card_state cs JOIN qb_questions q ON q.id=cs.question_id WHERE cs.user_id=? AND q.subject_id=? AND q.status='published'").bind(user.id, subject).first()).n;
    return json({ cards: rows.map((r) => ({ ...studentQuestion({ q: rowToQuestion(r), meta: qMeta(r, r.cat_name) }), box: r.box, isNew: !due.includes(r) })), cases: await loadCases(env, rows.map((r) => r.case_id)), learned: total });
  }
  if (!sameOrigin(request)) throw new HttpError(403, "bad_origin");
  const body = await readJson(request, 4000), id = posInt(body.question_id);
  if (!id) throw new HttpError(400, "bad_id");
  if (sub === "reveal" && request.method === "POST") {
    if (!(await rateLimit(env, user.id, "reveal", 900, 3600000, now))) throw new HttpError(429, "rate_limited");
    const e = (await loadQuestions(env, [id], { onlyPublished: true }))[String(id)];
    if (!e) throw new HttpError(404, "not_found");
    return json({ reveal: revealQuestion(e.q) });
  }
  if (sub === "rate" && request.method === "POST") {
    const rating = ["again", "hard", "good", "easy"].includes(body.rating) ? body.rating : null;
    if (!rating) throw new HttpError(400, "bad_rating");
    const q = await env.DB.prepare("SELECT 1 FROM qb_questions WHERE id=? AND status='published'").bind(id).first();
    if (!q) throw new HttpError(404, "not_found");
    const cur = (await env.DB.prepare("SELECT box, reps, lapses FROM qb_card_state WHERE user_id=? AND question_id=?").bind(user.id, id).first()) || { box: 0, reps: 0, lapses: 0 };
    let box = cur.box, lapses = cur.lapses, due;
    if (rating === "again") { box = 0; lapses += 1; due = now + 10 * 60000; }
    else { box = Math.min(5, rating === "hard" ? Math.max(1, cur.box) : cur.box + (rating === "easy" ? 2 : 1)); due = now + BOX_DAYS[box] * DAY; }
    await env.DB.prepare("INSERT INTO qb_card_state (user_id, question_id, box, due_at, reps, lapses, last_at) VALUES (?,?,?,?,?,?,?) ON CONFLICT(user_id, question_id) DO UPDATE SET box=excluded.box, due_at=excluded.due_at, reps=reps+1, lapses=excluded.lapses, last_at=excluded.last_at").bind(user.id, id, box, due, cur.reps + 1, lapses, now).run();
    return json({ ok: true, box, due_at: due });
  }
  throw new HttpError(404, "not_found");
}

async function myStats(ctx) {
  const { env, user, now } = ctx;
  const [totals, subjects, weak, recent, attempts, due] = await Promise.all([
    env.DB.prepare("SELECT COALESCE(SUM(answered),0) answered, COALESCE(SUM(correct),0) correct FROM qb_student_stats WHERE user_id=?").bind(user.id).first(),
    env.DB.prepare("SELECT s.subject_id, sb.name_ar, SUM(s.answered) answered, SUM(s.correct) correct FROM qb_student_stats s LEFT JOIN subjects sb ON sb.id=s.subject_id WHERE s.user_id=? GROUP BY s.subject_id ORDER BY answered DESC LIMIT 50").bind(user.id).all(),
    env.DB.prepare("SELECT s.subject_id, s.category_id, c.name, SUM(s.answered) answered, SUM(s.correct) correct FROM qb_student_stats s LEFT JOIN qb_categories c ON c.id=s.category_id WHERE s.user_id=? AND s.category_id>0 GROUP BY s.subject_id, s.category_id HAVING SUM(s.answered)>=3 ORDER BY (1.0*SUM(s.correct)/SUM(s.answered)) LIMIT 8").bind(user.id).all(),
    env.DB.prepare("SELECT s.difficulty, SUM(s.answered) answered, SUM(s.correct) correct FROM qb_student_stats s WHERE s.user_id=? GROUP BY s.difficulty").bind(user.id).all(),
    env.DB.prepare("SELECT COUNT(*) n, COALESCE(AVG(percent),0) avg FROM qb_attempts WHERE user_id=? AND status IN ('submitted','graded')").bind(user.id).first(),
    env.DB.prepare("SELECT COUNT(*) n FROM qb_card_state WHERE user_id=? AND due_at<=?").bind(user.id, now).first()
  ]);
  const wrong = (await env.DB.prepare("SELECT COUNT(*) n FROM qb_seen WHERE user_id=? AND last_correct=0").bind(user.id).first()).n;
  return json({ answered: totals.answered, correct: totals.correct, accuracy: totals.answered ? Math.round((totals.correct / totals.answered) * 1000) / 10 : 0, attempts: attempts.n, avg_percent: Math.round(attempts.avg * 10) / 10, wrong_pending: wrong, cards_due: due.n, subjects: subjects.results, weak_categories: weak.results, difficulty: recent.results });
}

async function myAttempts(ctx) {
  const rows = (await ctx.env.DB.prepare("SELECT a.id, a.kind, a.mode, a.status, a.started_at, a.submitted_at, a.score, a.max_score, a.percent, a.final, a.quiz_id, z.title FROM qb_attempts a LEFT JOIN qb_quizzes z ON z.id=a.quiz_id WHERE a.user_id=? ORDER BY a.started_at DESC LIMIT ?").bind(ctx.user.id, toInt(ctx.url.searchParams.get("limit"), 30, 1, 100)).all()).results;
  return json({ attempts: rows });
}

async function availableQuizzes(ctx) {
  const { env, now, user } = ctx;
  const rows = (await env.DB.prepare("SELECT z.id, z.subject_id, z.title, z.mode, z.status, z.duration_sec, z.attempts_allowed, z.starts_at, z.ends_at, sb.name_ar AS subject, (SELECT COUNT(*) FROM qb_quiz_items i WHERE i.quiz_id=z.id AND i.kind='question') AS question_count, (SELECT COUNT(*) FROM qb_attempts a WHERE a.quiz_id=z.id AND a.user_id=?) AS used, (SELECT id FROM qb_attempts a WHERE a.quiz_id=z.id AND a.user_id=? AND a.status='in_progress' LIMIT 1) AS open_attempt FROM qb_quizzes z LEFT JOIN subjects sb ON sb.id=z.subject_id WHERE z.status IN ('published','scheduled') ORDER BY z.created_at DESC LIMIT 100").bind(user.id, user.id).all()).results;
  return json({ quizzes: rows.map((z) => ({ ...z, status: effectiveQuizStatus(z, now) })).filter((z) => z.status === "published" || z.status === "scheduled") });
}

async function lastAttempt(ctx) {
  const row = await ctx.env.DB.prepare("SELECT a.id, a.status, a.mode, a.kind, a.started_at, a.percent, z.title FROM qb_attempts a LEFT JOIN qb_quizzes z ON z.id=a.quiz_id WHERE a.user_id=? ORDER BY a.started_at DESC LIMIT 1").bind(ctx.user.id).first();
  return json({ last: row || null });
}

/* ---------- الموجّه ---------- */
export async function handleQb(request, env, deps = {}) {
  const url = new URL(request.url);
  if (!url.pathname.startsWith("/api/qb/") && url.pathname !== "/api/qb") return null;
  if (!qbEnabled(env)) return null; // غير مفعّل: كأن المسار غير موجود، فيكمل الموجّه الرئيسي كما كان
  try {
    await ensureQbSchema(env);
    if (!(await qbReady(env))) return fail(503, "qb_not_migrated");
    const user = deps.currentUser ? await deps.currentUser(request, env) : null;
    if (!user) return fail(401, "unauthorized");
    const parts = url.pathname.slice("/api/qb/".length).split("/").filter(Boolean);
    const ctx = { request, env, user, url, parts, now: deps.now ? deps.now() : Date.now(), deps };
    const m = request.method, [a, b, c] = parts;
    if (!["GET", "HEAD"].includes(m) && !sameOrigin(request)) return fail(403, "bad_origin");

    if (a === "admin") return await handleQbAdmin(ctx);
    if (m === "GET") {
      if (a === "subjects") return await listSubjects(ctx);
      if (a === "subject" && posInt(b)) return await subjectDetail(ctx, posInt(b));
      if (a === "questions") return await listQuestions(ctx);
      if (a === "quizzes") return await availableQuizzes(ctx);
      if (a === "bookmarks") return await bookmarks(ctx, parts);
      if (a === "review") return await reviewList(ctx);
      if (a === "cards") return await cards(ctx, parts);
      if (a === "me" && b === "stats") return await myStats(ctx);
      if (a === "me" && b === "attempts") return await myAttempts(ctx);
      if (a === "me" && b === "last") return await lastAttempt(ctx);
      if (a === "attempts" && b) return await attemptRoutes(ctx, b, c);
    }
    if (a === "bookmarks") return await bookmarks(ctx, parts);
    if (m === "POST" && a === "check") return await checkQuestion(ctx);
    if (m === "POST" && a === "reports") return await reportQuestion(ctx);
    if (a === "cards") return await cards(ctx, parts);
    if (m === "POST" && a === "attempts" && !b) return await createAttempt(ctx);
    if (a === "attempts" && b) return await attemptRoutes(ctx, b, c);
    return fail(404, "not_found");
  } catch (e) {
    if (e instanceof HttpError) return json({ error: e.code, ...e.extra }, e.status);
    console.error("qb error", String(e && e.message).slice(0, 300));
    return fail(500, "server_error");
  }
}
