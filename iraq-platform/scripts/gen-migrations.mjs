// يولّد functions/_lib/migrations.generated.js من ملفات migrations/*.sql حتى تُطبَّق تلقائياً عند التشغيل.
// الاستعمال: node scripts/gen-migrations.mjs        (للتحقق فقط: --check)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const dir = new URL("../migrations/", import.meta.url);
const out = new URL("../functions/_lib/migrations.generated.js", import.meta.url);
const files = readdirSync(dir).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
const body = files.map((n) => `  [${JSON.stringify(n.replace(/\.sql$/, ""))}, ${JSON.stringify(readFileSync(new URL(n, dir), "utf8"))}]`).join(",\n");
const text = `// مولَّد تلقائياً من migrations/*.sql بواسطة scripts/gen-migrations.mjs. لا تعدّله يدوياً.\nexport const MIGRATIONS = [\n${body}\n];\n`;
if (process.argv.includes("--check")) {
  let cur = "";
  try { cur = readFileSync(out, "utf8"); } catch { /* غير موجود */ }
  if (cur !== text) { console.error("migrations.generated.js قديم: شغّل node scripts/gen-migrations.mjs"); process.exit(1); }
  console.log("migrations.generated.js محدّث (" + files.length + " ملفاً)");
} else {
  writeFileSync(out, text);
  console.log("كُتب " + files.length + " ترحيلاً");
}
