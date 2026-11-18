/* يحفظ صفحات الموقع والملفات التي تفتحها لتعمل بلا إنترنت */
var V = "ms-v56";
var FILES = "ms-files-public";
var SHELL = ["platform.html", "course.html", "semester.html", "study.html", "catalog.html", "assets/logo.png"];
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
  return fetch(req, { cache: "no-cache" }).then(function (res) {
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
  });
}
