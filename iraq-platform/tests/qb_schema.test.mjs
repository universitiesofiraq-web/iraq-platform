// فحص قاعدة بيانات بنك الأسئلة (QB-002): العزل عن الإنتاج، الترحيل، القيود، التراجع. كله على SQLite محلي في الذاكرة.
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync, readdirSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { database } from "./helpers/d1.mjs";
import { MIGRATIONS } from "../functions/_lib/migrations.generated.js";
import { QB_MIGRATIONS } from "../functions/_lib/qb_migrations.generated.js";
import { ensureQbSchema, qbEnabled, qbMigrateAllowed, qbReady, resetQbSchemaState } from "../functions/_lib/qb_schema.js";
import { ensureSchema, resetSchemaState } from "../functions/_lib/migrate.js";

const qbSql = readFileSync(new URL("../migrations/qb/0001_question_bank.sql", import.meta.url), "utf8");
const tables = (sql) => sql.prepare("SELECT name FROM sqlite_master WHERE type='table' AND name NOT LIKE 'sqlite_%'").all().map((r) => r.name);
const qbTables = (sql) => tables(sql).filter((n) => n.startsWith("qb_"));

test("ترحيلات qb لا تدخل الترحيل التلقائي الرئيسي أبداً", () => {
  assert.equal(MIGRATIONS.some(([name, text]) => /qb_/.test(name) || /CREATE TABLE[^;]*qb_/i.test(text)), false);
  assert.equal(readdirSync(new URL("../migrations/", import.meta.url)).some((n) => /qb/i.test(n) && n.endsWith(".sql")), false);
  assert.deepEqual(QB_MIGRATIONS.map((m) => m[0]), ["qb_0001_question_bank"]);
});

test("الملف المولَّد يطابق ملف SQL", () => {
  assert.equal(QB_MIGRATIONS[0][1], qbSql);
});

test("البوابات: بلا QB_ENABLED لا يحدث شيء ولو طُلب الترحيل", async () => {
  resetQbSchemaState();
  const { DB, sql } = database();
  for (const env of [{ DB }, { DB, QB_MIGRATE: "1" }, { DB, QB_ENABLED: "0", QB_MIGRATE: "1" }, { DB, QB_ENABLED: "true", QB_MIGRATE: "1" }]) {
    assert.equal(qbEnabled(env), false);
    assert.equal(qbMigrateAllowed(env), false);
    assert.equal((await ensureQbSchema(env)).applied, false);
  }
  assert.equal(qbTables(sql).length, 0);
  assert.equal(tables(sql).includes("_qb_schema"), false);
  assert.equal(await qbReady({ DB }), false);
});

test("QB_ENABLED وحده لا ينشئ جداول (التفعيل غير الترحيل)", async () => {
  resetQbSchemaState();
  const { DB, sql } = database();
  const env = { DB, QB_ENABLED: "1" };
  assert.equal(qbEnabled(env), true);
  assert.equal(qbMigrateAllowed(env), false);
  assert.equal((await ensureQbSchema(env)).applied, false);
  assert.equal(qbTables(sql).length, 0);
});

test("الترحيل الرئيسي لا يلمس جداول qb حتى مع تفعيل الخيارين", async () => {
  resetSchemaState();
  const sql = new DatabaseSync(":memory:");
  const DB = { prepare(q) { let a = []; return { bind(...v) { a = v; return this; }, async first() { return sql.prepare(q).get(...a) ?? null; }, async all() { return { results: sql.prepare(q).all(...a) }; }, async run() { sql.prepare(q).run(...a); return {}; } }; } };
  await ensureSchema({ DB, QB_ENABLED: "1", QB_MIGRATE: "1" });
  assert.equal(qbTables(sql).length, 0);
  assert.ok(tables(sql).includes("users"));
});

