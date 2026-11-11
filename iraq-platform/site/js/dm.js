/* js/dm.js — الرسائل الخاصة (منقولة من ميدكسا 2026-11-11). القائمة ثم المحادثة (dm.html?u=<رقم الحساب>).
   الاستعلام كل 15 ثانية والصفحة ظاهرة. كل النصوص textContent. */
(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = String(text); return e; }
  var ERR = { slow_down: "تمهّل قليلاً قبل الرسالة التالية.", unauthorized: "سجّل الدخول لاستعمال الرسائل الخاصة.", not_found: "هذا الحساب غير متاح.",
    cant_message: "لا يمكنك مراسلة هذا الحساب (المراسلة مع زملاء قسمك وممثليك).", you_blocked: "حظرتَ هذا الحساب. ارفع الحظر أولاً." };
  var ROLE = { rep: "ممثل" };
  var peerId = null, peer = null, last = 0, since = 0, seen = {}, prev = null, blocked = false, me = null, timer = null;
  function note(t) { $("dmNote").textContent = t || ""; $("dmNote").hidden = !t; }
  function api(method, path, body) {
    var o = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) { o.body = JSON.stringify(body); o.headers["content-type"] = "application/json"; }
    return fetch("/api/dm/" + path, o).then(function (r) { return r.json().catch(function () { return {}; }).then(function (j) { return { status: r.status, j: j }; }); })
      .catch(function () { return { status: 0, j: {} }; });
  }
  function fail(r) { note(r.status === 401 ? ERR.unauthorized : (ERR[r.j && r.j.error] || "حدث خطأ، حاول مرة أخرى.")); }
  function hue(id) { return 1 + (Math.abs(Number(id) || 0) % 6); }
  function avatar(p) {
    var a = el("span", "m-av hue-" + hue(p.id), (String(p.name || "?").trim().charAt(0) || "?").toUpperCase());
    a.setAttribute("aria-hidden", "true");
    if (p.av) { var im = el("img"); im.alt = ""; im.src = "/api/avatar/" + p.id + "?v=" + p.av; im.onload = function () { a.textContent = ""; a.appendChild(im); }; }
    return a;
  }
  function clock(ms) { return new Date(ms).toLocaleTimeString("ar-IQ", { hour: "2-digit", minute: "2-digit" }); }
  function sameDay(a, b) { return new Date(a).toDateString() === new Date(b).toDateString(); }

  function showList() {
    peerId = null; clearInterval(timer); timer = setInterval(loadList, 30000);
    $("dmList").hidden = false; $("dmPrivacy").hidden = false; $("log").hidden = true; $("form").hidden = true; $("dmBlocked").hidden = true;
    $("dmNew").hidden = false; $("dmBlock").hidden = true; $("dmBack").href = "group-chat.html";
    $("dmTitle").textContent = "الرسائل الخاصة"; $("dmSub").textContent = "محادثات بينك وبين زملائك وممثليك";
    var av = el("span", "m-av hue-1", "✉"); av.id = "dmAv"; $("dmAv").replaceWith(av);
    loadList();
  }
  function loadList() {
    if (document.hidden) return;
    api("GET", "threads").then(function (r) {
      if (r.status !== 200) { fail(r); return; }
      me = r.j.me; note("");
      var box = $("dmList"); box.textContent = "";
      if (!r.j.items.length) { var e = el("div", "empty-thread"); e.appendChild(el("h3", "", "لا محادثات بعد")); e.appendChild(el("p", "", "ابدأ محادثة مع ممثلك أو زميل في قسمك.")); box.appendChild(e); return; }
      r.j.items.forEach(function (it) {
        var row = el("a", "dm-row"); row.href = "dm.html?u=" + it.peer.id;
        row.appendChild(avatar(it.peer));
        var tx = el("span", "dm-row-txt"), top = el("span", "dm-row-top");
        top.appendChild(el("strong", "", it.peer.name));
        if (ROLE[it.peer.role]) top.appendChild(el("em", "dm-role", ROLE[it.peer.role]));
        top.appendChild(el("small", "", clock(it.last.at)));
        tx.appendChild(top);
        var sn = el("span", "dm-snip", (it.last.mine ? "أنت: " : "") + it.last.body); sn.dir = "auto"; tx.appendChild(sn);
        row.appendChild(tx);
        if (it.unread) row.appendChild(el("span", "unread", String(it.unread)));
        row.onclick = function (ev) { ev.preventDefault(); go(it.peer.id); };
        box.appendChild(row);
      });
    });
  }
  function go(id) { history.pushState({ u: id }, "", "dm.html?u=" + id); route(); }
  function route() { var u = Number(new URLSearchParams(location.search).get("u")) || 0; if (u) openThread(u); else showList(); }
  function openThread(id) {
    peerId = id; last = 0; since = 0; seen = {}; prev = null; blocked = false;
    $("dmList").hidden = true; $("dmPrivacy").hidden = true; $("log").hidden = false; $("log").textContent = "";
    $("dmNew").hidden = true; $("dmBack").href = "dm.html"; $("dmTitle").textContent = "…"; $("dmSub").textContent = "";
    clearInterval(timer); timer = setInterval(poll, 15000); poll(true);
  }
  function applyPeer(p, b) {
    peer = p; blocked = b;
    $("dmTitle").textContent = p.name; $("dmSub").textContent = ROLE[p.role] || "طالب";
    var av = avatar(p); av.id = "dmAv"; $("dmAv").replaceWith(av);
    $("dmBlock").hidden = false; $("dmBlock").textContent = b ? "رفع الحظر" : "حظر";
    $("form").hidden = b; $("dmBlocked").hidden = !b;
  }
  function drop(id) { var n = seen[id]; if (n) { n.remove(); delete seen[id]; } }
  function poll(first) {
    if (!peerId || document.hidden) return;
    api("GET", "messages?peer=" + peerId + "&after=" + last + "&since=" + since).then(function (r) {
      if (r.status !== 200) { if (first) fail(r); return; }
      me = { id: r.j.me }; if (r.j.now) since = r.j.now;
      applyPeer(r.j.peer, r.j.blocked);
      (r.j.gone || []).forEach(drop);
      var got = false;
      r.j.items.forEach(function (m) { draw(m); last = Math.max(last, m.id); if (m.sender_id !== me.id) got = true; });
      if (first || got) api("POST", "read", { peer: peerId });
    });
  }
  function act(label, fn) { var b = el("button", "", label); b.type = "button"; b.onclick = function (e) { e.stopPropagation(); fn(); }; return b; }
  function draw(m) {
    if (seen[m.id]) return;
    var log = $("log"), stick = log.scrollTop + log.clientHeight >= log.scrollHeight - 60;
    if (!prev || !sameDay(prev.at, m.created_at)) { log.appendChild(el("div", "day-sep", new Date(m.created_at).toLocaleDateString("ar-IQ", { weekday: "long", day: "numeric", month: "long" }))); prev = null; }
    var mine = m.sender_id === me.id, cont = !!prev && prev.uid === m.sender_id && m.created_at - prev.at < 300000;
    var box = el("article", "message" + (mine ? " mine" : "") + (cont ? " cont" : ""));
    var bub = el("div", "bubble"), tx = el("span", "msg-text", m.body); tx.dir = "auto";
    bub.appendChild(tx); bub.appendChild(el("span", "msg-time", clock(m.created_at)));
    var acts = el("span", "msg-actions");
    if (mine) acts.appendChild(act("حذف للطرفين", function () { api("POST", "delete", { message_id: m.id }).then(function (r) { r.status === 200 ? drop(m.id) : fail(r); }); }));
    else acts.appendChild(act("إبلاغ", function () { var why = prompt("اكتب سبب البلاغ"); if (why) api("POST", "report", { message_id: m.id, reason: why }).then(function (r) { r.status === 200 ? note("تم إرسال البلاغ.") : fail(r); }); }));
    bub.appendChild(acts);
    bub.onclick = function (e) { if (!e.target.closest("button")) bub.classList.toggle("show-actions"); };
    box.appendChild(bub);
    seen[m.id] = box; log.appendChild(box);
    prev = { uid: m.sender_id, at: m.created_at };
    if (stick || mine) log.scrollTop = log.scrollHeight;
  }
  $("form").addEventListener("submit", function (e) {
    e.preventDefault();
    var body = $("msg").value.trim(); if (!body || !peerId) return;
    $("send").disabled = true;
    api("POST", "send", { peer: peerId, body: body }).then(function (r) {
      if (r.status === 201) { $("msg").value = ""; note(""); poll(); } else fail(r);
      $("send").disabled = false;
    });
  });
  $("msg").addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (this.value.trim()) $("form").requestSubmit(); } });
  $("dmBlock").onclick = function () {
    if (!peerId) return;
    api("POST", blocked ? "unblock" : "block", { peer: peerId }).then(function (r) { if (r.status === 200) applyPeer(peer, !blocked); else fail(r); });
  };
  $("dmBack").addEventListener("click", function (e) { if (peerId) { e.preventDefault(); history.pushState({}, "", "dm.html"); route(); } });
  window.addEventListener("popstate", route);
  document.addEventListener("visibilitychange", function () { if (!document.hidden) { peerId ? poll() : loadList(); } });

  function closeSheet() { $("sheet").hidden = true; }
  function personRow(p) {
    var b = el("button", "sheet-row"); b.type = "button"; b.appendChild(avatar(p));
    var t = el("span", "att-txt"); t.appendChild(el("strong", "", p.name)); t.appendChild(el("small", "", ROLE[p.role] || "طالب"));
    b.appendChild(t); b.onclick = function () { closeSheet(); go(p.id); }; return b;
  }
  $("dmNew").onclick = function () {
    $("sheet").hidden = false;
    var list = $("sheetList"); list.textContent = "";
    list.appendChild(el("p", "muted", "ممثلوك"));
    var staff = el("div"); list.appendChild(staff);
    list.appendChild(el("p", "muted", "ابحث عن زميل في قسمك"));
    var q = el("input", "sheet-search"); q.type = "search"; q.placeholder = "اكتب حرفين من اسمه"; list.appendChild(q);
    var found = el("div"); list.appendChild(found);
    api("GET", "staff").then(function (r) {
      if (r.status !== 200) { fail(r); return; }
      if (!r.j.items.length) staff.appendChild(el("p", "muted", "لا يوجد ممثل مسجّل لنطاقك بعد."));
      r.j.items.forEach(function (p) { staff.appendChild(personRow(p)); });
    });
    var tm = null;
    q.oninput = function () {
      clearTimeout(tm);
      tm = setTimeout(function () {
        found.textContent = ""; if (q.value.trim().length < 2) return;
        api("GET", "people?q=" + encodeURIComponent(q.value.trim())).then(function (r) {
          if (r.status !== 200) return;
          if (!r.j.items.length) found.appendChild(el("p", "muted", "لا نتائج. البحث داخل قسمك فقط."));
          r.j.items.forEach(function (p) { found.appendChild(personRow(p)); });
        });
      }, 300);
    };
  };
  $("sheetX").onclick = closeSheet;
  $("sheet").addEventListener("click", function (e) { if (e.target === $("sheet")) closeSheet(); });
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });

  api("GET", "threads").then(function (r) {
    if (r.status === 401) {
      note(ERR.unauthorized); $("dmNew").hidden = true; $("dmList").hidden = true; $("dmPrivacy").hidden = true;
      var a = el("a", "dm-link", "تسجيل الدخول"); a.href = "login.html?next=" + encodeURIComponent("dm.html"); $("dmNote").after(a);
      return;
    }
    route();
  });
})();
