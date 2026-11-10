import test from "node:test";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";
import { ensureSchema, resetSchemaState, splitSql } from "../functions/_lib/migrate.js";
import { MIGRATIONS } from "../functions/_lib/migrations.generated.js";

function rawD1(db) {
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { changes: Number(r.changes) } }; }
  });
  return { prepare: (sql) => stmt(sql) };
}
const names = (db) => db.prepare("SELECT name FROM sqlite_master WHERE type IN ('table','trigger','index')").all().map((r) => r.name);

test("generated migrations list matches migrations/*.sql", () => {
  execFileSync("node", ["scripts/gen-migrations.mjs", "--check"], { cwd: new URL("..", import.meta.url) });
  const files = readdirSync(new URL("../migrations/", import.meta.url)).filter((n) => n.endsWith(".sql")).sort();
  assert.deepEqual(MIGRATIONS.map((m) => m[0] + ".sql"), files);
});

test("triggers are not split in the middle", () => {
  const trig = splitSql(readFileSync(new URL("../migrations/0009_university_onboarding.sql", import.meta.url), "utf8"));
  assert.equal(trig.filter((s) => /CREATE TRIGGER/i.test(s)).length, 2);
  assert.ok(trig.every((s) => !/CREATE TRIGGER/i.test(s) || /END$/i.test(s)));
});

test("a database with no tables gets every migration, and rerunning is a no-op", async () => {
  resetSchemaState();
  const db = new DatabaseSync(":memory:");
  await ensureSchema({ DB: rawD1(db) }, MIGRATIONS);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM _schema_migrations").get().n, MIGRATIONS.length);
  for (const t of ["university_onboarding", "global_admins", "stage_announcements", "ai_dept_files", "student_verification"]) assert.ok(names(db).includes(t), t);
  db.exec("INSERT INTO users (id,google_sub,email,name,created_at) VALUES (1,'a','a@x','A',0)");
  db.exec("INSERT INTO universities (id,slug,name_ar) VALUES (1,'u','ج')");
  db.exec("INSERT INTO university_onboarding (university_id,state,manager_id,updated_at,updated_by) VALUES (1,'registered',1,1,1)");
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM university_onboarding_audit").get().n, 1);
  resetSchemaState();
  await ensureSchema({ DB: rawD1(db) }, MIGRATIONS);
  assert.equal(db.prepare("SELECT COUNT(*) AS n FROM _schema_migrations").get().n, MIGRATIONS.length);
});

test("an old database keeps its data and only misses the new tables", async () => {
  resetSchemaState();
  const db = new DatabaseSync(":memory:");
  for (const [name, sql] of MIGRATIONS) if (name < "0009") db.exec(sql);
  db.exec("INSERT INTO universities (id,slug,name_ar) VALUES (9,'b','البصرة')");
  assert.ok(!names(db).includes("university_onboarding"));
  await ensureSchema({ DB: rawD1(db) }, MIGRATIONS);
  assert.ok(names(db).includes("university_onboarding"));
  assert.equal(db.prepare("SELECT name_ar FROM universities WHERE id=9").get().name_ar, "البصرة");
});
