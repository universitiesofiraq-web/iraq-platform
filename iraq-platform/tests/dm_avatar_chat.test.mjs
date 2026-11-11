// Run from iraq-platform/: node --test tests/dm_avatar_chat.test.mjs
// الرسائل الخاصة وصورة الطالب واسمه الظاهر ومرفقات الدردشة (منقولة من ميدكسا 2026-11-11).
import test from "node:test";
import assert from "node:assert/strict";
import { handleDm } from "../functions/_lib/dm.js";
import { handleAvatar } from "../functions/_lib/avatar.js";
import { handleGroupChat, cleanAttach } from "../functions/_lib/group_chat.js";
import { database } from "./helpers/d1.mjs";

function fixture() {
  const { DB, sql } = database();
  const q = (s, ...a) => sql.prepare(s).run(...a);
  q("INSERT INTO universities(id,slug,name_ar) VALUES(1,'uni','جامعة'),(2,'uni2','جامعة 2')");
  q("INSERT INTO colleges(id,university_id,slug,name_ar) VALUES(1,1,'c','كلية'),(2,2,'c2','كلية 2')");
  q("INSERT INTO departments(id,college_id,name_ar) VALUES(1,1,'قسم أ'),(2,1,'قسم ب'),(3,2,'قسم ج')");
  for (let i = 1; i <= 5; i++) q("INSERT INTO users(id,google_sub,email,name,created_at) VALUES(?,?,?,?,?)", i, "s" + i, "u" + i + "@x", "طالب رقم " + i, 1);
  q("INSERT INTO stages(id,department_id,number) VALUES(11,1,1),(21,2,1),(31,3,1)");
  q("INSERT INTO user_profile(user_id,college_id,stage_id) VALUES(2,1,11),(3,1,11),(4,1,21),(5,2,31)");
  q("INSERT INTO scopes(user_id,type,node_id,level) VALUES(1,'department',1,'rep')");
  const env = { DB, GROUP_CHAT_ENABLED: "1", GROUP_CHAT_AUTO: "0" };
  const user = (id) => ({ id, name: "طالب رقم " + id, email: "u" + id + "@x", role: "student", active: 1 });
  let t = 1e12;
  async function run(h, uid, path, body) {
    const req = new Request("https://p.test" + path, body === undefined ? { method: "GET" } :
      { method: "POST", headers: { "content-type": "application/json", origin: "https://p.test" }, body: JSON.stringify(body) });
    t += 5000;
    const r = await h(req, env, { currentUser: async () => (uid ? user(uid) : null), now: () => t });
    return { code: r.status, data: r.headers.get("content-type")?.includes("json") ? await r.json() : null };
  }
  return { env, q, sql, dm: (u, p, b) => run(handleDm, u, "/api/dm/" + p, b), av: (u, p, b) => run(handleAvatar, u, p, b), gc: (u, p, b) => run(handleGroupChat, u, "/api/group-chat/" + p, b) };
}

test("DM: same-department students can talk; private to the pair; other departments refused", async () => {
  const f = fixture();
  assert.equal((await f.dm(2, "send", { peer: 3, body: "مرحبا" })).code, 201);
  const mine = await f.dm(3, "threads");
  assert.equal(mine.data.items.length, 1);
  assert.equal(mine.data.items[0].unread, 1);
  assert.equal((await f.dm(4, "messages?peer=2")).data.items.length, 0, "third party sees nothing of 2↔3");
  assert.equal((await f.dm(2, "send", { peer: 4, body: "x" })).code, 403, "other department refused");
  assert.equal((await f.dm(2, "send", { peer: 5, body: "x" })).code, 403, "other university refused");
  assert.equal((await f.dm(2, "send", { peer: 1, body: "سؤال للممثل" })).code, 201, "student → rep covering him");
  assert.equal((await f.dm(1, "send", { peer: 4, body: "من الممثل" })).code, 201, "rep can start a conversation");
  assert.equal((await f.dm(4, "send", { peer: 1, body: "رد" })).code, 201, "reply in existing thread always allowed");
  assert.equal((await f.dm(null, "threads")).code, 401);
});

