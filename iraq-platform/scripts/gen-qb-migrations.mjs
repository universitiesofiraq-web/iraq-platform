// يولّد functions/_lib/qb_migrations.generated.js من migrations/qb/*.sql (ترحيلات بنك الأسئلة المعزولة).
// هذه الملفات لا تدخل migrations.generated.js ولا تُطبَّق تلقائياً: انظر functions/_lib/qb_schema.js وdocs/question-bank/ENVIRONMENTS.md.
// الاستعمال: node scripts/gen-qb-migrations.mjs   (للتحقق فقط: --check)
import { readFileSync, readdirSync, writeFileSync } from "node:fs";

const dir = new URL("../migrations/qb/", import.meta.url);
const out = new URL("../functions/_lib/qb_migrations.generated.js", import.meta.url);
const files = readdirSync(dir).filter((n) => /^\d{4}_.+\.sql$/.test(n)).sort();
const body = files.map((n) => `  [${JSON.stringify("qb_" + n.replace(/\.sql$/, ""))}, ${JSON.stringify(readFileSync(new URL(n, dir), "utf8"))}]`).join(",\n");
const text = `// مولَّد تلقائياً من migrations/qb/*.sql بواسطة scripts/gen-qb-migrations.mjs. لا تعدّله يدوياً.\nexport const QB_MIGRATIONS = [\n${body}\n];\n`;
if (process.argv.includes("--check")) {
  let cur = "";
  try { cur = readFileSync(out, "utf8"); } catch { /* غير موجود */ }
  if (cur !== text) { console.error("qb_migrations.generated.js قديم: شغّل node scripts/gen-qb-migrations.mjs"); process.exit(1); }
  console.log("qb_migrations.generated.js محدّث (" + files.length + " ملفاً)");
} else { writeFileSync(out, text); console.log("كُتب " + files.length + " ترحيل qb"); }
