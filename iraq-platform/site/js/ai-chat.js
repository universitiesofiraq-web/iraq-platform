/* js/ai-chat.js — صندوق "اسأل عن هذه المحاضرة".
   يرسل السؤال إلى الـ Worker (SITE.aiEndpoint) ويعرض الجواب. لا يحفظ شيئاً غير عدّاد الأسئلة اليومي على هذا الجهاز.
   الاستخدام: AIChat.mount(عنصر, { endpoint: "https://...", lectureId: "medical-immunology-1" }) */
(function () {
  "use strict";
  var DAILY_LIMIT = 15;     // حد الأسئلة لكل جهاز في اليوم (حماية بسيطة للحصة المجانية)
  var KEY = "ms.ai";
  var LATIN = /([A-Za-z][A-Za-z0-9'’\-\/ ]*[A-Za-z0-9])/;

  function today() { return new Date().toISOString().slice(0, 10); }
  function used() {
    try { var v = JSON.parse(localStorage.getItem(KEY) || "{}"); return v.d === today() ? v.n : 0; } catch (e) { return 0; }
  }
  function bump() {
    try { localStorage.setItem(KEY, JSON.stringify({ d: today(), n: used() + 1 })); } catch (e) {}
  }
  var el = function (tag, cls, text) { return MS.el(tag, cls, text); };

  /* نص عادي ← عقد DOM: المصطلحات اللاتينية في عناصر مستقلة حتى لا يختلط الاتجاه */
  function plain(parent, text) {
    text.split(LATIN).forEach(function (part, i) {
      if (!part) return;
      if (i % 2) parent.appendChild(el("span", "en", part));
      else parent.appendChild(document.createTextNode(part));
    });
  }
  /* **غامق** + نص عادي، بلا innerHTML */
  function inline(parent, text) {
    text.split(/(\*\*[^*]+\*\*)/).forEach(function (seg) {
      if (!seg) return;
      if (/^\*\*[^*]+\*\*$/.test(seg)) {
        var s = el("strong");
        plain(s, seg.slice(2, -2));
        parent.appendChild(s);
      } else plain(parent, seg);
    });
  }
  /* تنسيق خفيف لجواب النموذج: عناوين وقوائم وغامق فقط */
  function render(box, text) {
    box.textContent = "";
    var list = null;
    text.split("\n").forEach(function (raw) {
      var line = raw.trim();
      if (!line || /^-{3,}$/.test(line)) { list = null; return; }
      var li = /^[*-]\s+(.*)$/.exec(line);
      if (li) {
        if (!list) { list = el("ul", "ai-list"); box.appendChild(list); }
        inline(list.appendChild(el("li")), li[1]);
        return;
      }
      list = null;
      var h = /^#{1,6}\s+(.*)$/.exec(line);
      var p = el("p", h ? "ai-h" : "ai-p");
      inline(p, h ? h[1] : line);
      box.appendChild(p);
    });
  }

  function mount(root, opts) {
    root.hidden = false;
    var card = el("div", "ai-card");
    card.appendChild(el("h2", "ai-title", "اسأل عن هذه المحاضرة"));
    card.appendChild(el("p", "ai-note", "الإجابات من نص المحاضرة، وقد تخطئ. راجع الملف للتأكد."));
    var log = el("div", "ai-log");
    log.setAttribute("aria-live", "polite");
    var form = el("form", "ai-form");
    var label = el("label", "ai-label", "اكتب سؤالك");
    var input = el("textarea", "field ai-input");
    input.rows = 2;
    input.maxLength = 500;
    input.id = "aiQuestion";
    label.htmlFor = "aiQuestion";
    var send = el("button", "btn btn-primary", "إرسال");
    send.type = "submit";
    form.appendChild(label);
    form.appendChild(input);
    form.appendChild(send);
    card.appendChild(log);
    card.appendChild(form);
    root.appendChild(card);

    function add(cls, text) {
      var m = el("div", "ai-msg " + cls);
      if (text) m.appendChild(document.createTextNode(text));
      log.appendChild(m);
      log.scrollTop = log.scrollHeight;
      return m;
    }
    function fail(m, text) { m.className = "ai-msg ai-err"; m.textContent = text; }

    form.addEventListener("submit", function (e) {
      e.preventDefault();
      var q = input.value.trim();
      if (!q) return;
      if (used() >= DAILY_LIMIT) { add("ai-err", "وصلت للحد اليومي من الأسئلة، عد غداً."); return; }
      add("ai-user").appendChild(document.createTextNode(q));
      input.value = "";
      send.disabled = true;
      var wait = add("ai-bot", "جارٍ التفكير…");
      fetch(opts.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body: JSON.stringify({ question: q, lectureId: opts.lectureId })
      })
        .then(function (r) { return r.json().then(function (j) { return { ok: r.ok, j: j }; }); })
        .then(function (res) {
          if (res.ok && res.j.answer) { render(wait, String(res.j.answer)); bump(); }
          else fail(wait, res.j.error || "حدث خطأ، حاول مرة أخرى.");
        })
        .catch(function () { fail(wait, "تعذر الاتصال، تحقق من الإنترنت."); })
        .then(function () { send.disabled = false; log.scrollTop = log.scrollHeight; });
    });
  }

  window.AIChat = { mount: mount };
})();
