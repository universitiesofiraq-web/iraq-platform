// Run from iraq-platform/: node --test tests/group_chat.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { handleGroupChat } from "../functions/_lib/group_chat.js";
import { onRequest } from "../functions/api/[[path]].js";
import { database, seedAcademic, signedRequest } from "./helpers/d1.mjs";

function fixture() {
  const { DB, sql } = database();
  const q = (statement, ...args) => sql.prepare(statement).run(...args);
  q("INSERT INTO universities(id,slug,name_ar) VALUES(1,'uni','جامعة')");
  q("INSERT INTO colleges(id,university_id,slug,name_ar) VALUES(1,1,'college','كلية')");
  q("INSERT INTO departments(id,college_id,name_ar) VALUES(1,1,'قسم أ'),(2,1,'قسم ب')");
  for (let i = 1; i <= 4; i++) q("INSERT INTO users(id,google_sub,email,name,created_at) VALUES(?,?,?,?,?)", i, "sub" + i, "student" + i + "@x.edu", "طالب " + i, 1);
  q("INSERT INTO stages(id,department_id,number) VALUES(11,1,1),(12,1,2),(13,1,3),(21,2,1)");
  q("INSERT INTO user_profile(user_id,college_id,stage_id) VALUES(2,1,11),(3,1,11),(4,1,21)");
  q("INSERT INTO scopes(user_id,type,node_id,level) VALUES(1,'department',1,'rep')");
  const env = { DB, GROUP_CHAT_ENABLED: "1", GROUP_CHAT_AUTO: "0" };
  const users = [1, 2, 3, 4].map(id => ({ id, name: "طالب " + id, email: "student" + id + "@x.edu", role: "student" }));
  async function call(userId, op, payload, method) {
    const url = "https://platform.test/api/group-chat/" + op;
    const isGet = method === "GET" || (!payload && method !== "POST");
    const req = new Request(url, isGet ? { method: "GET" } : {
      method: "POST", headers: { "content-type": "application/json", origin: "https://platform.test" },
      body: JSON.stringify(payload)
    });
    const response = await handleGroupChat(req, env, { currentUser: async () => users[userId - 1] || null, now: () => Date.now() });
    return { code: response.status, data: await response.json() };
  }
  return { env, users, call, q };
}

test("rooms are stage-scoped, require explicit membership, and do not expose invite codes", async () => {
  const { call, q } = fixture();
  q("UPDATE user_profile SET stage_id=12 WHERE user_id=2");
  const denied = await call(2, "create", { stage_id: 12, name: "A" });
  assert.equal(denied.code, 403);
  const created = await call(1, "create", { stage_id: 12, name: "A" });
  assert.equal(created.code, 201);
  assert.match(created.data.invite_code, /^[a-f0-9]{36}$/);
  const same = await call(1, "create", { stage_id: 12, name: "A" });
  assert.equal(same.code, 409);
  const otherStage = await call(1, "create", { stage_id: 13, name: "A" });
  assert.equal(otherStage.code, 201);
  assert.notEqual(otherStage.data.id, created.data.id);
  const outsider = await call(2, "rooms", null, "GET");
  assert.equal(outsider.data.items.length, 0);
  const noRead = await call(2, "messages?room_id=" + created.data.id, null, "GET");
  assert.equal(noRead.code, 403);
  const joined = await call(2, "join", { invite_code: created.data.invite_code });
  assert.equal(joined.code, 202);
  assert.equal((await call(2, "messages?room_id=" + created.data.id)).code, 403);
  assert.equal((await call(1, "manage", { room_id: created.data.id, action: "approve", id: 2 })).code, 200);
  const rooms = await call(2, "rooms", null, "GET");
  assert.equal(rooms.data.items.length, 1);
  assert.equal(rooms.data.items[0].stage, 2);
  assert.ok(!JSON.stringify(rooms.data).includes(created.data.invite_code));
});

