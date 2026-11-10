import { readUploads } from "./d1manifest.js";
// functions/_lib/study_dept.js — فهرس ملفات القسم المشترك + البحث بالمعنى (Vectorize اختياري) + أدوات المرشد.
const clip = (s, n) => String(s == null ? "" : s).slice(0, n);
const CHUNK = 1000;
export const EMBED_MODEL = "@cf/baai/bge-m3";

/* تطبيع عربي خفيف للبحث بالكلمات */
const norm = (s) => String(s || "").toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[إأآ]/g, "ا").replace(/ى/g, "ي").replace(/ة/g, "ه");
const words = (q) => norm(q).split(/[^\p{L}\p{N}]+/u).filter((w) => w.length > 2);

/* تضمينات bge-m3؛ نقبل أشكال الرد المحتملة. ترجع null عند الفشل فنكمل بالبحث بالكلمات */
export async function embed(env, texts) {
  if (!env.AI || !texts.length) return null;
  try {
    const out = await env.AI.run(EMBED_MODEL, { text: texts });
    const arr = out && (out.data || out.embeddings || (out.result && out.result.data));
    if (Array.isArray(arr) && arr.length === texts.length && Array.isArray(arr[0])) return arr;
  } catch { /* ننتقل للكلمات */ }
  return null;
}

export function manifestItems(m) { return Array.isArray(m) ? m : (m && m.items) || []; }
export async function deptFiles(env, names) {
  if (!env.LECTURES) return [];
  try {
    const m = await readUploads(env);
    return manifestItems(m).filter((e) => e && e.kind !== "link" && names.has(e.course) && e.status !== "pending" && e.status !== "rejected" && !e.draft);
  } catch { return []; }
}

