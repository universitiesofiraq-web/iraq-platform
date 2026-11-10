import test from "node:test";
import assert from "node:assert/strict";
import vm from "node:vm";
import { readFileSync } from "node:fs";
import { serviceErrorResponse } from "../functions/_lib/service-errors.js";
import { onRequest } from "../functions/_middleware.js";
import { handleCatalog } from "../functions/_lib/catalog.js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

const script = name => readFileSync(new URL("../site/" + name, import.meta.url), "utf8");
const quotaError = () => new Error("D1_ERROR: Your account has exceeded D1's free tier daily row read limit. private diagnostic");

test("database failures return a retryable response without exposing diagnostics", async () => {
  for (const structured of [false, true]) {
    const response = serviceErrorResponse(quotaError(), structured);
    assert.equal(response.status, 503);
    assert.equal(response.headers.get("retry-after"), "60");
    const data = await response.json();
    assert.equal(structured ? data.error.code : data.error, "database_quota_exceeded");
    assert.doesNotMatch(JSON.stringify(data), /D1_ERROR|private diagnostic/);
  }
  const response = await onRequest({
    request: new Request("https://example.test/api/auth/me"), env: {},
    next: async () => { throw quotaError(); }
  });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "database_quota_exceeded");
});

test("failed catalog requests do not become successful empty catalogs", async () => {
  let reads = 0;
  const DB = { prepare() { reads++; throw quotaError(); } };
  const response = await handleCatalog(new Request("https://example.test/api/catalog/index"), { DB });
  assert.equal(response.status, 503);
  assert.equal((await response.json()).error, "database_quota_exceeded");
  assert.equal(reads, 1, "quota errors must not trigger the legacy kind-column retry");
});

test("public search reuses metadata but immediately respects suspension and activation", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  sql.exec("INSERT INTO university_onboarding VALUES (1,'active',2,1,1,1)");
  const calls = [];
  const counted = { prepare(query) { calls.push(query); return DB.prepare(query); } };
  const request = () => handleCatalog(new Request("https://example.test/api/catalog/index"), { DB: counted });
  const first = await (await request()).json();
  assert.deepEqual(first.u.map(row => row[0]), [1]);
  assert.deepEqual(first.c.map(row => row[0]), [1]);
  assert.deepEqual(first.d.map(row => row[0]), [1]);
  calls.length = 0;
  assert.deepEqual(await (await request()).json(), first);
  assert.equal(calls.filter(query => /^SELECT [cd]\.id/.test(query)).length, 0);
  sql.exec("UPDATE university_onboarding SET state='suspended' WHERE university_id=1");
  assert.deepEqual(await (await request()).json(), { ok: true, u: [], c: [], d: [] });
  sql.exec("INSERT INTO university_onboarding VALUES (2,'active',2,1,1,1)");
  const second = await (await request()).json();
  assert.deepEqual(second.u.map(row => row[0]), [2]);
  assert.deepEqual(second.c.map(row => row[0]), [2]);
  assert.deepEqual(second.d.map(row => row[0]), [2]);
  assert.equal((await handleCatalog(new Request("https://example.test/api/catalog/index?view=directory"), { DB })).status, 403);
  assert.equal(sql.prepare("SELECT COUNT(*) AS n FROM universities").get().n, 2);
});

test("API client distinguishes quota, sign-in and invalid responses and deduplicates concurrent reads", async () => {
  let calls = 0;
  let response = new Response(JSON.stringify({ ok: false, error: "database_quota_exceeded" }), { status: 503 });
  const context = { window: {}, Map, Error, fetch: async () => { calls++; return response.clone(); } };
  vm.runInNewContext(script("js/api-client.js"), context);
  const api = context.window.IQApi;
  const results = await Promise.allSettled([api.request("/api/catalog/index"), api.request("/api/catalog/index")]);
  assert.equal(calls, 1);
  assert.ok(results.every(result => result.status === "rejected" && result.reason.code === "database_quota_exceeded"));
  response = new Response("<html>server unavailable</html>", { status: 503 });
  await assert.rejects(api.request("/api/catalog/index"), error => error.code === "service_unavailable");
  response = new Response(JSON.stringify({ ok: false, error: "unauthorized" }), { status: 401 });
  await assert.rejects(api.request("/api/auth/me"), error => error.code === "unauthorized" && error.status === 401);
  response = new Response(JSON.stringify({ ok: true, items: [] }));
  assert.equal((await api.request("/api/catalog/index")).ok, true);
});

