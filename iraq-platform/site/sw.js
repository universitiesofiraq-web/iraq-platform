/* يحفظ صفحات الموقع والملفات التي تفتحها لتعمل بلا إنترنت */
var V = "ms-v62";
var FILES = "ms-files-public";
var SHELL = ["platform.html", "dafter.html", "course.html", "semester.html", "study.html", "catalog.html", "assets/logo.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k === "ms-files" || (/^ms-v\d+$/.test(k) && k !== V); }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET" || req.cache === "no-store" || req.headers.has("range")) return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  var uploadFile = /^\/api\/file\/[^/]+$/.test(url.pathname);
  if (/^\/api(?:\/|$)/.test(url.pathname) && !uploadFile) return;
  var isPdf = !uploadFile && /\.pdf$/i.test(url.pathname);
  var cache = caches.open(V).catch(function () { return null; });
  var update = function () { return fetchAndStore(req, cache, uploadFile); };
  e.respondWith(isPdf ? cache.then(function (c) { return c && c.match(req); }).catch(function () {})
    .then(function (hit) { return hit || update(); })
    : update().catch(function () {
      return cache.then(function (c) { return c && c.match(req, { ignoreSearch: !uploadFile }); }).then(function (hit) {
        if (hit || !uploadFile || url.search) return hit || Response.error();
        return caches.open(FILES).then(function (c) { return c.match(req); }).then(function (saved) { return saved || Response.error(); });
      });
    }));
});
function fetchAndStore(req, cache, uploadFile) {
  /* ملف مرفوع محفوظ: نسأل الخادم «هل تغيّر؟» بالبصمة (ETag). الخادم يقرّر الصلاحية في كل مرة كما كان،
     لكن الرد 304 يعني أن النسخة المحفوظة صالحة فتُفتح فوراً بلا تنزيل الملف كاملاً (2026-11-19). */
  var saved = uploadFile ? cache.then(function (c) { return c && c.match(req); }).catch(function () {}) : Promise.resolve(null);
  return saved.then(function (hit) {
    var tag = hit && hit.headers && hit.headers.get("etag");
    var ask = req;
    if (tag) { var h = new Headers(req.headers); h.set("if-none-match", tag); ask = new Request(req.url, { method: "GET", headers: h, credentials: req.credentials || "same-origin" }); }
    return fetch(ask, { cache: "no-cache" }).then(function (res) {
      if (tag && res.status === 304) return hit;
      return store(req, res, cache, uploadFile);
    });
  });
}
function store(req, res, cache, uploadFile) {
    var directives = res.headers.get("cache-control") || "";
    var cacheable = res.status === 200 && !res.redirected && !/\b(?:private|no-store)\b/i.test(directives);
    if (cacheable && (!uploadFile || /\bpublic\b/i.test(directives))) {
      var copy = res.clone();
      cache.then(function (c) { return c && c.put(req, copy); }).catch(function () {});
    } else if (uploadFile && res.status < 500) {
      cache.then(function (c) { return c && c.delete(req); }).catch(function () {});
      caches.open(FILES).then(function (c) { return c.delete(req); }).catch(function () {});
    }
    return res;
}