test("messages are isolated, safe to retry, and cannot reply across rooms", async () => {
  const { call } = fixture();
  const a = (await call(1, "create", { stage_id: 11, name: "A" })).data;
  const b = (await call(1, "create", { stage_id: 11, name: "B" })).data;
  const noSend = await call(2, "send", { room_id: a.id, body: "secret", client_id: "aaaaaaaa-aaaa-4444-aaaa-aaaaaaaaaaaa" });
  assert.equal(noSend.code, 403);
  assert.equal((await call(2, "join", { invite_code: a.invite_code })).code, 202);
  assert.equal((await call(1, "manage", { room_id: a.id, action: "approve", id: 2 })).code, 200);
  const first = await call(2, "send", { room_id: a.id, body: "مرحبا", client_id: "aaaaaaaa-aaaa-4444-aaaa-aaaaaaaaaaaa" });
  assert.equal(first.code, 201);
  const dup = await call(2, "send", { room_id: a.id, body: "مرحبا", client_id: "aaaaaaaa-aaaa-4444-aaaa-aaaaaaaaaaaa" });
  assert.equal(dup.code, 200);
  assert.equal(dup.data.item.id, first.data.item.id);
  const cross = await call(1, "send", { room_id: b.id, body: "secret", reply_to: first.data.item.id, client_id: "bbbbbbbb-bbbb-4444-bbbb-bbbbbbbbbbbb" });
  assert.equal(cross.code, 400);
  const list = await call(1, "messages?room_id=" + a.id, null, "GET");
  assert.equal(list.data.items.length, 1);
  assert.equal(list.data.items[0].body, "مرحبا");
  const other = await call(1, "messages?room_id=" + b.id, null, "GET");
  assert.equal(other.data.items.length, 0);
  const unread = await call(1, "rooms", null, "GET");
  assert.equal(unread.data.items.find(r => r.id === a.id).unread, 1);
  await call(1, "read", { room_id: a.id, last_read_id: first.data.item.id });
  const after = await call(1, "rooms", null, "GET");
  assert.equal(after.data.items.find(r => r.id === a.id).unread, 0);
});

test("edit, delete, pin and invitation rotation are authorized", async () => {
  const { call } = fixture();
  const a = (await call(1, "create", { stage_id: 11, name: "A" })).data;
  assert.equal((await call(2, "join", { invite_code: a.invite_code })).code, 202);
  assert.equal((await call(1, "manage", { room_id: a.id, action: "approve", id: 2 })).code, 200);
  const sent = await call(2, "send", { room_id: a.id, body: "text", client_id: "ffffffff-aaaa-4444-bbbb-aaaaaaaaaaaa" });
  assert.equal(sent.code, 201);
  const mid = sent.data.item.id;
  assert.equal((await call(1, "edit", { room_id: a.id, message_id: mid, body: "forbidden" })).code, 403);
  assert.equal((await call(2, "pin", { room_id: a.id, message_id: mid, pinned: true })).code, 403);
  assert.equal((await call(1, "pin", { room_id: a.id, message_id: mid, pinned: true })).code, 200);
  assert.equal((await call(2, "edit", { room_id: a.id, message_id: mid, body: "updated" })).code, 200);
  assert.equal((await call(1, "delete", { room_id: a.id, message_id: mid })).code, 200);
  const list = (await call(2, "messages?room_id=" + a.id, null, "GET")).data.items;
  assert.equal(list[0].body, null);
  assert.ok(list[0].deleted_at);
  assert.equal((await call(2, "rotate-code", { room_id: a.id })).code, 403);
  const rotated = await call(1, "rotate-code", { room_id: a.id });
  assert.equal(rotated.code, 200);
  assert.equal((await call(3, "join", { invite_code: a.invite_code })).code, 404);
  assert.equal((await call(3, "join", { invite_code: rotated.data.invite_code })).code, 202);
});

test("feature flag, origin validation and malformed inputs fail closed", async () => {
  const { env, call, users } = fixture();
  env.GROUP_CHAT_ENABLED = "0";
  assert.equal((await call(1, "rooms", null, "GET")).code, 503);
  env.GROUP_CHAT_ENABLED = "1";
  assert.equal((await call(1, "join", { invite_code: "invalid" })).code, 400);
  const req = new Request("https://platform.test/api/group-chat/create", {
    method: "POST", headers: { origin: "https://attacker.test", "content-type": "application/json" },
    body: JSON.stringify({ stage_id: 11, name: "A" })
  });
  const res = await handleGroupChat(req, env, { currentUser: async () => users[0] });
  assert.equal(res.status, 403);
});


