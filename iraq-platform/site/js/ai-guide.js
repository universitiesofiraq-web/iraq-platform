/* js/ai-guide.js — «المرشد الذكي»: نافذة منبثقة داخل صفحة القسم (بلا صفحة جديدة).
   يكلّم /api/study-assistant/* بكوكي الجلسة فقط (same-origin)، ولا يرسل أي هوية من المتصفح.
   يُفتح بأي عنصر عليه data-open-guide. كل نص يُبنى بـ textContent (لا innerHTML). */
(function () {
  "use strict";
  var API = "/api/study-assistant/";
  var HKEY = "iq.guide.history";
  var MODES = [
    { id: "ask", label: "اسألني أي شيء", ph: "اسألني عن محاضراتك أو تبليغاتك أو درجاتك أو أي سؤال…", chips: ["ما آخر محاضرة نزلت؟", "ما آخر تبليغ؟", "كم عدد المحاضرات في قسمي؟", "ما درجاتي ومعدلي؟", "لخّص لي أهم نقاط المحاضرة"] },
    { id: "quiz", label: "اختبرني", ph: "موضوع الاختبار (اختياري)", chips: ["اختبرني من هذه المحاضرة", "اختبار سريع على أهم المفاهيم"] },
    { id: "mindmap", label: "خريطة ذهنية", ph: "موضوع الخريطة (اختياري)", chips: ["خريطة ذهنية لهذه المحاضرة"] },
    { id: "advisor", label: "دليل القسم", ph: "اسأل عن قسمك: المواد، الامتحانات، السعي…", chips: ["ما المواد المرفوعة لقسمي؟", "ما مواعيد الامتحانات؟", "كيف يُحتسب السعي؟"] },
    { id: "grades", label: "درجاتي", grades: true }
  ];
  var st = { mode: "ask", busy: false, me: null, docs: [], hist: [], built: false, last: null };
  var root, thread, input, sendBtn, docSel, chipsBox, quotaEl, whoEl, foot, gradesBox, modeBtns = [], opener = null;

  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function req(path, method, body) {
    return fetch(API + path, { method: method || "GET", credentials: "same-origin", headers: body ? { "content-type": "application/json" } : {}, body: body ? JSON.stringify(body) : undefined })
      .then(function (r) { return r.json().catch(function () { return {}; }).then(function (d) { d.status = r.status; return d; }); });
  }
  function errText(d) { return d && d.error && d.error.message ? d.error.message + (d.error.detail ? " [" + d.error.detail + "]" : "") : "تعذّر الاتصال بالمرشد. تحقق من الإنترنت وحاول مرة أخرى."; }

  /* ---------- حفظ المحادثة في هذه الجلسة فقط ---------- */
  function loadHist() { try { var h = JSON.parse(sessionStorage.getItem(HKEY)); if (Array.isArray(h)) st.hist = h.slice(-30); } catch (e) { st.hist = []; } }
  function saveHist() { try { sessionStorage.setItem(HKEY, JSON.stringify(st.hist.slice(-30))); } catch (e) { /* لا شيء */ } }

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
      var a = el(d && d.file ? "a" : "span", "ag-cite", "ص " + c.pageNumber);
      if (c.excerpt) a.title = c.excerpt;
      if (d && d.file) { a.href = "pdf-notes.html?file=" + encodeURIComponent(d.file) + "#page=" + c.pageNumber; a.target = "_blank"; a.rel = "noopener"; }
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
    var b = el("div", "ag-msg ag-user"); b.appendChild(el("div", "ag-bubble", text)); thread.appendChild(b); scroll(); return b;
  }
  function addBot(d, fromHist) {
    var b = el("div", "ag-msg ag-bot"), bub = el("div", "ag-bubble");
    if (!d.ok) { bub.classList.add("err"); bub.appendChild(el("p", null, d.text || errText(d))); if (!fromHist && st.last) { var r = el("button", "ag-retry", "إعادة المحاولة"); r.type = "button"; r.addEventListener("click", function () { b.remove(); send(st.last.q, st.last.mode, true); }); bub.appendChild(r); } }
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
    w.appendChild(el("p", null, "أنا المرشد الذكي. أجيب من محاضراتك التي فتحتها في «اكتب وظلّل» ومن بيانات قسمك، وأختبرك وألخّص لك."));
    thread.appendChild(w);
    st.hist.forEach(function (m) { if (m.u) addUser(m.u); if (m.d) addBot(m.d, true); });
  }

  /* ---------- الإرسال ---------- */
  function setBusy(v) { st.busy = v; sendBtn.disabled = v; input.disabled = v; }
  function send(text, mode, isRetry) {
    mode = mode || st.mode; text = String(text == null ? input.value : text).trim();
    if (st.busy) return;
    if (!text && mode !== "quiz" && mode !== "mindmap") return;
    var q = text || (mode === "quiz" ? "اختبرني من هذه المحاضرة" : "خريطة ذهنية لهذه المحاضرة");
    st.last = { q: q, mode: mode };
    if (!isRetry) { addUser(q); input.value = ""; autosize(); }
    var typing = el("div", "ag-msg ag-bot"); var tb = el("div", "ag-bubble ag-typing"); tb.appendChild(el("span")); tb.appendChild(el("span")); tb.appendChild(el("span")); typing.appendChild(tb); thread.appendChild(typing); scroll();
    setBusy(true);
    var body = { task: mode, question: q };
    if (docSel.value && mode !== "advisor") body.documentId = docSel.value;
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
    st.mode = id;
    var m = MODES.filter(function (x) { return x.id === id; })[0];
    modeBtns.forEach(function (b) { b.setAttribute("aria-selected", String(b.dataset.mode === id)); });
    var g = !!m.grades;
    thread.hidden = g; chipsBox.hidden = g; foot.hidden = g; gradesBox.hidden = !g;
    if (g) { loadGrades(); return; }
    input.placeholder = m.ph;
    docSel.hidden = id === "advisor" || st.docs.length === 0;
    chipsBox.textContent = "";
    m.chips.forEach(function (c) { var b = el("button", "ag-chip", c); b.type = "button"; b.addEventListener("click", function () { send(c, id); }); chipsBox.appendChild(b); });
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
    var clr = el("button", "ag-tool", "مسح"); clr.type = "button"; clr.title = "مسح المحادثة"; clr.addEventListener("click", function () { st.hist = []; saveHist(); welcome(); }); head.appendChild(clr);
    var x = el("button", "ag-x", "×"); x.type = "button"; x.setAttribute("aria-label", "إغلاق"); x.addEventListener("click", close); head.appendChild(x);
    dlg.appendChild(head);
    var tabs = el("div", "ag-tabs"); tabs.setAttribute("role", "tablist");
    MODES.forEach(function (m) { var b = el("button", "ag-tab", m.label); b.type = "button"; b.setAttribute("role", "tab"); b.dataset.mode = m.id; b.addEventListener("click", function () { setMode(m.id); input.focus(); }); tabs.appendChild(b); modeBtns.push(b); });
    dlg.appendChild(tabs);
    thread = el("div", "ag-thread"); thread.setAttribute("aria-live", "polite"); dlg.appendChild(thread);
    gradesBox = buildGrades(); dlg.appendChild(gradesBox);
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

  function open(ev) {
    if (ev && ev.preventDefault) ev.preventDefault();
    build(); opener = document.activeElement;
    root.hidden = false; document.documentElement.classList.add("ag-lock");
    setTimeout(function () { try { input.focus(); } catch (e) { /* لا شيء */ } }, 50);
    req("me").then(function (d) {
      if (d.status === 401) { gate(); whoEl.textContent = ""; return; }
      if (!d.ok) { addBot({ ok: false, text: errText(d) }); return; }
      st.me = d.principal; input.disabled = false; sendBtn.disabled = false;
      whoEl.textContent = st.me.department ? [st.me.college, st.me.department].filter(Boolean).join(" — ") : "لم تختر قسمك بعد";
      quota(d.quota);
      return req("documents").then(function (r) {
        st.docs = r.items || [];
        while (docSel.options.length > 1) docSel.remove(1);
        st.docs.forEach(function (x) { var o = el("option", null, x.title + " (" + x.page_count + " صفحة)"); o.value = x.id; docSel.appendChild(o); });
        setMode(st.mode);
        if (!st.docs.length && !st.hist.length) { var tip = el("p", "ag-tip", "نصيحة: افتح أي ملف PDF من صفحة المادة في «اكتب وظلّل» ليُضاف إلى محاضراتك، فأجيبك منه مع رقم الصفحة. وبدون ملفات يمكنك سؤالي عن قسمك من «دليل القسم»."); thread.appendChild(tip); }
      });
    }).catch(function () { addBot({ ok: false }); });
  }
  function close() {
    if (!root) return; root.hidden = true; document.documentElement.classList.remove("ag-lock");
    try { if (opener && opener.focus) opener.focus(); } catch (e) { /* لا شيء */ }
  }

  document.addEventListener("click", function (e) {
    var t = e.target.closest ? e.target.closest("[data-open-guide]") : null;
    if (t) open(e);
  });
  window.IQGuide = { open: open, close: close };
  if (/[?&]guide=1\b/.test(location.search)) document.addEventListener("DOMContentLoaded", function () { open(); });
})();
