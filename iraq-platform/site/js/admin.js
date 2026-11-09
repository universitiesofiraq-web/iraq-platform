/* js/admin.js — إدارة الحسابات للمشرف (بالعربية فقط، مثل صفحة الرفع) */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text !== undefined) n.textContent = text; return n; }
  function msg(text, ok) { var n = $("msg"); n.textContent = text || ""; n.hidden = !text; n.className = "up-msg" + (ok ? " is-ok" : ""); }

  var ROLE_NAME = { student: "طالب", uploader: "رافع ملفات", rep: "ممثل الدفعة", admin: "مشرف" };

  function load() {
    MSAuth.api("GET", "auth/users").then(function (r) {
      if (r.status === 401) { location.href = "login.html?next=admin.html"; return; }
      if (r.status === 403) { msg("هذه الصفحة للمشرفين فقط."); return; }
      if (r.status !== 200) { msg("تعذّر تحميل الحسابات. حاول مرة أخرى."); return; }
      render(r.data.users);
    });
  }

  function render(users) {
    var box = $("list");
    box.textContent = "";
    if (!users.length) { box.appendChild(el("p", "up-hint", "لا توجد حسابات بعد.")); return; }
    users.forEach(function (u) {
      var row = el("div", "up-item");
      var main = el("div", "up-item-main");
      main.appendChild(el("div", "up-item-name", u.name + (u.role !== "student" ? " (" + (ROLE_NAME[u.role] || u.role) + ")" : "") + (u.active ? "" : " (موقوف)")));
      main.appendChild(el("div", "up-item-sub up-ltr", u.email));
      row.appendChild(main);

      var acts = el("div", "up-actions");
      if (u.role !== "admin") {
        var pick = el("select", "field");
        pick.setAttribute("aria-label", "دور " + u.name);
        ["student", "uploader", "rep"].forEach(function (r) {
          var o = el("option", "", ROLE_NAME[r]); o.value = r; if (u.role === r) o.selected = true; pick.appendChild(o);
        });
        pick.addEventListener("change", function () {
          MSAuth.api("POST", "auth/user", { id: u.id, role: pick.value }).then(function (r) {
            if (r.status === 200) { msg("تم تغيير الدور.", true); load(); } else { msg("تعذّر تغيير الدور."); load(); }
          });
        });
        acts.appendChild(pick);
      }
      var toggle = el("button", "btn btn-secondary btn-sm", u.active ? "إيقاف" : "تفعيل");
      toggle.type = "button";
      toggle.addEventListener("click", function () {
        MSAuth.api("POST", "auth/user", { id: u.id, active: !u.active }).then(function (r) {
          if (r.status === 200) { msg("تم التحديث.", true); load(); } else msg("تعذّر التحديث.");
        });
      });
      acts.appendChild(toggle);

      row.appendChild(acts);
      box.appendChild(row);
    });
  }
  load();
})();
