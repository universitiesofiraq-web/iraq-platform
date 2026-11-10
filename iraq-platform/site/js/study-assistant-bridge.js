/* ربط «اكتب وظلّل» بمساعد الدراسة (عقد PdfStudioBridgeAdapter من حزمة الدمج):
   1) يفهرس نص صفحات الملف المفتوح في حساب الطالب (POST /api/study-assistant/documents/index) مرة كل يوم لكل ملف.
   2) زر «المرشد الذكي»: دردشة حرّة (لوحة جانبية) تعرف الملف والصفحة الحالية والنص المحدد، مع اختصارات للشرح والتلخيص والاختبار والترجمة
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

  // الواجهة: زر يفتح «المرشد الذكي» كلوحة دردشة جانبية فوق العارض (js/ai-guide.js)، وهو يرى الملف والصفحة الحالية والنص المحدد
  var lastSel = "";
  document.addEventListener("selectionchange", function () {
    var sel = getSelection(), s = String(sel || "").trim();
    if (!s || (sel.anchorNode && sel.anchorNode.parentElement && sel.anchorNode.parentElement.closest && sel.anchorNode.parentElement.closest(".ag-root"))) return;
    lastSel = s.slice(0, 6000);
  });
  function cite(c) { document.dispatchEvent(new CustomEvent(EVT.OPEN_CITED_PAGE, { detail: { eventType: EVT.OPEN_CITED_PAGE, documentId: c.documentId, pageNumber: c.pageNumber, chunkId: c.chunkId, highlightExcerpt: (c.excerpt || "").slice(0, 200) } })); }
  function setup() {
    if (!window.IQGuide) return false;
    IQGuide.setContext(function () {
      return {
        documentId: doc, dock: true, page: currentPage, onCite: cite,
        title: decodeURIComponent(fileUrl.split("/").pop() || "").replace(/\.pdf$/i, "").slice(0, 40),
        selection: function () { return lastSel; }, clearSelection: function () { lastSel = ""; },
        chips: [
          { t: "💡 اشرح هذه الصفحة", q: "اشرح لي النص المحدد إن وُجد، وإلا اشرح الصفحة الحالية ببساطة وبالتفصيل", page: true },
          { t: "📋 لخّص", q: "لخّص النص المحدد إن وُجد، وإلا لخّص الصفحة الحالية في نقاط", page: true },
          { t: "🧪 اختبرني من الصفحة", q: "اختبرني من هذه الصفحة", mode: "quiz", page: true },
          { t: "🌐 ترجم إلى العربية", q: "ترجم النص المحدد إن وُجد، وإلا ترجم الصفحة الحالية إلى العربية مع إبقاء المصطلحات الإنجليزية", page: true }
        ]
      };
    });
    var fab = document.createElement("button"); fab.type = "button"; fab.className = "sab-fab"; fab.textContent = "🤖 المرشد الذكي";
    fab.addEventListener("click", function () { IQGuide.open(); });
    document.body.appendChild(fab);
    return true;
  }
  (function waitGuide(t) { if (!setup() && t < 40) setTimeout(function () { waitGuide(t + 1); }, 250); })(0);

  crypto.subtle.digest("SHA-256", new TextEncoder().encode(fileUrl)).then(function (h) {
    doc = hex(h).slice(0, 24);
    return api("me");
  }).then(function (d) {
    signedIn = !!d.ok;
    if (signedIn) indexOnce();
  }).catch(function () { /* بلا شبكة */ });
})();
