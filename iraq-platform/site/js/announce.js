/* js/announce.js — كتابة التبليغات وحذفها لممثل الدفعة والمشرفين (بالعربية فقط، مثل صفحة الرفع والإدارة) */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function msg(text, ok) { var n = $("msg"); n.textContent = text || ""; n.hidden = !text; n.className = "up-msg" + (ok ? " is-ok" : ""); }

  function render(items) {
    var box = $("list");
    box.textContent = "";
    if (!items.length) { box.appendChild(el("p", "up-hint", "لا توجد تبليغات منشورة.")); return; }
    items.forEach(function (a) {
      var row = el("div", "up-item");
      var main = el("div", "up-item-main");
      main.appendChild(el("div", "up-item-name", a.title));
      if (a.body) main.appendChild(el("div", "up-item-sub", a.body));
      main.appendChild(el("div", "up-item-sub", a.by + " · " + new Date(a.at).toLocaleDateString("ar-u-nu-latn")));
      row.appendChild(main);
      var acts = el("div", "up-actions");
      var del = el("button", "btn btn-secondary btn-sm", "حذف");
      del.type = "button";
      del.addEventListener("click", function () {
        MSAuth.api("POST", "announcements/delete", { id: a.id }).then(function (r) {
          if (r.status === 200) { msg("تم الحذف.", true); load(); } else msg("تعذّر الحذف.");
        });
      });
      acts.appendChild(del);
      row.appendChild(acts);
      box.appendChild(row);
    });
  }

  function load() {
    MSAuth.api("GET", "announcements").then(function (r) {
      if (r.status === 200) render(r.data.items || []); else msg("تعذّر تحميل التبليغات.");
    });
  }

  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    var title = $("title").value.trim();
    if (!title) { msg("اكتب عنواناً للتبليغ."); return; }
    $("send").disabled = true;
    MSAuth.api("POST", "announcements", { title: title, body: $("body").value.trim() }).then(function (r) {
      $("send").disabled = false;
      if (r.status === 200) { $("title").value = ""; $("body").value = ""; msg("نُشر التبليغ.", true); load(); }
      else if (r.status === 403) msg("ليس لديك صلاحية نشر التبليغات.");
      else if (r.status === 401) location.href = "login.html?next=announce.html";
      else msg("تأكد من العنوان (حتى 120 حرفاً) والنص (حتى 2000 حرف).");
    });
  });

  MSAuth.me().then(function (u) {
    if (!u) { location.href = "login.html?next=announce.html"; return; }
    if (u.role !== "rep" && u.role !== "admin") { msg("هذه الصفحة لممثل الدفعة والمشرفين فقط."); return; }
    $("formCard").hidden = false;
    $("listCard").hidden = false;
    load();
  });
})();
