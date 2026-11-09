/* js/login.js — صفحة الدخول: Google أو زائر، ونافذة التواصل. يحتاج js/auth.js (MSAuth) وjs/login-i18n.js. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var T = (window.LoginI18N && LoginI18N.t) || function (x) { return x; };
  var LANG = (window.LoginI18N && LoginI18N.lang) || "ar";
  var notice = $("notice");
  function say(text) { notice.textContent = text ? T(text) : ""; }

  // الوجهة بعد الدخول: مسار نسبي داخل الموقع فقط
  function nextUrl() {
    var n = new URLSearchParams(location.search).get("next") || "";
    return /^[A-Za-z0-9._\-\/?=&%#]+$/.test(n) && n.indexOf("//") === -1 && n.indexOf(":") === -1 ? n.replace(/^\//, "") : "index.html";
  }

  /* ---------- نافذة التواصل ---------- */
  var dlg = $("contact");
  function openContact() { if (dlg && !dlg.open && dlg.showModal) dlg.showModal(); }
  if (dlg) {
    $("contactBtn").addEventListener("click", openContact);
    $("contactClose").addEventListener("click", function () { dlg.close(); });
    dlg.addEventListener("click", function (e) { if (e.target === dlg) dlg.close(); });
    if (location.hash === "#contact") openContact();
  }

  /* ---------- الزائر ---------- */
  $("actions").querySelector('[data-auth="guest"]').addEventListener("click", function () { location.href = nextUrl(); });

  /* ---------- حالة: مسجّل الدخول ---------- */
  function row(label, glyphHtml) {
    var b = document.createElement("button");
    b.type = "button";
    var g = document.createElement("span"); g.className = "glyph"; g.innerHTML = glyphHtml;
    var t = document.createElement("span"); t.textContent = T(label);
    var c = document.createElement("span"); c.textContent = "‹";
    b.appendChild(g); b.appendChild(t); b.appendChild(c);
    return b;
  }
  var ICON = {
    go: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M5 12h14M13 6l6 6-6 6"/></svg>',
    out: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M9 4H5v16h4M16 8l4 4-4 4M20 12H9"/></svg>',
    adm: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true"><path d="M12 3 4 6v6c0 4.5 3.2 7.6 8 9 4.8-1.4 8-4.5 8-9V6l-8-3Z"/></svg>'
  };
  function showUser(u) {
    var box = $("actions");
    box.textContent = "";
    var who = document.createElement("p");
    who.className = "subtitle";
    who.appendChild(document.createTextNode(T("أنت مسجّل الدخول باسم") + " "));
    var strong = document.createElement("strong"); strong.textContent = u.name; who.appendChild(strong);
    box.appendChild(who);
    var go = row("المتابعة إلى الموقع", ICON.go);
    go.addEventListener("click", function () { location.href = nextUrl(); });
    box.appendChild(go);
    if (u.role === "admin" || u.role === "rep" || u.role === "uploader") {
      var up = row("رفع الملفات", ICON.go);
      up.addEventListener("click", function () { location.href = "upload.html"; });
      box.appendChild(up);
    }
    if (u.role === "admin" || u.role === "rep") {
      var an = row("التبليغات", ICON.go);
      an.addEventListener("click", function () { location.href = "announce.html"; });
      box.appendChild(an);
    }
    if (u.role === "admin") {
      var adm = row("إدارة الحسابات", ICON.adm);
      adm.addEventListener("click", function () { location.href = "admin.html"; });
      box.appendChild(adm);
    }
    var out = row("خروج", ICON.out);
    out.addEventListener("click", function () { MSAuth.logout().then(function () { location.href = "login.html"; }); });
    box.appendChild(out);
  }

  /* ---------- Google ---------- */
  var ERR = { disabled: "هذا الحساب موقوف. تواصل معنا.", google_unavailable: "تعذّر الاتصال بـ Google. يمكنك المتابعة كزائر.", network: "لا يوجد اتصال بالإنترنت. حاول مرة أخرى." };

  function onCredential(resp) {
    say("جارٍ تسجيل الدخول…");
    MSAuth.api("POST", "auth/google", { credential: resp.credential }).then(function (r) {
      if (r.status === 200 && r.data.ok) {
        MSAuth.afterLogin(r.data.user);
        try { sessionStorage.removeItem("ms.sync.reloaded"); } catch (e) { /* لا شيء */ }
        location.href = nextUrl();
        return;
      }
      say(ERR[r.data && r.data.error] || "تعذّر تسجيل الدخول. حاول مرة أخرى.");
    });
  }

  function loadGsi(cb, fail) {
    var done = false;
    function ok() { if (!done) { done = true; cb(); } }
    function bad() { if (!done) { done = true; fail(); } }
    var s = document.createElement("script");
    s.src = "https://accounts.google.com/gsi/client";
    s.async = true; s.defer = true;
    s.onload = ok; s.onerror = bad;
    document.head.appendChild(s);
    setTimeout(function () { if (!(window.google && google.accounts && google.accounts.id)) bad(); }, 8000);
  }

  function setupGoogle(clientId) {
    var btn = $("googleBtn");
    loadGsi(function () {
      if (!(window.google && google.accounts && google.accounts.id)) { say("تعذّر الاتصال بـ Google. يمكنك المتابعة كزائر."); return; }
      google.accounts.id.initialize({ client_id: clientId, callback: onCredential, ux_mode: "popup", auto_select: false });
      var slot = $("gSlot");
      slot.hidden = false;
      google.accounts.id.renderButton(slot, {
        theme: "outline", size: "large", text: "continue_with", shape: "rectangular", logo_alignment: "left",
        width: Math.min(400, Math.max(200, Math.round($("actions").getBoundingClientRect().width))), locale: LANG
      });
      btn.hidden = true;
    }, function () { say("تعذّر الاتصال بـ Google. يمكنك المتابعة كزائر."); });
  }

  $("googleBtn").addEventListener("click", function () { say("تسجيل الدخول بحساب Google غير مفعّل بعد."); });

  MSAuth.me().then(function (u) {
    if (u) { showUser(u); return; }
    MSAuth.api("GET", "auth/config").then(function (r) {
      if (r.status === 200 && r.data.ready && r.data.googleClientId) setupGoogle(r.data.googleClientId);
    });
  });
})();