test("a failed platform load preserves the saved department and stage and reports an error", () => {
  const saved = new Map([
    ["iq.dept", JSON.stringify({ id: 1, name: "القسم" })],
    ["iq.stage", JSON.stringify({ dept: 1, stage: 2 })]
  ]);
  const before = [...saved];
  const redirects = [];
  const context = {
    URLSearchParams, location: { search: "", replace: url => redirects.push(url) },
    localStorage: { getItem: key => saved.get(key), setItem: (key, value) => saved.set(key, value), removeItem: key => saved.delete(key) },
    XMLHttpRequest: class {
      open() {}
      send() { this.status = 503; this.responseText = JSON.stringify({ ok: false, error: "database_quota_exceeded" }); }
    }
  };
  vm.runInNewContext(script("data/courses.js"), context);
  assert.deepEqual([...saved], before);
  assert.deepEqual(redirects, []);
  assert.equal(context.IQ_LOAD_ERROR.message, "database_quota_exceeded");
  assert.equal(context.SEMESTERS.length, 0);
});

test("upload selectors discard stale university responses and reset dependent selections", async () => {
  class Element {
    constructor() { this.events = {}; this.children = []; this.style = {}; this.value = ""; }
    addEventListener(type, callback) { this.events[type] = callback; }
    set innerHTML(value) { this.children = []; this.value = ""; }
    appendChild(child) { this.children.push(child); if (this.children.length === 1) this.value = child.value; return child; }
  }
  const source = script("contribute.html");
  const elements = new Map([...source.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element()]));
  let finishFirst;
  const context = {
    document: { getElementById: id => elements.get(id) }, URLSearchParams,
    location: { search: "" },
    Option: class { constructor(text, value) { this.textContent = text; this.value = String(value); } },
    IQApi: {
      request(url) {
        if (url === "/api/auth/me") return Promise.resolve({ user: { role: "admin", admin: true } });
        if (url === "/api/catalog/universities") return Promise.resolve({ items: [{ id: 1, name_ar: "الأولى" }, { id: 2, name_ar: "الثانية" }] });
        if (url.endsWith("university_id=1")) return new Promise(resolve => { finishFirst = resolve; });
        if (url.endsWith("university_id=2")) return Promise.resolve({ items: [{ id: 22, name_ar: "كلية الجامعة الثانية" }] });
        throw new Error("Unexpected request " + url);
      }
    }
  };
  vm.runInNewContext([...source.matchAll(/<script>([\s\S]*?)<\/script>/g)][0][1], context);
  const tick = () => new Promise(resolve => setImmediate(resolve));
  await tick();
  const u = elements.get("u"), c = elements.get("c"), d = elements.get("d"), s = elements.get("s");
  d.value = "old-department"; s.value = "old-subject";
  u.value = "1"; u.events.change();
  assert.equal(s.value, "");
  assert.equal(d.value, "");
  assert.equal(elements.get("go").disabled, true);
  u.value = "2"; u.events.change();
  await tick();
  assert.equal(c.children[1].value, "22");
  finishFirst({ items: [{ id: 11, name_ar: "استجابة قديمة" }] });
  await tick();
  assert.equal(c.children[1].value, "22");
  assert.equal(c.disabled, false);
});

test("university tree queries stay in the selected university and keep directory permissions", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  const env = { DB, ADMIN_EMAILS: "owner@example.test" };
  for (const id of [1, 2]) {
    const response = await handleCatalog(signedRequest(sql, "/api/catalog/index?view=directory&university_id=" + id, 1), env);
    const data = await response.json();
    assert.deepEqual(data.u.map(row => row[0]), [id]);
    assert.deepEqual(data.c.map(row => row[0]), [id]);
    assert.deepEqual(data.d.map(row => row[0]), [id]);
  }
  assert.equal((await handleCatalog(signedRequest(sql, "/api/catalog/index?view=directory&university_id=1", 3), env)).status, 403);
  const pending = await (await handleCatalog(new Request("https://example.test/api/catalog/index?university_id=1"), env)).json();
  assert.deepEqual(pending.u, []);
  assert.equal((await handleCatalog(new Request("https://example.test/api/catalog/index?university_id=bad"), env)).status, 400);
  const plan = sql.prepare(`EXPLAIN QUERY PLAN SELECT d.id, d.name_ar, d.name_en FROM departments d
    JOIN colleges c ON c.id=d.college_id JOIN universities u ON u.id=c.university_id
    WHERE d.college_id=? AND 1=1 ORDER BY CASE WHEN d.name_ar LIKE 'المرحلة %' THEN d.id ELSE 0 END, d.name_ar`).all(1);
  assert.ok(plan.some(row => row.detail.includes("SEARCH d USING INDEX idx_departments_college")));
  assert.ok(!plan.some(row => row.detail === "SCAN d"));
});