test("الترحيل عند التفعيل الكامل: ينشئ 23 جدولاً ويسجّل نفسه ويُعاد بأمان", async () => {
  resetQbSchemaState();
  const { DB, sql } = database();
  const before = tables(sql).filter((n) => !n.startsWith("qb_"));
  const env = { DB, QB_ENABLED: "1", QB_MIGRATE: "1" };
  assert.equal((await ensureQbSchema(env)).applied, true);
  assert.equal(qbTables(sql).length, 23);
  assert.equal(await qbReady(env), true);
  assert.deepEqual(sql.prepare("SELECT name FROM _qb_schema").all().map((r) => r.name), ["qb_0001_question_bank"]);
  // لا تغيير في أي جدول قائم
  assert.deepEqual(tables(sql).filter((n) => !n.startsWith("qb_") && n !== "_qb_schema").sort(), before.sort());
  // إعادة التطبيق على قاعدة مطبَّقة لا تفشل ولا تكرر القوالب
  resetQbSchemaState();
  assert.equal((await ensureQbSchema(env)).applied, true);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM qb_templates").get().n, 10);
  sql.exec(qbSql); sql.exec(qbSql); // IF NOT EXISTS + INSERT OR IGNORE
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM qb_templates").get().n, 10);
});

test("قاعدة الاختبار تطبّق qb كاملاً على المخطط الحقيقي مع المفاتيح الأجنبية", () => {
  const { sql } = database();
  sql.exec(qbSql);
  assert.equal(sql.prepare("PRAGMA foreign_key_check").all().length, 0);
  const idx = sql.prepare("SELECT COUNT(*) n FROM sqlite_master WHERE type='index' AND name LIKE 'idx_qb_%'").get().n;
  assert.ok(idx >= 25, "فهارس qb: " + idx);
});

test("القيود: نوع وحالة وصعوبة ودرجة وبلاغ مكرر", () => {
  const { sql } = database();
  sql.exec(qbSql);
  const ins = (over = {}) => {
    const r = { subject_id: 1, type: "sba", status: "draft", difficulty: 2, content_json: "{}", content_hash: "h", points: 1, created_by: 1, updated_by: 1, created_at: 1, updated_at: 1, ...over };
    return sql.prepare("INSERT INTO qb_questions (subject_id,type,status,difficulty,content_json,content_hash,points,created_by,updated_by,created_at,updated_at) VALUES (:subject_id,:type,:status,:difficulty,:content_json,:content_hash,:points,:created_by,:updated_by,:created_at,:updated_at)").run(r);
  };
  const id = Number(ins().lastInsertRowid);
  for (const bad of [{ type: "x" }, { status: "live" }, { difficulty: 4 }, { difficulty: 0 }, { points: 0 }, { points: -1 }]) assert.throws(() => ins(bad), /CHECK|constraint/i, JSON.stringify(bad));
  for (const t of ["sba", "mcq", "mrq", "tf", "emq", "saq", "essay", "fill", "matching", "ordering", "numerical"]) ins({ type: t });
  sql.prepare("INSERT INTO qb_reports (question_id,user_id,reason,created_at) VALUES (?,?,?,?)").run(id, 5, "typo", 1);
  assert.throws(() => sql.prepare("INSERT INTO qb_reports (question_id,user_id,reason,created_at) VALUES (?,?,?,?)").run(id, 5, "typo", 2), /UNIQUE/);
  assert.throws(() => sql.prepare("INSERT INTO qb_reports (question_id,user_id,reason,created_at) VALUES (?,?,?,?)").run(id, 6, "bad", 2), /CHECK/);
  assert.throws(() => sql.prepare("INSERT INTO qb_quiz_items (quiz_id,kind,position) VALUES (999,'question',1)").run(), /FOREIGN KEY/);
  assert.throws(() => sql.prepare("INSERT INTO qb_quizzes (subject_id,title,mode,created_by,created_at,updated_at) VALUES (1,'t','oral',1,1,1)").run(), /CHECK/);
});

