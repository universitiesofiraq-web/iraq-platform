// functions/_lib/migrate.js — يطبّق ترحيلات D1 الناقصة تلقائياً عند أول طلب API بعد كل نشر.
// كل ملفات migrations/*.sql تستعمل IF NOT EXISTS فتُعاد بأمان على قاعدة قديمة أو جديدة.
// يسجّل ما طُبّق في جدول _schema_migrations، وإن فشل ترحيل يُعاد بعد دقيقة دون تعطيل الموقع.
import { MIGRATIONS } from "./migrations.generated.js";

// يقسم ملف SQL إلى جمل منفصلة مع احترام كتل BEGIN ... END داخل TRIGGER.
export function splitSql(text) {
  const clean = text.split("\n").filter((l) => !l.trim().startsWith("--")).join("\n");
  const out = [];
  let buf = "";
  for (const part of clean.split(";")) {
    buf += (buf ? ";" : "") + part;
    const isTrigger = /^\s*CREATE\s+(TEMP\s+|TEMPORARY\s+)?TRIGGER\b/i.test(buf);
    if (isTrigger && !/\bEND\s*$/i.test(part.trim())) continue;
    if (buf.trim()) out.push(buf.trim());
    buf = "";
  }
  if (buf.trim()) out.push(buf.trim());
  return out;
}

let done = false;
let running = null;
let retryAt = 0;

export async function ensureSchema(env, migrations = MIGRATIONS) {
  if (!env.DB) return;
  if (done && migrations === MIGRATIONS) return;
  if (Date.now() < retryAt) return;
  if (!running) {
    running = apply(env, migrations).then((ok) => {
      if (migrations === MIGRATIONS) { done = ok; retryAt = ok ? 0 : Date.now() + 60000; }
      return ok;
    }).finally(() => { running = null; });
  }
  await running;
}

export function resetSchemaState() { done = false; running = null; retryAt = 0; }

async function apply(env, migrations) {
  let ok = true;
  try {
    await env.DB.prepare("CREATE TABLE IF NOT EXISTS _schema_migrations (name TEXT PRIMARY KEY, applied_at INTEGER NOT NULL)").run();
    const seen = new Set(((await env.DB.prepare("SELECT name FROM _schema_migrations").all()).results || []).map((r) => r.name));
    for (const [name, text] of migrations) {
      if (seen.has(name)) continue;
      let failed = false;
      for (const statement of splitSql(text)) {
        try { await env.DB.prepare(statement).run(); }
        catch (e) {
          if (/already exists|duplicate column/i.test(String(e && e.message))) continue;
          failed = true;
          console.error("migration failed", name, String(e && e.message).slice(0, 200));
        }
      }
      if (failed) { ok = false; continue; }
      await env.DB.prepare("INSERT OR IGNORE INTO _schema_migrations (name, applied_at) VALUES (?,?)").bind(name, Date.now()).run();
    }
  } catch (e) {
    console.error("schema check failed", String(e && e.message).slice(0, 200));
    return false;
  }
  return ok;
}
