/* qb-common.js — أدوات مشتركة لصفحات بنك الأسئلة (الطالب والمشرف): الشبكة، بناء DOM بلا HTML، الإشعارات، وعرض الأسئلة.
   كل نص يُكتب بـtextContent/createTextNode فقط (لا innerHTML بمحتوى قادم من قاعدة البيانات). */
(function (g) {
  "use strict";
  var QB = g.QB = g.QB || {};

  QB.TYPE_NAMES = { sba: "اختيار واحد (SBA)", mcq: "اختيار من متعدد", mrq: "عدة إجابات صحيحة", tf: "صح / خطأ", emq: "مطابقة موسّعة (EMQ)", saq: "إجابة قصيرة", essay: "مقالي", fill: "ملء الفراغات", matching: "توصيل", ordering: "ترتيب", numerical: "رقمي" };
  QB.TYPE_SHORT = { sba: "SBA", mcq: "MCQ", mrq: "MRQ", tf: "صح/خطأ", emq: "EMQ", saq: "قصير", essay: "مقالي", fill: "فراغات", matching: "توصيل", ordering: "ترتيب", numerical: "رقمي" };
  QB.DIFF = { 1: "سهل", 2: "متوسط", 3: "صعب" };
  QB.STATUS = { draft: "مسودة", pending: "بانتظار المراجعة", approved: "معتمد", published: "منشور", archived: "مؤرشف", scheduled: "مجدول", closed: "مغلق" };
  QB.ERRORS = {
    unauthorized: "سجّل الدخول أولاً.", forbidden: "ليست لديك صلاحية لهذا الإجراء.", not_found: "غير موجود.", rate_limited: "طلبات كثيرة، انتظر قليلاً.",
    qb_not_migrated: "بنك الأسئلة غير مفعّل على هذه البيئة بعد.", invalid_question: "بيانات السؤال غير صالحة.", transition_not_allowed: "هذا الانتقال بين الحالات غير مسموح.",
    questions_not_published: "في الاختبار أسئلة غير منشورة. انشرها أولاً.", quiz_has_no_questions: "الاختبار بلا أسئلة.", question_in_use: "السؤال مستخدم في اختبارات أو محاولات؛ أرشفه بدل الحذف.",
    quiz_in_use: "الاختبار له محاولات أو منشور؛ أرشفه بدل الحذف.", attempts_exhausted: "استنفدت عدد المحاولات المسموحة.", quiz_closed: "الاختبار مغلق.", quiz_not_open_yet: "الاختبار لم يفتح بعد.",
    no_matching_questions: "لا توجد أسئلة مطابقة لهذه الاختيارات.", closed: "انتهت هذه المحاولة.", invalid_rules: "قواعد المنطق الشرطي غير صالحة.", bad_origin: "تعذّر التحقق من مصدر الطلب.",
    case_not_published: "الحالة السريرية المرتبطة غير منشورة.", too_large: "الحجم أكبر من المسموح.", duplicate_question_in_quiz: "السؤال مكرر داخل الاختبار.", question_not_in_subject: "سؤال من مادة أخرى.", bad_json: "بيانات غير صالحة."
  };

  /* ---------- الشبكة ---------- */
  QB.api = function (method, path, body) {
    var opt = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) { opt.headers["content-type"] = "application/json"; opt.body = JSON.stringify(body); }
    return fetch("/api/qb/" + path, opt).then(function (r) {
      return r.json().catch(function () { return {}; }).then(function (d) {
        if (!r.ok) { var e = new Error((d && d.error) || "error"); e.status = r.status; e.code = d && d.error; e.data = d; throw e; }
        return d;
      });
    }, function () { var e = new Error("network"); e.status = 0; e.code = "network"; throw e; });
  };
  QB.errText = function (e) {
    if (!e) return "حدث خطأ.";
    if (e.status === 0) return "لا يوجد اتصال بالخادم.";
    if (e.status === 404 && !e.code) return "الخدمة غير متاحة على هذه البيئة.";
    if (e.code === "invalid_question" && e.data && e.data.details) return "السؤال غير صالح: " + e.data.details.slice(0, 3).join("، ");
    if (e.code === "invalid_rules" && e.data && e.data.details) return e.data.details.slice(0, 2).join("، ");
    return QB.ERRORS[e.code] || ("تعذّر التنفيذ (" + (e.code || e.status) + ")");
  };

  /* ---------- DOM ---------- */
  QB.h = function (tag, attrs) {
    var el = document.createElement(tag);
    if (attrs) for (var k in attrs) {
      var v = attrs[k];
      if (v === null || v === undefined || v === false) continue;
      if (k === "class") el.className = v;
      else if (k === "text") el.textContent = v;
      else if (k.slice(0, 2) === "on" && typeof v === "function") el.addEventListener(k.slice(2), v);
      else if (k === "dataset") for (var d in v) el.dataset[d] = v[d];
      else if (k === "value") el.value = v;
      else if (k === "checked" || k === "disabled" || k === "hidden" || k === "selected" || k === "required") { if (v) el.setAttribute(k, ""); el[k] = !!v; }
      else el.setAttribute(k, v === true ? "" : v);
    }
    for (var i = 2; i < arguments.length; i++) add(el, arguments[i]);
    return el;
  };
  function add(el, c) {
    if (c === null || c === undefined || c === false) return;
    if (Array.isArray(c)) c.forEach(function (x) { add(el, x); });
    else el.appendChild(c.nodeType ? c : document.createTextNode(String(c)));
  }
  QB.clear = function (el) { while (el.firstChild) el.removeChild(el.firstChild); return el; };
  QB.mount = function (el, node) { QB.clear(el); add(el, node); return el; };
  QB.$ = function (s, r) { return (r || document).querySelector(s); };
  QB.fmtDate = function (t) { if (!t) return "—"; try { return new Date(t).toLocaleString("ar-IQ", { dateStyle: "medium", timeStyle: "short" }); } catch (e) { return String(t); } };
  QB.fmtDur = function (s) { s = Math.max(0, Math.round(s || 0)); var m = Math.floor(s / 60), r = s % 60; return m + ":" + (r < 10 ? "0" : "") + r; };
  QB.debounce = function (fn, ms) { var t; return function () { var a = arguments, c = this; clearTimeout(t); t = setTimeout(function () { fn.apply(c, a); }, ms); }; };
  QB.safeSrc = function (u) { return typeof u === "string" && (/^https:\/\/[^\s"'<>\\]+$/i.test(u) || /^(\/(?!\/)|files\/|api\/|assets\/)[^\s"'<>\\]*$/i.test(u)) ? u : ""; };

  /* ---------- إشعارات وحوارات ---------- */
  QB.toast = function (msg, kind, action) {
    var box = document.getElementById("qb-toasts");
    if (!box) { box = QB.h("div", { id: "qb-toasts", class: "qb-toasts", "aria-live": "polite" }); document.body.appendChild(box); }
    var t = QB.h("div", { class: "qb-toast " + (kind || "") }, QB.h("span", { text: msg }));
    if (action) t.appendChild(QB.h("button", { type: "button", class: "qb-btn qb-btn-link", text: action.label, onclick: function () { action.run(); t.remove(); } }));
    box.appendChild(t);
    setTimeout(function () { t.classList.add("out"); setTimeout(function () { t.remove(); }, 250); }, action ? 7000 : 3800);
  };
  QB.confirm = function (title, text, okLabel, danger) {
    return new Promise(function (res) {
      var prev = document.activeElement;
      var done = function (v) { ov.remove(); document.removeEventListener("keydown", key); if (prev && prev.focus) prev.focus(); res(v); };
      var ok = QB.h("button", { type: "button", class: "qb-btn " + (danger ? "qb-btn-danger" : "qb-btn-primary"), text: okLabel || "تأكيد", onclick: function () { done(true); } });
      var ov = QB.h("div", { class: "qb-overlay", onclick: function (e) { if (e.target === ov) done(false); } },
        QB.h("div", { class: "qb-dialog", role: "alertdialog", "aria-modal": "true", "aria-label": title },
          QB.h("h3", { text: title }), text ? QB.h("p", { text: text }) : null,
          QB.h("div", { class: "qb-row end" }, QB.h("button", { type: "button", class: "qb-btn", text: "إلغاء", onclick: function () { done(false); } }), ok)));
      var key = function (e) { if (e.key === "Escape") done(false); };
      document.addEventListener("keydown", key); document.body.appendChild(ov); ok.focus();
    });
  };
  QB.prompt = function (title, label, value) {
    return new Promise(function (res) {
      var inp = QB.h("input", { class: "qb-input", type: "text", value: value || "", maxlength: "200", "aria-label": label });
      var done = function (v) { ov.remove(); res(v); };
      var ov = QB.h("div", { class: "qb-overlay", onclick: function (e) { if (e.target === ov) done(null); } },
        QB.h("form", { class: "qb-dialog", onsubmit: function (e) { e.preventDefault(); done(inp.value.trim() || null); } },
          QB.h("h3", { text: title }), QB.h("label", { class: "qb-label" }, label, inp),
          QB.h("div", { class: "qb-row end" }, QB.h("button", { type: "button", class: "qb-btn", text: "إلغاء", onclick: function () { done(null); } }), QB.h("button", { type: "submit", class: "qb-btn qb-btn-primary", text: "موافق" }))));
      document.body.appendChild(ov); inp.focus(); inp.select();
    });
  };
  QB.lightbox = function (src, caption) {
    var close = function () { ov.remove(); document.removeEventListener("keydown", key); };
    var key = function (e) { if (e.key === "Escape") close(); };
    var ov = QB.h("div", { class: "qb-overlay qb-lightbox", role: "dialog", "aria-modal": "true", "aria-label": "عرض الصورة" },
      QB.h("button", { type: "button", class: "qb-lb-close", "aria-label": "إغلاق", text: "×", onclick: close }),
      QB.h("div", { class: "qb-lb-scroll" }, QB.h("img", { src: src, alt: caption || "صورة السؤال" })),
      caption ? QB.h("p", { class: "qb-lb-cap", text: caption }) : null);
    document.addEventListener("keydown", key); document.body.appendChild(ov);
  };

  /* ---------- الوسائط والجداول ---------- */
  QB.media = function (list) {
    if (!list || !list.length) return null;
    return QB.h("div", { class: "qb-media" }, list.map(function (m) {
      var src = QB.safeSrc(m.url); if (!src) return null;
      var label = m.caption || ({ xray: "أشعة سينية", ct: "CT", mri: "MRI", ecg: "تخطيط قلب", histology: "نسيج", pathology: "باثولوجي", clinical: "صورة سريرية" })[m.kind] || "صورة";
      if (m.kind === "video" || /\.(mp4|webm)(\?|$)/i.test(src)) return QB.h("figure", { class: "qb-fig" }, QB.h("video", { src: src, controls: true, preload: "metadata", "aria-label": label }), m.caption ? QB.h("figcaption", { text: m.caption }) : null);
      return QB.h("figure", { class: "qb-fig" },
        QB.h("button", { type: "button", class: "qb-img-btn", "aria-label": "تكبير: " + label, onclick: function () { QB.lightbox(src, m.caption); } }, QB.h("img", { src: src, alt: label, loading: "lazy" })),
        m.caption ? QB.h("figcaption", { text: m.caption }) : null);
    }));
  };
  QB.table = function (t) {
    if (!t || !t.head || !t.rows) return null;
    return QB.h("div", { class: "qb-table-wrap" }, QB.h("table", { class: "qb-table" },
      QB.h("thead", null, QB.h("tr", null, t.head.map(function (c) { return QB.h("th", { text: c }); }))),
      QB.h("tbody", null, t.rows.map(function (r) { return QB.h("tr", null, r.map(function (c) { return QB.h("td", { text: c }); })); }))));
  };
  QB.caseCard = function (c) {
    if (!c) return null;
    var row = function (label, v) { return v ? QB.h("p", null, QB.h("strong", { text: label + ": " }), v) : null; };
    return QB.h("details", { class: "qb-case", open: true }, QB.h("summary", { text: "حالة سريرية: " + (c.title || "") }),
      c.text ? QB.h("p", { text: c.text }) : null, row("القصة", c.history), row("الفحص", c.exam), row("العلامات الحيوية", c.vitals), row("التحاليل", c.labs), QB.table(c.labsTable), QB.media(c.images));
  };

  /* ---------- عرض السؤال وجمع الإجابة ---------- */
  var uid = 0;
  function optionList(name, multi, options, value, locked, onPick, reveal, resultStatus) {
    var sel = multi ? (Array.isArray(value) ? value.slice() : []) : value;
    var corr = reveal ? (multi ? reveal.correct || [] : [reveal.correct]) : [];
    return QB.h("div", { class: "qb-opts", role: multi ? "group" : "radiogroup" }, options.map(function (o, i) {
      var id = "qo" + (++uid), picked = multi ? sel.indexOf(o.id) >= 0 : sel === o.id;
      var cls = "qb-opt" + (picked ? " picked" : "") + (reveal ? (corr.indexOf(o.id) >= 0 ? " is-correct" : picked ? " is-wrong" : "") : "");
      var inp = QB.h("input", { type: multi ? "checkbox" : "radio", name: name, id: id, checked: picked, disabled: locked, onchange: function () {
        if (multi) { var s = Array.isArray(sel) ? sel : []; var k = s.indexOf(o.id); if (inp.checked && k < 0) s.push(o.id); if (!inp.checked && k >= 0) s.splice(k, 1); sel = s; onPick(s.length ? s.slice() : null); }
        else { sel = o.id; onPick(o.id); }
        refresh();
      } });
      return QB.h("label", { class: cls, for: id }, inp, QB.h("span", { class: "qb-opt-key", text: String.fromCharCode(65 + i) }), QB.h("span", { class: "qb-opt-text", text: o.text }));
    }));
    function refresh() { /* الحالة المرئية تتبع :checked عبر CSS */ }
  }

  function selectFor(options, value, locked, onPick, label) {
    var s = QB.h("select", { class: "qb-input", "aria-label": label, disabled: locked, onchange: function () { onPick(s.value || null); } },
      QB.h("option", { value: "", text: "— اختر —" }), options.map(function (o) { return QB.h("option", { value: o.id, text: o.text, selected: value === o.id }); }));
    return s;
  }

  /* opts: {answer, locked, onChange(ans), reveal, status, qnum} */
  QB.renderQuestion = function (q, opts) {
    opts = opts || {}; var locked = !!opts.locked, reveal = opts.reveal || null, cur = opts.answer;
    var change = function (v) { cur = v; if (opts.onChange) opts.onChange(v); };
    var body, name = "q" + q.id + "_" + (++uid);
    switch (q.type) {
      case "sba": case "mcq": body = optionList(name, false, q.options, cur, locked, change, reveal); break;
      case "mrq": body = QB.h("div", null, QB.h("p", { class: "qb-hint", text: "اختر " + q.selectCount + " إجابات" }), optionList(name, true, q.options, cur, locked, change, reveal)); break;
      case "tf": body = QB.h("div", { class: "qb-tf", role: "radiogroup" }, [[true, "صح"], [false, "خطأ"]].map(function (p) {
        var picked = cur === p[0], cls = "qb-opt qb-tf-btn" + (picked ? " picked" : "") + (reveal ? (reveal.correct === p[0] ? " is-correct" : picked ? " is-wrong" : "") : "");
        var id = "qt" + (++uid), inp = QB.h("input", { type: "radio", name: name, id: id, checked: picked, disabled: locked, onchange: function () { change(p[0]); } });
        return QB.h("label", { class: cls, for: id }, inp, QB.h("span", { class: "qb-opt-text", text: p[1] }));
      })); break;
      case "emq": {
        var ans = Object.assign({}, cur || {});
        body = QB.h("div", { class: "qb-emq" }, QB.h("ol", { class: "qb-emq-opts" }, q.options.map(function (o, i) { return QB.h("li", null, QB.h("span", { class: "qb-opt-key", text: String.fromCharCode(65 + i) }), " ", o.text); })),
          q.items.map(function (it) {
            var sel = selectFor(q.options, ans[it.id], locked, function (v) { if (v) ans[it.id] = v; else delete ans[it.id]; change(Object.keys(ans).length ? Object.assign({}, ans) : null); }, it.text);
            var ok = reveal && reveal.correct ? reveal.correct[it.id] : null;
            return QB.h("div", { class: "qb-pair" + (reveal ? (ans[it.id] === ok ? " is-correct" : " is-wrong") : "") }, QB.h("span", { class: "qb-pair-l", text: it.text }), sel, reveal && ans[it.id] !== ok ? QB.h("small", { class: "qb-ans", text: "الصحيح: " + (q.options.filter(function (o) { return o.id === ok; })[0] || {}).text }) : null);
          })); break;
      }
      case "matching": {
        var m = Object.assign({}, cur || {});
        body = QB.h("div", { class: "qb-match" }, q.left.map(function (l) {
          var ok = reveal && reveal.correct ? reveal.correct[l.id] : null;
          var sel = selectFor(q.right, m[l.id], locked, function (v) { if (v) m[l.id] = v; else delete m[l.id]; change(Object.keys(m).length ? Object.assign({}, m) : null); }, l.text);
          return QB.h("div", { class: "qb-pair" + (reveal ? (m[l.id] === ok ? " is-correct" : " is-wrong") : "") }, QB.h("span", { class: "qb-pair-l", text: l.text }), sel, reveal && m[l.id] !== ok ? QB.h("small", { class: "qb-ans", text: "الصحيح: " + (q.right.filter(function (o) { return o.id === ok; })[0] || {}).text }) : null);
        })); break;
      }
      case "ordering": {
        var order = Array.isArray(cur) && cur.length === q.items.length ? cur.slice() : q.items.map(function (i) { return i.id; });
        var byId = {}; q.items.forEach(function (i) { byId[i.id] = i; });
        var list = QB.h("ol", { class: "qb-order" });
        var draw = function () {
          QB.clear(list);
          order.forEach(function (id, i) {
            var good = reveal && reveal.correct ? reveal.correct[i] === id : null;
            list.appendChild(QB.h("li", { class: "qb-order-item" + (good === true ? " is-correct" : good === false ? " is-wrong" : "") },
              QB.h("span", { class: "qb-opt-text", text: byId[id].text }),
              locked ? null : QB.h("span", { class: "qb-order-btns" },
                QB.h("button", { type: "button", class: "qb-icon-btn", "aria-label": "أعلى", disabled: i === 0, text: "↑", onclick: function () { var t = order[i - 1]; order[i - 1] = order[i]; order[i] = t; change(order.slice()); draw(); } }),
                QB.h("button", { type: "button", class: "qb-icon-btn", "aria-label": "أسفل", disabled: i === order.length - 1, text: "↓", onclick: function () { var t = order[i + 1]; order[i + 1] = order[i]; order[i] = t; change(order.slice()); draw(); } }))));
          });
        };
        draw();
        body = QB.h("div", null, QB.h("p", { class: "qb-hint", text: "رتّب العناصر بالأسهم" }), list); break;
      }
      case "fill": {
        var f = Object.assign({}, cur || {});
        body = QB.h("div", { class: "qb-fill" }, q.blanks.map(function (b, i) {
          var inp = QB.h("input", { class: "qb-input", type: "text", maxlength: "300", value: f[b.id] || "", disabled: locked, "aria-label": "الفراغ " + (i + 1), autocomplete: "off", oninput: function () { var v = inp.value; if (v.trim()) f[b.id] = v; else delete f[b.id]; change(Object.keys(f).length ? Object.assign({}, f) : null); } });
          return QB.h("label", { class: "qb-label" }, "الفراغ " + (i + 1), inp, reveal && reveal.correct ? QB.h("small", { class: "qb-ans", text: "مقبول: " + reveal.correct[b.id] }) : null);
        })); break;
      }
      case "numerical": {
        var n = QB.h("input", { class: "qb-input", type: "text", inputmode: "decimal", dir: "ltr", maxlength: "30", value: cur == null ? "" : String(cur), disabled: locked, "aria-label": "الإجابة الرقمية", oninput: function () { change(n.value.trim() === "" ? null : n.value.trim()); } });
        body = QB.h("div", { class: "qb-num" }, n, q.unit ? QB.h("span", { class: "qb-unit", text: q.unit }) : null, reveal && reveal.correct !== undefined ? QB.h("small", { class: "qb-ans", text: "الإجابة: " + reveal.correct + (q.unit ? " " + q.unit : "") }) : null); break;
      }
      case "essay": {
        var ta = QB.h("textarea", { class: "qb-input", rows: "6", maxlength: "8000", disabled: locked, "aria-label": "إجابتك", value: cur || "", oninput: function () { change(ta.value.trim() ? ta.value : null); } });
        body = QB.h("div", null, ta, QB.h("p", { class: "qb-hint", text: "يُصحَّح هذا السؤال يدوياً." })); break;
      }
      default: {
        var t = QB.h("input", { class: "qb-input", type: "text", maxlength: "500", value: cur || "", disabled: locked, "aria-label": "إجابتك", autocomplete: "off", oninput: function () { change(t.value.trim() ? t.value : null); } });
        body = QB.h("div", null, t, reveal && reveal.correct && reveal.correct[0] ? QB.h("small", { class: "qb-ans", text: "مثال على إجابة مقبولة: " + reveal.correct[0] }) : null);
      }
    }
    var head = QB.h("div", { class: "qb-q-head" },
      opts.qnum ? QB.h("span", { class: "qb-q-num", text: opts.qnum }) : null,
      QB.h("span", { class: "qb-chip", text: QB.TYPE_SHORT[q.type] || q.type }),
      q.difficulty ? QB.h("span", { class: "qb-chip d" + q.difficulty, text: QB.DIFF[q.difficulty] }) : null,
      QB.h("span", { class: "qb-chip pts", text: q.points + " د" }));
    return QB.h("article", { class: "qb-q", dataset: { type: q.type } }, head, QB.h("p", { class: "qb-q-text", text: q.text }), QB.media(q.media), QB.table(q.table), body);
  };

  QB.revealBlock = function (rv, status) {
    if (!rv) return null;
    var good = status === "correct", msg = good ? rv.feedbackCorrect : rv.feedbackWrong;
    if (!rv.explanation && !msg && !rv.source) return null;
    return QB.h("div", { class: "qb-reveal" }, msg ? QB.h("p", { class: "qb-fb", text: msg }) : null, rv.explanation ? QB.h("p", null, QB.h("strong", { text: "الشرح: " }), rv.explanation) : null, rv.source ? QB.h("p", { class: "qb-src", text: "المصدر: " + rv.source }) : null);
  };
  QB.statusBadge = function (s) { var m = { correct: ["صحيح", "ok"], partial: ["جزئي", "mid"], wrong: ["خطأ", "bad"], unanswered: ["بلا إجابة", "none"], pending: ["بانتظار التصحيح", "mid"] }[s] || [s, "none"]; return QB.h("span", { class: "qb-badge " + m[1], text: m[0] }); };
})(window);
