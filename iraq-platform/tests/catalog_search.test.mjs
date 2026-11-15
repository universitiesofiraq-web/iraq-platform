import test from "node:test";
import assert from "node:assert/strict";
import { handleCatalog } from "../functions/_lib/catalog.js";
import { database, seedAcademic } from "./helpers/d1.mjs";

test("بحث المواد: يطابق الاسم والأستاذ، يخفي الجامعات غير المفعّلة، ويرفض النص القصير", async () => {
  const { DB, sql } = database(); seedAcademic(sql);
  sql.exec(`UPDATE subjects SET professor='د. أحمد علي' WHERE id=11;
    INSERT INTO university_onboarding (university_id,state,manager_id,verified_at,updated_at,updated_by) VALUES (1,'active',1,1,1,1),(2,'registered',1,NULL,1,1);`);
  const get = (q) => handleCatalog(new Request("https://example.test/api/catalog/search?q=" + encodeURIComponent(q)), { DB }).then((r) => r.json());
  assert.equal((await get("م")).items.length, 0);
  const byName = await get("أولى");
  assert.deepEqual(byName.items.map((x) => x.id), [11]);
  assert.equal((await get("أحمد")).items[0].id, 11);
  assert.equal((await get("خارجية")).items.length, 0, "جامعة غير مفعّلة");
  assert.equal((await get("%")).items.length, 0, "الرمز الخاص لا يطابق الكل");
});
