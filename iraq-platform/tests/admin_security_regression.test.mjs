// Read-only regression suite for the admin / scoped-upload hardening patch.
// Run from iraq-platform/: node tests/admin_security_regression.test.mjs
import assert from 'node:assert/strict';
import { isAdminUser, policy } from '../functions/_lib/scope.js';
import { handleAuth, uploadAccount } from '../functions/_lib/auth.js';
import { handle as handleUpload } from '../netlify/lib/core.mjs';

const TOKEN = 'a'.repeat(64);
const BASE = 'https://app.example.test';
const known = {
  oldAdmin: { id: 1, email: 'old@example.test', name: 'Previous Admin', role: 'admin', active: 1 },
  admin: { id: 2, email: 'new@example.test', name: 'Current Admin', role: 'student', active: 1 },
  uploader: { id: 3, email: 'uploader@example.test', name: 'Uploader', role: 'uploader', active: 1 },
  representative: { id: 4, email: 'rep@example.test', name: 'Representative', role: 'rep', active: 1 }
};
function mockEnv(current = known.oldAdmin, userScopes = []) {
  const accounts = Object.values(known);
  const db = {
    prepare(sql) {
      let args = [];
      return {
        bind(...a) { args = a; return this; },
        async first() {
          if (sql.includes('FROM sessions s JOIN users')) return current;
          if (sql.includes('FROM subjects sb')) {
            return args[0] === 11 ? { university: 1, college: 10, department: 100 }
              : args[0] === 22 ? { university: 2, college: 20, department: 200 } : null;
          }
          if (sql.includes('SELECT id, email, active FROM users WHERE id')) return accounts.find(x => x.id === args[0]) ?? null;
          return null;
        },
        async all() {
          if (sql.includes('FROM scopes WHERE user_id')) {
            return { results: userScopes.filter(s => s.user_id === args[0]) };
          }
          if (sql.includes('FROM users u LEFT JOIN global_admins')) return { results: accounts };
          return { results: [] };
        },
        async run() { return { success: true }; }
      };
    }
  };
  return { ADMIN_EMAILS: 'new@example.test', DB: db };
}
function request(path, method = 'GET', body) {
  return new Request(BASE + path, {
    method,
    headers: {
      cookie: `ms_session=${TOKEN}`,
      origin: BASE,
      ...(body ? { 'content-type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
}
const tests = [];
const test = (name, run) => tests.push({ name, run });

test('Only the configured ADMIN_EMAILS are administrators, even in existing sessions', () => {
  const env = mockEnv();
  assert.equal(isAdminUser(known.oldAdmin, env), false);
  assert.equal(isAdminUser(known.admin, env), true);
  assert.equal(isAdminUser(null, env), false);
});
test('Removed administrators cannot list users', async () => {
  const r = await handleAuth(request('/api/auth/users'), mockEnv(known.oldAdmin));
  assert.equal(r.status, 403);
});
test('Removed administrators cannot publish announcements', async () => {
  const r = await handleAuth(request('/api/announcements', 'POST', { title: 'Test', body: 'Denied' }), mockEnv(known.oldAdmin));
  assert.equal(r.status, 403);
});
test('Configured administrators can list users; removed admins appear as ordinary users', async () => {
  const r = await handleAuth(request('/api/auth/users'), mockEnv(known.admin));
  assert.equal(r.status, 200);
  const { users } = await r.json();
  assert.equal(users.find(u => u.id === known.oldAdmin.id).role, 'student');
  assert.equal(users.find(u => u.id === known.admin.id).role, 'admin');
});
test('Listed administrators cannot be disabled from the account manager', async () => {
  const r = await handleAuth(request('/api/auth/user', 'POST', { id: known.admin.id, active: false }), mockEnv(known.admin));
  assert.equal(r.status, 409);
});
test('Legacy global uploader / rep roles do not bypass course scopes', async () => {
  for (const u of [known.uploader, known.representative]) {
    assert.equal(await (await policy(mockEnv(u), u)).upload('s11'), false);
    assert.equal(await uploadAccount(mockEnv(u))(request('/api/check', 'POST', {})), null);
  }
});
test('Scoped university uploader may upload only inside assigned university', async () => {
  const u = known.uploader;
  const env = mockEnv(u, [{ user_id: u.id, type: 'university', node_id: 1, level: 'uploader' }]);
  const permission = await policy(env, u);
  assert.equal(await permission.upload('s11'), true);
  assert.equal(await permission.upload('s22'), false);
  assert.equal(await permission.manageCourse('s11'), false);
  const acc = await uploadAccount(env)(request('/api/check', 'POST', {}));
  assert.equal(acc.role, 'uploader');
  assert.equal(await acc.canUpload('s11'), true);
  assert.equal(await acc.canUpload('s22'), false);
});
test('Scoped representative can review only assigned department', async () => {
  const u = known.representative;
  const env = mockEnv(u, [{ user_id: u.id, type: 'department', node_id: 100, level: 'rep' }]);
  const permission = await policy(env, u);
  assert.equal(await permission.manageCourse('s11'), true);
  assert.equal(await permission.manageCourse('s22'), false);
});
test('Legacy upload codes cannot list administrative files', async () => {
  const deps = {
    store: {
      async get() { return null; },
      async set() {},
      async delete() {}
    },
    env: (key) => key === 'UPLOAD_CODES' ? 'Legacy:correct-horse-battery-2035' : '',
    ip: '127.0.0.1', now: () => Date.now(),
    account: async () => null
  };
  const req = new Request(BASE + '/api/admin', { method: 'POST', headers: { 'x-upload-code': 'correct-horse-battery-2035', 'content-type': 'application/json' }, body: '{}' });
  const res = await handleUpload(req, deps);
  assert.equal(res.status, 403);
});

let passed = 0;
for (const { name, run } of tests) {
  try { await run(); console.log('PASS', name); passed++; }
  catch (e) { console.error('FAIL', name, e.stack ?? e); }
}
console.log(`\n${passed}/${tests.length} regression tests passed`);
if (passed !== tests.length) process.exitCode = 1;
