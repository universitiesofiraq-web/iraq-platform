// node --no-warnings tests/pdfnotes_api_check.mjs — Step 63: مزامنة كتابة الطالب على ملفات PDF (D1 وهمية، بيانات وهمية).
import { handleAuth } from "../functions/_lib/auth.js";
import { handlePdfNotes, keyKind, validDoc, USER_LIMIT } from "../functions/_lib/pdfnotes.js";
import { createMockD1 } from "./mock_d1.mjs";
import { mint, fakeFetch, CLIENT_ID } from "./google_token.mjs";

let fails = 0, n = 0;
const ok = (c, m) => { n++; if (!c) { fails++; console.log("FAIL", m); } };

function setup(dbOpts) {
  const env = { DB: createMockD1(dbOpts), GOOGLE_CLIENT_ID: CLIENT_ID, ADMIN_EMAILS: "boss@x.com" };
  let clock = Date.now();
  const call = async (method, path, body, cookie, extra = {}) => {
    const headers = { "content-type": "application/json", ...(cookie ? { cookie } : {}), ...extra };
    const req = new Request("https://medixa.test" + path, { method, headers, body: body ? (typeof body === "string" ? body : JSON.stringify(body)) : undefined });
    const res = /^\/api\/(auth|sync)/.test(path) ? await handleAuth(req, env, { fetch: fakeFetch }) : await handlePdfNotes(req, env, { now: () => clock });
    const sc = res && res.headers.get("set-cookie");
    return { status: res.status, body: await res.json().catch(() => ({})), cookie: sc ? sc.split(";")[0] : null };
  };
  const login = async (claims) => (await call("POST", "/api/auth/google", { credential: await mint(claims) })).cookie;
  return { env, call, login, tick: (ms) => { clock += ms; } };
}

const DOC = "0123456789abcdef01234567", DOC2 = "fedcba9876543210fedcba98";

ok(validDoc(DOC) && !validDoc("ABC") && !validDoc("0123456789ABCDEF01234567") && !validDoc(null), "doc id format");
ok(keyKind("ink:1") === "ink" && keyKind("ink:9999") === "ink" && keyKind("ink:0") === "ink" && keyKind("study") === "study" && keyKind("layout") === "layout" && keyKind("occl") === "occl", "valid keys");
ok(!keyKind("ink:01") && !keyKind("ink:10000") && !keyKind("ink:") && !keyKind("x") && !keyKind("ink:-1") && !keyKind(5), "invalid keys rejected");

