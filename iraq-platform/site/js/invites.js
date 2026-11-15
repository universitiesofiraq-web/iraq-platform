/* روابط الدعوة: لكل قسم (أو مرحلة) يديره المستخدم رابط يُنشأ بضغطة وينسخ ويُشارَك. */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var nodes = [], options = null;
  function msg(t, ok) { $("msg").textContent = t || ""; $("msg").style.color = t ? (ok ? "var(--ok,#0a7d4f)" : "var(--bad,#c0392b)") : ""; }
  function post(body) {
    return fetch("/api/admin/invites", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }).then(function (r) { return r.json().catch(function () { return { ok: false }; }); }).catch(function () { return { ok: false, error: "network" }; });
  }
  function live(type, id) {
    return fetch("/api/admin/invites?type=" + type + "&id=" + id, { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (d) { return ((d && d.items) || []).filter(function (x) { return !x.revoked_at; }); }).catch(function () { return []; });
  }
  function linkOf(code) { return location.origin + "/join.html?inv=" + code; }
  function btn(txt, cls, fn) { var b = document.createElement("button"); b.type = "button"; b.textContent = txt; if (cls) b.className = cls; b.onclick = fn; return b; }
  function showLink(box, n, item) {
    var url = linkOf(item.code), wrap = document.createElement("div"); wrap.className = "inv-link";
    var inp = document.createElement("input"); inp.readOnly = true; inp.value = url; inp.setAttribute("aria-label", "رابط الدعوة");
    inp.onfocus = function () { inp.select(); };
    var acts = document.createElement("div"); acts.className = "inv-acts";
    acts.appendChild(btn("نسخ", "pri", function () { (navigator.clipboard ? navigator.clipboard.writeText(url) : Promise.reject()).then(function () { msg("نُسخ الرابط ✓", true); }, function () { inp.select(); msg("حدّد الرابط وانسخه."); }); }));
    var text = "سجّل في المنصة العراقية واحصل على ملازم " + n.name;
    var tg = document.createElement("a"); tg.textContent = "تيليغرام"; tg.target = "_blank"; tg.rel = "noopener"; tg.href = "https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent(text); acts.appendChild(tg);
    var wa = document.createElement("a"); wa.textContent = "واتساب"; wa.target = "_blank"; wa.rel = "noopener"; wa.href = "https://wa.me/?text=" + encodeURIComponent(text + " " + url); acts.appendChild(wa);
    acts.appendChild(btn("إيقاف الرابط", "", function () { if (!confirm("لن يعمل الرابط بعد الآن. إيقافه؟")) return; post({ action: "revoke", code: item.code }).then(function (d) { d.ok ? (msg("تم إيقاف الرابط.", true), load(box, n)) : msg("تعذّر الإيقاف."); }); }));
    var small = document.createElement("small"); small.textContent = "سجّل عبره " + (item.uses || 0) + " طالب";
    wrap.append(inp, acts, small); return wrap;
  }
  function load(box, n) {
    box.replaceChildren(); var s = document.createElement("small"); s.textContent = "جارٍ التحميل…"; box.appendChild(s);
    live(n.type, n.id).then(function (items) {
      box.replaceChildren();
      if (!items.length) {
        box.appendChild(btn("إنشاء رابط الدعوة", "pri", function () { post({ action: "create", type: n.type, id: n.id }).then(function (d) { d.ok ? load(box, n) : msg(d.error === "forbidden" ? "لا تملك صلاحية لهذا القسم." : "تعذّر الإنشاء."); }); }));
      } else box.appendChild(showLink(box, n, items[0]));
    });
  }
  function draw() {
    var host = $("rows"); host.replaceChildren();
    var col = options && $("c").value ? Number($("c").value) : 0;
    nodes.filter(function (n) { return !col || n.college_id === col || !n.college_id; }).forEach(function (n) {
      var row = document.createElement("section"); row.className = "inv-row";
      var h = document.createElement("h2"); h.textContent = n.name; var box = document.createElement("div");
      row.append(h, box); host.appendChild(row); load(box, n);
    });
    if (!host.children.length) msg("لا توجد أقسام تديرها.");
  }
  function start() {
    Promise.all([
      fetch("/api/auth/me", { credentials: "same-origin" }).then(function (r) { return r.json(); }),
      fetch("/api/upload-options", { credentials: "same-origin" }).then(function (r) { return r.json(); }).catch(function () { return null; })
    ]).then(function (r) {
      var u = r[0] && r[0].user; options = r[1] && r[1].ok ? r[1] : null;
      if (!u) { location.href = "login.html?next=" + encodeURIComponent("invites.html"); return; }
      var sc = u.scopes || [], global = !!u.admin;
      var broad = global || sc.some(function (x) { return x.type === "college" || x.type === "university"; });
      if (broad && options) {
        nodes = options.departments.map(function (d) { var c = options.colleges.find(function (x) { return x.id === d.college_id; }) || {}; return { type: "department", id: d.id, college_id: d.college_id, name: (c.name_ar ? c.name_ar + " — " : "") + d.name_ar }; });
        var sel = $("c"); sel.replaceChildren(new Option("كل الكليات", ""));
        options.colleges.forEach(function (c) { sel.appendChild(new Option(c.name_ar, c.id)); });
        sel.onchange = draw; $("pickRow").hidden = options.colleges.length < 2;
      } else {
        sc.forEach(function (x) {
          if (x.type === "department") nodes.push({ type: "department", id: x.node_id, name: x.label || "القسم" });
          else if (x.type === "stage") nodes.push({ type: "stage", id: x.node_id, name: (x.label ? x.label + " — " : "") + "المرحلة " + (x.stage_number || "") });
        });
      }
      $("gate").hidden = true; draw();
    }).catch(function () { $("gate").textContent = "تعذّر التحميل، أعد المحاولة."; });
  }
  start();
})();