test("stage representatives manage their own stage, and membership follows the current profile", async () => {
  const { call, q } = fixture();
  q("UPDATE scopes SET type='stage',node_id=11 WHERE user_id=1");
  const mine = await call(1, "create", { stage_id: 11, name: "A" });
  assert.equal(mine.code, 201);
  assert.equal((await call(1, "create", { stage_id: 12, name: "B" })).code, 403);
  assert.equal((await call(1, "create", { stage_id: 18, name: "C" })).code, 403);
  assert.equal((await call(1, "create", { stage_id: 21, name: "A" })).code, 403);
  assert.equal((await call(4, "join", { invite_code: mine.data.invite_code })).code, 403);
  q("UPDATE user_profile SET stage_id=12 WHERE user_id=3");
  assert.equal((await call(3, "join", { invite_code: mine.data.invite_code })).code, 403);
  assert.equal((await call(2, "join", { invite_code: mine.data.invite_code })).code, 202);
  assert.equal((await call(1, "manage", { room_id: mine.data.id, action: "approve", id: 2 })).code, 200);
  assert.equal((await call(2, "messages?room_id=" + mine.data.id)).code, 200);
  const sent = await call(2, "send", { room_id: mine.data.id, body: "رسالة", client_id: "stage-scope-check-1" });
  assert.equal(sent.code, 201);
  assert.equal((await call(1, "pin", { room_id: mine.data.id, message_id: sent.data.item.id, pinned: true })).code, 200);
  assert.equal((await call(1, "rotate-code", { room_id: mine.data.id })).code, 200);

  q("UPDATE user_profile SET stage_id=12 WHERE user_id=2");
  assert.deepEqual((await call(2, "rooms")).data.items, []);
  assert.equal((await call(2, "messages?room_id=" + mine.data.id)).code, 403);
  assert.equal((await call(2, "send", { room_id: mine.data.id, body: "رسالة", client_id: "stage-scope-check-2" })).code, 403);
  q("DELETE FROM scopes WHERE user_id=1");
  assert.equal((await call(1, "rotate-code", { room_id: mine.data.id })).code, 403);
});


test("the Pages router checks the feature flag, session and stage with migrated D1 tables", async () => {
  const { DB, sql } = database();
  seedAcademic(sql);
  sql.exec("INSERT INTO scopes(user_id,type,node_id,level) VALUES(3,'stage',11,'rep')");
  const env = { DB };
  const call = (path, userId, body) =>
    onRequest({ request: signedRequest(sql, "/api/group-chat/" + path, userId, body), env });
  assert.equal((await call("rooms", 3)).status, 503);
  env.GROUP_CHAT_ENABLED = "1";
  assert.equal((await call("rooms")).status, 401);
  assert.equal((await call("create", 3, { stage_id: 12, name: "A" })).status, 403);
  const created = await call("create", 3, { stage_id: 11, name: "A" });
  assert.equal(created.status, 201);
  const { id } = await created.json();
  assert.equal((await call("messages?room_id=" + id, 2)).status, 403);
  assert.equal((await call("messages?room_id=" + id, 3)).status, 200);
});


test("approval is scoped, rechecks eligibility, and removal revokes access", async () => {
  const { call, q } = fixture();
  const group = (await call(1, "create", { stage_id: 11, name: "A" })).data;
  const act = (user, action, id) => call(user, "manage", { room_id: group.id, action, id });
  const invite = { invite_code: group.invite_code };
  assert.equal((await call(2, "join", invite)).code, 202);
  assert.equal((await call(2, "join", invite)).code, 202);
  const requests = "manage?kind=requests&room_id=" + group.id;
  assert.equal((await call(4, requests)).code, 403);
  assert.equal((await call(2, requests)).code, 403);
  assert.deepEqual((await call(1, requests)).data.items.map(item => item.id), [2]);
  assert.equal((await act(2, "approve", 2)).code, 403);
  q("UPDATE user_profile SET stage_id=12 WHERE user_id=2");
  assert.equal((await act(1, "approve", 2)).code, 409);
  assert.equal((await act(1, "reject", 2)).code, 200);
  q("UPDATE user_profile SET stage_id=11 WHERE user_id=2");
  assert.equal((await call(2, "rooms")).data.requests[0].status, "rejected");
  assert.equal((await call(2, "join", invite)).code, 202);
  assert.equal((await act(1, "approve", 2)).code, 200);
  assert.equal((await act(1, "approve", 2)).code, 409);
  assert.equal((await call(2, "messages?room_id=" + group.id)).code, 200);
  assert.equal((await act(1, "revoke", 2)).code, 200);
  assert.equal((await call(2, "rooms")).data.requests[0].status, "revoked");
  assert.equal((await call(2, "messages?room_id=" + group.id)).code, 403);
  assert.equal((await call(2, "send", { room_id: group.id, body: "test", client_id: "revoked-member-check" })).code, 403);
  assert.equal((await call(2, "join", invite)).code, 202);
  assert.equal((await call(2, "messages?room_id=" + group.id)).code, 403);
});

