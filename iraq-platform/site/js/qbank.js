/* qbank.js — واجهة الطالب لبنك الأسئلة: تدريب، امتحان، بطاقات، نتائج ومراجعة. تصحيح الإجابات كله على الخادم. */
(function () {
  "use strict";
  var h = QB.h, api = QB.api, app = document.getElementById("app"), titleEl = document.getElementById("title"), timerEl = document.getElementById("timer"), backEl = document.getElementById("back");
  var cleanup = null;
  function setTitle(t, back) { titleEl.textContent = t; document.title = t + " | دفعتنا"; backEl.setAttribute("href", back || "platform.html"); }
  function show(node) { QB.mount(app, node); window.scrollTo(0, 0); }
  function skeleton() { show(h("div", { class: "qb-stack" }, [1, 2, 3].map(function () { return h("div", { class: "qb-skel" }); }))); }
  function fail(e, retry) {
    var msg = QB.errText(e);
    if (e && e.status === 401) { show(h("div", { class: "qb-empty" }, h("strong", { text: "سجّل الدخول للمتابعة" }), h("a", { class: "qb-btn qb-btn-primary", href: "login.html?next=qbank.html", text: "تسجيل الدخول" }))); return; }
    if (e && (e.status === 404 && !e.code || e.code === "qb_not_migrated")) { show(h("div", { class: "qb-empty" }, h("strong", { text: "بنك الأسئلة غير مفعّل بعد" }), "سيُفتح لطلاب جامعتك قريباً.", h("div", null, h("a", { class: "qb-btn", href: "platform.html", text: "العودة للمنصة" })))); return; }
    show(h("div", { class: "qb-empty" }, h("strong", { text: msg }), retry ? h("button", { type: "button", class: "qb-btn", text: "إعادة المحاولة", onclick: retry }) : null));
  }

  /* ---------- التوجيه ---------- */
  function route() {
    if (cleanup) { cleanup(); cleanup = null; }
    timerEl.hidden = true; document.body.style.paddingBottom = "";
    var p = (location.hash.replace(/^#\/?/, "") || "").split("?")[0].split("/");
    skeleton();
    if (!p[0]) return home();
    if (p[0] === "subject" && p[1]) return subject(+p[1], p[2]);
    if (p[0] === "run" && p[1]) return run(p[1]);
    if (p[0] === "result" && p[1]) return result(p[1]);
    if (p[0] === "cards" && p[1]) return cards(+p[1]);
    location.hash = "#/";
  }
  window.addEventListener("hashchange", route);

  /* ---------- الرئيسية ---------- */
  function home() {
    setTitle("بنك الأسئلة");
    Promise.all([api("GET", "subjects"), api("GET", "me/stats").catch(function () { return null; }), api("GET", "me/last").catch(function () { return { last: null }; })]).then(function (r) {
      var subs = r[0].subjects, st = r[1], last = r[2].last, node = h("div", { class: "qb-stack" });
      if (last && last.status === "in_progress") node.appendChild(h("a", { class: "qb-card", href: "#/run/" + last.id }, h("h3", { text: "لديك محاولة غير مكتملة" }), h("p", { class: "qb-muted", text: (last.title || "تدريب ذكي") + " — تابع من حيث توقفت" })));
      if (st && st.answered) node.appendChild(h("div", { class: "qb-card" }, h("h3", { text: "إنجازك" }), h("div", { class: "qb-stats" },
        stat(st.answered, "سؤال أجبت عنه"), stat(st.accuracy + "%", "نسبة الصحة"), stat(st.attempts, "اختبار"), stat(st.wrong_pending, "أخطاء للمراجعة"), stat(st.cards_due, "بطاقات مستحقة")),
        st.weak_categories && st.weak_categories.length ? h("p", { class: "qb-muted", text: "محاور تحتاج مراجعة: " + st.weak_categories.map(function (c) { return c.name; }).join("، ") }) : null));
      node.appendChild(h("h2", { class: "qb-h", text: "المواد" }));
      if (!subs.length) node.appendChild(h("div", { class: "qb-empty" }, h("strong", { text: "لا توجد أسئلة منشورة بعد" }), "عندما ينشر ممثل قسمك أسئلة ستجدها هنا."));
      else node.appendChild(h("div", { class: "qb-grid" }, subs.map(function (s) { return h("a", { class: "qb-card", href: "#/subject/" + s.id }, h("h3", { text: s.name_ar }), h("p", { class: "qb-muted", text: s.questions + " سؤال" + (s.quizzes ? " · " + s.quizzes + " اختبار" : "") })); })));
      show(node);
    }).catch(function (e) { fail(e, route); });
  }
  function stat(v, l) { return h("div", { class: "qb-stat" }, h("b", { text: String(v) }), h("span", { text: l })); }

  /* ---------- صفحة المادة ---------- */
  function subject(id, tab) {
    api("GET", "subject/" + id).then(function (d) {
      setTitle(d.subject.name_ar, "#/");
      tab = tab || "smart";
      var tabs = [["smart", "تدريب ذكي"], ["quizzes", "الاختبارات"], ["cards", "بطاقات"], ["review", "مراجعة"], ["saved", "المحفوظة"]];
      var body = h("div", { class: "qb-stack" });
      var bar = h("div", { class: "qb-tabs", role: "tablist" }, tabs.map(function (t) { return h("button", { type: "button", role: "tab", class: "qb-tab", "aria-selected": String(t[0] === tab), text: t[1], onclick: function () { history.replaceState(null, "", "#/subject/" + id + "/" + t[0]); subject(id, t[0]); } }); }));
      show(h("div", null, bar, h("div", { style: "height:16px" }), body));
      if (tab === "smart") smartTab(body, id, d);
      else if (tab === "quizzes") quizzesTab(body, d);
      else if (tab === "cards") body.appendChild(h("div", { class: "qb-card" }, h("h3", { text: "بطاقات المراجعة المتباعدة" }), h("p", { class: "qb-muted", text: d.cards_due ? d.cards_due + " بطاقة مستحقة اليوم" : "ابدأ بطاقات جديدة؛ ستعود إليك الأسئلة في الأوقات المناسبة للحفظ." }), h("a", { class: "qb-btn qb-btn-primary", href: "#/cards/" + id, text: "ابدأ البطاقات" })));
      else if (tab === "review") reviewTab(body, id);
      else savedTab(body, id);
    }).catch(function (e) { fail(e, route); });
  }

  function chips(options, selected, multi, onChange) {
    var wrap = h("div", { class: "qb-chips" });
    function draw() {
      QB.clear(wrap);
      options.forEach(function (o) {
        var on = multi ? selected.indexOf(o[0]) >= 0 : selected[0] === o[0];
        wrap.appendChild(h("button", { type: "button", class: "qb-chip-btn", "aria-pressed": String(on), text: o[1], onclick: function () {
          if (multi) { var i = selected.indexOf(o[0]); if (i >= 0) selected.splice(i, 1); else selected.push(o[0]); } else { selected[0] = o[0]; }
          draw(); if (onChange) onChange();
        } }));
      });
    }
    draw(); return wrap;
  }

  function smartTab(body, sid, d) {
    var st = { count: [10], mode: ["practice"], filter: ["all"], diff: [], types: [], lectures: [], cats: [], duration: [0] };
    var total = d.types.reduce(function (s, t) { return s + t.n; }, 0);
    var typesAvail = [];
    d.types.forEach(function (t) { if (typesAvail.indexOf(t.type) < 0) typesAvail.push(t.type); });
    var msg = h("p", { class: "qb-banner", hidden: true });
    var go = h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "ابدأ", onclick: start });
    if (!total) { body.appendChild(h("div", { class: "qb-empty" }, h("strong", { text: "لا توجد أسئلة منشورة لهذه المادة بعد" }))); return; }
    body.appendChild(h("div", { class: "qb-card qb-stack" },
      h("h3", { text: "ابنِ تدريبك" }), h("p", { class: "qb-muted", text: total + " سؤال متاح. يُختار لك بلا تكرار." }),
      lab("عدد الأسئلة", chips([[5, "5"], [10, "10"], [20, "20"], [40, "40"]], st.count, false)),
      lab("الوضع", chips([["practice", "تدريب (شرح فوري)"], ["exam", "امتحان (بلا إجابات حتى النهاية)"]], st.mode, false, function () { dur.hidden = st.mode[0] !== "exam"; })),
      lab("الأسئلة", chips([["all", "الكل"], ["new", "الجديدة فقط"], ["wrong", "أخطائي"], ["bookmarked", "المحفوظة"], ["unfinished", "غير المجابة سابقاً"]], st.filter, false)),
      h("details", { class: "qb-more" }, h("summary", { text: "خيارات متقدمة" }), h("div", { class: "qb-stack" },
        lab("الصعوبة", chips([[1, "سهل"], [2, "متوسط"], [3, "صعب"]], st.diff, true)),
        typesAvail.length > 1 ? lab("نوع السؤال", chips(typesAvail.map(function (t) { return [t, QB.TYPE_SHORT[t] || t]; }), st.types, true)) : null,
        d.lectures.filter(function (l) { return l.questions; }).length ? lab("المحاضرات", chips(d.lectures.filter(function (l) { return l.questions; }).map(function (l) { return [l.id, l.number + ". " + l.title + " (" + l.questions + ")"]; }), st.lectures, true)) : null,
        d.categories.filter(function (c) { return c.questions; }).length ? lab("المحاور", chips(d.categories.filter(function (c) { return c.questions; }).map(function (c) { return [c.id, c.name + " (" + c.questions + ")"]; }), st.cats, true)) : null)),
      (dur = lab("مدة الامتحان", chips([[0, "بلا مؤقت"], [15, "15 دقيقة"], [30, "30 دقيقة"], [60, "60 دقيقة"]], st.duration, false))), msg, go));
    var dur; dur.hidden = true;
    function lab(t, c) { return h("div", null, h("div", { class: "qb-label", text: t }), c); }
    function start() {
      go.disabled = true; msg.hidden = true;
      var smart = { subject_id: sid, count: st.count[0], mode: st.mode[0], filter: st.filter[0] };
      if (st.diff.length) smart.difficulty = st.diff; if (st.types.length) smart.types = st.types; if (st.lectures.length) smart.lectures = st.lectures; if (st.cats.length) smart.categories = st.cats;
      if (st.mode[0] === "exam" && st.duration[0]) smart.duration_min = st.duration[0];
      api("POST", "attempts", { smart: smart }).then(function (r) { location.hash = "#/run/" + r.attempt.id; }).catch(function (e) { go.disabled = false; msg.hidden = false; msg.textContent = QB.errText(e); });
    }
  }

  function quizzesTab(body, d) {
    if (!d.quizzes.length) { body.appendChild(h("div", { class: "qb-empty" }, h("strong", { text: "لا توجد اختبارات منشورة" }), "سيضيف ممثل القسم اختبارات هنا.")); return; }
    d.quizzes.forEach(function (z) {
      var open = z.status === "published", left = z.attempts_allowed > 0 ? Math.max(0, z.attempts_allowed - z.used) : null;
      var action;
      if (z.status === "scheduled") action = h("span", { class: "qb-badge mid", text: "يفتح " + QB.fmtDate(z.starts_at) });
      else if (z.status === "closed") action = h("span", { class: "qb-badge none", text: "مغلق" });
      else if (left === 0) action = h("span", { class: "qb-badge none", text: "استُنفدت المحاولات" });
      else action = h("button", { type: "button", class: "qb-btn qb-btn-primary", text: z.used ? "ابدأ محاولة جديدة / أكمل" : "ابدأ", onclick: function (ev) { ev.target.disabled = true; api("POST", "attempts", { quiz_id: z.id }).then(function (r) { location.hash = "#/run/" + r.attempt.id; }).catch(function (e) { ev.target.disabled = false; QB.toast(QB.errText(e), "bad"); }); } });
      body.appendChild(h("div", { class: "qb-card" }, h("div", { class: "qb-row between" }, h("h3", { text: z.title }), h("span", { class: "qb-chip", text: z.mode === "exam" ? "امتحان" : "تدريب" })),
        z.description ? h("p", { class: "qb-muted", text: z.description }) : null,
        h("p", { class: "qb-muted", text: z.question_count + " سؤال" + (z.duration_sec ? " · " + Math.round(z.duration_sec / 60) + " دقيقة" : "") + (left !== null ? " · المحاولات المتبقية " + left : "") + (z.ends_at ? " · ينتهي " + QB.fmtDate(z.ends_at) : "") }), action));
    });
    api("GET", "me/attempts").then(function (r) {
      var mine = r.attempts.filter(function (a) { return a.status !== "in_progress" && a.title; }).slice(0, 8);
      if (!mine.length) return;
      body.appendChild(h("h2", { class: "qb-h", text: "محاولاتي السابقة" }));
      mine.forEach(function (a) { body.appendChild(h("a", { class: "qb-card", href: "#/result/" + a.id }, h("div", { class: "qb-row between" }, h("strong", { text: a.title }), h("span", { class: "qb-badge " + (a.final ? "ok" : "mid"), text: a.final ? Math.round(a.percent) + "%" : "بانتظار التصحيح" })), h("span", { class: "qb-muted", text: QB.fmtDate(a.submitted_at) }))); });
    }).catch(function () {});
  }

  function reviewTab(body, sid) {
    var items = [["wrong", "أخطائي", "أعد حل الأسئلة التي أخطأت فيها"], ["unfinished", "غير المجابة", "أسئلة تركتها بلا إجابة"], ["bookmarked", "المحفوظة", "أسئلتك المحفوظة"]];
    items.forEach(function (it) { body.appendChild(h("button", { type: "button", class: "qb-card", onclick: function () { api("POST", "attempts", { smart: { subject_id: sid, count: 20, mode: "practice", filter: it[0] } }).then(function (r) { location.hash = "#/run/" + r.attempt.id; }).catch(function (e) { QB.toast(e.code === "no_matching_questions" ? "لا توجد أسئلة في هذه القائمة الآن." : QB.errText(e), e.code === "no_matching_questions" ? "" : "bad"); }); } }, h("h3", { text: it[1] }), h("p", { class: "qb-muted", text: it[2] }))); });
  }
  function savedTab(body, sid) {
    api("GET", "bookmarks?subject=" + sid).then(function (r) {
      if (!r.questions.length) { body.appendChild(h("div", { class: "qb-empty" }, h("strong", { text: "لا أسئلة محفوظة" }), "احفظ سؤالاً أثناء الحل بعلامة ☆ ليظهر هنا.")); return; }
      r.questions.forEach(function (q) { var card = h("div", { class: "qb-stack" }); card.appendChild(QB.renderQuestion(q, { locked: true })); card.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "إزالة من المحفوظة", onclick: function () { api("DELETE", "bookmarks/" + q.id).then(function () { card.remove(); }); } })); body.appendChild(card); });
    }).catch(function (e) { body.appendChild(h("p", { class: "qb-banner bad", text: QB.errText(e) })); });
  }

  /* ---------- مشغّل الاختبار ---------- */
  function run(id) {
    api("GET", "attempts/" + id).then(function (r) {
      if (r.attempt.status !== "in_progress") { location.replace("#/result/" + id); return; }
      runAttempt(r.attempt);
    }).catch(function (e) { fail(e, route); });
  }

  function runAttempt(att) {
    var practice = att.mode === "practice", items = att.items.map(function (it, i) { return Object.assign({ position: i + 1 }, it); });
    var answers = att.answers || {}, flags = new Set(att.flags || []), checked = {}, dirty = {}, flagsDirty = false, saving = false, saveTimer = null, offline = false, rev = att.rev;
    var offset = att.server_now - Date.now(), noBack = !practice && att.settings.allowBack === false, cur = 0, submitted = false;
    var official = !!att.settings.official && att.mode === "exam";
    setTitle(att.quiz ? att.quiz.title : "تدريب ذكي", "#/subject/" + (att.quiz && att.quiz.subject_id ? att.quiz.subject_id : ""));
    backEl.setAttribute("href", "#/");
    var saveEl = h("span", { class: "qb-save", text: "" });
    var wrap = h("div", { class: "qb-stack" }), foot = h("div", { class: "qb-foot" });
    document.body.appendChild(foot); document.body.style.paddingBottom = "76px";
    show(wrap);

    function visible() { return QBLogic.computeVisible(items, att.rules, byItem(), { disabled: official }); }
    function byItem() { var m = {}; items.forEach(function (i) { if (i.kind === "question" && Object.prototype.hasOwnProperty.call(answers, i.qid)) m[i.id] = answers[i.qid]; }); return m; }
    function steps() { var vis = visible(); return items.filter(function (i) { return vis.has(i.id); }); }
    // الخطوات: كل سؤال شاشة؛ العناصر غير السؤالية تُعرض قبل السؤال التالي لها.
    function pages() {
      var out = [], pending = [];
      steps().forEach(function (i) {
        if (i.kind === "question") { out.push({ pre: pending, q: i }); pending = []; }
        else if (i.kind === "pagebreak") { if (pending.length) { /* يبقى مع التالي */ } }
        else pending.push(i);
      });
      if (pending.length && out.length) out[out.length - 1].post = pending;
      return out;
    }
    function render() {
      var pg = pages(); if (cur >= pg.length) cur = Math.max(0, pg.length - 1);
      var page = pg[cur]; if (!page) { QB.mount(wrap, h("div", { class: "qb-empty", text: "لا أسئلة ظاهرة." })); return; }
      var q = page.q, locked = !!checked[q.qid] || submitted;
      var answeredCount = pg.filter(function (p) { return isAnswered(p.q.qid); }).length;
      QB.mount(wrap, [
        h("div", { class: "qb-run-bar" }, h("div", { class: "qb-row between" }, h("span", { class: "qb-muted", text: "السؤال " + (cur + 1) + " من " + pg.length }), saveEl),
          h("div", { class: "qb-progress", role: "progressbar", "aria-valuemin": "0", "aria-valuemax": String(pg.length), "aria-valuenow": String(answeredCount) }, h("i", { style: "width:" + Math.round(answeredCount / pg.length * 100) + "%" }))),
        page.pre.map(renderInfo),
        q.q.caseId && att.cases[q.q.caseId] ? QB.caseCard(att.cases[q.q.caseId]) : null,
        (function () {
          var holder = h("div", { class: "qb-stack" });
          var node = QB.renderQuestion(q.q, { answer: answers[q.qid], locked: locked, qnum: cur + 1, reveal: checked[q.qid] ? checked[q.qid].reveal : null, onChange: function (v) { setAnswer(q.qid, v); var dots = document.getElementById("qb-dots"); if (dots) drawDots(dots, pg); } });
          holder.appendChild(node);
          if (checked[q.qid]) { holder.appendChild(h("p", { class: "qb-banner " + (checked[q.qid].status === "correct" ? "ok" : checked[q.qid].status === "partial" ? "" : "bad"), text: checked[q.qid].status === "correct" ? "إجابة صحيحة" : checked[q.qid].status === "partial" ? "إجابة جزئية" : "إجابة غير صحيحة" })); var rb = QB.revealBlock(checked[q.qid].reveal, checked[q.qid].status); if (rb) holder.appendChild(rb); }
          holder.appendChild(h("div", { class: "qb-row" },
            h("button", { type: "button", class: "qb-btn qb-btn-sm", "aria-pressed": String(flags.has(q.qid)), text: flags.has(q.qid) ? "⚑ مُعلَّم للمراجعة" : "⚐ علّم للمراجعة", onclick: function () { if (flags.has(q.qid)) flags.delete(q.qid); else flags.add(q.qid); flagsDirty = true; scheduleSave(); render(); } }),
            practice ? h("button", { type: "button", class: "qb-btn qb-btn-sm", text: bm[q.qid] ? "★ محفوظ" : "☆ احفظ السؤال", onclick: function (ev) { toggleBm(q.qid, ev.target); } }) : null,
            practice ? h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "إبلاغ عن خطأ", onclick: function () { reportDialog(q.qid); } }) : null));
          return holder;
        })(),
        page.post ? page.post.map(renderInfo) : null,
        h("div", { id: "qb-dots", class: "qb-nav-dots", "aria-label": "التنقل بين الأسئلة" })
      ]);
      drawDots(document.getElementById("qb-dots"), pg);
      drawFoot(pg, q, locked);
    }
    var bm = {};
    function toggleBm(qid, btn) { var on = !bm[qid]; (on ? api("PUT", "bookmarks/" + qid, {}) : api("DELETE", "bookmarks/" + qid)).then(function () { bm[qid] = on; btn.textContent = on ? "★ محفوظ" : "☆ احفظ السؤال"; }).catch(function (e) { QB.toast(QB.errText(e), "bad"); }); }
    function renderInfo(i) {
      if (i.kind === "heading") return h("h2", { class: "qb-sect", text: i.content.text });
      if (i.kind === "text") return h("p", { class: "qb-card", text: i.content.text });
      if (i.kind === "image" || i.kind === "video") return QB.media([{ kind: i.kind === "video" ? "video" : "image", url: i.content.url, caption: i.content.caption }]);
      if (i.kind === "divider") return h("hr");
      return null;
    }
    function isAnswered(qid) { var a = answers[qid]; return !(a === undefined || a === null || a === "" || (Array.isArray(a) && !a.length) || (typeof a === "object" && !Array.isArray(a) && !Object.keys(a).length)); }
    function drawDots(el, pg) {
      if (!el) return; QB.clear(el);
      pg.forEach(function (p, i) { el.appendChild(h("button", { type: "button", class: "qb-dot" + (i === cur ? " current" : isAnswered(p.q.qid) ? " answered" : "") + (flags.has(p.q.qid) ? " flag" : ""), text: String(i + 1), disabled: noBack && i < cur, "aria-label": "السؤال " + (i + 1), onclick: function () { cur = i; render(); window.scrollTo(0, 0); } })); });
    }
    function drawFoot(pg, q, locked) {
      var last = cur === pg.length - 1;
      var kids = [];
      kids.push(h("button", { type: "button", class: "qb-btn", text: "السابق", disabled: cur === 0 || noBack, onclick: function () { cur--; render(); window.scrollTo(0, 0); } }));
      if (practice && !locked) kids.push(h("button", { type: "button", class: "qb-btn qb-btn-accent qb-grow", text: "تحقّق", disabled: !isAnswered(q.qid), onclick: function (ev) { ev.target.disabled = true; check(q); } }));
      else kids.push(h("span", { class: "qb-grow" }));
      kids.push(last ? h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "إنهاء وتسليم", onclick: finish }) : h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "التالي", onclick: function () { cur++; render(); window.scrollTo(0, 0); } }));
      QB.mount(foot, h("div", null, kids));
    }
    function setAnswer(qid, v) {
      if (v === null || v === undefined) delete answers[qid]; else answers[qid] = v;
      dirty[qid] = v === undefined ? null : v; scheduleSave();
      var pg = pages(); var page = pg[cur]; if (page) drawFoot(pg, page.q, !!checked[page.q.qid]);
      // قد تتغير الأسئلة الظاهرة بالمنطق الشرطي
      if (att.rules && att.rules.length && !official) { var n = pages().length; if (n !== pg.length) render(); }
    }
    function check(q) {
      api("POST", "attempts/" + att.id + "/check", { qid: q.qid, answer: answers[q.qid] }).then(function (r) { checked[q.qid] = { status: r.result.status, reveal: r.reveal }; delete dirty[q.qid]; render(); })
        .catch(function (e) { QB.toast(QB.errText(e), "bad"); render(); });
    }
    function reportDialog(qid) {
      var reason = h("select", { class: "qb-input", "aria-label": "السبب" }, [["wrong_answer", "الإجابة الصحيحة خاطئة"], ["typo", "خطأ إملائي"], ["unclear", "السؤال غير واضح"], ["outdated", "معلومة قديمة"], ["other", "أخرى"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
      var det = h("textarea", { class: "qb-input", rows: "3", maxlength: "1000", placeholder: "تفاصيل (اختياري)" });
      var ov = h("div", { class: "qb-overlay", onclick: function (e) { if (e.target === ov) ov.remove(); } }, h("div", { class: "qb-dialog" }, h("h3", { text: "إبلاغ عن مشكلة في السؤال" }), h("div", { class: "qb-stack" }, reason, det,
        h("div", { class: "qb-row end" }, h("button", { type: "button", class: "qb-btn", text: "إلغاء", onclick: function () { ov.remove(); } }), h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "إرسال", onclick: function () { api("POST", "reports", { question_id: +qid, reason: reason.value, details: det.value }).then(function () { ov.remove(); QB.toast("وصل بلاغك للمراجعين. شكراً.", "ok"); }).catch(function (e) { QB.toast(QB.errText(e), "bad"); }); } })))));
      document.body.appendChild(ov);
    }

    /* الحفظ التلقائي */
    function scheduleSave() { saveEl.textContent = "جارٍ الحفظ…"; saveEl.className = "qb-save"; clearTimeout(saveTimer); saveTimer = setTimeout(flush, 700); }
    function flush(keepalive) {
      if (saving && !keepalive) { saveTimer = setTimeout(flush, 500); return Promise.resolve(); }
      var keys = Object.keys(dirty); if (!keys.length && !flagsDirty) { saveEl.textContent = offline ? saveEl.textContent : "تم الحفظ"; return Promise.resolve(); }
      var send = {}; keys.forEach(function (k) { send[k] = dirty[k]; });
      var body = { answers: send, flags: Array.from(flags) }, wasFlags = flagsDirty; flagsDirty = false; saving = true;
      return api("PUT", "attempts/" + att.id + "/answers", body).then(function (r) {
        saving = false; offline = false; keys.forEach(function (k) { if (JSON.stringify(dirty[k]) === JSON.stringify(send[k])) delete dirty[k]; });
        saveEl.textContent = "تم الحفظ"; saveEl.className = "qb-save"; rev = r.rev;
        if (Object.keys(dirty).length) scheduleSave();
      }).catch(function (e) {
        saving = false; flagsDirty = flagsDirty || wasFlags;
        if (e.status === 409 || e.status === 404 || e.status === 403) { saveEl.textContent = "انتهت المحاولة"; saveEl.className = "qb-save err"; QB.toast("انتهت هذه المحاولة.", "bad"); if (!submitted) { submitted = true; setTimeout(function () { location.hash = "#/result/" + att.id; }, 1200); } return; }
        offline = true; saveEl.textContent = "غير محفوظ — سنعيد المحاولة"; saveEl.className = "qb-save err"; saveTimer = setTimeout(flush, 4000);
      });
    }
    function finish() {
      var pg = pages(), un = pg.filter(function (p) { return !isAnswered(p.q.qid); }).length, fl = flags.size;
      var text = (un ? "لديك " + un + " سؤال بلا إجابة. " : "") + (fl ? fl + " سؤال معلَّم للمراجعة. " : "") + "بعد التسليم لا يمكن تغيير الإجابات.";
      QB.confirm("تسليم الاختبار؟", text, "تسليم نهائي").then(function (ok) { if (ok) submit(); });
    }
    function submit() {
      if (submitted) return; submitted = true; clearInterval(tick);
      foot.querySelectorAll("button").forEach(function (b) { b.disabled = true; });
      var all = {}; Object.keys(dirty).forEach(function (k) { all[k] = dirty[k]; });
      api("POST", "attempts/" + att.id + "/submit", { answers: all }).then(function () { location.hash = "#/result/" + att.id; })
        .catch(function (e) { submitted = false; foot.querySelectorAll("button").forEach(function (b) { b.disabled = false; }); tick = setInterval(onTick, 500); QB.toast(QB.errText(e) + " حاول مجدداً.", "bad"); });
    }

    /* المؤقت: وقت الخادم هو المرجع */
    var tick, warned = false;
    function onTick() {
      if (!att.deadline_at) return;
      var left = Math.ceil((att.deadline_at - (Date.now() + offset)) / 1000);
      timerEl.hidden = false; timerEl.textContent = QB.fmtDur(Math.max(0, left)); timerEl.className = "qb-timer" + (left <= 60 ? " low" : "");
      if (left === 300 || left === 60) { if (!warned) { warned = true; QB.toast(left === 300 ? "تبقّت 5 دقائق" : "تبقّت دقيقة واحدة", ""); setTimeout(function () { warned = false; }, 1500); } }
      if (left <= 0 && !submitted) { QB.toast("انتهى الوقت: يتم التسليم تلقائياً", ""); submit(); }
    }
    if (att.deadline_at) { onTick(); tick = setInterval(onTick, 500); }
    var onHide = function () { if (document.visibilityState === "hidden") flush(true); };
    var onUnload = function (e) { if (Object.keys(dirty).length && !submitted) { flush(true); e.preventDefault(); e.returnValue = ""; } };
    document.addEventListener("visibilitychange", onHide); window.addEventListener("beforeunload", onUnload);
    window.addEventListener("online", function () { if (offline) flush(); });
    cleanup = function () { clearInterval(tick); clearTimeout(saveTimer); document.removeEventListener("visibilitychange", onHide); window.removeEventListener("beforeunload", onUnload); if (Object.keys(dirty).length && !submitted) flush(true); foot.remove(); document.body.style.paddingBottom = ""; timerEl.hidden = true; };
    render();
  }

  /* ---------- النتيجة والمراجعة ---------- */
  function result(id) {
    api("GET", "attempts/" + id + "/result").then(function (r) {
      var res = r.result; setTitle("النتيجة", "#/");
      if (res.hidden) { show(h("div", { class: "qb-empty" }, h("strong", { text: "تم تسليم الاختبار" }), res.message, h("div", null, h("a", { class: "qb-btn", href: "#/", text: "العودة" })))); return; }
      var node = h("div", { class: "qb-stack" });
      node.appendChild(h("div", { class: "qb-card qb-score" }, res.quiz ? h("h3", { text: res.quiz.title }) : h("h3", { text: "تدريب ذكي" }),
        h("div", { class: "qb-ring", style: "--p:" + Math.round(res.percent) }, h("span", { text: Math.round(res.percent) + "%" })),
        h("p", { text: res.score + " من " + res.max + " درجة" }),
        res.passed === true ? h("span", { class: "qb-badge ok", text: "ناجح" }) : res.passed === false ? h("span", { class: "qb-badge bad", text: "راسب" }) : null,
        res.note ? h("p", { class: "qb-banner", text: res.note }) : null));
      node.appendChild(h("div", { class: "qb-stats" }, stat(res.correct, "صحيحة"), stat(res.wrong, "خاطئة"), stat(res.partial || 0, "جزئية"), stat(res.unanswered, "بلا إجابة"), stat(QB.fmtDur(res.seconds), "الوقت"), stat(res.avgSeconds + "ث", "متوسط السؤال")));
      var bd = res.breakdown;
      if (bd) {
        if (bd.categories.length > 1 || (bd.categories[0] && bd.categories[0].name !== "بدون تصنيف")) node.appendChild(bars("الأداء حسب المحور", bd.categories));
        if (bd.difficulty.length) node.appendChild(bars("الأداء حسب الصعوبة", bd.difficulty));
        if (bd.strengths.length) node.appendChild(h("p", { class: "qb-banner ok", text: "نقاط القوة: " + bd.strengths.join("، ") }));
        if (bd.review.length) node.appendChild(h("p", { class: "qb-banner", text: "راجع: " + bd.review.join("، ") }));
      }
      if (res.review) {
        node.appendChild(h("h2", { class: "qb-h", text: "مراجعة الأسئلة" }));
        var filt = "all", listEl = h("div", { class: "qb-stack" });
        var ctl = h("div", { class: "qb-chips" }, [["all", "الكل"], ["wrong", "الخاطئة"], ["unanswered", "بلا إجابة"]].map(function (f) { return h("button", { type: "button", class: "qb-chip-btn", "aria-pressed": String(f[0] === filt), text: f[1], onclick: function (ev) { filt = f[0]; ctl.querySelectorAll("button").forEach(function (b) { b.setAttribute("aria-pressed", "false"); }); ev.target.setAttribute("aria-pressed", "true"); drawList(); } }); }));
        node.appendChild(ctl); node.appendChild(listEl);
        var drawList = function () {
          QB.clear(listEl);
          res.review.forEach(function (it, i) {
            if (filt === "wrong" && it.status !== "wrong" && it.status !== "partial") return; if (filt === "unanswered" && it.status !== "unanswered") return;
            var c = res.review && it.caseId ? null : null;
            listEl.appendChild(h("div", { class: "qb-stack" }, h("div", { class: "qb-row" }, QB.statusBadge(it.status), h("span", { class: "qb-muted", text: (it.score != null ? it.score : 0) + " / " + it.max })),
              QB.renderQuestion(it.question, { answer: it.answer, locked: true, qnum: i + 1, reveal: it.reveal }), QB.revealBlock(it.reveal, it.status)));
          });
          if (!listEl.firstChild) listEl.appendChild(h("div", { class: "qb-empty", text: "لا أسئلة في هذه القائمة." }));
        };
        drawList();
      }
      node.appendChild(h("div", { class: "qb-row" }, h("a", { class: "qb-btn qb-btn-primary", href: res.quiz && res.quiz.subject_id ? "#/subject/" + res.quiz.subject_id + "/quizzes" : "#/", text: "العودة إلى المادة" })));
      show(node);
    }).catch(function (e) { if (e.code === "not_submitted") { location.replace("#/run/" + id); return; } fail(e, route); });
  }
  function bars(title, rows) {
    return h("div", { class: "qb-card" }, h("h3", { text: title }), rows.map(function (r) { return h("div", { class: "qb-bar-row" }, h("span", { text: r.name }), h("div", { class: "qb-progress" }, h("i", { style: "width:" + r.percent + "%" })), h("span", { text: Math.round(r.percent) + "%" })); }));
  }

  /* ---------- البطاقات التعليمية ---------- */
  function cards(sid) {
    setTitle("بطاقات المراجعة", "#/subject/" + sid + "/cards");
    api("GET", "cards?subject=" + sid + "&limit=20").then(function (d) {
      var list = d.cards, i = 0, revealed = null, done = 0;
      if (!list.length) { show(h("div", { class: "qb-empty" }, h("strong", { text: "أنهيت كل البطاقات المستحقة" }), "سنذكّرك عندما تحين مراجعتها.", h("div", null, h("a", { class: "qb-btn", href: "#/subject/" + sid, text: "العودة" })))); return; }
      function draw() {
        if (i >= list.length) { show(h("div", { class: "qb-empty" }, h("strong", { text: "أحسنت! أنهيت " + done + " بطاقة" }), h("a", { class: "qb-btn qb-btn-primary", href: "#/subject/" + sid, text: "العودة إلى المادة" }))); return; }
        var c = list[i];
        var node = h("div", { class: "qb-stack" }, h("div", { class: "qb-progress" }, h("i", { style: "width:" + Math.round(i / list.length * 100) + "%" })),
          c.caseId && d.cases[c.caseId] ? QB.caseCard(d.cases[c.caseId]) : null,
          h("div", { class: "qb-card qb-flash" }, QB.renderQuestion(c, { locked: true, reveal: revealed ? revealed.reveal : null }), revealed ? QB.revealBlock(revealed.reveal, "correct") : null));
        if (!revealed) node.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "أظهر الإجابة", onclick: function (ev) { ev.target.disabled = true; api("POST", "cards/reveal", { question_id: +c.id }).then(function (r) { revealed = r; draw(); }).catch(function (e) { ev.target.disabled = false; QB.toast(QB.errText(e), "bad"); }); } }));
        else node.appendChild(h("div", { class: "qb-rate" }, [["again", "أعدها", "10 د"], ["hard", "صعبة", ""], ["good", "جيدة", ""], ["easy", "سهلة", ""]].map(function (r) { return h("button", { type: "button", class: "qb-btn", onclick: function () { api("POST", "cards/rate", { question_id: +c.id, rating: r[0] }).then(function () { done++; i++; revealed = null; draw(); }).catch(function (e) { QB.toast(QB.errText(e), "bad"); }); } }, r[1], r[2] ? h("small", { text: r[2] }) : null); })));
        show(node);
      }
      draw();
    }).catch(function (e) { fail(e, route); });
  }

  route();
})();
