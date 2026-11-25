// خادم تطوير محلي لاختبار واجهات بنك الأسئلة في المتصفح: يقدّم site/ ويشغّل المعالج الحقيقي (handleQb) على SQLite في الذاكرة.
// ليس للإنتاج. الاستعمال: node tests/browser/qb_server.mjs [port]  ثم /__login/<root|rep|up|st|st2|other>?next=/qbank.html
import http from "node:http";
import { readFile } from "node:fs/promises";
import { extname, join, normalize } from "node:path";
import { createHash } from "node:crypto";
import { fileURLToPath } from "node:url";
import { makeEnv, sba } from "../helpers/qb_env.mjs";

const site = fileURLToPath(new URL("../../site/", import.meta.url));
const port = Number(process.argv[2] || process.env.PORT || 4177);
const t = await makeEnv();
const { call, ids, env, sql } = t;
export const seed = async () => {
  const mk = async (uid, type, content, extra = {}) => (await call(uid, "POST", "admin/questions", { subject_id: 1, type, content, ...extra })).body.id;
  const cat = (await call(ids.rep, "POST", "admin/categories", { subject_id: 1, name: "القلب والدورة" })).body.id;
  const cat2 = (await call(ids.rep, "POST", "admin/categories", { subject_id: 1, name: "الجهاز التنفسي" })).body.id;
  const cs = (await call(ids.rep, "POST", "admin/cases", { subject_id: 1, lecture_id: 1, title: "رجل بألم صدري", body: { history: "رجل عمره 55 سنة يشكو من ألم صدري ضاغط منذ ساعة.", exam: "ضغط 150/95، نبض 98.", vitals: "حرارة 37", labs: "تروبونين مرتفع" } })).body.id;
  await call(ids.rep, "PUT", "admin/cases/" + cs, { status: "published" });
  const qs = [];
  qs.push(await mk(ids.rep, "sba", sba("ما هو العضو المسؤول عن ضخ الدم؟", { explanation: "القلب هو المضخة العضلية للدورة الدموية." }), { lecture_id: 1, category_id: cat, difficulty: 1, tags: ["أساسي"] }));
  qs.push(await mk(ids.rep, "mrq", { text: "اختر أعراض احتشاء العضلة القلبية", points: 2, options: [{ id: "a", text: "ألم صدري" }, { id: "b", text: "تعرّق" }, { id: "c", text: "طفح جلدي" }, { id: "d", text: "ضيق نفس" }], correct: ["a", "b", "d"], scoring: "partial", explanation: "الطفح الجلدي ليس عَرَضاً نموذجياً." }, { lecture_id: 1, category_id: cat, difficulty: 2 }));
  qs.push(await mk(ids.rep, "tf", { text: "الرئة اليمنى فيها ثلاثة فصوص.", correct: true, points: 1, explanation: "اليمنى ثلاثة والمنى اثنان." }, { lecture_id: 2, category_id: cat2, difficulty: 1 }));
  qs.push(await mk(ids.rep, "sba", sba("ما أنسب فحص أولي للمريض في الحالة؟", { options: [{ id: "a", text: "تخطيط القلب ECG" }, { id: "b", text: "تنظير المعدة" }, { id: "c", text: "أشعة الركبة" }], correct: "a", explanation: "ECG أسرع فحص لتشخيص الاحتشاد." }), { lecture_id: 1, category_id: cat, difficulty: 2, case_id: cs }));
  qs.push(await mk(ids.rep, "saq", { text: "اذكر أكبر شريان في الجسم.", accepted: ["الأبهر", "aorta"], points: 1, explanation: "الأبهر Aorta." }, { lecture_id: 1, category_id: cat, difficulty: 2 }));
  qs.push(await mk(ids.rep, "numerical", { text: "ما الحجم الطبيعي لضربة القلب (مل)؟", points: 1, numeric: { value: 70, tolerance: 10, mode: "abs", unit: "مل" }, explanation: "نحو 70 مل." }, { lecture_id: 1, category_id: cat, difficulty: 3 }));
  qs.push(await mk(ids.rep, "matching", { text: "طابق العضو بوظيفته", points: 3, pairs: [{ id: "p1", rid: "r1", left: "القلب", right: "ضخ الدم" }, { id: "p2", rid: "r2", left: "الكلية", right: "ترشيح الدم" }, { id: "p3", rid: "r3", left: "الرئة", right: "تبادل الغازات" }], explanation: "" }, { lecture_id: 2, category_id: cat2, difficulty: 2 }));
  qs.push(await mk(ids.rep, "ordering", { text: "رتّب مسار الدم من الأذين الأيمن", points: 2, order: [{ id: "o1", text: "الأذين الأيمن" }, { id: "o2", text: "البطين الأيمن" }, { id: "o3", text: "الشريان الرئوي" }, { id: "o4", text: "الرئتان" }], scoring: "partial" }, { lecture_id: 2, category_id: cat2, difficulty: 3 }));
  qs.push(await mk(ids.rep, "essay", { text: "اشرح باختصار الدورة الدموية الكبرى.", points: 4 }, { lecture_id: 1, category_id: cat, difficulty: 2 }));
  qs.push(await mk(ids.rep, "fill", { text: "الدم الغني بالأكسجين يصل إلى الجسم عبر ____ ويعود عبر ____.", points: 2, blanks: [{ id: "b1", accepted: ["الشرايين"] }, { id: "b2", accepted: ["الأوردة"] }] }, { lecture_id: 1, category_id: cat, difficulty: 1 }));
  qs.push(await mk(ids.rep, "emq", { text: "اختر التشخيص الأنسب لكل حالة", points: 2, options: [{ id: "a", text: "احتشاء" }, { id: "b", text: "انصمام رئوي" }, { id: "c", text: "التهاب التامور" }], items: [{ id: "i1", text: "ألم صدري ضاغط وتعرّق", correct: "a" }, { id: "i2", text: "ضيق نفس مفاجئ بعد جراحة", correct: "b" }] }, { lecture_id: 1, category_id: cat, difficulty: 3 }));
  for (const q of qs) await call(ids.rep, "POST", `admin/question/${q}/status`, { to: "published" });
  const z = (await call(ids.rep, "POST", "admin/quizzes", { subject_id: 1, title: "اختبار القلب الأول", lecture_id: 1 })).body.id;
  await call(ids.rep, "PUT", "admin/quiz/" + z, { meta: { mode: "exam", duration_min: 20, pass_score: 5, attempts_allowed: 3, settings: { showResults: true, allowReview: true, showExplanations: true, allowBack: true } }, sections: [{ id: "s1", title: "القسم الأول" }], items: [{ id: "h", kind: "heading", content: { text: "أسئلة الدورة الدموية" }, section: "s1" }, { id: "a", kind: "question", question_id: qs[0], section: "s1" }, { id: "b", kind: "question", question_id: qs[3], section: "s1" }, { id: "c", kind: "question", question_id: qs[4] }, { id: "d", kind: "question", question_id: qs[8] }] });
  await call(ids.rep, "POST", `admin/quiz/${z}/status`, { to: "published" });
  return { qs, z, cs, cat, cat2 };
};
export const seeded = await seed();

