/* طلبات تفعيل الجامعات (للمشرف العام): تفعيل الجامعة بضغطة. */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  function msg(t, ok) { $("msg").textContent = t || ""; $("msg").style.color = t ? (ok ? "var(--ok,#0a7d4f)" : "var(--bad,#c0392b)") : ""; }
  function activate(u, row, b) {
    if (!confirm("تفعيل " + u.university + "؟ ستفتح كل أقسامها لطلابها فوراً.")) return;
    b.disabled = true;
    fetch("/api/admin/universities", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify({ id: u.university_id, action: "activate" }) })
      .then(function (r) { return r.json(); }).then(function (d) { if (d.ok) { row.remove(); msg("تم تفعيل " + u.university + " ✓", true); } else { b.disabled = false; msg(d.error === "forbidden" ? "التفعيل للمشرف العام فقط." : "تعذّر التفعيل، حاول مرة أخرى."); } })
      .catch(function () { b.disabled = false; msg("تعذّر الاتصال."); });
  }
  fetch("/api/admin/activation-requests", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (d) {
    if (d.error === "unauthorized") { location.href = "login.html?next=activation-requests.html"; return; }
    if (!d.ok) { $("gate").textContent = d.error === "forbidden" ? "هذه الصفحة للمشرف العام فقط." : "تعذّر التحميل."; return; }
    $("gate").hidden = true;
    if (!d.items.length) { $("gate").hidden = false; $("gate").textContent = "لا توجد طلبات حالياً."; return; }
    d.items.forEach(function (u) {
      var row = document.createElement("section"); row.className = "inv-row";
      var h = document.createElement("h2"); h.textContent = u.university + " — " + u.requests + " طلب";
      var ul = document.createElement("small"); ul.textContent = u.departments.map(function (x) { return x.name + " (" + x.requests + ")"; }).join(" · ");
      var b = document.createElement("button"); b.type = "button"; b.className = "pri"; b.textContent = "تفعيل الجامعة"; b.onclick = function () { activate(u, row, b); };
      var acts = document.createElement("div"); acts.className = "inv-acts"; acts.appendChild(b);
      row.append(h, ul, acts); $("rows").appendChild(row);
    });
  }).catch(function () { $("gate").textContent = "تعذّر الاتصال."; });
})();