test("الحذف المتسلسل: حذف سؤال يزيل وسومه وعلاماته وبلاغاته فقط", () => {
  const { sql } = database();
  sql.exec("PRAGMA foreign_keys=ON");
  sql.exec(qbSql);
  sql.prepare("INSERT INTO qb_questions (id,subject_id,type,content_json,content_hash,created_by,updated_by,created_at,updated_at) VALUES (1,1,'tf','{}','a',1,1,1,1),(2,1,'tf','{}','b',1,1,1,1)").run();
  sql.prepare("INSERT INTO qb_tags (id,name) VALUES (1,'x')").run();
  sql.prepare("INSERT INTO qb_question_tags VALUES (1,1),(2,1)").run();
  sql.prepare("INSERT INTO qb_bookmarks VALUES (7,1,1),(7,2,1)").run();
  sql.prepare("INSERT INTO qb_card_state (user_id,question_id,due_at,last_at) VALUES (7,1,1,1)").run();
  sql.prepare("DELETE FROM qb_questions WHERE id=1").run();
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM qb_question_tags").get().n, 1);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM qb_bookmarks").get().n, 1);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM qb_card_state").get().n, 0);
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM qb_tags").get().n, 1);
});

test("المحاولة: النتيجة والإجابات تُحذف مع المحاولة، وحالة وفئة المحاولة مقيّدتان", () => {
  const { sql } = database();
  sql.exec("PRAGMA foreign_keys=ON");
  sql.exec(qbSql);
  const ins = (extra = {}) => sql.prepare("INSERT INTO qb_attempts (id,user_id,kind,mode,status,snapshot_json,seed,started_at) VALUES (?,?,?,?,?,?,?,?)").run(extra.id || "a1", 1, extra.kind || "quiz", extra.mode || "exam", extra.status || "in_progress", "{}", "s", 1);
  ins();
  sql.prepare("INSERT INTO qb_attempt_answers (attempt_id,question_id,max_score,status) VALUES ('a1',1,1,'correct')").run();
  assert.throws(() => ins({ id: "a2", status: "paused" }), /CHECK/);
  assert.throws(() => ins({ id: "a3", mode: "oral" }), /CHECK/);
  assert.throws(() => ins({ id: "a4", kind: "other" }), /CHECK/);
  assert.throws(() => ins({ id: "a1" }), /UNIQUE|PRIMARY/);
  sql.prepare("DELETE FROM qb_attempts WHERE id='a1'").run();
  assert.equal(sql.prepare("SELECT COUNT(*) n FROM qb_attempt_answers").get().n, 0);
});

test("التراجع اليدوي يحذف جداول qb فقط ولا يمس غيرها", () => {
  const { sql } = database();
  const before = tables(sql).sort();
  sql.exec(qbSql);
  assert.equal(qbTables(sql).length, 23);
  sql.exec(readFileSync(new URL("../migrations/qb/rollback/0001_question_bank.down.sql", import.meta.url), "utf8"));
  assert.equal(qbTables(sql).length, 0);
  assert.deepEqual(tables(sql).sort(), before);
  sql.exec(qbSql); // ويمكن إعادة التطبيق بعد التراجع
  assert.equal(qbTables(sql).length, 23);
});

test("ملفات الترحيل: كل جملة IF NOT EXISTS ولا حذف ولا تعديل لجدول قائم", () => {
  const stmts = qbSql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").split(";").map((s) => s.trim()).filter(Boolean);
  for (const s of stmts) {
    if (/^CREATE TABLE/i.test(s)) assert.match(s, /^CREATE TABLE IF NOT EXISTS qb_/i);
    else if (/^CREATE INDEX/i.test(s)) assert.match(s, /^CREATE INDEX IF NOT EXISTS idx_qb_\w+ ON qb_/i);
    else if (/^INSERT/i.test(s)) assert.match(s, /^INSERT OR IGNORE INTO qb_templates/i);
    else assert.fail("جملة غير مسموحة: " + s.slice(0, 60));
  }
  const code = qbSql.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n").replace(/ON (DELETE|UPDATE) (CASCADE|SET NULL|RESTRICT)/gi, "");
  assert.doesNotMatch(code, /\b(DROP|ALTER|DELETE|UPDATE)\b/i);
  // لا قيود أجنبية على جداول المنصة القائمة
  assert.doesNotMatch(qbSql, /REFERENCES\s+(users|subjects|lectures|files|sessions|colleges|departments)\b/i);
});