test("stage managers can review reports without membership but only in scope", async () => {
  const { call, q } = fixture();
  const a = (await call(1, "create", { stage_id: 11, name: "A" })).data;
  const b = (await call(1, "create", { stage_id: 12, name: "B" })).data;
  assert.equal((await call(2, "join", { invite_code: a.invite_code })).code, 202);
  assert.equal((await call(1, "manage", { room_id: a.id, action: "approve", id: 2 })).code, 200);
  const sent = (await call(1, "send", { room_id: a.id, body: "رسالة", client_id: "report-verify-test" })).data.item;
  assert.equal((await call(2, "report", { room_id: a.id, message_id: sent.id, reason: "بلاغ تجريبي" })).code, 200);
  q("INSERT INTO scopes(user_id,type,node_id,level) VALUES(3,'stage',11,'rep')");
  const reportPath = id => "manage?kind=reports&room_id=" + id;
  assert.equal((await call(3, "messages?room_id=" + a.id)).code, 403);
  assert.equal((await call(3, reportPath(b.id))).code, 403);
  assert.equal((await call(2, reportPath(a.id))).code, 403);
  const [report] = (await call(3, reportPath(a.id))).data.items;
  assert.equal(report.reason, "بلاغ تجريبي");
  assert.equal((await call(1, "manage", { room_id: b.id, action: "remove", id: report.id })).code, 409);
  assert.equal((await call(3, "manage", { room_id: a.id, action: "remove", id: report.id })).code, 200);
  assert.deepEqual((await call(3, reportPath(a.id))).data.items, []);
  const messages = (await call(2, "messages?room_id=" + a.id)).data;
  assert.equal(messages.items[0].body, null);
  assert.equal(messages.removed_count, 1);
  assert.equal((await call(3, "manage", { room_id: a.id, action: "dismiss", id: report.id })).code, 409);
  const second = (await call(2, "send", { room_id: a.id, body: "رسالة باقية", client_id: "report-dismiss-test" })).data.item;
  assert.equal((await call(1, "report", { room_id: a.id, message_id: second.id, reason: "بلاغ ثانٍ" })).code, 200);
  const [newReport] = (await call(3, reportPath(a.id))).data.items;
  assert.equal((await call(3, "manage", { room_id: a.id, action: "dismiss", id: newReport.id })).code, 200);
  assert.equal((await call(2, "messages?room_id=" + a.id)).data.items[1].body, "رسالة باقية");
});

test("auto groups: every stage gets a default group and students join without a code", async () => {
  const { env, call, q } = fixture();
  env.GROUP_CHAT_AUTO = "1";
  assert.equal((await call(2, "rooms")).data.items.length, 0, "unverified student does not auto-join");
  q("INSERT INTO student_verification(user_id,stage_id,verified_by,verified_at) VALUES(2,11,1,1),(3,11,1,1),(4,21,1,1)");
  const r2 = await call(2, "rooms");
  assert.equal(r2.data.items.length, 1);
  const r3 = await call(3, "rooms");
  assert.equal(r3.data.items.length, 1);
  assert.equal(r3.data.items[0].id, r2.data.items[0].id, "same stage shares one group");
  const r4 = await call(4, "rooms");
  assert.equal(r4.data.items.length, 1);
  assert.notEqual(r4.data.items[0].id, r2.data.items[0].id, "other department has its own group");
  const sent = await call(2, "send", { room_id: r2.data.items[0].id, body: "مرحبا", client_id: "abcdefabcdefabcdef12" });
  assert.equal(sent.code, 201);
  assert.equal((await call(3, "messages?room_id=" + r2.data.items[0].id)).data.items.length, 1);
  q("INSERT INTO chat_join_requests(group_id,user_id,status,requested_at) VALUES(?,?,'revoked',1)", r2.data.items[0].id, 1);
  assert.equal((await call(1, "rooms")).data.items.length, 0, "no profile stage, no auto membership");
});