test("DM: people search stays inside the department; staff lists covering reps", async () => {
  const f = fixture();
  const ppl = await f.dm(2, "people?q=" + encodeURIComponent("طالب"));
  assert.deepEqual(ppl.data.items.map((p) => p.id).sort(), [3]);
  const staff = await f.dm(2, "staff");
  assert.deepEqual(staff.data.items.map((p) => p.id), [1]);
  assert.equal((await f.dm(5, "staff")).data.items.length, 0);
});

test("DM: delete, block, report", async () => {
  const f = fixture();
  const s = await f.dm(2, "send", { peer: 3, body: "سيُحذف" });
  assert.equal((await f.dm(3, "delete", { message_id: s.data.item.id })).code, 403, "cannot delete other's");
  assert.equal((await f.dm(2, "delete", { message_id: s.data.item.id })).code, 200);
  assert.equal((await f.dm(3, "messages?peer=2")).data.items.length, 0);
  const s2 = await f.dm(2, "send", { peer: 3, body: "مزعج" });
  assert.equal((await f.dm(3, "report", { message_id: s2.data.item.id, reason: "إزعاج" })).code, 200);
  assert.equal((await f.dm(3, "block", { peer: 2 })).code, 200);
  assert.equal((await f.dm(2, "send", { peer: 3, body: "؟" })).data.error, "cant_message");
  assert.equal((await f.dm(2, "reports")).code, 403, "reports admin only");
});

test("avatar + display name flow into group chat messages", async () => {
  const f = fixture();
  assert.equal((await f.av(2, "/api/profile/public", { name: "أبو علي" })).code, 200);
  const img = "data:image/jpeg;base64,/9j/" + "A".repeat(200);
  assert.equal((await f.av(2, "/api/profile/public", { image: img })).code, 200);
  assert.equal((await f.av(2, "/api/profile/public", { image: "data:image/png;base64,AAAA" })).code, 400);
  const pub = await f.av(2, "/api/profile/public");
  assert.equal(pub.data.display_name, "أبو علي"); assert.equal(pub.data.has_avatar, true);
  assert.equal((await f.av(null, "/api/avatar/2")).code, 401);
  f.q("INSERT INTO chat_groups(id,stage_id,name,invite_hash,created_by,created_at) VALUES(1,11,'م','h',1,1)");
  f.q("INSERT INTO chat_members(group_id,user_id,joined_at) VALUES(1,2,1),(1,3,1)");
  const sent = await f.gc(2, "send", { room_id: 1, client_id: "abcdefghijklmnop1", body: "انظر", attach: { type: "file", title: "المحاضرة 1", href: "course.html?id=anat&dept=1#lec-1" } });
  assert.equal(sent.code, 201);
  assert.equal(sent.data.item.sender, "أبو علي");
  assert.ok(sent.data.item.av > 0);
  assert.ok(sent.data.item.body.startsWith("[[att]]"));
  const bad = await f.gc(2, "send", { room_id: 1, client_id: "abcdefghijklmnop2", body: "x", attach: { type: "file", title: "t", href: "https://evil.example" } });
  assert.equal(bad.code, 400, "external links refused");
  const forged = await f.gc(2, "send", { room_id: 1, client_id: "abcdefghijklmnop3", body: '[[att]]{"type":"file","title":"x","href":"https://evil"}\nhi' });
  assert.equal(forged.code, 201); assert.ok(!forged.data.item.body.startsWith("[[att]]"), "forged attachment stripped");
  assert.equal(cleanAttach({ type: "announcement", title: "ت", href: "platform.html?dept=4&stage=1#announcements" }).type, "announcement");
});

test("chat rooms follow the profile stage: admin sees only the new stage group and joins it without verification", async () => {
  const f = fixture();
  f.env.ADMIN_EMAILS = "u2@x"; delete f.env.GROUP_CHAT_AUTO;
  f.q("INSERT INTO chat_groups(id,stage_id,name,invite_hash,created_by,created_at) VALUES(1,31,'قديمة','h1',5,1),(2,11,'جديدة','h2',3,1)");
  f.q("INSERT INTO chat_members(group_id,user_id,joined_at) VALUES(1,2,1)"); // عضو قديم في مجموعة جامعة أخرى
  const rooms = await f.gc(2, "rooms");
  assert.deepEqual(rooms.data.items.map((r) => r.id), [2], "old university group hidden, joined own stage group");
});
