/* ربط «اكتب وظلّل» بمساعد الدراسة (عقد PdfStudioBridgeAdapter من حزمة الدمج):
   1) يفهرس نص صفحات الملف المفتوح في حساب الطالب (POST /api/study-assistant/documents/index) مرة كل يوم لكل ملف.
   2) زر «المساعد» بأربعة إجراءات: explain_page · summarize_selection · quiz_from_pages · translate_paragraph → POST /api/study-assistant/notebook/actions
   3) شرائح الصفحات في الجواب تطلق الحدث iu:pdf-studio:open-cited-page فيفتح العارض تلك الصفحة. ويُفتح أيضاً من #page=N في الرابط.
   لا يغيّر عارض PDF نفسه: يقرأ الصفحات من #pages .page فقط. */
(function () {
  "use strict";
  var src = new URLSearchParams(location.search).get("file");
  if (!src || !window.fetch || !window.crypto || !crypto.subtle) return;
  var API = "/api/study-assistant/", fileUrl = new URL(src, location.href).href, doc = null, signedIn = false;
  var EVT = { SELECTION_ACTION: "iu:pdf-studio:selection-action", OPEN_CITED_PAGE: "iu:pdf-studio:open-cited-page" };

  function pagesEls() { return document.querySelectorAll("#pages .page"); }
  function currentPage() {
    var els = pagesEls(), mid = innerHeight / 2, best = 1, bestD = Infinity;
    for (var i = 0; i < els.length; i++) {
      var r = els[i].getBoundingClientRect(), d = r.top <= mid && r.bottom >= mid ? 0 : Math.min(Math.abs(r.top - mid), Math.abs(r.bottom - mid));
      if (d < bestD) { bestD = d; best = i + 1; }
    }
    return best;
  }
  function openPage(n) {
    var el = pagesEls()[n - 1];
    if (el) el.scrollIntoView({ behavior: "smooth", block: "start" });
    return !!el;
  }
  document.addEventListener(EVT.OPEN_CITED_PAGE, function (e) { if (e.detail && e.detail.pageNumber) openPage(Number(e.detail.pageNumber)); });
  var m = /(?:^#|&)page=(\d+)/.exec(location.hash);
  if (m) { var want = Number(m[1]), tries = 0; (function wait() { if (!openPage(want) && tries++ < 40) setTimeout(wait, 500); })(); }

  function api(path, body) {
    return fetch(API + path, { method: body ? "POST" : "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; }); });
  }
  function hex(buf) { return Array.prototype.map.call(new Uint8Array(buf), function (b) { return ("0" + b.toString(16)).slice(-2); }).join(""); }

  function indexOnce() {
    var key = "iq.sa.idx." + doc, last = 0;
    try { last = Number(localStorage.getItem(key)) || 0; } catch (e) { /* لا شيء */ }
    if (Date.now() - last < 864e5) return;
    (function waitLib(t) {
      if (!window.pdfjsLib) { if (t < 40) setTimeout(function () { waitLib(t + 1); }, 500); return; }
      pdfjsLib.getDocument({ url: fileUrl, isEvalSupported: false }).promise.then(function (pdf) {
        var n = Math.min(pdf.numPages, 400), out = [], i = 1;
        function next() {
          if (i > n) return api("documents/index", { doc: doc, title: document.title.replace(/\s*\|.*$/, "") || decodeURIComponent(fileUrl.split("/").pop()), file: src, pages: out }).then(function (d) {
            if (d.ok) try { localStorage.setItem(key, String(Date.now())); } catch (e) { /* لا شيء */ }
          });
          var p = i++;
          return pdf.getPage(p).then(function (pg) { return pg.getTextContent(); }).then(function (tc) {
            out.push({ n: p, text: tc.items.map(function (x) { return x.str; }).join(" ").slice(0, 12000) });
            return next();
          });
        }
        return next();
      }).catch(function () { /* ملف بلا نص أو تعذّر التحميل: المساعد يعمل بلا فهرس */ });
    })(0);
  }

  // الواجهة
  var fab = document.createElement("button"); fab.type = "button"; fab.className = "sab-fab"; fab.textContent = "🤖 المساعد";
  var panel = document.createElement("div"); panel.className = "sab-panel"; panel.hidden = true; panel.setAttribute("role", "dialog"); panel.setAttribute("aria-label", "مساعد الدراسة");
  panel.innerHTML = '<strong>مساعد الدراسة</strong><p class="sab-note" data-r="note">حدّد نصاً في الصفحة أو اختر إجراءً للصفحة الحالية.</p>' +
    '<div class="sab-acts">' +
    '<button type="button" data-a="explain_page">💡 اشرح الصفحة/الفقرة</button>' +
    '<button type="button" data-a="summarize_selection">📋 لخّص التحديد</button>' +
    '<button type="button" data-a="quiz_from_pages">🧪 اختبرني من الصفحة</button>' +
    '<button type="button" data-a="translate_paragraph">🌐 ترجم الفقرة</button></div>' +
    '<div class="sab-out" data-r="out" aria-live="polite"></div>' +
    '<p class="sab-note"><a href="study-assistant.html">فتح صفحة المساعد كاملة</a></p>';
  document.body.appendChild(panel); document.body.appendChild(fab);
  var note = panel.querySelector('[data-r="note"]'), out = panel.querySelector('[data-r="out"]'), lastSel = "";
  document.addEventListener("selectionchange", function () { var s = String(getSelection() || "").trim(); if (s) lastSel = s.slice(0, 6000); });
  fab.addEventListener("click", function () { panel.hidden = !panel.hidden; });

  function render(d, action) {
    out.textContent = "";
    if (!d.ok) { out.textContent = ((d.error && d.error.message) ? d.error.message + (d.error.detail ? " [" + d.error.detail + "]" : "") : "تعذّر الاتصال بالمساعد."); return; }
    if (action === "quiz_from_pages" && d.data && d.data.questions) {
      d.data.questions.forEach(function (q, i) {
        var p = document.createElement("p"); p.textContent = (i + 1) + ". " + q.question; out.appendChild(p);
        (q.options || []).forEach(function (o, k) {
          var b = document.createElement("button"); b.type = "button"; b.className = "sa-cite"; b.textContent = o;
          b.addEventListener("click", function () { b.textContent = (k === q.correctIndex ? "✓ " : "✗ ") + o + (q.explanation && k === q.correctIndex ? " — " + q.explanation : ""); });
          out.appendChild(b);
        });
      });
    } else out.appendChild(document.createTextNode(d.answer || ""));
    var c = document.createElement("div"); c.className = "sa-cites";
    (d.citations || []).forEach(function (ci) {
      var b = document.createElement("button"); b.type = "button"; b.className = "sa-cite"; b.textContent = "ص " + ci.pageNumber; b.title = ci.excerpt || "";
      b.addEventListener("click", function () {
        document.dispatchEvent(new CustomEvent(EVT.OPEN_CITED_PAGE, { detail: { eventType: EVT.OPEN_CITED_PAGE, documentId: ci.documentId, pageNumber: ci.pageNumber, chunkId: ci.chunkId, highlightExcerpt: (ci.excerpt || "").slice(0, 200) } }));
      });
      c.appendChild(b);
    });
    out.appendChild(c);
  }

  panel.querySelectorAll("[data-a]").forEach(function (b) {
    b.addEventListener("click", function () {
      if (!signedIn) { out.textContent = "سجّل الدخول لاستعمال المساعد."; return; }
      var action = b.dataset.a, page = currentPage();
      var payload = { documentId: doc, pageNumbers: [page], selectedText: lastSel, actionType: action, targetLang: "ar" };
      document.dispatchEvent(new CustomEvent(EVT.SELECTION_ACTION, { detail: payload }));
      panel.querySelectorAll("[data-a]").forEach(function (x) { x.disabled = true; });
      out.textContent = "جارٍ التفكير… (ص " + page + ")";
      api("notebook/actions", payload).then(function (d) { render(d, action); }).catch(function () { render({ ok: false }); })
        .then(function () { panel.querySelectorAll("[data-a]").forEach(function (x) { x.disabled = false; }); lastSel = ""; });
    });
  });

  crypto.subtle.digest("SHA-256", new TextEncoder().encode(fileUrl)).then(function (h) {
    doc = hex(h).slice(0, 24);
    return api("me");
  }).then(function (d) {
    signedIn = !!d.ok;
    if (!signedIn) { note.textContent = d.status === 401 ? "سجّل الدخول لاستعمال المساعد على هذا الملف." : "المساعد غير متاح الآن."; return; }
    indexOnce();
  }).catch(function () { /* بلا شبكة */ });
})();
