import test from "node:test";
import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import vm from "node:vm";

const script = readFileSync(new URL("../site/js/admin-v3.js", import.meta.url), "utf8");
const html = readFileSync(new URL("../site/admin.html", import.meta.url), "utf8");
const tick = () => new Promise(resolve => setImmediate(resolve));

class Element {
  constructor(tag, owner) {
    this.tagName = tag;
    this.owner = owner;
    this.children = [];
    this.attrs = new Map();
    this.dataset = {};
    this.events = {};
    this.hidden = false;
    this.value = "";
  }
  get firstElementChild() { return this.children[0]; }
  get lastElementChild() { return this.children.at(-1); }
  get textContent() { return this._text ?? this.children.map(x => x.textContent).join(" "); }
  set textContent(text) { this._text = String(text); this.children = []; }
  get isConnected() { return true; }
  append(...nodes) {
    if (this._text) this.children.push({ textContent: this._text });
    this._text = undefined;
    this.children.push(...nodes.map(node => node instanceof Element ? node : { textContent: String(node) }));
  }
  replaceChildren(...nodes) { this._text = undefined; this.children = []; this.append(...nodes); }
  addEventListener(type, callback) { this.events[type] = callback; }
  setAttribute(key, value) { this.attrs.set(key, value); }
  removeAttribute(key) { this.attrs.delete(key); }
  toggleAttribute(key, force = !this.attrs.has(key)) {
    if (force) this.attrs.set(key, ""); else this.attrs.delete(key);
    return force;
  }
  showModal() { this.open = true; }
  close() { this.open = false; }
  createTHead() { return this.section("thead"); }
  createTBody() { return this.section("tbody"); }
  insertRow() { return this.section("tr"); }
  insertCell() { return this.section("td"); }
  section(tag) { const node = new Element(tag, this.owner); this.append(node); return node; }
}

