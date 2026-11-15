/* js/upload-link.js — الرأس المشترك لصفحات iq.css:
   - يُظهر روابط «رفع ملف» (data-upload-link، مخفية افتراضياً) لمن يملك صلاحية الرفع فقط.
   - يحوّل زر «دخول» إلى «منصتي» لمن سجّل الدخول (قسمه المحفوظ، وإلا صفحة التسجيل). */
(function () {
  "use strict";
  var links = document.querySelectorAll("[data-upload-link]");
  var login = document.querySelectorAll(".iq-top a.iq-login");
  if (!links.length && !login.length) return;

  function canUpload(u) {
    if (!u) return false;
    if (u.admin || u.role === "admin" || u.role === "rep" || u.role === "uploader") return true;
    return !!(u.scopes && u.scopes.length);
  }
  function home() {
    try { var d = JSON.parse(localStorage.getItem("iq.dept") || "null"); if (d && Number(d.id) > 0) return "platform.html?dept=" + Number(d.id); } catch (e) { /* لا شيء */ }
    return "join.html";
  }

  fetch("/api/auth/me", { credentials: "same-origin" })
    .then(function (r) { return r.json(); })
    .then(function (d) {
      var u = d && d.user;
      if (!u) return;
      for (var j = 0; j < login.length; j++) { login[j].textContent = "منصتي"; login[j].href = home(); }
      if (!canUpload(u)) return;
      for (var i = 0; i < links.length; i++) links[i].hidden = false;
    })
    .catch(function () { /* يبقى كما هو عند تعذّر التحقق */ });
})();
