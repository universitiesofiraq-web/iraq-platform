/* qbank-admin.js — صفحة إدارة بنك الأسئلة: اختيار المادة ثم تبويبات (أسئلة، اختبارات، حالات، تصنيفات، استيراد/تصدير، بلاغات، تصحيح، إحصاءات).
   كل الصلاحيات تُفرض على الخادم؛ هنا إخفاء ما لا يملكه المستخدم فقط. */
(function () {
  "use strict";
  var h = QB.h, api = QB.api, app = document.getElementById("app"), titleEl = document.getElementById("title"), backEl = document.getElementById("back");
  var me = null, ctxCache = {}, builder = null;
  var TABS = [["questions", "الأسئلة"], ["quizzes", "الاختبارات"], ["cases", "الحالات السريرية"], ["taxonomy", "التصنيفات والوسوم"], ["io", "استيراد وتصدير"], ["reports", "البلاغات"], ["grading", "التصحيح"], ["stats", "الإحصاءات"]];
  var qs = function (o) { var p = []; Object.keys(o).forEach(function (k) { if (o[k] !== "" && o[k] != null) p.push(encodeURIComponent(k) + "=" + encodeURIComponent(o[k])); }); return p.join("&"); };
  var fail = function (e) { QB.toast(QB.errText(e), "bad"); };

  /* ---------- التوجيه ---------- */
  function route() {
    if (builder) { builder.destroy && builder.destroy(); builder = null; }
    var p = (location.hash || "#/").replace(/^#\/?/, "").split("/").filter(Boolean);
    window.scrollTo(0, 0);
    if (!me) return;
    if (!p.length) return pickSubject();
    if (p[0] === "s" && p[1]) { var sid = Number(p[1]); return withSubject(sid).then(function (S) { if (!S) return; var a = p[2] || "questions";
      if (a === "q" && p[3] === "new") return questionPage(S, null, p[4]);
      if (a === "q" && p[3]) return questionPage(S, Number(p[3]));
      if (a === "quiz" && p[3]) return quizPage(S, Number(p[3]));
      return subjectPage(S, a); }); }
    location.hash = "#/";
  }
  window.addEventListener("hashchange", route);

  function withSubject(id) {
    var meS = me.subjects.filter(function (s) { return s.id === id; })[0];
    if (!meS) { QB.mount(app, h("div", { class: "qb-empty" }, h("p", { text: "لا تملك صلاحية على هذه المادة." }), h("a", { class: "qb-btn", href: "#/", text: "اختيار مادة" }))); return Promise.resolve(null); }
    if (ctxCache[id]) return Promise.resolve(ctxCache[id]);
    return Promise.all([api("GET", "subject/" + id), api("GET", "admin/cases?subject=" + id)]).then(function (r) {
      var S = { id: id, name: meS.name_ar, review: meS.level === "review", admin: me.admin, lectures: r[0].lectures || [], categories: r[0].categories || [], cases: r[1].cases || [] };
      ctxCache[id] = S; return S;
    }).catch(function (e) { fail(e); return null; });
  }
  function refreshCtx(id) { delete ctxCache[id]; return withSubject(id); }

  /* ---------- اختيار المادة ---------- */
  function pickSubject() {
    titleEl.textContent = "إدارة بنك الأسئلة"; backEl.href = "qbank.html";
    if (!me.subjects.length) return QB.mount(app, h("div", { class: "qb-empty" }, h("h2", { text: "لا توجد مواد تديرها" }), h("p", { class: "qb-muted", text: "تظهر هنا المواد التي يمنحك المشرف صلاحية الرفع أو التمثيل عليها." })));
    var q = h("input", { class: "qb-input", type: "search", placeholder: "ابحث عن مادة…", "aria-label": "بحث" }), grid = h("div", { class: "qb-grid" });
    function draw() { QB.clear(grid); var t = q.value.trim(); me.subjects.filter(function (s) { return !t || (s.name_ar + " " + (s.name_en || "")).indexOf(t) >= 0; }).forEach(function (s) { grid.appendChild(h("a", { class: "qb-card", href: "#/s/" + s.id + "/questions" }, h("h3", { text: s.name_ar }), h("span", { class: "qb-badge " + (s.level === "review" ? "ok" : "mid"), text: s.level === "review" ? "مراجعة ونشر" : "إدخال" }))); }); if (!grid.firstChild) grid.appendChild(h("p", { class: "qb-muted", text: "لا نتائج." })); }
    q.addEventListener("input", QB.debounce(draw, 150));
    QB.mount(app, h("div", { class: "qb-stack" }, h("h2", { class: "qb-h", text: "اختر المادة" }), q, grid)); draw();
  }

  /* ---------- صفحة المادة والتبويبات ---------- */
  function subjectPage(S, tab) {
    titleEl.textContent = S.name; backEl.href = "#/";
    var nav = h("nav", { class: "qa-sub", "aria-label": "أقسام الإدارة" }, TABS.filter(function (t) { return S.review || ["questions", "quizzes", "cases", "io"].indexOf(t[0]) >= 0; }).map(function (t) { return h("a", { href: "#/s/" + S.id + "/" + t[0], "aria-current": t[0] === tab ? "page" : null, text: t[1] }); }));
    var body = h("div", { class: "qb-stack" }, h("div", { class: "qb-skel" }));
    QB.mount(app, [nav, body]);
    var fn = { questions: tabQuestions, quizzes: tabQuizzes, cases: tabCases, taxonomy: tabTaxonomy, io: tabIO, reports: tabReports, grading: tabGrading, stats: tabStats }[tab] || tabQuestions;
    Promise.resolve(fn(S, body)).catch(function (e) { QB.mount(body, h("p", { class: "qb-banner bad", text: QB.errText(e) })); });
  }

  /* ---------- الأسئلة ---------- */
  var qState = {};
  function tabQuestions(S, body) {
    var st = qState[S.id] = qState[S.id] || { status: "", type: "", difficulty: "", lecture: "", category: "", q: "", mine: "", offset: 0 }, selected = new Set();
    var sel = function (key, opts, ph) { var s = h("select", { class: "qb-input", "aria-label": ph }, [h("option", { value: "", text: ph })].concat(opts.map(function (o) { return h("option", { value: String(o[0]), text: o[1], selected: String(st[key]) === String(o[0]) }); }))); s.addEventListener("change", function () { st[key] = s.value; st.offset = 0; load(); }); return s; };
    var search = h("input", { class: "qb-input", type: "search", placeholder: "بحث في نص السؤال…", "aria-label": "بحث", value: st.q, oninput: QB.debounce(function () { st.q = search.value; st.offset = 0; load(); }, 300) });
    var filters = h("div", { class: "qb-filters" }, search,
      sel("status", Object.keys(QB.STATUS).filter(function (k) { return ["draft", "pending", "approved", "published", "archived"].indexOf(k) >= 0; }).map(function (k) { return [k, QB.STATUS[k]]; }), "كل الحالات"),
      sel("type", Object.keys(QB.TYPE_NAMES).map(function (k) { return [k, QB.TYPE_NAMES[k]]; }), "كل الأنواع"),
      sel("difficulty", [[1, "سهل"], [2, "متوسط"], [3, "صعب"]], "كل الصعوبات"),
      sel("lecture", S.lectures.map(function (l) { return [l.id, l.number + ". " + l.title]; }), "كل المحاضرات"),
      sel("category", S.categories.map(function (c) { return [c.id, c.name]; }), "كل التصنيفات"),
      sel("mine", [["1", "أسئلتي فقط"]], "كل الكتّاب"));
    var list = h("div", { class: "qb-list" }), pager = h("div", { class: "qb-pager" }), bulk = h("div", { class: "qb-bulk", hidden: true }), count = h("span", { class: "qb-muted" });
    var newBtn = h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "+ سؤال جديد", onclick: function () { typePicker(function (t) { location.hash = "#/s/" + S.id + "/q/new/" + t; }); } });
    var dupBtn = S.review ? h("button", { type: "button", class: "qb-btn", text: "المكرّرات", onclick: function () { duplicatesDialog(S, load); } }) : null;
    QB.mount(body, [h("div", { class: "qb-row between" }, h("h2", { class: "qb-h", text: "بنك الأسئلة" }), h("div", { class: "qb-row" }, dupBtn, newBtn)), filters, bulk, count, list, pager]);

    function load() {
      selected = new Set(); renderBulk();
      api("GET", "admin/questions?" + qs({ subject: S.id, status: st.status, type: st.type, difficulty: st.difficulty, lecture: st.lecture, category: st.category, q: st.q, mine: st.mine, limit: 20, offset: st.offset })).then(function (r) {
        QB.clear(list); count.textContent = r.total + " سؤال";
        if (!r.questions.length) list.appendChild(h("div", { class: "qb-empty" }, h("p", { text: st.q || st.status || st.type || st.lecture || st.category ? "لا أسئلة مطابقة للتصفية." : "لا توجد أسئلة بعد. ابدأ بإضافة سؤال أو استيراد ملف." })));
        r.questions.forEach(function (q) {
          var chk = h("input", { type: "checkbox", "aria-label": "تحديد", onchange: function () { if (chk.checked) selected.add(q.id); else selected.delete(q.id); renderBulk(); } });
          list.appendChild(h("div", { class: "qb-list-item" }, chk, h("div", { class: "qb-grow" },
            h("p", { class: "qb-entry-text" }, h("a", { class: "qb-title", href: "#/s/" + S.id + "/q/" + q.id, text: String(q.content.text || "(بلا نص)").slice(0, 200) })),
            h("div", { class: "qb-meta" }, h("span", { class: "qb-chip", text: QB.TYPE_SHORT[q.type] || q.type }), h("span", { class: "qb-chip d" + q.difficulty, text: QB.DIFF[q.difficulty] }), h("span", { class: "qb-badge " + (q.status === "published" ? "ok" : q.status === "archived" ? "none" : "mid"), text: QB.STATUS[q.status] }),
              (q.tags || []).map(function (t) { return h("span", { class: "qb-chip on", text: "#" + t }); }),
              q.uses ? h("span", { text: "استُخدم " + q.uses + (q.accuracy != null ? " · صحة " + q.accuracy + "%" : "") }) : null,
              q.reports_open ? h("span", { class: "qb-badge bad", text: "بلاغ " + q.reports_open }) : null))));
        });
        QB.clear(pager);
        if (r.total > 20) { pager.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", disabled: st.offset <= 0, text: "السابق", onclick: function () { st.offset = Math.max(0, st.offset - 20); load(); } })); pager.appendChild(h("span", { class: "qb-muted", text: (st.offset + 1) + "–" + Math.min(r.total, st.offset + 20) + " من " + r.total })); pager.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", disabled: st.offset + 20 >= r.total, text: "التالي", onclick: function () { st.offset += 20; load(); } })); }
      }).catch(function (e) { QB.clear(list); list.appendChild(h("p", { class: "qb-banner bad", text: QB.errText(e) })); });
    }
    function renderBulk() {
      bulk.hidden = !selected.size; QB.clear(bulk); if (!selected.size) return;
      var ids = function () { return Array.from(selected); };
      var run = function (action, value, label) { api("POST", "admin/questions/bulk", { ids: ids(), action: action, value: value }).then(function (r) { var f = (r.failed || []).length; QB.toast((r.updated != null ? r.updated : ids().length - f) + " تم" + (f ? " — تعذّر " + f + " (غير مسموح)" : ""), f ? "" : "ok"); load(); }).catch(fail); };
      var mk = function (ph, opts, action) { var s = h("select", { class: "qb-input", "aria-label": ph }, [h("option", { value: "", text: ph })].concat(opts.map(function (o) { return h("option", { value: String(o[0]), text: o[1] }); }))); s.addEventListener("change", function () { if (s.value) run(action, action === "status" ? s.value : Number(s.value)); }); return s; };
      var stOpts = S.review ? [["approved", "اعتماد"], ["published", "نشر"], ["draft", "إرجاع لمسودة"], ["archived", "أرشفة"]] : [["pending", "إرسال للمراجعة"], ["draft", "إرجاع لمسودة"]];
      QB.mount(bulk, [h("strong", { text: selected.size + " محدد" }), mk("تغيير الحالة…", stOpts, "status"), mk("تصنيف…", S.categories.map(function (c) { return [c.id, c.name]; }), "category"), mk("محاضرة…", S.lectures.map(function (l) { return [l.id, l.number + ". " + l.title]; }), "lecture"), mk("صعوبة…", [[1, "سهل"], [2, "متوسط"], [3, "صعب"]], "difficulty"),
        h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "وسم +", onclick: function () { QB.prompt("إضافة وسم للمحدد", "الوسم").then(function (v) { if (v) run("tags_add", [v]); }); } }),
        h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "إلغاء", onclick: function () { selected = new Set(); [].forEach.call(list.querySelectorAll("input[type=checkbox]"), function (c) { c.checked = false; }); renderBulk(); } })]);
    }
    load();
  }
  function typePicker(cb) {
    var TY = QBEditor.TYPES, dlg = h("div", { class: "qb-overlay", onclick: function (e) { if (e.target === dlg) dlg.remove(); } }, h("div", { class: "qb-dialog qb-dialog-wide" }, h("h3", { text: "نوع السؤال" }),
      h("div", { class: "qb-grid" }, TY.map(function (t) { return h("button", { type: "button", class: "qb-card", onclick: function () { dlg.remove(); cb(t); } }, h("h3", { text: QB.TYPE_NAMES[t] })); })), h("div", { class: "qb-row end" }, h("button", { type: "button", class: "qb-btn", text: "إلغاء", onclick: function () { dlg.remove(); } }))));
    document.body.appendChild(dlg);
  }
  function duplicatesDialog(S, after) {
    api("GET", "admin/duplicates?subject=" + S.id).then(function (r) {
      var box = h("div", { class: "qb-stack" });
      if (!r.groups.length) box.appendChild(h("p", { class: "qb-muted", text: "لا توجد أسئلة مكرّرة." }));
      r.groups.forEach(function (g) {
        var keep = g.questions[0].id;
        var radios = g.questions.map(function (q, i) { var rd = h("input", { type: "radio", name: "keep" + g.questions[0].id, checked: i === 0, onchange: function () { keep = q.id; } }); return h("label", { class: "qb-check" }, rd, h("span", {}, h("b", { text: "#" + q.id + " " }), q.text.slice(0, 90), h("small", { class: "qb-muted", text: " — " + QB.STATUS[q.status] }))); });
        box.appendChild(h("div", { class: "qb-card" }, h("p", { class: "qb-hint", text: "اختر السؤال الذي يبقى؛ يُؤرشف الباقي وتُنقل استخداماته." }), radios, h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "دمج", onclick: function (ev) { var drop = g.questions.map(function (q) { return q.id; }).filter(function (i) { return i !== keep; }); QB.confirm("دمج " + (drop.length + 1) + " أسئلة؟", "يبقى #" + keep + " ويُؤرشف الباقي.", "دمج").then(function (ok) { if (ok) api("POST", "admin/merge", { keep_id: keep, merge_ids: drop }).then(function () { QB.toast("تم الدمج", "ok"); ev.target.closest(".qb-card").remove(); after(); }).catch(fail); }); } })));
      });
      var dlg = h("div", { class: "qb-overlay", onclick: function (e) { if (e.target === dlg) dlg.remove(); } }, h("div", { class: "qb-dialog qb-dialog-wide" }, h("h3", { text: "الأسئلة المكرّرة" }), box, h("div", { class: "qb-row end" }, h("button", { type: "button", class: "qb-btn", text: "إغلاق", onclick: function () { dlg.remove(); } }))));
      document.body.appendChild(dlg);
    }).catch(fail);
  }

  function questionPage(S, id, type) {
    titleEl.textContent = id ? "تعديل سؤال" : "سؤال جديد"; backEl.href = "#/s/" + S.id + "/questions";
    var host = h("div"); QB.mount(app, host);
    refreshCtx(S.id).then(function (S2) {
      QBEditor.open(host, { type: type, id: id, subject: S2, onSaved: function (qid, wasNew) { if (wasNew) history.replaceState(null, "", "#/s/" + S.id + "/q/" + qid); }, onClose: function () { location.hash = "#/s/" + S.id + "/questions"; } });
    });
  }

  /* ---------- الاختبارات ---------- */
  function tabQuizzes(S, body) {
    var list = h("div", { class: "qb-list" });
    QB.mount(body, [h("div", { class: "qb-row between" }, h("h2", { class: "qb-h", text: "الاختبارات" }), h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "+ اختبار جديد", onclick: function () { newQuizDialog(S); } })), list]);
    return api("GET", "admin/quizzes?subject=" + S.id).then(function (r) {
      if (!r.quizzes.length) list.appendChild(h("div", { class: "qb-empty" }, h("p", { text: "لا توجد اختبارات. أنشئ اختباراً وابنِه بالسحب والإفلات." })));
      r.quizzes.forEach(function (z) {
        list.appendChild(h("div", { class: "qb-list-item" }, h("div", { class: "qb-grow" }, h("p", { class: "qb-entry-text" }, h("a", { class: "qb-title", href: "#/s/" + S.id + "/quiz/" + z.id, text: z.title })),
          h("div", { class: "qb-meta" }, h("span", { class: "qb-badge " + (z.status === "published" ? "ok" : "mid"), text: QB.STATUS[z.status] || z.status }), h("span", { class: "qb-chip", text: z.mode === "exam" ? "امتحان" : "تدريب" }), h("span", { text: z.question_count + " سؤال" }), z.duration_sec ? h("span", { text: Math.round(z.duration_sec / 60) + " د" }) : null, z.attempts != null ? h("span", { text: z.attempts + " محاولة" }) : null, h("span", { text: "آخر تعديل " + QB.fmtDate(z.updated_at) }))),
          h("button", { type: "button", class: "qb-icon-btn", "aria-label": "حذف الاختبار", text: "🗑", onclick: function () { QB.confirm("حذف الاختبار «" + z.title + "»؟", "لا يمكن الحذف إن كانت له محاولات (أرشِفه بدلاً من ذلك).", "حذف", true).then(function (ok) { if (ok) api("DELETE", "admin/quiz/" + z.id).then(function () { QB.toast("تم الحذف", "ok"); route(); }).catch(fail); }); } })));
      });
    });
  }
  function newQuizDialog(S) {
    api("GET", "admin/templates").then(function (t) {
      var title = h("input", { class: "qb-input", type: "text", maxlength: "200", placeholder: "عنوان الاختبار", "aria-label": "العنوان" });
      var lec = h("select", { class: "qb-input", "aria-label": "المحاضرة" }, [h("option", { value: "", text: "كل المادة" })].concat(S.lectures.map(function (l) { return h("option", { value: String(l.id), text: l.number + ". " + l.title }); })));
      var tpl = h("select", { class: "qb-input", "aria-label": "القالب" }, [h("option", { value: "", text: "بلا قالب" })].concat(t.templates.map(function (x) { return h("option", { value: String(x.id), text: x.name }); })));
      var ok = h("button", { type: "submit", class: "qb-btn qb-btn-primary", text: "إنشاء وفتح المحرر" });
      var dlg = h("div", { class: "qb-overlay", onclick: function (e) { if (e.target === dlg) dlg.remove(); } }, h("form", { class: "qb-dialog", onsubmit: function (e) { e.preventDefault(); if (!title.value.trim()) return title.focus(); ok.disabled = true; var b = { subject_id: S.id, title: title.value.trim() }; if (lec.value) b.lecture_id = Number(lec.value); if (tpl.value) b.template_id = Number(tpl.value);
        api("POST", "admin/quizzes", b).then(function (r) { dlg.remove(); location.hash = "#/s/" + S.id + "/quiz/" + r.id; }).catch(function (er) { ok.disabled = false; fail(er); }); } },
        h("h3", { text: "اختبار جديد" }), h("div", { class: "qb-stack" }, h("label", { class: "qb-label" }, "العنوان", title), h("label", { class: "qb-label" }, "المحاضرة (اختياري)", lec), h("label", { class: "qb-label" }, "قالب الإعدادات", tpl)), h("div", { class: "qb-row end" }, h("button", { type: "button", class: "qb-btn", text: "إلغاء", onclick: function () { dlg.remove(); } }), ok)));
      document.body.appendChild(dlg); title.focus();
    }).catch(fail);
  }
  function quizPage(S, id) {
    titleEl.textContent = "محرر الاختبار"; backEl.href = "#/s/" + S.id + "/quizzes";
    var host = h("div"); QB.mount(app, host);
    refreshCtx(S.id).then(function (S2) { builder = {}; var b = QBBuilder; b.open(host, S2, id, function () { location.hash = "#/s/" + S.id + "/quizzes"; }).then(function () { builder = { destroy: b.destroy }; }); builder = { destroy: function () { b.destroy && b.destroy(); } }; });
  }

  /* ---------- الحالات السريرية ---------- */
  function tabCases(S, body) {
    var list = h("div", { class: "qb-list" });
    QB.mount(body, [h("div", { class: "qb-row between" }, h("h2", { class: "qb-h", text: "الحالات السريرية" }), h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "+ حالة جديدة", onclick: function () { caseDialog(S, null); } })), h("p", { class: "qb-hint", text: "الحالة نص سريري مشترك (قصة، فحص، علامات حيوية، مختبر) تُربط بعدة أسئلة وتظهر قبلها للطالب." }), list]);
    return refreshCtx(S.id).then(function (S2) {
      if (!S2.cases.length) list.appendChild(h("div", { class: "qb-empty" }, h("p", { text: "لا توجد حالات." })));
      S2.cases.forEach(function (c) { list.appendChild(h("div", { class: "qb-list-item" }, h("div", { class: "qb-grow" }, h("p", { class: "qb-entry-text" }, h("button", { type: "button", class: "qb-btn qb-btn-link qb-title", text: c.title, onclick: function () { caseDialog(S, c); } })), h("div", { class: "qb-meta" }, h("span", { class: "qb-badge " + (c.status === "published" ? "ok" : "mid"), text: QB.STATUS[c.status] || c.status }), h("span", { text: c.questions + " سؤال مرتبط" }))), h("button", { type: "button", class: "qb-icon-btn", "aria-label": "حذف", text: "🗑", onclick: function () { QB.confirm("حذف الحالة؟", "لا تُحذف إن كانت مرتبطة بأسئلة.", "حذف", true).then(function (ok) { if (ok) api("DELETE", "admin/cases/" + c.id).then(function () { QB.toast("تم الحذف", "ok"); route(); }).catch(fail); }); } }))); });
    });
  }
  function caseDialog(S, c) {
    var b = (c && c.body) || {}, f = {};
    var mkf = function (key, label, rows, val) { var t = h(rows ? "textarea" : "input", { class: "qb-input", rows: rows || null, type: rows ? null : "text", maxlength: "8000", value: val || "" }); f[key] = t; return h("label", { class: "qb-label" }, label, t); };
    var title = h("input", { class: "qb-input", type: "text", maxlength: "200", value: c ? c.title : "" });
    var lec = h("select", { class: "qb-input" }, [h("option", { value: "", text: "— كل المادة —" })].concat(S.lectures.map(function (l) { return h("option", { value: String(l.id), text: l.number + ". " + l.title, selected: c && c.lecture_id === l.id }); })));
    var status = h("select", { class: "qb-input", disabled: !S.review }, [["draft", "مسودة"], ["published", "منشورة"], ["archived", "مؤرشفة"]].map(function (o) { return h("option", { value: o[0], text: o[1], selected: c && c.status === o[0] }); }));
    var save = h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "حفظ", onclick: function () {
      var body = { history: f.history.value, exam: f.exam.value, vitals: f.vitals.value, labs: f.labs.value, diagnosis: f.diagnosis.value, text: f.text.value, images: b.images || [], labsTable: b.labsTable }; if (!title.value.trim()) return title.focus(); save.disabled = true;
      var p = c ? api("PUT", "admin/cases/" + c.id, { title: title.value, body: body, status: S.review ? status.value : undefined }) : api("POST", "admin/cases", { subject_id: S.id, title: title.value, lecture_id: lec.value ? Number(lec.value) : null, body: body }).then(function (r) { return S.review && status.value !== "draft" ? api("PUT", "admin/cases/" + r.id, { status: status.value }) : r; });
      p.then(function () { dlg.remove(); QB.toast("تم الحفظ", "ok"); route(); }).catch(function (e) { save.disabled = false; fail(e); }); } });
    var dlg = h("div", { class: "qb-overlay", onclick: function (e) { if (e.target === dlg) dlg.remove(); } }, h("div", { class: "qb-dialog qb-dialog-wide" }, h("h3", { text: c ? "تعديل الحالة" : "حالة جديدة" }), h("div", { class: "qb-stack" },
      h("label", { class: "qb-label" }, "العنوان", title), h("div", { class: "qb-grid2" }, c ? null : h("label", { class: "qb-label" }, "المحاضرة", lec), h("label", { class: "qb-label" }, "الحالة", status)),
      mkf("history", "القصة المرضية", 3, b.history), mkf("exam", "الفحص السريري", 3, b.exam), mkf("vitals", "العلامات الحيوية", 2, b.vitals), mkf("labs", "المختبر والتصوير (نص)", 3, b.labs), mkf("diagnosis", "التشخيص (يظهر بعد الإجابة إن رغبت)", 2, b.diagnosis), mkf("text", "نص إضافي", 3, b.text),
      h("p", { class: "qb-hint", text: "الصور والجداول: تُدار من محرر السؤال (روابط https فقط)." }), h("div", { class: "qb-row end" }, h("button", { type: "button", class: "qb-btn", text: "إلغاء", onclick: function () { dlg.remove(); } }), save))));
    document.body.appendChild(dlg); title.focus();
  }

  /* ---------- التصنيفات والوسوم ---------- */
  function tabTaxonomy(S, body) {
    var list = h("div", { class: "qb-list" }), tags = h("div", { class: "qb-row" });
    QB.mount(body, [h("div", { class: "qb-row between" }, h("h2", { class: "qb-h", text: "التصنيفات" }), h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "+ تصنيف", onclick: function () { QB.prompt("تصنيف جديد", "الاسم").then(function (n) { if (n) api("POST", "admin/categories", { subject_id: S.id, name: n }).then(function () { route(); }).catch(fail); }); } })), list, h("h2", { class: "qb-h", text: "الوسوم الأكثر استعمالاً" }), tags]);
    return Promise.all([api("GET", "admin/categories?subject=" + S.id), api("GET", "admin/tags")]).then(function (r) {
      delete ctxCache[S.id];
      if (!r[0].categories.length) list.appendChild(h("p", { class: "qb-muted", text: "لا توجد تصنيفات." }));
      r[0].categories.forEach(function (c) { list.appendChild(h("div", { class: "qb-list-item" }, h("div", { class: "qb-grow" }, h("strong", { text: c.name }), " ", h("span", { class: "qb-muted", text: c.questions + " سؤال" })),
        h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "إعادة تسمية", onclick: function () { QB.prompt("إعادة تسمية", "الاسم", c.name).then(function (n) { if (n) api("PUT", "admin/categories/" + c.id, { name: n }).then(route).catch(fail); }); } }),
        h("button", { type: "button", class: "qb-icon-btn", "aria-label": "حذف", text: "🗑", onclick: function () { QB.confirm("حذف التصنيف «" + c.name + "»؟", "لا يُحذف إن كان مستعملاً.", "حذف", true).then(function (ok) { if (ok) api("DELETE", "admin/categories/" + c.id).then(route).catch(fail); }); } }))); });
      if (!r[1].tags.length) tags.appendChild(h("span", { class: "qb-muted", text: "لا وسوم بعد." }));
      r[1].tags.forEach(function (t) { tags.appendChild(h("span", { class: "qb-chip on", text: "#" + t.name + " (" + t.n + ")" })); });
    });
  }

  /* ---------- استيراد وتصدير ---------- */
  function download(name, text, type) { var a = h("a", { href: URL.createObjectURL(new Blob([text], { type: type })), download: name }); document.body.appendChild(a); a.click(); setTimeout(function () { URL.revokeObjectURL(a.href); a.remove(); }, 500); }
  function csvEsc(v) { v = String(v == null ? "" : v); return /[",\n\r]/.test(v) ? '"' + v.replace(/"/g, '""') + '"' : v; }
  function parseCSV(t) {
    var rows = [], row = [], cur = "", q = false;
    t = t.replace(/^﻿/, "");
    for (var i = 0; i < t.length; i++) { var c = t[i];
      if (q) { if (c === '"') { if (t[i + 1] === '"') { cur += '"'; i++; } else q = false; } else cur += c; }
      else if (c === '"') q = true; else if (c === ",") { row.push(cur); cur = ""; } else if (c === "\n" || c === "\r") { if (c === "\r" && t[i + 1] === "\n") i++; row.push(cur); cur = ""; if (row.some(function (x) { return x !== ""; })) rows.push(row); row = []; } else cur += c; }
    row.push(cur); if (row.some(function (x) { return x !== ""; })) rows.push(row); return rows;
  }
  /* CSV: type,text,option1..option8,correct,explanation,points,difficulty,tags — للأنواع sba/mcq/mrq/tf/saq فقط. correct: رقم/أرقام الخيار (1،2) أو true/false أو الإجابات المقبولة مفصولة بـ | */
  function csvToItems(text) {
    var rows = parseCSV(text); if (rows.length < 2) throw new Error("الملف لا يحوي صفوفاً");
    var head = rows[0].map(function (x) { return x.trim().toLowerCase(); }), col = function (r, n) { var i = head.indexOf(n); return i < 0 ? "" : (r[i] || "").trim(); }, out = [];
    rows.slice(1).forEach(function (r, ri) {
      var type = col(r, "type").toLowerCase(), t = col(r, "text"); if (!type && !t) return;
      var c = { text: t, points: Number(col(r, "points")) || 1, explanation: col(r, "explanation") }, item = { type: type, content: c, difficulty: Number(col(r, "difficulty")) || 2, tags: col(r, "tags") ? col(r, "tags").split(/[|،;]/).map(function (x) { return x.trim(); }).filter(Boolean) : [] };
      var opts = []; for (var k = 1; k <= 8; k++) { var o = col(r, "option" + k); if (o) opts.push({ id: "o" + k, text: o }); }
      var cor = col(r, "correct");
      if (type === "sba" || type === "mcq") { c.options = opts; c.correct = "o" + (parseInt(cor, 10) || 0); }
      else if (type === "mrq") { c.options = opts; c.correct = cor.split(/[|,،;\s]+/).filter(Boolean).map(function (x) { return "o" + parseInt(x, 10); }); c.scoring = "partial"; }
      else if (type === "tf") c.correct = /^(true|صح|صحيح|1|t)$/i.test(cor);
      else if (type === "saq") c.accepted = cor.split("|").map(function (x) { return x.trim(); }).filter(Boolean);
      else item.needs_review = "نوع غير مدعوم في CSV: " + type;
      item.row = ri + 2; out.push(item);
    });
    return out;
  }
  /* GIFT مبسّط: اختيار من متعدد (=صحيح ~خطأ)، صح/خطأ ({T}/{F})، إجابة قصيرة (={جواب}). */
  function giftToItems(text) {
    var out = [], blocks = text.replace(/\r/g, "").replace(/^\s*\/\/.*$/gm, "").split(/\n\s*\n/);
    blocks.forEach(function (b, bi) {
      b = b.trim(); if (!b) return; b = b.replace(/^::.*?::/, "").replace(/^\[.*?\]/, "").trim();
      var m = b.match(/^([\s\S]*?)\{([\s\S]*)\}\s*$/); if (!m) return; var stem = m[1].trim(), ans = m[2].trim(), c = { text: stem, points: 1, explanation: "" };
      var fb = ans.match(/####([\s\S]*)$/); if (fb) { c.explanation = fb[1].trim(); ans = ans.replace(/####[\s\S]*$/, "").trim(); }
      if (/^(T|TRUE|F|FALSE)$/i.test(ans)) { out.push({ type: "tf", content: Object.assign(c, { correct: /^t/i.test(ans) }), row: bi + 1 }); return; }
      var parts = ans.split(/(?=[=~])/).map(function (x) { return x.trim(); }).filter(Boolean);
      var ok = parts.filter(function (p) { return p[0] === "="; }), bad = parts.filter(function (p) { return p[0] === "~"; });
      var strip = function (p) { return p.slice(1).replace(/#.*$/, "").trim(); };
      if (bad.length && ok.length === 1) { var opts = parts.map(function (p, i) { return { id: "o" + (i + 1), text: strip(p) }; }); c.options = opts; c.correct = "o" + (parts.indexOf(ok[0]) + 1); out.push({ type: "sba", content: c, row: bi + 1 }); }
      else if (!bad.length && ok.length) { c.accepted = ok.map(strip); out.push({ type: "saq", content: c, row: bi + 1 }); }
      else out.push({ type: "unsupported", content: c, needs_review: "صيغة GIFT غير مدعومة", row: bi + 1 });
    });
    return out;
  }
  function jsonToItems(text) { var d = JSON.parse(text), arr = Array.isArray(d) ? d : d.questions; if (!Array.isArray(arr)) throw new Error("لا توجد مصفوفة أسئلة"); return arr.map(function (q, i) { return { type: q.type, content: q.content || q, difficulty: q.difficulty, tags: q.tags, row: i + 1 }; }); }

  function tabIO(S, body) {
    var statusSel = h("select", { class: "qb-input", "aria-label": "الحالة" }, [["", "كل الحالات"], ["published", "المنشورة فقط"], ["draft", "المسودات"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
    var exp = h("div", { class: "qb-card qb-stack" }, h("h3", { text: "تصدير" }), h("div", { class: "qb-row" }, statusSel,
      h("button", { type: "button", class: "qb-btn", text: "JSON كامل", onclick: function () { api("GET", "admin/export?" + qs({ subject: S.id, status: statusSel.value })).then(function (r) { download("questions-" + S.id + ".json", JSON.stringify(r, null, 2), "application/json"); QB.toast("صُدّر " + r.count + " سؤال", "ok"); }).catch(fail); } }),
      h("button", { type: "button", class: "qb-btn", text: "CSV (للأنواع البسيطة)", onclick: function () { api("GET", "admin/export?" + qs({ subject: S.id, status: statusSel.value })).then(function (r) {
        var head = ["type", "text"].concat([1, 2, 3, 4, 5, 6].map(function (i) { return "option" + i; }), ["correct", "explanation", "points", "difficulty", "tags"]), rows = [head.join(",")], skipped = 0;
        r.questions.forEach(function (q) { var c = q.content, cor = "", o = c.options || []; if (q.type === "sba" || q.type === "mcq") cor = o.findIndex(function (x) { return x.id === c.correct; }) + 1; else if (q.type === "mrq") cor = o.map(function (x, i) { return c.correct.indexOf(x.id) >= 0 ? i + 1 : 0; }).filter(Boolean).join("|"); else if (q.type === "tf") cor = c.correct ? "true" : "false"; else if (q.type === "saq") cor = (c.accepted || []).join("|"); else { skipped++; return; }
          rows.push([q.type, c.text].concat([0, 1, 2, 3, 4, 5].map(function (i) { return o[i] ? o[i].text : ""; }), [cor, c.explanation || "", c.points || 1, q.difficulty, (q.tags || []).join("|")]).map(csvEsc).join(",")); });
        download("questions-" + S.id + ".csv", "﻿" + rows.join("\n"), "text/csv"); QB.toast("صُدّر " + (rows.length - 1) + " سؤال" + (skipped ? " (تخطّينا " + skipped + " من أنواع لا يدعمها CSV)" : ""), "ok"); }).catch(fail); } })),
      h("p", { class: "qb-hint", text: "الأنواع المعقدة (توصيل، ترتيب، EMQ، فراغات، مقالي، رقمي) تُصدَّر بصيغة JSON فقط." }));
    var file = h("input", { class: "qb-input", type: "file", accept: ".json,.csv,.txt,.gift", "aria-label": "ملف الاستيراد" }), out = h("div", { class: "qb-stack" });
    var lec = h("select", { class: "qb-input", "aria-label": "محاضرة" }, [h("option", { value: "", text: "بلا محاضرة" })].concat(S.lectures.map(function (l) { return h("option", { value: String(l.id), text: l.number + ". " + l.title }); })));
    var cat = h("select", { class: "qb-input", "aria-label": "تصنيف" }, [h("option", { value: "", text: "بلا تصنيف" })].concat(S.categories.map(function (c) { return h("option", { value: String(c.id), text: c.name }); })));
    file.addEventListener("change", function () {
      var f = file.files[0]; if (!f) return; if (f.size > 1400000) return QB.toast("الملف أكبر من 1.4 ميغابايت؛ قسّمه", "bad");
      var rd = new FileReader(); rd.onload = function () {
        var items; try { var name = f.name.toLowerCase(), t = String(rd.result); items = name.endsWith(".json") ? jsonToItems(t) : name.endsWith(".csv") ? csvToItems(t) : giftToItems(t); } catch (e) { return QB.mount(out, h("p", { class: "qb-banner bad", text: "تعذّر قراءة الملف: " + e.message })); }
        if (!items.length) return QB.mount(out, h("p", { class: "qb-banner bad", text: "لم نجد أسئلة في الملف." }));
        items = items.slice(0, 500);
        api("POST", "admin/import/preview", { subject_id: S.id, items: items }).then(function (p) {
          var okIdx = p.items.filter(function (i) { return i.ok && !i.duplicate_of && (i.duplicate_in_batch === null || i.duplicate_in_batch === undefined); }).map(function (i) { return i.index; });
          var commit = h("button", { type: "button", class: "qb-btn qb-btn-primary", disabled: !okIdx.length, text: "استيراد " + okIdx.length + " كمسودات", onclick: function () { commit.disabled = true; api("POST", "admin/import/commit", { subject_id: S.id, items: okIdx.map(function (i) { return items[i]; }), lecture_id: lec.value ? Number(lec.value) : null, category_id: cat.value ? Number(cat.value) : null }).then(function (r) { QB.toast("أُنشئت " + r.created + " مسودة — راجعها ثم انشرها", "ok"); QB.mount(out, h("p", { class: "qb-banner", text: "تم. الأسئلة المستوردة مسودات دائماً ولا تُنشر تلقائياً." })); }).catch(function (e) { commit.disabled = false; fail(e); }); } });
          QB.mount(out, [h("div", { class: "qb-stats" }, stat(p.total, "في الملف"), stat(p.valid, "صالح"), stat(p.invalid, "غير صالح"), stat(p.duplicates, "مكرّر")),
            h("div", { class: "qb-table-wrap" }, h("table", { class: "qb-mini-table" }, h("thead", {}, h("tr", {}, ["#", "النوع", "النص", "الحالة"].map(function (x) { return h("th", { text: x }); }))), h("tbody", {}, p.items.slice(0, 200).map(function (i) { var src = items[i.index] || {}; return h("tr", {}, h("td", { text: String(src.row || i.index + 1) }), h("td", { text: i.type || src.type || "—" }), h("td", { text: i.text || String((src.content || {}).text || "").slice(0, 100) }), h("td", {}, i.ok ? (i.duplicate_of ? h("span", { class: "qb-badge mid", text: "مكرر لـ #" + i.duplicate_of[0] + " (يُتخطّى)" }) : i.duplicate_in_batch != null ? h("span", { class: "qb-badge mid", text: "مكرر داخل الملف" }) : h("span", { class: "qb-badge ok", text: "جاهز" })) : h("span", { class: "qb-badge bad", text: (i.errors || ["غير صالح"]).join("، ").slice(0, 120) }))); })))),
            h("div", { class: "qb-grid2" }, h("label", { class: "qb-label" }, "محاضرة للأسئلة المستوردة", lec), h("label", { class: "qb-label" }, "تصنيف", cat)), commit]);
        }).catch(function (e) { QB.mount(out, h("p", { class: "qb-banner bad", text: QB.errText(e) })); });
      }; rd.readAsText(f, "utf-8");
    });
    var imp = h("div", { class: "qb-card qb-stack" }, h("h3", { text: "استيراد" }), h("p", { class: "qb-hint", text: "الصيغ المدعومة: JSON (تصدير المنصة أو مصفوفة أسئلة)، CSV (أعمدة: type,text,option1..option8,correct,explanation,points,difficulty,tags)، وGIFT المبسّط (اختيار من متعدد، صح/خطأ، إجابة قصيرة). لا نقبل Excel أو Word أو PDF أو QTI حالياً: صدّر ملفك إلى CSV من Excel. كل ما يُستورد مسودة ويمرّ بمعاينة وكشف تكرار." }), file, out);
    QB.mount(body, [h("h2", { class: "qb-h", text: "استيراد وتصدير" }), exp, imp]);
  }
  function stat(v, l) { return h("div", { class: "qb-stat" }, h("b", { text: String(v) }), h("span", { text: l })); }

  /* ---------- البلاغات ---------- */
  function tabReports(S, body) {
    var st = "open", list = h("div", { class: "qb-list" });
    var sel = h("select", { class: "qb-input", "aria-label": "الحالة", onchange: function () { st = sel.value; load(); } }, [["open", "مفتوحة"], ["resolved", "محلولة"], ["dismissed", "مرفوضة"]].map(function (o) { return h("option", { value: o[0], text: o[1] }); }));
    QB.mount(body, [h("h2", { class: "qb-h", text: "بلاغات الطلاب على الأسئلة" }), sel, list]);
    function load() { return api("GET", "admin/reports?" + qs({ subject: S.id, status: st })).then(function (r) { QB.clear(list); if (!r.reports.length) list.appendChild(h("div", { class: "qb-empty" }, h("p", { text: "لا بلاغات." })));
      r.reports.forEach(function (x) { list.appendChild(h("div", { class: "qb-list-item" }, h("div", { class: "qb-grow" }, h("p", { class: "qb-entry-text" }, h("a", { class: "qb-title", href: "#/s/" + S.id + "/q/" + x.question_id, text: x.text })), h("div", { class: "qb-meta" }, h("span", { class: "qb-badge bad", text: x.reason }), h("span", { text: QB.fmtDate(x.created_at) })), x.details ? h("p", { class: "qb-muted", text: x.details }) : null, x.note ? h("p", { class: "qb-hint", text: "ملاحظة: " + x.note }) : null),
        st === "open" ? [h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "تم الحل", onclick: function () { resolve(x, "resolved"); } }), h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "رفض", onclick: function () { resolve(x, "dismissed"); } })] : null)); }); }); }
    function resolve(x, to) { QB.prompt(to === "resolved" ? "ملاحظة الحل (اختياري)" : "سبب الرفض (اختياري)", "الملاحظة").then(function (n) { api("PUT", "admin/reports/" + x.id, { status: to, note: n || "" }).then(function () { QB.toast("تم", "ok"); load(); }).catch(fail); }); }
    return load();
  }

  /* ---------- التصحيح اليدوي ---------- */
  function tabGrading(S, body) {
    var host = h("div", { class: "qb-stack" });
    QB.mount(body, [h("h2", { class: "qb-h", text: "أسئلة بانتظار التصحيح اليدوي" }), host]);
    function list() {
      return api("GET", "admin/grading?subject=" + S.id).then(function (r) { QB.clear(host); if (!r.attempts.length) return host.appendChild(h("div", { class: "qb-empty" }, h("p", { text: "لا محاولات بانتظار التصحيح." })));
        r.attempts.forEach(function (a) { host.appendChild(h("div", { class: "qb-list-item" }, h("div", { class: "qb-grow" }, h("strong", { text: a.title }), h("div", { class: "qb-meta" }, h("span", { text: a.name || "طالب" }), h("span", { text: QB.fmtDate(a.submitted_at) }))), h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "تصحيح", onclick: function () { open(a.id); } }))); }); });
    }
    function open(id) {
      api("GET", "admin/attempt/" + id).then(function (r) {
        var inputs = {}, box = h("div", { class: "qb-stack" });
        r.pending.forEach(function (p) {
          var inp = h("input", { class: "qb-input", type: "number", min: "0", max: String(p.max), step: "0.25", dir: "ltr", "aria-label": "الدرجة من " + p.max }); inputs[p.qid] = inp;
          box.appendChild(h("div", { class: "qb-card qb-stack" }, h("p", { class: "qb-entry-text", text: p.text }), h("div", { class: "qb-card", style: null }, h("small", { class: "qb-muted", text: "إجابة الطالب:" }), h("p", { text: typeof p.answer === "string" ? (p.answer || "(بلا إجابة)") : JSON.stringify(p.answer) })),
            p.model_answers && p.model_answers.length ? h("p", { class: "qb-hint", text: "إجابة نموذجية: " + p.model_answers.join(" | ") }) : null, p.explanation ? h("p", { class: "qb-hint", text: "شرح: " + p.explanation }) : null, h("label", { class: "qb-label" }, "الدرجة (من " + p.max + ")", inp)));
        });
        var ok = h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "حفظ الدرجات", onclick: function () { var scores = {}; for (var k in inputs) { var v = inputs[k].value; if (v === "") return QB.toast("أدخل درجة لكل سؤال", "bad"); scores[k] = Number(v); } ok.disabled = true; api("POST", "admin/attempt/" + id + "/grade", { scores: scores }).then(function (res) { QB.toast("حُفظت. النتيجة النهائية " + res.percent + "%", "ok"); list(); }).catch(function (e) { ok.disabled = false; fail(e); }); } });
        QB.mount(host, [h("button", { type: "button", class: "qb-btn qb-btn-link", text: "← القائمة", onclick: list }), box, ok]);
      }).catch(fail);
    }
    return list();
  }

  /* ---------- الإحصاءات والسجل ---------- */
  function tabStats(S, body) {
    return Promise.all([api("GET", "admin/stats?subject=" + S.id), S.admin ? api("GET", "admin/audit?limit=60").catch(function () { return { audit: [] }; }) : Promise.resolve({ audit: [] })]).then(function (rr) {
      var s = rr[0], sum = function (a) { return a.reduce(function (x, y) { return x + y.n; }, 0); }, bars = function (title, rows, key, names) { var total = Math.max(1, sum(rows)); return h("div", { class: "qb-card qb-stack" }, h("h3", { text: title }), rows.length ? rows.map(function (r) { return h("div", { class: "qb-bar-row" }, h("span", { text: names[r[key]] || r[key] }), h("div", { class: "qb-progress" }, h("i", { style: "width:" + Math.round(r.n / total * 100) + "%" })), h("span", { text: String(r.n) })); }) : h("p", { class: "qb-muted", text: "—" })); };
      QB.mount(body, [h("h2", { class: "qb-h", text: "الإحصاءات" }), h("div", { class: "qb-stats" }, stat(sum(s.questions_by_status), "سؤال"), stat(s.open_reports, "بلاغ مفتوح"), stat(s.awaiting_grading, "بانتظار التصحيح"), stat(sum(s.quizzes_by_status), "اختبار")),
        h("div", { class: "qb-diff" }, bars("الأسئلة حسب الحالة", s.questions_by_status, "status", QB.STATUS), bars("حسب النوع", s.questions_by_type, "type", QB.TYPE_SHORT), bars("حسب الصعوبة", s.questions_by_difficulty, "difficulty", QB.DIFF), bars("الاختبارات حسب الحالة", s.quizzes_by_status, "status", QB.STATUS)),
        S.admin ? [h("h2", { class: "qb-h", text: "سجل العمليات (للمشرف)" }), h("div", { class: "qb-table-wrap" }, h("table", { class: "qb-mini-table" }, h("thead", {}, h("tr", {}, ["الوقت", "المنفّذ", "العملية", "التفصيل"].map(function (x) { return h("th", { text: x }); }))), h("tbody", {}, rr[1].audit.map(function (a) { return h("tr", {}, h("td", { text: QB.fmtDate(a.at) }), h("td", { text: a.actor || "#" + a.actor_id }), h("td", { text: a.action + " " + (a.entity || "") + (a.entity_id ? " #" + a.entity_id : "") }), h("td", { text: a.detail || "" })); }))))] : null]);
    });
  }

  /* ---------- البدء ---------- */
  api("GET", "admin/me").then(function (r) { me = r; route(); }).catch(function (e) {
    if (e.status === 401) return QB.mount(app, h("div", { class: "qb-empty" }, h("h2", { text: "سجّل الدخول أولاً" }), h("a", { class: "qb-btn qb-btn-primary", href: "login.html?next=" + encodeURIComponent("qbank-admin.html" + location.hash), text: "تسجيل الدخول" })));
    QB.mount(app, h("p", { class: "qb-banner bad", text: QB.errText(e) }));
  });
})();
