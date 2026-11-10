/* js/ai-guide.js — «المرشد الذكي»: نافذة منبثقة داخل صفحة القسم (بلا صفحة جديدة).
   يكلّم /api/study-assistant/* بكوكي الجلسة فقط (same-origin)، ولا يرسل أي هوية من المتصفح.
   يُفتح بأي عنصر عليه data-open-guide. كل نص يُبنى بـ textContent (لا innerHTML). */
(function () {
  "use strict";
  var API = "/api/study-assistant/";
  var HKEY = "iq.guide.history";
  var MODES = [
    { id: "ask", ph: "اسألني أي شيء…", chips: ["ما آخر محاضرة نزلت؟", "ما آخر تبليغ؟", "كم عدد المحاضرات في قسمي؟", "ما درجاتي ومعدلي؟", "لخّص لي أهم نقاط المحاضرة"] }
  ];
  /* نية الطلب تُفهم من الكلام نفسه: اختبار أو خريطة ذهنية، وما عداهما دردشة عادية */
  function intent(q) { if (/خريطة ذهنية|mind ?map/i.test(q)) return "mindmap"; if (/اختبرني|اختبر معلوماتي|أعطني (اختبار|أسئلة)|اعطني (اختبار|أسئلة)|quiz me/i.test(q)) return "quiz"; return "ask"; }
  var st = { gradesOpen: false, mode: "ask", busy: false, me: null, docs: [], hist: [], built: false, last: null, ctxFn: null, timer: null };
  var ctxBar;
  function ctx() { try { return st.ctxFn ? st.ctxFn() : null; } catch (e) { return null; } }
  function hkey() { var c = ctx(); return c && c.documentId ? HKEY + "." + c.documentId : HKEY; }
  var idxBox, idxBtn, root, thread, input, sendBtn, docSel, chipsBox, quotaEl, whoEl, foot, gradesBox, modeBtns = [], opener = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function req(path, method, body) {
    return fetch(API + path, { method: method || "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; }); });
  }
  function errText(d) {
    var error = d && d.error;
    var code = typeof error === "string" ? error : error && error.code;
    if (code === "database_quota_exceeded") return "بلغت الخدمة حد الاستخدام اليومي. حاول لاحقًا.";
    if (code === "service_unavailable" || code === "server" || code === "SERVER_ERROR") return "المساعد غير متاح مؤقتًا. أعد المحاولة بعد قليل.";
    return error && typeof error.message === "string" ? error.message : "تعذّر الاتصال بالمساعد. أعد المحاولة.";
  }

  /* ---------- حفظ المحادثة في هذه الجلسة فقط ---------- */
  function loadHist() { try { var h = JSON.parse(sessionStorage.getItem(hkey())); if (Array.isArray(h)) st.hist = h.slice(-30); } catch (e) { st.hist = []; } }
  function saveHist() { try { sessionStorage.setItem(hkey(), JSON.stringify(st.hist.slice(-30))); } catch (e) { /* لا شيء */ } }

  /* ---------- عرض نص منسّق بسيط وآمن: **غامق**، قوائم، عناوين ---------- */
  function inline(parent, text) {
    String(text).split(/(\*\*[^*]+\*\*)/g).forEach(function (p) {
      if (!p) return;
      if (p.length > 4 && p.slice(0, 2) === "**" && p.slice(-2) === "**") parent.appendChild(el("strong", null, p.slice(2, -2)));
      else parent.appendChild(document.createTextNode(p));
    });
  }
  function rich(text) {
    var box = el("div", "ag-rich"), list = null, ordered = false;
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var m;
      if ((m = /^\s*(?:[-*•]|(\d+)[.)])\s+(.*)$/.exec(line))) {
        var isOrd = !!m[1];
        if (!list || ordered !== isOrd) { list = el(isOrd ? "ol" : "ul"); ordered = isOrd; box.appendChild(list); }
        var li = el("li"); inline(li, m[2]); list.appendChild(li); return;
      }
      list = null;
      if (!line.trim()) return;
      if ((m = /^#{1,4}\s+(.*)$/.exec(line))) { var h = el("h4"); inline(h, m[1]); box.appendChild(h); return; }
      var p = el("p"); inline(p, line); box.appendChild(p);
    });
    return box;
  }

  function cites(list) {
    var box = el("div", "ag-cites");
    (list || []).forEach(function (c) {
      var d = null; st.docs.forEach(function (x) { if (x.id === c.documentId) d = x; });
      var cx = ctx(), a = el(c.fileUrl ? "a" : (cx && cx.onCite ? "button" : (d && d.file ? "a" : "span")), "ag-cite", (c.title ? c.title.slice(0, 24) + " · " : "") + "ص " + c.pageNumber);
      if (c.excerpt) a.title = c.excerpt;
      if (c.fileUrl) { a.href = "pdf-notes.html?file=" + encodeURIComponent(c.fileUrl) + "#page=" + c.pageNumber; a.target = "_blank"; a.rel = "noopener"; }
      else if (cx && cx.onCite) { a.type = "button"; a.addEventListener("click", function () { cx.onCite(c); }); }
      else if (d && d.file) { a.href = "pdf-notes.html?file=" + encodeURIComponent(d.file) + "#page=" + c.pageNumber; a.target = "_blank"; a.rel = "noopener"; }
      box.appendChild(a);
    });
    return box;
  }

  function quizView(data) {
    var wrap = el("div", "ag-quiz"), qs = data.questions || [], done = 0, right = 0;
    if (data.title) wrap.appendChild(el("strong", null, data.title));
    var score = el("p", "ag-score", ""); score.hidden = true;
    qs.forEach(function (q, i) {
      var box = el("div", "ag-q"), exp = el("p", "ag-exp"), answered = false;
      box.appendChild(el("p", "ag-qt", (i + 1) + ". " + q.question + (q.pageNumber ? "  (ص " + q.pageNumber + ")" : "")));
      var btns = [];
      (q.options || []).forEach(function (o, k) {
        var b = el("button", "ag-opt", o); b.type = "button"; btns.push(b);
        b.addEventListener("click", function () {
          if (answered) return; answered = true; done++;
          if (k === q.correctIndex) { right++; b.classList.add("ok"); } else { b.classList.add("bad"); if (btns[q.correctIndex]) btns[q.correctIndex].classList.add("ok"); }
          exp.textContent = q.explanation || "";
          if (done === qs.length) { score.hidden = false; score.textContent = "نتيجتك: " + right + " من " + qs.length + (right === qs.length ? " — ممتاز!" : right >= qs.length / 2 ? " — جيد، راجع الأخطاء." : " — راجع المحاضرة ثم أعد المحاولة."); }
        });
        box.appendChild(b);
      });
      box.appendChild(exp); wrap.appendChild(box);
    });
    wrap.appendChild(score);
    return wrap;
  }
  function mapView(data) {
    function node(n) {
      var li = el("li", null, (n.label || "—") + (n.pageNumber ? " (ص " + n.pageNumber + ")" : ""));
      var kids = n.children || n.branches || [];
      if (kids.length) { var ul = el("ul"); kids.forEach(function (k) { ul.appendChild(node(k)); }); li.appendChild(ul); }
      return li;
    }
    var wrap = el("div", "ag-map"), ul = el("ul"); ul.appendChild(node(data.root || { label: "—" })); wrap.appendChild(ul); return wrap;
  }

  /* ---------- فقاعات المحادثة ---------- */
  function addUser(text) {
    var b = el("div", "ag-msg ag-user"); var ub = el("div", "ag-bubble", text); ub.setAttribute("dir", "auto"); b.appendChild(ub); thread.appendChild(b); scroll(); return b;
  }
  function addBot(d, fromHist) {
    var b = el("div", "ag-msg ag-bot"), bub = el("div", "ag-bubble"); bub.setAttribute("dir", "auto");
    if (!d.ok) { bub.classList.add("err"); bub.appendChild(el("p", null, d.text || errText(d))); if (!fromHist && st.last) { var r = el("button", "ag-retry", "إعادة المحاولة"); r.type = "button"; r.addEventListener("click", function () { b.remove(); send(st.last.q, st.last.mode, true, st.last.extra); }); bub.appendChild(r); } }
    else if (d.task === "quiz" && d.data && d.data.questions && d.data.questions.length) bub.appendChild(quizView(d.data));
    else if (d.task === "mindmap" && d.data && d.data.root) bub.appendChild(mapView(d.data));
    else bub.appendChild(rich(d.answer || d.text || "لم يصلني ردّ مفهوم، أعد صياغة السؤال."));
    if (d.ok && d.citations && d.citations.length) bub.appendChild(cites(d.citations));
    b.appendChild(bub);
    if (d.ok && (d.answer || d.text)) {
      var cp = el("button", "ag-copy", "نسخ"); cp.type = "button";
      cp.addEventListener("click", function () { try { navigator.clipboard.writeText(d.answer || d.text).then(function () { cp.textContent = "تم النسخ ✓"; setTimeout(function () { cp.textContent = "نسخ"; }, 1500); }); } catch (e) { /* لا شيء */ } });
      b.appendChild(cp);
    }
    thread.appendChild(b); scroll(); return b;
  }
  function scroll() { thread.scrollTop = thread.scrollHeight; }
  function welcome() {
    thread.textContent = "";
    var w = el("div", "ag-welcome");
    w.appendChild(el("strong", null, "أهلاً بك 👋"));
    var cw = ctx();
    w.appendChild(el("p", null, cw && cw.documentId ? "أرى الملف المفتوح وصفحتك الحالية والنص الذي تحدّده. اسألني عن أي شيء: اشرح، لخّص، ترجم، اختبرني، أو اسأل سؤالاً عاماً لا علاقة له بالملف." : "أنا المرشد الذكي. اسألني عن محاضراتك وقسمك ودرجاتك وأي موضوع، وأختبرك وألخّص لك."));
    thread.appendChild(w);
    st.hist.forEach(function (m) { if (m.u) addUser(m.u); if (m.d) addBot(m.d, true); });
  }

  /* ---------- الإرسال ---------- */
  function setBusy(v) { st.busy = v; sendBtn.disabled = v; input.disabled = v; }
  function histPayload() {
    var out = [];
    st.hist.slice(-6).forEach(function (m) {
      if (m.u && m.d && m.d.ok && (m.d.task === "ask" || m.d.task === "advisor" || m.d.task === "summarize" || m.d.task === "explain" || m.d.task === "translate") && m.d.answer) { out.push({ role: "user", content: m.u }); out.push({ role: "assistant", content: String(m.d.answer).slice(0, 1500) }); }
    });
    return out;
  }
  function send(text, mode, isRetry, extra) {
    text = String(text == null ? input.value : text).trim();
    if (st.busy) return;
    if (!text && mode !== "quiz" && mode !== "mindmap") return;
    var q = text || (mode === "quiz" ? "اختبرني من هذه المحاضرة" : "خريطة ذهنية لهذه المحاضرة");
    if (!mode || mode === "ask") mode = intent(q);
    st.last = { q: q, mode: mode, extra: extra };
    if (!isRetry) { addUser(q); input.value = ""; autosize(); }
    var typing = el("div", "ag-msg ag-bot"); var tb = el("div", "ag-bubble ag-typing"); tb.appendChild(el("span")); tb.appendChild(el("span")); tb.appendChild(el("span")); typing.appendChild(tb); thread.appendChild(typing); scroll();
    chipsBox.hidden = true;
    setBusy(true);
    var body = { task: mode, question: q }, cx = ctx();
    if (cx && cx.documentId && mode !== "advisor") {
      body.documentId = cx.documentId;
      var pg = cx.page ? cx.page() : 0; if (pg) body.contextPage = pg;
      var sel = cx.selection ? cx.selection() : ""; if (sel) body.selectedText = sel;
      if (extra && extra.page && pg) body.pageNumbers = [pg];
    } else if (docSel.value && mode !== "advisor") body.documentId = docSel.value;
    var hp = histPayload(); if (hp.length) body.history = hp;
    if (body.selectedText && cx && cx.clearSelection) setTimeout(function () { cx.clearSelection(); refreshCtx(); }, 0);
    req("assistant/run", "POST", body).then(function (d) {
      typing.remove();
      if (d.ok) { st.hist.push({ u: isRetry ? null : q, d: { ok: true, task: d.task, answer: d.answer, data: d.data, citations: d.citations } }); }
      else if (!isRetry) st.hist.push({ u: q });
      saveHist();
      if (d.status === 401) d.text = "انتهت جلستك. سجّل الدخول من جديد.";
      addBot(d.ok ? d : { ok: false, text: d.text || errText(d) });
      if (d.quota) quota(d.quota);
    }).catch(function () { typing.remove(); addBot({ ok: false }); })
      .then(function () { setBusy(false); try { input.focus(); } catch (e) { /* لا شيء */ } });
  }
  function quota(q) { if (q) quotaEl.textContent = "المتبقي اليوم: " + q.remaining + " من " + q.dailyLimit + " طلباً"; }

  /* ---------- الأوضاع والاقتراحات ---------- */
  function setMode(id) {
    st.mode = "ask";
    var cx = ctx();
    input.placeholder = cx && cx.documentId ? "اسألني عن الملف أو عن أي شيء آخر…" : MODES[0].ph;
    docSel.hidden = st.docs.length === 0 || !!(cx && cx.documentId);
    chipsBox.textContent = "";
    var list = MODES[0].chips.map(function (c) { return { t: c }; });
    if (cx && cx.documentId) list = (cx.chips || []).concat(list.slice(0, 2));
    list.forEach(function (c) { var b = el("button", "ag-chip", c.t); b.type = "button"; b.addEventListener("click", function () { send(c.q || c.t, c.mode, false, { page: !!c.page }); }); chipsBox.appendChild(b); });
    chipsBox.hidden = st.gradesOpen || st.hist.length > 0;
  }
  function toggleGrades(on) {
    st.gradesOpen = !!on;
    thread.hidden = on; foot.hidden = on; gradesBox.hidden = !on; chipsBox.hidden = on || st.hist.length > 0;
    if (on) loadGrades();
  }

  /* ---------- درجاتي: يسجّلها الطالب بنفسه ويراها المرشد ---------- */
  function renderGrades(d) {
    var box = gradesBox.querySelector(".ag-glist"); box.textContent = "";
    var sum = gradesBox.querySelector(".ag-gsum");
    if (!d.ok) { sum.textContent = errText(d); return; }
    sum.textContent = d.count ? "عدد الدرجات: " + d.count + (d.averagePercent != null ? " — معدلك التقريبي: " + d.averagePercent + "%" : "") : "لم تسجّل أي درجة بعد.";
    (d.items || []).slice().reverse().forEach(function (g) {
      var row = el("div", "ag-grow");
      var t = el("div", "ag-gt"); t.appendChild(el("strong", null, g.subject)); t.appendChild(el("small", null, (g.kind || "") + " · " + g.score + " من " + g.max + (g.percent != null ? " (" + g.percent + "%)" : "") + (g.date ? " · " + g.date : "")));
      var del = el("button", "ag-gdel", "حذف"); del.type = "button";
      del.addEventListener("click", function () { if (confirm("حذف هذه الدرجة؟")) req("grades", "DELETE", { id: g.id }).then(renderGrades); });
      row.appendChild(t); row.appendChild(del); box.appendChild(row);
    });
  }
  function loadGrades() { req("grades").then(function (d) { if (d.status === 401) { gradesBox.querySelector(".ag-gsum").textContent = "سجّل الدخول لتسجيل درجاتك."; return; } renderGrades(d); }).catch(function () { renderGrades({ ok: false }); }); }
  function buildGrades() {
    var box = el("div", "ag-grades"); box.hidden = true;
    box.appendChild(el("p", "ag-tip", "سجّل درجاتك هنا فيعرفها المرشد ويجيبك عنها (معدلك، أضعف مادة…). هي محفوظة في حسابك ولا يراها غيرك."));
    var f = el("form", "ag-gform");
    var subj = el("input"); subj.placeholder = "اسم المادة"; subj.maxLength = 80; subj.required = true; subj.setAttribute("aria-label", "اسم المادة");
    var kind = el("select"); kind.setAttribute("aria-label", "النوع"); ["سعي", "نصف السنة", "نهائي", "اختبار", "عملي", "أخرى"].forEach(function (k) { var o = el("option", null, k); o.value = k; kind.appendChild(o); });
    var score = el("input"); score.type = "number"; score.step = "any"; score.min = "0"; score.placeholder = "الدرجة"; score.required = true; score.setAttribute("aria-label", "الدرجة");
    var max = el("input"); max.type = "number"; max.step = "any"; max.min = "1"; max.placeholder = "من (100)"; max.setAttribute("aria-label", "الدرجة العظمى");
    var add = el("button", "ag-send", "إضافة"); add.type = "submit";
    [subj, kind, score, max, add].forEach(function (x) { f.appendChild(x); });
    f.addEventListener("submit", function (e) {
      e.preventDefault(); add.disabled = true;
      req("grades", "POST", { subject: subj.value, kind: kind.value, score: score.value, max: max.value || 100 }).then(function (d) {
        if (!d.ok) { alert(errText(d)); return; }
        subj.value = ""; score.value = ""; max.value = ""; renderGrades(d);
      }).then(function () { add.disabled = false; });
    });
    box.appendChild(f); box.appendChild(el("p", "ag-gsum")); box.appendChild(el("div", "ag-glist"));
    return box;
  }
  function autosize() { input.style.height = "auto"; input.style.height = Math.min(input.scrollHeight, 120) + "px"; }

  /* ---------- فهرسة ملفات القسم (لممثل القسم/المشرف): تُستخرج النصوص في متصفحه وتُرسل للخادم ---------- */
  var PDFJS = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.min.js", PDFJS_W = "https://cdnjs.cloudflare.com/ajax/libs/pdf.js/3.11.174/pdf.worker.min.js";
  function loadPdfJs() {
    if (window.pdfjsLib) return Promise.resolve(window.pdfjsLib);
    return new Promise(function (ok, no) {
      var s = document.createElement("script"); s.src = PDFJS; s.onload = function () { window.pdfjsLib.GlobalWorkerOptions.workerSrc = PDFJS_W; ok(window.pdfjsLib); }; s.onerror = function () { no(new Error("pdfjs")); };
      document.head.appendChild(s);
    });
  }
  function buildIdx() {
    var box = el("div", "ag-grades"); box.hidden = true;
    box.appendChild(el("strong", null, "فهرسة ملفات القسم"));
    var info = el("p", "ag-gsum", "…"); info.className = "ag-gsum ag-idxinfo"; box.appendChild(info);
    var bar = el("progress"); bar.max = 100; bar.value = 0; bar.hidden = true; bar.style.width = "100%"; box.appendChild(bar);
    var go = el("button", "ag-send", "ابدأ فهرسة الملفات الجديدة"); go.type = "button"; box.appendChild(go);
    var note = el("small", "ag-quota", "بعد الفهرسة يجيب المرشد كل طالب في القسم من نصوص المحاضرات مع رقم الصفحة. يمكنك ترك النافذة مفتوحة حتى تنتهي."); box.appendChild(note);
    box._info = info; box._bar = bar; box._go = go;
    go.addEventListener("click", function () { runIdx(box); });
    return box;
  }
  function refreshIdx(box) {
    return req("dept/status").then(function (d) {
      if (!d.ok) { box._info.textContent = errText(d); return null; }
      box._st = d;
      box._info.textContent = "ملفات القسم: " + d.total + " — المفهرس منها: " + d.indexed + (d.semantic ? " — البحث بالمعنى مفعّل" : " — البحث بالكلمات (فعّل Vectorize للبحث بالمعنى)");
      box._go.disabled = d.indexed >= d.total; return d;
    });
  }
  function runIdx(box) {
    var d = box._st; if (!d) return;
    var todo = d.files.filter(function (f) { return !f.indexed; });
    if (!todo.length) return;
    box._go.disabled = true; box._bar.hidden = false; box._bar.value = 0;
    var failed = 0;
    loadPdfJs().then(function () {
      var i = 0;
      function next() {
        if (i >= todo.length) { box._bar.hidden = true; box._info.textContent = failed ? "اكتملت الفهرسة مع تعذّر " + failed + " ملف." : "اكتملت فهرسة كل الملفات ✓"; return refreshIdx(box); }
        var f = todo[i++];
        box._info.textContent = "فهرسة (" + i + "/" + todo.length + "): " + (f.title || f.subject || "");
        box._bar.value = Math.round(((i - 1) / todo.length) * 100);
        return window.pdfjsLib.getDocument({ url: "/api/file/" + encodeURIComponent(f.id), withCredentials: true }).promise.then(function (pdf) {
          var pages = [], n = 1;
          function page() {
            if (n > pdf.numPages || n > 600) return;
            var cur = n++;
            return pdf.getPage(cur).then(function (p) { return p.getTextContent(); }).then(function (tc) {
              pages.push({ n: cur, text: tc.items.map(function (it) { return it.str; }).join(" ") }); return page();
            });
          }
          return page().then(function () {
            var out = [], batch = Promise.resolve();
            return req("dept/index", "POST", { fileId: f.id, pages: pages.filter(function (p) { return p.text.trim().length > 15; }) }).then(function (r) { if (!r.ok) failed++; });
          });
        }).catch(function () { failed++; }).then(next);
      }
      return next();
    }).catch(function () { box._info.textContent = "تعذّر تحميل مكتبة قراءة PDF."; box._go.disabled = false; });
  }
  function toggleIdx(on) {
    thread.hidden = on; foot.hidden = on; idxBox.hidden = !on; chipsBox.hidden = on || st.hist.length > 0;
    if (on) refreshIdx(idxBox);
  }

  /* ---------- بناء النافذة ---------- */
  function build() {
    if (st.built) return; st.built = true;
    loadHist();
    root = el("div", "ag-root"); root.hidden = true;
    var back = el("div", "ag-back"); back.addEventListener("click", close);
    var dlg = el("div", "ag-dialog"); dlg.setAttribute("role", "dialog"); dlg.setAttribute("aria-modal", "true"); dlg.setAttribute("aria-labelledby", "agTitle");
    var head = el("div", "ag-head"), ht = el("div", "ag-ht");
    var t = el("strong", "ag-title", "✨ المرشد الذكي"); t.id = "agTitle"; ht.appendChild(t);
    whoEl = el("small", "ag-who", "…"); ht.appendChild(whoEl); head.appendChild(ht);
    var full = el("a", "ag-tool", "فتح كاملاً"); full.href = "study-assistant.html"; full.title = "فتح الصفحة الكاملة (دليل القسم وإضافة الملاحظات)"; head.appendChild(full);
    var clr = el("button", "ag-tool", "مسح"); clr.type = "button"; clr.title = "مسح المحادثة"; clr.addEventListener("click", function () { st.hist = []; saveHist(); welcome(); setMode("ask"); }); head.appendChild(clr);
    var gb = el("button", "ag-tool", "درجاتي"); gb.type = "button"; gb.title = "سجّل درجاتك ليعرفها المرشد";
    gb.addEventListener("click", function () { toggleGrades(!st.gradesOpen); gb.textContent = st.gradesOpen ? "رجوع للمحادثة" : "درجاتي"; }); head.appendChild(gb);
    idxBtn = el("button", "ag-tool", "فهرسة القسم"); idxBtn.type = "button"; idxBtn.hidden = true; idxBtn.title = "لممثل القسم: اجعل المرشد يعرف نصوص كل محاضرات القسم";
    idxBtn.addEventListener("click", function () { var on = idxBox.hidden; if (on && st.gradesOpen) { toggleGrades(false); gb.textContent = "درجاتي"; } toggleIdx(on); idxBtn.textContent = on ? "رجوع للمحادثة" : "فهرسة القسم"; }); head.appendChild(idxBtn);
    var x = el("button", "ag-x", "×"); x.type = "button"; x.setAttribute("aria-label", "إغلاق"); x.addEventListener("click", close); head.appendChild(x);
    dlg.appendChild(head);
    ctxBar = el("div", "ag-ctx"); ctxBar.hidden = true; dlg.appendChild(ctxBar);
    thread = el("div", "ag-thread"); thread.setAttribute("aria-live", "polite"); dlg.appendChild(thread);
    gradesBox = buildGrades(); dlg.appendChild(gradesBox);
    idxBox = buildIdx(); dlg.appendChild(idxBox);
    chipsBox = el("div", "ag-chips"); dlg.appendChild(chipsBox);
    foot = el("div", "ag-foot");
    docSel = el("select", "ag-doc"); docSel.setAttribute("aria-label", "المحاضرة"); docSel.hidden = true;
    var o0 = el("option", null, "كل محاضراتي المفهرسة"); o0.value = ""; docSel.appendChild(o0); foot.appendChild(docSel);
    var row = el("div", "ag-inrow");
    input = el("textarea", "ag-input"); input.rows = 1; input.maxLength = 2000; input.setAttribute("aria-label", "سؤالك");
    input.addEventListener("input", autosize);
    input.addEventListener("keydown", function (e) { if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); send(); } });
    sendBtn = el("button", "ag-send", "إرسال"); sendBtn.type = "button"; sendBtn.addEventListener("click", function () { send(); });
    row.appendChild(input); row.appendChild(sendBtn); foot.appendChild(row);
    quotaEl = el("small", "ag-quota"); foot.appendChild(quotaEl);
    dlg.appendChild(foot);
    root.appendChild(back); root.appendChild(dlg); document.body.appendChild(root);
    document.addEventListener("keydown", function (e) { if (!root.hidden && e.key === "Escape") close(); });
    setMode("ask"); welcome();
  }

  function gate() {
    thread.textContent = "";
    var w = el("div", "ag-welcome"); w.appendChild(el("strong", null, "سجّل الدخول لاستعمال المرشد"));
    w.appendChild(el("p", null, "المرشد يعمل على حسابك ومحاضراتك فقط، لذلك يحتاج تسجيل دخول."));
    var a = el("a", "ag-send ag-link", "تسجيل الدخول"); a.href = "login.html?next=" + encodeURIComponent(location.pathname.replace(/^\//, "") + location.search); w.appendChild(a);
    thread.appendChild(w); chipsBox.textContent = ""; input.disabled = true; sendBtn.disabled = true; docSel.hidden = true;
  }

  function refreshCtx() {
    var c = ctx(); if (!ctxBar) return;
    if (!c || !c.documentId) { ctxBar.hidden = true; return; }
    ctxBar.hidden = false; ctxBar.textContent = "";
    ctxBar.appendChild(el("span", "ag-ctxdoc", "📄 " + (c.title ? c.title : "الملف المفتوح") + (c.page ? " · ص " + c.page() : "")));
    var sel = c.selection ? c.selection() : "";
    if (sel) {
      var chip = el("span", "ag-ctxsel"); chip.appendChild(el("span", null, "✂️ «" + sel.slice(0, 40) + (sel.length > 40 ? "…" : "") + "»"));
      var x = el("button", "ag-ctxx", "×"); x.type = "button"; x.setAttribute("aria-label", "إلغاء التحديد");
      x.addEventListener("click", function () { if (c.clearSelection) c.clearSelection(); refreshCtx(); });
      chip.appendChild(x); ctxBar.appendChild(chip);
    }
  }
  function open(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    build(); opener = document.activeElement;
    var oc = ctx(); root.classList.toggle("ag-dock", !!(oc && oc.dock));
    root.hidden = false; if (!(oc && oc.dock)) document.documentElement.classList.add("ag-lock");
    refreshCtx(); clearInterval(st.timer); if (oc && oc.documentId) st.timer = setInterval(refreshCtx, 700);
    setTimeout(function () { try { input.focus(); } catch (e) { /* لا شيء */ } }, 50);
    req("me").then(function (d) {
      if (d.status === 401) { gate(); whoEl.textContent = ""; return; }
      if (!d.ok) { addBot({ ok: false, text: errText(d) }); return; }
      st.me = d.principal; idxBtn.hidden = !(st.me && st.me.canManageDepartment); input.disabled = false; sendBtn.disabled = false;
      whoEl.textContent = st.me.department ? [st.me.college, st.me.department].filter(Boolean).join(" — ") : "لم تختر قسمك بعد";
      quota(d.quota);
      return req("documents").then(function (r) {
        st.docs = r.items || [];
        while (docSel.options.length > 1) docSel.remove(1);
        st.docs.forEach(function (x) { var o = el("option", null, x.title + " (" + x.page_count + " صفحة)"); o.value = x.id; docSel.appendChild(o); });
        setMode(st.mode);
        if (!st.docs.length && !st.hist.length && !(ctx() && ctx().documentId)) { var tip = el("p", "ag-tip", "نصيحة: افتح أي ملف PDF من صفحة المادة في «اكتب وظلّل» ليُضاف إلى محاضراتك، فأجيبك منه مع رقم الصفحة. وبدون ملفات يمكنك سؤالي عن قسمك من «دليل القسم»."); thread.appendChild(tip); }
      });
    }).catch(function () { addBot({ ok: false }); });
  }
  function close() {
    if (!root) return; root.hidden = true; document.documentElement.classList.remove("ag-lock"); clearInterval(st.timer);
    try { if (opener && opener.focus) opener.focus(); } catch (e) { /* لا شيء */ }
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-open-guide]") : null;
    if (t) open(e);
  });
  window.IQGuide = { open: open, close: close, setContext: function (fn) { st.ctxFn = fn; if (st.built) { loadHist(); welcome(); setMode(st.mode); } } };
  if (/[?&]guide=1\b/.test(location.search)) document.addEventListener("DOMContentLoaded", function () { open(); });
})();