/* فهرسة ملف واحد (يستدعيها المدير فقط بعد التحقق من أن الملف ضمن مواد قسمه) */
export async function indexDeptFile(env, { deptKey, fileId, subject, title, pages, by, now }) {
  const rows = [];
  for (const p of pages.slice(0, 600)) {
    const n = Number(p && p.n);
    if (!Number.isInteger(n) || n < 1) continue;
    const text = clip(p.text, 12000).replace(/\s+/g, " ").trim();
    for (let i = 0, c = 0; i < text.length; i += CHUNK, c++) {
      const piece = text.slice(i, i + CHUNK);
      if (piece.length > 15) rows.push({ id: "dc_" + deptKey + "_" + fileId + "_" + n + "_" + c, n, c, text: piece });
    }
  }
  const stmts = [
    env.DB.prepare("DELETE FROM ai_dept_chunks WHERE department_key = ? AND file_id = ?").bind(deptKey, fileId),
    env.DB.prepare("DELETE FROM ai_dept_files WHERE department_key = ? AND file_id = ?").bind(deptKey, fileId)
  ];
  for (const r of rows) stmts.push(env.DB.prepare("INSERT INTO ai_dept_chunks (id, department_key, file_id, subject, title, page_number, chunk_index, content) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(r.id, deptKey, fileId, subject, title, r.n, r.c, r.text));
  stmts.push(env.DB.prepare("INSERT INTO ai_dept_files (file_id, department_key, subject, title, pages, chunks, indexed_by, indexed_at) VALUES (?, ?, ?, ?, ?, ?, ?, ?)").bind(fileId, deptKey, subject, title, pages.length, rows.length, by, new Date(now).toISOString()));
  for (let i = 0; i < stmts.length; i += 90) await env.DB.batch(stmts.slice(i, i + 90));
  let semantic = false;
  if (env.VEC && rows.length) {
    try {
      for (let i = 0; i < rows.length; i += 20) {
        const part = rows.slice(i, i + 20);
        const vecs = await embed(env, part.map((r) => r.text));
        if (!vecs) break;
        await env.VEC.upsert(part.map((r, k) => ({ id: r.id, values: vecs[k], namespace: deptKey, metadata: { f: fileId, p: r.n } })));
        semantic = true;
      }
    } catch { semantic = false; }
  }
  return { chunks: rows.length, semantic };
}

/* بحث في فهرس القسم: بالمعنى إن توفّر Vectorize ثم بالكلمات، ويُدمجان */
export async function searchDept(env, deptKey, query, { subject, limit = 6 } = {}) {
  if (!deptKey) return [];
  const byId = new Map();
  if (env.VEC) {
    try {
      const v = await embed(env, [clip(query, 800)]);
      if (v) {
        const r = await env.VEC.query(v[0], { topK: 10, namespace: deptKey });
        const ids = ((r && r.matches) || []).map((m) => m.id);
        if (ids.length) {
          const rows = (await env.DB.prepare("SELECT * FROM ai_dept_chunks WHERE id IN (" + ids.map(() => "?").join(",") + ")").bind(...ids).all()).results || [];
          const m = new Map(rows.map((x) => [x.id, x]));
          ids.forEach((id, i) => { if (m.has(id)) byId.set(id, { row: m.get(id), score: 100 - i }); });
        }
      }
    } catch { /* نكمل بالكلمات */ }
  }
  const ws = words(query);
  if (ws.length) {
    const rows = (await env.DB.prepare("SELECT * FROM ai_dept_chunks WHERE department_key = ? LIMIT 4000").bind(deptKey).all()).results || [];
    for (const r of rows) {
      const t = norm(r.content + " " + (r.title || "") + " " + (r.subject || ""));
      let s = 0; for (const w of ws) if (t.includes(w)) s++;
      if (s > 0) { const cur = byId.get(r.id); byId.set(r.id, { row: r, score: (cur ? cur.score : 0) + s * 10 }); }
    }
  }
  let list = [...byId.values()];
  if (subject) { const sn = norm(subject); const f = list.filter((x) => norm(x.row.subject).includes(sn)); if (f.length) list = f; }
  return list.sort((a, b) => b.score - a.score).slice(0, limit).map((x) => ({
    chunkId: x.row.id, fileId: x.row.file_id, documentId: "dept:" + x.row.file_id, subject: x.row.subject, title: x.row.title,
    pageNumber: x.row.page_number, content: x.row.content
  }));
}

/* ===== أدوات المرشد (بروتوكول نصّي: يكتب النموذج سطراً TOOL: {...}) ===== */
export const TOOL_HELP = [
  "لديك أدوات للبحث في المنصة. إن احتجت معلومة حقيقية لا تملكها، اكتب في ردّك سطراً واحداً فقط بلا أي نص آخر، بهذا الشكل بالضبط:",
  'TOOL: {"name":"<اسم الأداة>","args":{...}}',
  "وسأرجع لك النتيجة لتجيب بعدها. الأدوات:",
  '- search_materials {"query":"...","subject":"اسم المادة (اختياري)"}: بحث بالمعنى في نصوص كل محاضرات القسم مع رقم الصفحة.',
  '- list_files {"subject":"(اختياري)","type":"lecture|exam|quiz (اختياري)","limit":10}: قائمة ملفات القسم الأحدث أولاً.',
  '- get_announcements {"limit":5}: آخر التبليغات.',
  '- get_grades {}: درجات الطالب المسجّلة ومعدلها.',
  '- get_page {"file_id":"...","page":3}: نص صفحة محددة من ملف.',
  "استعمل أداة واحدة في كل مرة (حتى 3 مرات). لا تستعمل الأدوات للدردشة العادية أو للمعرفة العامة. بعد النتائج أجب مباشرة واذكر (ص N) واسم المحاضرة."
].join("\n");

export function parseToolCall(text) {
  const m = /^\s*TOOL:\s*(\{[\s\S]*\})\s*$/.exec(String(text || ""));
  if (!m) return null;
  try { const o = JSON.parse(m[1]); return o && typeof o.name === "string" ? { name: o.name, args: o.args && typeof o.args === "object" ? o.args : {} } : null; } catch { return null; }
}

export async function runTool(env, ctx, call) {
  const a = call.args || {};
  const { principal, names, loadFiles, loadGrades, gradeSummary, announcements } = ctx;
  switch (call.name) {
    case "search_materials": {
      const hits = await searchDept(env, principal.departmentKey, clip(a.query, 500), { subject: clip(a.subject, 80) || undefined, limit: 5 });
      ctx.cites.push(...hits);
      return { results: hits.map((h) => ({ file: h.title, subject: h.subject, file_id: h.fileId, page: h.pageNumber, text: clip(h.content, 700) })), note: hits.length ? undefined : "لا توجد نتائج (قد لا تكون الملفات مفهرسة بعد)." };
    }
    case "list_files": {
      const files = await loadFiles();
      const sn = a.subject ? norm(a.subject) : "";
      const ty = ["lecture", "exam", "quiz"].includes(a.type) ? a.type : null;
      const out = files.filter((e) => (!sn || norm(names.get(e.course)).includes(sn)) && (!ty || (e.type || "lecture") === ty))
        .sort((x, y) => String(y.at || y.added || "").localeCompare(String(x.at || x.added || "")))
        .slice(0, Math.min(Number(a.limit) || 10, 25))
        .map((e) => ({ file_id: e.id, subject: names.get(e.course), number: e.number || null, title: e.title || e.label || "", type: e.type || "lecture", date: String(e.at || e.added || "").slice(0, 10) || null }));
      return { total: files.length, files: out };
    }
    case "get_announcements": return { announcements: await announcements(Math.min(Number(a.limit) || 5, 10)) };
    case "get_grades": return gradeSummary(await loadGrades());
    case "get_page": {
      const row = await env.DB.prepare("SELECT subject, title, page_number, content FROM ai_dept_chunks WHERE department_key = ? AND file_id = ? AND page_number = ? ORDER BY chunk_index").bind(principal.departmentKey, clip(a.file_id, 80), Number(a.page) || 0).all();
      const rs = row.results || [];
      if (rs.length) ctx.cites.push({ chunkId: "pg", fileId: clip(a.file_id, 80), documentId: "dept:" + clip(a.file_id, 80), title: rs[0].title, subject: rs[0].subject, pageNumber: rs[0].page_number, content: rs[0].content });
      return rs.length ? { file: rs[0].title, page: rs[0].page_number, text: clip(rs.map((r) => r.content).join(" "), 3000) } : { error: "الصفحة غير مفهرسة." };
    }
    default: return { error: "أداة غير معروفة." };
  }
}
