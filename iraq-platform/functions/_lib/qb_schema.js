// functions/_lib/qb_schema.js — بوابات بنك الأسئلة وترحيله المعزول.
// القاعدة: لا شيء من بنك الأسئلة يعمل ما لم يكن QB_ENABLED=1. ولا يُنشأ أي جدول qb_ ما لم يكن QB_MIGRATE=1 أيضاً.
// لذلك يبقى الإنتاج بلا تغيير حتى لو وصل الكود إليه. اضبط المتغيرين في بيئة Preview فقط وبقاعدة D1 منفصلة عن الإنتاج.
import { QB_MIGRATIONS } from "./qb_migrations.generated.js";
import { splitSql } from "./migrate.js";

export const qbEnabled = (env) => !!env && env.QB_ENABLED === "1" && !!env.DB;
export const qbMigrateAllowed = (env) => qbEnabled(env) && env.QB_MIGRATE === "1";

let done = false, running = null, retryAt = 0;
export function resetQbSchemaState() { done = false; running = null; retryAt = 0; }

// يطبّق ترحيلات qb الناقصة فقط (جداول جديدة IF NOT EXISTS) ويسجّلها في _qb_schema (جدول منفصل عن _schema_migrations).
export async function ensureQbSchema(env, migrations = QB_MIGRATIONS) {
  if (!qbMigrateAllowed(env)) return { applied: false, reason: "migrate_disabled" };
  if (done && migrations === QB_MIGRATIONS) return { applied: true };
  if (Date.now() < retryAt) return { applied: false, reason: "retry_later" };
  if (!running) {
    running = apply(env, migrations).then((ok) => { if (migrations === QB_MIGRATIONS) { done = ok; retryAt = ok ? 0 : Date.now() + 60000; } return ok; }).finally(() => { running = null; });
  }
  const ok = await running;
  return { applied: ok };
}

async function apply(env, migrations) {
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS _qb_schema (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)").run();
    const seen = new Set(((await env.DB.prepare("SELECT name FROM _qb_schema").all()).results || []).map((r) => r.name));
    for (const [name, text] of migrations) {
      if (seen.has(name)) continue;
      for (const statement of splitSql(text)) {
        try { await env.DB.prepare(statement).run(); }
        catch (e) { if (/already exists|duplicate column/i.test(String(e && e.message))) continue; console.error("qb migration failed", name, String(e && e.message).slice(0, 200)); return false; }
      }
      await env.DB.prepare("INSERT OR IGNORE INTO _qb_schema (name, applied_at) VALUES (?,?)").bind(name, Date.now()).run();
    }
    return true;
  } catch (e) { console.error("qb schema error", String(e && e.message).slice(0, 200)); return false; }
}

// هل جداول qb جاهزة؟ (للرد الصريح 503 بدل خطأ SQL غامض)
export async function qbReady(env) {
  try { await env.DB.prepare("SELECT 1 FROM qb_questions LIMIT 1").first(); return true; }
  catch (e) { if (/no such table/i.test(String(e && e.message))) return false; throw e; }
}
