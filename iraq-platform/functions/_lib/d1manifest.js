// functions/_lib/d1manifest.js — قائمة الملفات المرفوعة في D1 بدل مفتاح KV واحد.
// كل ملف صف مستقل؛ التعديل يكتب الصفوف التي تغيّرت فقط فلا يضيع رفع متزامن. يُستورد manifest.json القديم مرة واحدة.
const FLAG = "manifest_from_kv";

async function importOnce(DB, kv) {
  const done = await DB.prepare("SELECT 1 AS x FROM import_flags WHERE name = ?").bind(FLAG).first();
  if (done) return;
  let list = [];
  try { const m = await kv.get("manifest.json", { type: "json" }); if (Array.isArray(m)) list = m; } catch (_) { /* لا قائمة قديمة */ }
  const stmts = list.filter((e) => e && e.id).map((e) =>
    DB.prepare("INSERT OR IGNORE INTO upload_manifest(id, course_id, json) VALUES(?,?,?)").bind(String(e.id), e.courseId || null, JSON.stringify(e)));
  for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
  await DB.prepare("INSERT OR IGNORE INTO import_flags(name, at) VALUES(?,?)").bind(FLAG, Date.now()).run();
}

// ذاكرة مؤقتة قصيرة داخل العامل: كل فتح لملف أو تحميل uploads.js كان يقرأ كل صفوف القائمة (يستهلك حصة D1 المجانية).
const CACHE_MS = 30000;
let cache = { db: null, at: 0, list: null };
export function resetManifestCache() { cache = { db: null, at: 0, list: null }; }

export function d1Manifest(DB, kv) {
  let ready = null;
  const init = () => (ready ||= importOnce(DB, kv).catch((e) => { ready = null; throw e; }));
  const load = async () => {
    await init();
    const rows = (await DB.prepare("SELECT json FROM upload_manifest ORDER BY seq").all()).results || [];
    return rows.map((r) => { try { return JSON.parse(r.json); } catch { return null; } }).filter(Boolean);
  };
  const read = async () => {
    if (cache.db === DB && cache.list && Date.now() - cache.at < CACHE_MS) return structuredClone(cache.list);
    const list = await load();
    cache = { db: DB, at: Date.now(), list };
    return structuredClone(list);
  };
  return {
    read,
    async update(mutate) {
      resetManifestCache(); // الكتابة تقرأ من D1 مباشرة لتفادي ضياع رفع متزامن
      const before = await load();
      const next = mutate(before);
      const old = new Map(before.map((e) => [e.id, JSON.stringify(e)]));
      const keep = new Set(next.map((e) => e.id));
      const stmts = [];
      for (const e of next) {
        const j = JSON.stringify(e);
        if (old.get(e.id) === j) continue;
        stmts.push(DB.prepare("INSERT INTO upload_manifest(id, course_id, json) VALUES(?,?,?) ON CONFLICT(id) DO UPDATE SET course_id = excluded.course_id, json = excluded.json").bind(String(e.id), e.courseId || null, j));
      }
      for (const id of old.keys()) if (!keep.has(id)) stmts.push(DB.prepare("DELETE FROM upload_manifest WHERE id = ?").bind(id));
      for (let i = 0; i < stmts.length; i += 50) await DB.batch(stmts.slice(i, i + 50));
      resetManifestCache();
      return next;
    }
  };
}

/* قراءة القائمة لبقية الوحدات (المساعد الذكي، العدّادات): D1 إن كان متاحاً وإلا KV القديم */
export async function readUploads(env) {
  if (env.DB && env.LECTURES) {
    try { return await d1Manifest(env.DB, env.LECTURES).read(); } catch (_) { /* قبل تنفيذ 0018 */ }
  }
  if (!env.LECTURES) return [];
  const m = await env.LECTURES.get("manifest.json", { type: "json" });
  return Array.isArray(m) ? m : (m && m.items) || [];
}
