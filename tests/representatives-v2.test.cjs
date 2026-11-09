const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const script = fs.readFileSync(path.resolve(__dirname, '../iraq-platform/site/js/representatives.js'), 'utf8');

class Element {
  constructor(tag) { this.tag = tag; this.children = []; this.hidden = false; this.ownText = ''; this.value = ''; }
  set textContent(text) { this.ownText = String(text); this.children = []; }
  get textContent() { return this.ownText + this.children.map(element => element.textContent).join(' '); }
  append(...children) { this.children.push(...children); }
  replaceChildren(...children) { this.children = children; this.ownText = ''; }
  addEventListener(name, listener) { this[name] = listener; }
  setAttribute(name, value) { this[name] = value; }
  remove() {}
}

const scope = { type: 'department', node_id: 3855, level: 'rep' };
const defaults = {
  '/api/auth/scopes': { items: [{ type: 'department', node_id: 3855, level: 'rep', name: 'ممثل الطب', email: 'private@example.test', node: 'الطب', university: 'جامعة البصرة' }] },
  '/api/catalog/department?id=3855': { item: { name_ar: 'الطب', college: 'كلية الطب', university: 'جامعة البصرة' }, can: true },
  '/api/catalog/subjects?department_id=3855': { items: [{ id: 1, name_ar: 'تشريح' }] },
  '/api/uploads': { items: [{ courseId: 's1', type: 'lecture', title: 'محاضرة القسم' }, { courseId: 's2', type: 'lecture', title: 'محاضرة قسم آخر' }, { courseId: 's1', type: 'quiz', title: 'اختبار' }] },
  '/api/announcements': { items: [{ title: 'تنبيه عام', body: 'تفاصيل التنبيه' }] },
  '/api/auth/rep-requests': { items: [{ status: 'pending' }, { status: 'approved' }] }
};

async function load(user, overrides = {}) {
  const elements = new Map();
  const get = id => {
    if (id === 'team-directory' && !elements.has(id)) return null;
    if (!elements.has(id)) elements.set(id, new Element(id));
    return elements.get(id);
  };
  const calls = [];
  const context = {
    AbortController,
    document: { getElementById: get, createElement: tag => new Element(tag) },
    Option: class extends Element {
      constructor(label, value) { super('option'); this.textContent = label; this.value = value; }
    },
    async fetch(url, options) {
      calls.push({ url, options });
      const result = Object.hasOwn(overrides, url) ? overrides[url]
        : url === '/api/auth/me' ? user ? { user } : 401
        : defaults[url];
      if (result === 'network') throw new TypeError('Network unavailable');
      assert.notEqual(result, undefined, url);
      const status = typeof result === 'number' ? result : 200;
      return { status, ok: status < 400, json: async () => ({ ok: status < 400, ...result }) };
    }
  };
  vm.runInNewContext(script, context);
  await new Promise(resolve => setImmediate(resolve));
  return { get, calls };
}

test('guest sees a sign-in link and no privileged calls', async () => {
  const { get, calls } = await load(null);
  assert.equal(get('dashboard').hidden, true);
  assert.equal(get('session-actions').children[0].href, 'login.html?next=representatives.html');
  assert.deepEqual(calls.map(call => call.url), ['/api/auth/me']);
});

test('students, legacy reps and malformed scopes do not gain management tools', async () => {
  for (const user of [
    { role: 'student', scopes: [] }, { role: 'rep', scopes: [] },
    { role: 'student', scopes: [{ ...scope, level: 'uploader' }, { ...scope, node_id: '3855' }] }
  ]) {
    const { get, calls } = await load(user);
    assert.equal(get('dashboard').hidden, true);
    assert.equal(calls.length, 1);
    assert.equal(get('session-actions').children[0].href, 'catalog.html');
  }
});

test('representative dashboard filters lecture activity to the department and hides privileged actions', async () => {
  const { get, calls } = await load({ role: 'student', scopes: [scope] });
  assert.equal(get('dashboard').hidden, false);
  assert.match(get('context').textContent, /جامعة البصرة/);
  assert.match(get('activity').textContent, /محاضرة القسم/);
  assert.doesNotMatch(get('activity').textContent, /محاضرة قسم آخر|اختبار/);
  assert.equal(get('quick-actions').children[1].children[0].href, 'dept.html?id=3855&manage=1');
  assert.equal(get('quick-actions').children[2].children[0].disabled, true);
  assert.equal(get('quick-actions').children[4].children[0].disabled, true);
  assert.ok(!calls.some(call => call.url === '/api/auth/rep-requests'));
});

test('administrator gets confirmed pending requests and administration links', async () => {
  const { get, calls } = await load({ role: 'student', admin: true, scopes: [] });
  assert.equal(get('dashboard').hidden, false);
  assert.match(get('activity').textContent, /طلب تمثيل معلّق/);
  assert.equal(get('quick-actions').children[4].children[0].href, 'admin.html');
  assert.ok(calls.some(call => call.url === '/api/auth/rep-requests'));
  assert.ok(calls.every(call => call.options.credentials === 'same-origin'));
});

test('network and forbidden session states do not expose dashboard actions', async () => {
  const unavailable = await load(null, { '/api/auth/me': 'network' });
  assert.equal(unavailable.get('dashboard').hidden, true);
  assert.match(unavailable.get('session-actions').textContent, /حاول مرة أخرى/);
  const forbidden = await load(null, { '/api/auth/me': 403 });
  assert.equal(forbidden.get('dashboard').hidden, true);
  assert.match(forbidden.get('session-status').textContent, /غير مخوّل/);
});

test('catalog failure is distinct from an empty announcement list', async () => {
  const { get } = await load({ role: 'student', scopes: [scope] }, {
    '/api/catalog/subjects?department_id=3855': 503,
    '/api/announcements': { items: [] }
  });
  assert.match(get('activity').textContent, /تعذّر تحميل المحاضرات/);
  assert.match(get('announcements').textContent, /لا توجد تبليغات/);
});


test('directory shows server-provided names and scopes without exposing emails or advanced actions', async () => {
  const { get } = await load({ role: 'student', scopes: [scope] });
  assert.match(get('dashboard').textContent, /دليل الممثلين.*ممثل الطب/);
  assert.doesNotMatch(get('dashboard').textContent, /private@example/);
  const directory = get('dashboard').children.at(-1);
  assert.equal(directory.children.at(-1).children[1].children[0].disabled, true);
  const search = directory.children[1].children[1];
  search.value = 'لا يوجد';
  search.input();
  assert.match(directory.textContent, /لا توجد نتائج مطابقة/);
});
