/* صفحة مساعد الدراسة: يكلّم /api/study-assistant/* بكوكي الجلسة (same-origin) فقط؛ لا يرسل أي هوية. */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var tab = "ask", me = null, busy = false;
  var API = "/api/study-assistant/";

  function req(path, method, body) {
    return fetch(API + path, { method: method || "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; }); });
  }
  function el(tag, text, cls) { var e = document.createElement(tag); if (text != null) e.textContent = text; if (cls) e.className = cls; return e; }
  function errText(d) { return (d && d.error && d.error.message) ? d.error.message + (d.error.detail ? " [" + d.error.detail + "]" : "") : "تعذّر الاتصال بالمساعد."; }
  function quota(q) { if (q) $("quota").textContent = "الطلبات المتبقية اليوم: " + q.remaining + " من " + q.dailyLimit; }

  function cites(list) {
    var box = el("div", null, "sa-cites");
    (list || []).forEach(function (c) {
      var a = el("a", "ص " + c.pageNumber, "sa-cite");
      a.title = c.excerpt || "";
      var doc = (DOCS[c.documentId] || {}).file;
      if (doc) a.href = "pdf-notes.html?file=" + encodeURIComponent(doc) + "#page=" + c.pageNumber;
      box.appendChild(a);
    });
    return box;
  }
  function quiz(data) {
    var wrap = el("div");
    if (data.title) wrap.appendChild(el("strong", data.title));
    (data.questions || []).forEach(function (q, i) {
      var box = el("div", null, "sa-q");
      box.appendChild(el("p", (i + 1) + ". " + q.question + (q.pageNumber ? "  (ص " + q.pageNumber + ")" : "")));
      var exp = el("p", null, "sa-hint");
      (q.options || []).forEach(function (o, k) {
        var b = el("button", o); b.type = "button";
        b.addEventListener("click", function () {
          b.className = k === q.correctIndex ? "right" : "wrong";
          if (k !== q.correctIndex && box.querySelectorAll("button")[q.correctIndex]) box.querySelectorAll("button")[q.correctIndex].className = "right";
          exp.textContent = q.explanation || "";
        });
        box.appendChild(b);
      });
      box.appendChild(exp);
      wrap.appendChild(box);
    });
    return wrap;
  }
  function mindmap(data) {
    var wrap = el("div", null, "sa-map");
    function node(n) {
      var li = el("li", n.label + (n.pageNumber ? " (ص " + n.pageNumber + ")" : ""));
      var kids = n.children || n.branches || [];
      if (kids.length) { var ul = el("ul"); kids.forEach(function (k) { ul.appendChild(node(k)); }); li.appendChild(ul); }
      return li;
    }
    var ul = el("ul"); ul.appendChild(node(data.root || { label: "—" })); wrap.appendChild(ul);
    return wrap;
  }
  function show(d) {
    var card = el("div", null, "sa-card");
    if (!d.ok) { card.className += " err"; card.textContent = errText(d); }
    else if (d.task === "quiz" && d.data && d.data.questions) card.appendChild(quiz(d.data));
    else if (d.task === "mindmap" && d.data && d.data.root) card.appendChild(mindmap(d.data));
    else card.appendChild(document.createTextNode(d.answer || ""));
    if (d.ok && d.citations && d.citations.length) card.appendChild(cites(d.citations));
    $("out").insertBefore(card, $("out").firstChild);
    if (d.quota) quota(d.quota);
  }

  var DOCS = {};
  function send() {
    var text = $("q").value.trim();
    if (busy || (!text && tab !== "quiz" && tab !== "mindmap")) return;
    busy = true; $("go").disabled = true;
    var body = { task: tab, question: text || (tab === "quiz" ? "اختبرني من هذه المحاضرة" : "خريطة ذهنية لهذه المحاضرة") };
    if ($("doc").value && tab !== "advisor") body.documentId = $("doc").value;
    req("assistant/run", "POST", body).then(show).catch(function () { show({ ok: false }); })
      .then(function () { busy = false; $("go").disabled = false; });
  }

  function kb() {
    req("department/knowledge").then(function (d) {
      var plat = $("kbPlatform"), list = $("kbList");
      plat.textContent = ""; list.textContent = "";
      if (!d.ok) { list.appendChild(el("p", errText(d), "sa-msg")); return; }
      if (!d.departmentKey) { plat.appendChild(el("p", "اختر قسمك أولاً من صفحة القسم في المنصة، ثم عد إلى هنا.", "sa-msg")); return; }
      (d.platform || []).forEach(function (p) {
        var c = el("div", null, "sa-card");
        c.appendChild(el("strong", p.title));
        var rows = []; try { rows = JSON.parse(p.content); } catch (e) { /* نص */ }
        var ul = el("ul");
        rows.slice(0, 40).forEach(function (r) {
          ul.appendChild(el("li", [r.name || r.subject || r.title, r.number ? "المحاضرة " + r.number : "", r.title && r.subject ? r.title : "", r.professor || "", r.stage ? "المرحلة " + r.stage : "", r.body || "", r.date || ""].filter(Boolean).join(" · ")));
        });
        c.appendChild(ul); plat.appendChild(c);
      });
      if (!d.items.length) list.appendChild(el("p", "لا توجد ملاحظات للقسم بعد.", "sa-hint"));
      d.items.forEach(function (it) {
        var c = el("div", null, "sa-card sa-kb");
        var t = el("div"); t.appendChild(el("strong", it.title)); t.appendChild(el("div", it.content)); t.appendChild(el("small", it.updated_at.slice(0, 10)));
        c.appendChild(t);
        if (d.canManage) {
          var del = el("button", "حذف", "sa-del"); del.type = "button";
          del.addEventListener("click", function () { if (confirm("حذف هذه الملاحظة؟")) req("department/knowledge", "DELETE", { id: it.id }).then(kb); });
          c.appendChild(del);
        }
        list.appendChild(c);
      });
      $("kbForm").hidden = !d.canManage;
    });
  }

  function setTab(t) {
    tab = t;
    document.querySelectorAll("#tabs button").forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.tab === t)); });
    $("pane-kb").hidden = t !== "advisor";
    $("doc").hidden = t === "advisor";
    $("qLabel").textContent = t === "advisor" ? "اسأل عن قسمك (المواد، المحاضرات المرفوعة، الامتحانات، السعي)" : t === "quiz" ? "موضوع الاختبار (اختياري)" : t === "mindmap" ? "موضوع الخريطة (اختياري)" : "سؤالك";
    if (t === "advisor") kb();
  }

  document.querySelectorAll("#tabs button").forEach(function (b) { b.addEventListener("click", function () { setTab(b.dataset.tab); }); });
  $("go").addEventListener("click", send);
  $("q").addEventListener("keydown", function (e) { if (e.key === "Enter" && (e.ctrlKey || e.metaKey)) send(); });
  $("kbForm").addEventListener("submit", function (e) {
    e.preventDefault();
    req("department/knowledge", "POST", { category: $("kbCat").value, title: $("kbTitle").value, content: $("kbContent").value }).then(function (d) {
      if (!d.ok) { alert(errText(d)); return; }
      $("kbTitle").value = ""; $("kbContent").value = ""; kb();
    });
  });

  req("me").then(function (d) {
    if (d.status === 401) {
      $("gate").hidden = false; $("gate").textContent = "";
      $("gate").appendChild(document.createTextNode("سجّل الدخول لاستعمال المساعد. "));
      var a = el("a", "تسجيل الدخول"); a.href = "login.html?next=study-assistant.html"; $("gate").appendChild(a);
      $("tabs").hidden = true; $("pane-chat").hidden = true; $("who").textContent = ""; return;
    }
    if (!d.ok) { $("gate").hidden = false; $("gate").textContent = errText(d); return; }
    me = d.principal;
    $("who").textContent = me.department ? [me.university, me.college, me.department].filter(Boolean).join(" — ") : "لم تختر قسمك بعد: افتح صفحة قسمك مرة ليعرفه المساعد.";
    quota(d.quota);
    req("documents").then(function (r) {
      (r.items || []).forEach(function (x) { DOCS[x.id] = x; var o = el("option", x.title + " (" + x.page_count + " صفحة)"); o.value = x.id; $("doc").appendChild(o); });
    });
  });
})();
