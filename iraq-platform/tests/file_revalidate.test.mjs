/* فتح ملف مرفوع للمرة الثانية بلا تنزيله كاملاً (2026-11-19):
   الخادم يعطي بصمة ETag ويرد 304 عند تطابقها بعد فحص الصلاحية، والعامل يعيد النسخة المحفوظة عند 304
   ويبقى الخادم صاحب القرار: ملف صار خاصاً أو محذوفاً يُمسح من الجهاز كما كان. */
import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";
import { onRequest } from "../functions/api/[[path]].js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

test("uploaded file: ETag, 304 on match after the access check, 404 still wins", async () => {
  const { DB, sql } = database(); seedAcademic(sql);
  sql.exec("INSERT INTO university_onboarding VALUES (1,'active',2,1,1,1)");
  const id = "aaaaaaaa-aaaa-aaaa-aaaa-00000000000a";
  let chunkReads = 0;
  const env = { DB, ADMIN_EMAILS: "owner@example.test", LECTURES: {
    async get(key) {
      if (key === "manifest.json") return [{ id, courseId: "s11", kind: "file", status: "approved", size: 5, chunks: 1 }];
      if (key.startsWith("chunks/")) { chunkReads++; return new TextEncoder().encode("%PDF-").buffer; }
      return null;
    }
  } };
  const get = (headers) => { const r = signedRequest(sql, "/api/file/" + id); for (const [k, v] of Object.entries(headers || {})) r.headers.set(k, v); return onRequest({ request: r, env }); };
  const first = await get();
  const tag = first.headers.get("etag");
  assert.equal(first.status, 200); assert.ok(tag); assert.equal(await first.text(), "%PDF-");
  const reads = chunkReads;
  const again = await get({ "if-none-match": tag });
  assert.equal(again.status, 304); assert.equal(again.headers.get("etag"), tag);
  assert.equal(chunkReads, reads, "304 must not read the file chunks");
  assert.equal((await get({ "if-none-match": '"other"' })).status, 200);
  sql.exec("UPDATE university_onboarding SET state='suspended' WHERE university_id=1");
  assert.equal((await get({ "if-none-match": tag })).status, 404, "a hidden file never answers 304");
});

test("service worker returns the saved copy on 304 and asks with the saved ETag", async () => {
  const origin = "https://example.test", handlers = {}, stored = new Map();
  const cache = { async match(req) { return stored.get(req.url); }, async put(req, res) { stored.set(req.url, res); }, async delete(req) { stored.delete(req.url); } };
  let asked = null, network = async () => new Response("BODY", { headers: { "cache-control": "public, max-age=0", etag: '"x-5"' } });
  vm.runInNewContext(readFileSync(new URL("../site/sw.js", import.meta.url), "utf8"), {
    URL, Response, Request, Headers, location: { origin },
    fetch: (req, ...rest) => { asked = req; return network(req, ...rest); },
    self: { addEventListener: (n, h) => { handlers[n] = h; }, clients: { claim() {} } },
    caches: { open: async () => cache, keys: async () => [], delete: async () => {} }
  });
  const open = () => { let r; handlers.fetch({ request: new Request(origin + "/api/file/lecture"), respondWith: v => { r = v; } }); return r; };
  assert.equal(await (await open()).text(), "BODY");
  network = async () => new Response(null, { status: 304 });
  const second = await open();
  assert.equal(second.status, 200); assert.equal(await second.text(), "BODY");
  assert.equal(asked.headers.get("if-none-match"), '"x-5"');
  network = async () => new Response(null, { status: 404 });
  assert.equal((await open()).status, 404);
  assert.equal(stored.size, 0, "a removed file is dropped from the device");
});
