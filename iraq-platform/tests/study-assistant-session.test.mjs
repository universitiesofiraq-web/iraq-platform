import assert from "node:assert/strict";
import { createHash } from "node:crypto";
import { test } from "node:test";
import { onRequest } from "../functions/api/study-assistant/session.js";

const path = "https://test.example/api/study-assistant/session";
const token = "a".repeat(64);
const hash = createHash("sha256").update(token).digest("hex");
const request = (headers = {}, method = "GET") => new Request(path, { headers, method });

function database(session) {
  return {
    prepare(sql) {
      assert.match(sql, /FROM sessions s JOIN users/);
      return {
        bind(tokenHash, now) {
          return {
            async first() {
              return session && tokenHash === hash && session.expiresAt > now ? session.user : null;
            }
          };
        }
      };
    }
  };
}

test("an active platform cookie returns a minimal, private student identity", async () => {
  const env = {
    DB: database({
      expiresAt: Date.now() + 60_000,
      user: { id: 12, name: "طالب تجريبي", role: "student", email: "student@example.test", active: 1 }
    })
  };
  const response = await onRequest({
    request: request({ Cookie: "ms_session=" + token, "X-User-Id": "99" }),
    env
  });
  assert.equal(response.status, 200);
  assert.equal(response.headers.get("Cache-Control"), "private, no-store");
  assert.deepEqual(await response.json(), { ok: true, user: { id: 12, name: "طالب تجريبي" } });
});

test("missing cookies, assistant demo headers and a fabricated cookie are rejected", async () => {
  const env = {
    DB: database({ expiresAt: Date.now() + 60_000, user: { id: 12, active: 1 } })
  };
  for (const headers of [
    {},
    { "X-Session-Token": token, Authorization: "Bearer " + token },
    { Cookie: "ms_session=" + "b".repeat(64) }
  ]) {
    const response = await onRequest({ request: request(headers), env });
    assert.equal(response.status, 401);
  }
});

test("expired sessions and inactive users are rejected", async () => {
  for (const session of [
    { expiresAt: Date.now() - 1, user: { id: 12, active: 1 } },
    { expiresAt: Date.now() + 60_000, user: { id: 12, active: 0 } }
  ]) {
    const response = await onRequest({
      request: request({ Cookie: "ms_session=" + token }),
      env: { DB: database(session) }
    });
    assert.equal(response.status, 401);
  }
});

test("unbound and unavailable session databases fail without exposing internals", async () => {
  const req = request({ Cookie: "ms_session=" + token });
  const unbound = await onRequest({ request: req, env: {} });
  assert.equal(unbound.status, 503);
  assert.deepEqual(await unbound.json(), { ok: false, error: "not_configured" });
  const failing = await onRequest({
    request: req,
    env: { DB: { prepare() { throw new Error("internal database message"); } } }
  });
  assert.equal(failing.status, 503);
  assert.deepEqual(await failing.json(), { ok: false, error: "session_unavailable" });
});

test("the session endpoint rejects mutation methods", async () => {
  const response = await onRequest({ request: request({}, "POST"), env: {} });
  assert.equal(response.status, 405);
  assert.equal(response.headers.get("Allow"), "GET");
});
