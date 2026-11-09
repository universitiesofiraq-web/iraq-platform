/* يحفظ صفحات الموقع والملفات التي تفتحها لتعمل بلا إنترنت */
var V = "ms-v32";
var SHELL = ["index.html", "course.html", "semester.html", "study.html", "assets/university.webp"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return c.addAll(SHELL); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== V; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/^\/api\/(auth\/|sync|announcements)/.test(url.pathname)) return; // الحساب والمزامنة: دائماً من الشبكة
  var isPdf = /\.pdf$/i.test(url.pathname);
  e.respondWith(
    (isPdf ? caches.match(req).then(function (hit) { return hit || fetchAndStore(req); })
           : fetchAndStore(req).catch(function () { return caches.match(req, { ignoreSearch: true }); }))
  );
});
function fetchAndStore(req) {
  return fetch(req, { cache: "no-cache" }).then(function (res) {
    if (res && res.status === 200 && !res.redirected) { var copy = res.clone(); caches.open(V).then(function (c) { c.put(req, copy); }); }
    return res;
  });
}
