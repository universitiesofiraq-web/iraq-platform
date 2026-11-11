// يمنع عودة مسح الجداول الكاملة في المسارات الساخنة، ويفحص الذاكرة المؤقتة لقائمة الرفع (حصة D1 المجانية).
import test from "node:test";
import assert from "node:assert/strict";
import { createMockD1 } from "./mock_d1.mjs";
import { d1Manifest, resetManifestCache } from "../functions/_lib/d1manifest.js";

const plan = (db, sql, n) => db._db.prepare("EXPLAIN QUERY PLAN " + sql).all(...Array(n).fill(null)).map((r) => r.detail).join(" | ");

test("الاستعلامات الساخنة تستعمل فهارس لا مسحاً كاملاً", () => {
  const db = createMockD1();
  const cases = [
    ["DELETE FROM sessions WHERE expires_at < ?", 1],
    ["SELECT id FROM users WHERE lower(email)=? AND active=1", 1],
    ["SELECT COALESCE(SUM(units),0) AS used FROM ai_quota_ledger WHERE day_key = ? AND status IN ('reserved','committed')", 1],
    ["SELECT chunk_id FROM ai_document_chunks WHERE user_id = ? ORDER BY rowid DESC LIMIT 600", 1],
    ["SELECT file_id FROM ai_dept_files WHERE department_key = ?", 1],
    ["SELECT COUNT(*) AS n FROM chat_reports WHERE reporter_id=? AND created_at>?", 2]
  ];
  for (const [sql, n] of cases) assert.doesNotMatch(plan(db, sql, n), /SCAN (sessions|users|ai_quota_ledger|ai_document_chunks|ai_dept_files|chat_reports)\b(?! USING)/, sql);
});

test("قائمة الرفع تُقرأ من D1 مرة واحدة خلال نافذة التخزين المؤقت وتُبطَل عند الكتابة", async () => {
  resetManifestCache();
  const db = createMockD1();
  let reads = 0;
  const wrapped = { prepare(sql) { if (/FROM upload_manifest ORDER BY seq/.test(sql)) reads++; return db.prepare(sql); }, batch: (l) => db.batch(l) };
  const kv = { get: async () => [] };
  const m = d1Manifest(wrapped, kv);
  await m.read(); await m.read(); await m.read();
  assert.equal(reads, 1);
  await m.update((list) => [...list, { id: "a1", courseId: "c1", title: "x" }]);
  const after = await m.read();
  assert.equal(after.length, 1);
  assert.equal(after[0].id, "a1");
  const copy = await m.read(); copy.push({ id: "junk" });
  assert.equal((await m.read()).length, 1, "تعديل النتيجة لا يلوّث الذاكرة المؤقتة");
  resetManifestCache();
});
