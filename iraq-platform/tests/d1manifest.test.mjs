import test from "node:test";
import assert from "node:assert/strict";
import { d1Manifest, readUploads } from "../functions/_lib/d1manifest.js";
import { database } from "./helpers/d1.mjs";

const kv = (m) => ({ async get() { return m; } });

test("imports the legacy KV manifest once, then mutates rows independently", async () => {
  const { DB } = database();
  const legacy = [{ id: "a", courseId: "s1", title: "A" }, { id: "b", courseId: "s1", title: "B" }];
  const store = d1Manifest(DB, kv(legacy));
  assert.deepEqual((await store.read()).map((e) => e.id), ["a", "b"]);
  await store.update((l) => l.concat([{ id: "c", courseId: "s2" }]));
  await store.update((l) => l.map((e) => (e.id === "a" ? { ...e, title: "A2" } : e)));
  await store.update((l) => l.filter((e) => e.id !== "b"));
  // a second instance sees the same state and does not re-import the old KV list
  const again = d1Manifest(DB, kv(legacy));
  const list = await again.read();
  assert.deepEqual(list.map((e) => e.id), ["a", "c"]);
  assert.equal(list[0].title, "A2");
  const viaHelper = await readUploads({ DB, LECTURES: kv(legacy) });
  assert.equal(viaHelper.length, 2);
});

test("readUploads falls back to KV when D1 is not migrated", async () => {
  const bad = { prepare() { throw new Error("no such table"); } };
  const r = await readUploads({ DB: bad, LECTURES: kv([{ id: "z" }]) });
  assert.deepEqual(r, [{ id: "z" }]);
});