const mime = { ".html": "text/html; charset=utf-8", ".js": "text/javascript; charset=utf-8", ".css": "text/css; charset=utf-8", ".png": "image/png", ".svg": "image/svg+xml", ".webp": "image/webp", ".json": "application/json", ".webmanifest": "application/manifest+json" };
const names = { root: ids.root, rep: ids.rep, up: ids.up, st: ids.st, st2: ids.st2, other: ids.other };
const { currentUser } = await import("../../functions/_lib/auth.js");
const { handleQb } = await import("../../functions/_lib/qb.js");

const server = http.createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://localhost:" + port);
    if (url.pathname.startsWith("/__login/")) {
      const uid = names[url.pathname.split("/")[2]]; if (!uid) { res.writeHead(404).end(); return; }
      const cookie = uid.toString(16).padStart(64, "0");
      sql.prepare("INSERT OR REPLACE INTO sessions VALUES (?,?,?)").run(createHash("sha256").update(cookie).digest("hex"), uid, Date.now() + 86400_000);
      res.writeHead(302, { "set-cookie": `ms_session=${cookie}; Path=/; HttpOnly; SameSite=Lax`, location: url.searchParams.get("next") || "/qbank.html" }).end(); return;
    }
    if (url.pathname.startsWith("/api/")) {
      const chunks = []; for await (const c of req) chunks.push(c);
      const body = chunks.length ? Buffer.concat(chunks) : undefined;
      const headers = new Headers(); for (const [k, v] of Object.entries(req.headers)) if (typeof v === "string") headers.set(k, v);
      headers.set("origin", "http://localhost:" + port);
      const request = new Request("https://example.test" + url.pathname + url.search, { method: req.method, headers, body: ["GET", "HEAD"].includes(req.method) ? undefined : body });
      // الأصل في الطلب المحلي يطابق https://example.test كي يمر فحص CSRF كما في الإنتاج
      const r = new Request(request, { headers: (() => { const h2 = new Headers(request.headers); if (!["GET", "HEAD"].includes(req.method)) h2.set("origin", "https://example.test"); return h2; })() });
      const out = await handleQb(r, { ...env }, { currentUser });
      if (!out) { res.writeHead(404, { "content-type": "application/json" }).end('{"error":"not_found"}'); return; }
      const buf = Buffer.from(await out.arrayBuffer()); const h3 = {}; out.headers.forEach((v, k) => (h3[k] = v));
      res.writeHead(out.status, h3).end(buf); return;
    }
    let p = normalize(decodeURIComponent(url.pathname)).replace(/^(\.\.[/\\])+/, ""); if (p === "/" || p === "\\") p = "/index.html";
    const file = join(site, p);
    if (!file.startsWith(site)) { res.writeHead(403).end(); return; }
    const data = await readFile(file);
    res.writeHead(200, { "content-type": mime[extname(file)] || "application/octet-stream", "cache-control": "no-store" }).end(data);
  } catch (e) { res.writeHead(e.code === "ENOENT" ? 404 : 500).end(e.code === "ENOENT" ? "not found" : String(e.stack || e)); }
});
server.listen(port, () => console.log("qb dev server on http://localhost:" + port));
