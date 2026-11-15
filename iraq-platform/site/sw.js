/* يحفظ صفحات الموقع والملفات التي تفتحها لتعمل بلا إنترنت */
var V = "ms-v49";
var FILES = "ms-files"; /* ملفات يحفظها الطالب صراحةً: لا تُمسح مع تحديث الإصدار */
var SHELL = ["platform.html", "course.html", "semester.html", "study.html", "catalog.html", "assets/logo.png"];
self.addEventListener("install", function (e) {
  e.waitUntil(caches.open(V).then(function (c) { return Promise.all(SHELL.map(function (u) { return c.add(u).catch(function () {}); })); }).then(function () { return self.skipWaiting(); }));
});
self.addEventListener("activate", function (e) {
  e.waitUntil(caches.keys().then(function (ks) {
    return Promise.all(ks.filter(function (k) { return k !== V && k !== FILES; }).map(function (k) { return caches.delete(k); }));
  }).then(function () { return self.clients.claim(); }));
});
self.addEventListener("fetch", function (e) {
  var req = e.request;
  if (req.method !== "GET") return;
  var url = new URL(req.url);
  if (url.origin !== location.origin) return;
  if (/^\/api\/(auth\/|admin\/|catalog\/|platform(?:$|\/)|sync|dm\/|profile\/|group-chat\/|stage-announcements|announcements|pdfnotes|ai\/|study-assistant\/)/.test(url.pathname)) return; // الحساب والمزامنة: دائماً من الشبكة
  if (/^\/api\/file\/\d+$/.test(url.pathname)) { // ملف محفوظ بلا إنترنت: من الجهاز أولاً
    e.respondWith(caches.open(FILES).then(function (c) { return c.match(url.pathname); }).then(function (hit) { return hit || fetch(req); }));
    return;
  }
  var isPdf = /\.pdf$/i.test(url.pathname);
  e.respondWith(
    (isPdf ? caches.match(req).then(function (hit) { return hit || fetchAndStore(req); })
           : fetchAndStore(req).catch(function () { return caches.match(req, { ignoreSearch: true }); }))
  );
});
function fetchAndStore(req) {
  return fetch(req, { cache: "no-cache" }).then(function (res) {
    if (res && res.status === 200 && !res.redirected && !/no-store/i.test(res.headers.get("cache-control") || "")) { var copy = res.clone(); caches.open(V).then(function (c) { c.put(req, copy); }); }
    return res;
  });
}
