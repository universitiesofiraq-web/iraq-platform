// tests/mock_d1.mjs — يحاكي واجهة D1 التي نستخدمها (prepare/bind/first/all/run وbatch) فوق node:sqlite.
import { DatabaseSync } from "node:sqlite";
import { readFileSync, readdirSync } from "node:fs";

export function createMockD1({ without = [] } = {}) {
  const db = new DatabaseSync(":memory:");
  // كل ملفات migrations بالترتيب؛ without: ["0006"] يتخطى ملفاً برقمه
  for (const f of readdirSync(new URL("../migrations/", import.meta.url)).filter((n) => n.endsWith(".sql")).sort()) {
    if (without.includes(f.slice(0, 4))) continue;
    db.exec(readFileSync(new URL("../migrations/" + f, import.meta.url), "utf8"));
  }
  const stmt = (sql, args = []) => ({
    bind: (...a) => stmt(sql, a),
    async first() { return db.prepare(sql).get(...args) || null; },
    async all() { return { results: db.prepare(sql).all(...args) }; },
    async run() { const r = db.prepare(sql).run(...args); return { meta: { last_row_id: Number(r.lastInsertRowid), changes: Number(r.changes) } }; }
  });
  return { prepare: (sql) => stmt(sql), async batch(list) { for (const s of list) await s.run(); }, _db: db };
}