export function dashboard(responseFor, search = "") {
  const roots = new Map([...html.matchAll(/\bid="([^"]+)"/g)].map(([, id]) => [id, new Element(id)]));
  const sidebar = new Element("aside");
  const requests = [];
  const go = { href: "", search, replace(path) { this.href = path; } };
  const lookup = (node, id) => {
    if (node.id === id) return node;
    for (const child of node.children || []) {
      const found = lookup(child, id);
      if (found) return found;
    }
    return undefined;
  };
  const doc = {
    documentElement: new Element("html"),
    getElementById(id) { return roots.get(id) ?? lookup(roots.get("content"), id); },
    createElement(tag) { return new Element(tag); },
    querySelector() { return sidebar; }
  };
  vm.runInNewContext(script, {
    document: doc, Node: Element, location: go, URLSearchParams, window: {},
    localStorage: { getItem: () => null },
    Option: class extends Element {
      constructor(text, value) { super("option"); this.textContent = text; this.value = String(value); }
    },
    async fetch(path, options) {
      requests.push({ path, options });
      const result = await responseFor(path, options);
      return { ok: result.ok !== false, json: async () => result };
    }
  });
  return { get: doc.getElementById.bind(doc), requests, go };
}

const university = (id, name_ar, city, state = "active") =>
  ({ id, name_ar, city, state, colleges: 2, departments: 3, manager_id: state === "active" ? 2 : null });
const baseApi = path => {
  if (path === "/api/auth/me") return { ok: true, user: { name: "مالك", admin: true, owner: true } };
  if (path.endsWith("/audit")) return { ok: true, items: [] };
  if (path.includes("?filter=active")) return { ok: true, totals: { directory: 2 }, items: [university(1,"جامعة البصرة","البصرة")] };
  if (path.includes("?filter=directory")) return { ok: true, totals: { directory: 2 }, items: [university(1,"جامعة البصرة","البصرة"), university(2,"جامعة بغداد","بغداد","not_onboarded")] };
  throw new Error("Unexpected request " + path);
};

test("general dashboard fetches active universities by default and can switch to the directory", async () => {
  const screen = dashboard(baseApi);
  await tick();
  assert.ok(screen.requests.some(({ path }) => path === "/api/admin/universities?filter=active"));
  assert.match(screen.get("content").textContent, /جامعة البصرة/);
  assert.doesNotMatch(screen.get("content").textContent, /جامعة بغداد/);
  screen.get("content").children[0].children.at(-1).events.click();
  await tick();
  assert.match(screen.get("content").textContent, /جامعة بغداد/);
  screen.get("search").value = "بَغداد";
  screen.get("search").events.input();
  assert.match(screen.get("content").textContent, /جامعة بغداد/);
  assert.doesNotMatch(screen.get("content").textContent, /جامعة البصرة/);
});

test("student and unauthenticated sessions never call privileged endpoints", async () => {
  for (const me of [{ ok: true, user: { name: "طالب", admin: false, scopes: [] } }, { ok: false, error: "unauthorized" }]) {
    const screen = dashboard(() => me);
    await tick();
    assert.deepEqual(screen.requests.map(x => x.path), ["/api/auth/me"]);
    assert.notEqual(screen.get("notice").textContent, "");
  }
});

test("directory errors are distinct from an empty active directory", async () => {
  const screen = dashboard(path => path.includes("?filter=") ? { ok: false, error: "server" } : baseApi(path));
  await tick();
  assert.equal(screen.get("content").hidden, true);
  assert.match(screen.get("notice").textContent, /تعذّر تحميل البيانات/);
  assert.match(screen.get("notice").textContent, /إعادة المحاولة/);
});

test("department administrators start in their server-validated department and can select only its stages", async () => {
  const screen = dashboard(path => {
    if (path === "/api/auth/me") return { ok: true, user: { name: "م", scopes: [{ type: "department", node_id: 1, level: "rep" }] } };
    assert.equal(path, "/api/admin/workspace?type=department&id=1");
    return { ok: true, scope: { type: "department", id: 1, university: "البصرة", college: "الطب", department: "طب الزهراء" },
      can_assign: true, items: [{ id: 12, number: 2, department: "طب الزهراء", students: 2, subjects: 3 }] };
  });
  await tick();
  assert.match(screen.get("title").textContent, /إدارة طب الزهراء/);
  assert.match(screen.get("content").textContent, /المرحلة الثانية/);
  assert.match(screen.get("content").textContent, /تعيين ممثل/);
  assert.doesNotMatch(screen.get("sidebar-nav").textContent, /الإدارة العامة/);
});

test("a forged scope URL shows the server rejection without drawing management data", async () => {
  const screen = dashboard(path => path === "/api/auth/me"
    ? { ok: true, user: { name: "م", scopes: [{ type: "department", node_id: 1, level: "rep" }] } }
    : { ok: false, error: "forbidden" }, "?type=department&id=2");
  await tick();
  assert.equal(screen.get("content").hidden, true);
  assert.match(screen.get("notice").textContent, /لا يسمح نطاقك/);
});

test("stage representatives see only their stage actions and scoped file and announcement calls", async () => {
  const screen = dashboard((path, options) => {
    if (path === "/api/auth/me") return { ok: true, user: { name: "الممثل", scopes: [{ type: "stage", node_id: 12, level: "rep" }] } };
    if (path === "/api/admin/workspace?type=stage&id=12") return { ok: true,
      scope: { type: "stage", id: 12, stage: 2, department: "طب الزهراء" }, can_assign: false,
      items: [{ id: 12, number: 2, department: "طب الزهراء", students: 1, subjects: 1 }],
      subjects: [{ id: 12, name_ar: "التشريح" }] };
    if (path === "/api/admin") {
      assert.deepEqual(JSON.parse(options.body), { stage_id: 12 });
      return { ok: true, items: [{ id: "id", courseId: "s12", label: "محاضرة المرحلة", status: "pending" }] };
    }
    if (path === "/api/reports") {
      assert.deepEqual(JSON.parse(options.body), { stage_id: 12 });
      return { ok: true, items: [] };
    }
    assert.equal(path, "/api/admin/stage-announcements?stage_id=12");
    return { ok: true, items: [] };
  });
  await tick();
  assert.match(screen.get("title").textContent, /ممثل المرحلة الثانية/);
  assert.match(screen.get("stage-files").textContent, /محاضرة المرحلة/);
  assert.match(screen.get("stage-files").textContent, /اعتماد/);
  assert.match(screen.get("stage-announcements").textContent, /نشر إعلان/);
  assert.doesNotMatch(screen.get("content").textContent, /تعيين ممثل/);
  assert.doesNotMatch(screen.get("sidebar-nav").textContent, /الفرق والتعيينات|الإدارة العامة/);
});