{
  const { env, call, login, tick } = setup();
  const a = await login({ sub: "a", email: "a@x.com", name: "A" });
  const b = await login({ sub: "b", email: "b@x.com", name: "B" });
  const put = (cookie, rows, doc = DOC, extra) => call("PUT", "/api/pdfnotes", { doc, rows }, cookie, extra);

  // 1. الصلاحيات
  ok((await call("GET", "/api/pdfnotes?doc=" + DOC)).status === 401, "guest cannot read");
  ok((await call("PUT", "/api/pdfnotes", { doc: DOC, rows: [{ k: "study", d: "{}" }] })).status === 401, "guest cannot write");
  ok((await put(a, [{ k: "study", d: "{}" }], DOC, { origin: "https://evil.test" })).status === 403, "cross-origin write refused");
  ok((await call("GET", "/api/pdfnotes?doc=BAD", null, a)).status === 400, "bad doc id on read");
  ok((await call("PUT", "/api/pdfnotes", { doc: "BAD", rows: [{ k: "study", d: "{}" }] }, a)).status === 400, "bad doc id on write");
  ok((await call("PUT", "/api/pdfnotes", { doc: DOC, rows: [] }, a)).status === 400, "empty rows refused");
  ok((await call("PUT", "/api/pdfnotes", "not json", a)).status === 400, "bad json refused");
  ok((await call("DELETE", "/api/pdfnotes", null, a)).status === 404, "unknown method");

  // 2. صف جديد ثم تعديل بتفاؤل
  let r = await put(a, [{ k: "ink:3", d: '[{"id":"s1"}]' }, { k: "study", d: '{"cards":[]}' }]);
  ok(r.status === 200 && r.body.results.every((x) => x.ok && x.t > 0), "new rows saved " + JSON.stringify(r.body));
  const t3 = r.body.results[0].t;
  r = await call("GET", "/api/pdfnotes?doc=" + DOC, null, a);
  ok(r.body.rows.length === 2 && r.body.rows.find((x) => x.k === "ink:3").d === '[{"id":"s1"}]' && r.body.rows.find((x) => x.k === "ink:3").t === t3, "rows read back with t");
  ok(r.body.usage.bytes > 0 && r.body.usage.limit === USER_LIMIT, "usage reported");
  tick(5000);
  r = await put(a, [{ k: "ink:3", d: '[{"id":"s1"},{"id":"s2"}]', base: t3 }]);
  ok(r.body.results[0].ok && r.body.results[0].t > t3, "update with matching base");
  const t3b = r.body.results[0].t;

  // 3. تعارض: جهاز آخر بقاعدة قديمة
  r = await put(a, [{ k: "ink:3", d: '[{"id":"old"}]', base: t3 }]);
  ok(r.body.results[0].conflict === true && r.body.results[0].t === t3b, "stale base is a conflict, reports the server t");
  r = await call("GET", "/api/pdfnotes?doc=" + DOC, null, a);
  ok(r.body.rows.find((x) => x.k === "ink:3").d === '[{"id":"s1"},{"id":"s2"}]', "conflict wrote nothing");
  r = await put(a, [{ k: "ink:3", d: "[]" }]);   // صف موجود وbase فارغ = جهاز لم يقرأه
  ok(r.body.results[0].conflict === true, "existing row without base is a conflict");
  r = await put(a, [{ k: "ink:9", d: "[]", base: 12345 }]);
  ok(r.body.results[0].conflict === true, "missing row with a base is a conflict (row was never there)");

  // 4. عزل الطلاب
  ok((await call("GET", "/api/pdfnotes?doc=" + DOC, null, b)).body.rows.length === 0, "other student sees nothing");
  r = await put(b, [{ k: "ink:3", d: '[{"id":"b1"}]' }]);
  ok(r.body.results[0].ok, "other student writes their own row with the same key");
  ok((await call("GET", "/api/pdfnotes?doc=" + DOC, null, a)).body.rows.find((x) => x.k === "ink:3").d.includes("s2"), "first student's row untouched");
  ok((await call("GET", "/api/pdfnotes?doc=" + DOC2, null, a)).body.rows.length === 0, "other doc is separate");

  // 5. مفاتيح وأحجام
  r = await put(a, [{ k: "evil", d: "x" }, { k: "ink:3", d: 5 }, { k: "layout", d: "x".repeat(70 * 1024) }, { k: "ink:4", d: "x".repeat(401 * 1024) }, { k: "occl", d: "[]" }], DOC2);
  const e = r.body.results.map((x) => x.error || (x.ok ? "ok" : "?"));
  ok(e.join() === "bad_key,bad_data,too_large,too_large,ok", "per-row validation: " + e.join());
  ok((await put(a, [{ k: "study", d: "x" }], DOC, { "content-length": String(5 * 1024 * 1024) })).status !== 500, "no crash on large content-length");
  ok((await call("PUT", "/api/pdfnotes", { doc: DOC, rows: Array.from({ length: 61 }, (_, i) => ({ k: "ink:" + (i + 1), d: "[]" })) }, a)).status === 400, "too many rows refused");

  // 6. الحصة (5 ميغابايت) لا تُتجاوز ولا تُعدّ الصفوف المستبدلة مرتين
  const big = "x".repeat(390 * 1024), c = await login({ sub: "c", email: "c@x.com", name: "C" });
  let saved = 0, lastErr = null;
  for (let i = 1; i <= 20; i++) {
    const rr = await put(c, [{ k: "ink:" + i, d: big }], DOC);
    if (rr.body.results[0].ok) saved++; else { lastErr = rr.body.results[0].error; break; }
  }
  ok(saved === Math.floor(USER_LIMIT / big.length) && lastErr === "quota", `quota stops at ${saved} rows (${lastErr})`);
  const cur = (await call("GET", "/api/pdfnotes?doc=" + DOC, null, c)).body.rows.find((x) => x.k === "ink:1");
  r = await put(c, [{ k: "ink:1", d: "x".repeat(300 * 1024), base: cur.t }]);
  ok(r.body.results[0].ok, "shrinking an existing row is allowed at the limit");
  r = await put(c, [{ k: "ink:1", d: big, base: r.body.results[0].t }]);
  ok(r.body.results[0].ok, "replacing a row does not double count");
  ok((await call("GET", "/api/pdfnotes", null, c)).body.usage.bytes <= USER_LIMIT, "usage never exceeds the limit");

  // 7. لا يظهر في تصدير المشرف
  const boss = await login({ sub: "boss", email: "boss@x.com", name: "Boss" });
  const ex = await call("GET", "/api/auth/admin/export", null, boss);
  ok(!JSON.stringify(ex.body).includes("old") && !JSON.stringify(ex.body).includes("s2"), "admin export has no notes");
}
{
  // 8. بلا الجدول
  const old = setup({ without: ["0006"] });
  const u = await old.login({ sub: "o", email: "o@x.com", name: "O" });
  ok((await old.call("GET", "/api/pdfnotes?doc=" + DOC, null, u)).body.error === "not_migrated", "before 0006: not_migrated (read)");
  ok((await old.call("PUT", "/api/pdfnotes", { doc: DOC, rows: [{ k: "study", d: "{}" }] }, u)).body.error === "not_migrated", "before 0006: not_migrated (write)");
}
console.log(fails ? `PDFNOTES FAIL ${fails}/${n}` : `PDFNOTES OK: ${n} checks`);
process.exit(fails ? 1 : 0);
