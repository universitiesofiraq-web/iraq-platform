/* js/upload-link.js — يُظهر روابط «رفع ملف» لمن يملك صلاحية الرفع فقط.
   كل رابط رفع في الصفحات يبدأ مخفياً بالسمة hidden وعليه data-upload-link،
   وهذا الملف يكشفه بعد التأكد من /api/auth/me. الطالب العادي لا يراه إطلاقاً. */
(function () {
  "use strict";
  var links = document.querySelectorAll("[data-upload-link]");
  if (!links.length) return;

  function canUpload(u) {
    if (!u) return false;
    if (u.admin || u.role === "admin" || u.role === "rep" || u.role === "uploader") return true;
    return !!(u.scopes && u.scopes.length);
  }

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      if (!canUpload(d && d.user)) return;
      for (var i = 0; i < links.length; i++) links[i].hidden = false;
    })
    .catch(function () { /* يبقى مخفياً عند تعذّر التحقق */ });
})();
