/* qb-qeditor.js — محرر السؤال (كل الأنواع) مع معاينة حية كما يراها الطالب. الحفظ والتحقق على الخادم. */
(function () {
  "use strict";
  var h = QB.h, api = QB.api;
  var QE = window.QBEditor = {};
  var n = 0, nid = function (p) { return p + (++n) + Math.random().toString(36).slice(2, 5); };

  function blank(type) {
    var base = { text: "", points: 1, explanation: "", source: "", media: [] };
    var o = function (t) { return { id: nid("o"), text: t || "" }; };
    switch (type) {
      case "sba": case "mcq": { var a = o(), b = o(); return Object.assign(base, { options: [a, b, o(), o()], correct: a.id, shuffle: true }); }
      case "mrq": { var x = o(); return Object.assign(base, { options: [x, o(), o(), o()], correct: [x.id], scoring: "partial", shuffle: true }); }
      case "tf": return Object.assign(base, { correct: true });
      case "emq": { var p = o(), q = o(); return Object.assign(base, { options: [p, q, o()], items: [{ id: nid("i"), text: "", correct: p.id }, { id: nid("i"), text: "", correct: q.id }], shuffle: true }); }
      case "matching": return Object.assign(base, { pairs: [1, 2, 3].map(function () { return { id: nid("p"), rid: nid("r"), left: "", right: "" }; }) });
      case "ordering": return Object.assign(base, { order: [o(), o(), o()], scoring: "partial" });
      case "fill": return Object.assign(base, { blanks: [{ id: nid("b"), accepted: [], caseSensitive: false }] });
      case "saq": return Object.assign(base, { accepted: [] });
      case "numerical": return Object.assign(base, { numeric: { value: 0, tolerance: 0, mode: "abs", unit: "" } });
      default: return base; // essay
    }
  }

  function field(label, input, hint) { return h("label", { class: "qb-label" }, label, input, hint ? h("small", { class: "qb-muted", text: hint }) : null); }
  function text(m, key, rows, ph, max) { var t = h(rows ? "textarea" : "input", { class: "qb-input", rows: rows, type: rows ? null : "text", maxlength: String(max || 1000), placeholder: ph || "", value: m[key] || "" }); t.addEventListener("input", function () { m[key] = t.value; m.__change(); }); return t; }

  /* أقسام النماذج لكل نوع */
  function optionsEditor(m, multi, minOpts) {
    var box = h("div", { class: "qb-stack" });
    function draw() {
      QB.clear(box);
      m.options.forEach(function (o, i) {
        var isC = multi ? m.correct.indexOf(o.id) >= 0 : m.correct === o.id;
        var chk = h("input", { type: multi ? "checkbox" : "radio", name: "correct" + m.__uid, checked: isC, "aria-label": "إجابة صحيحة", onchange: function () {
          if (multi) { var k = m.correct.indexOf(o.id); if (chk.checked && k < 0) m.correct.push(o.id); if (!chk.checked && k >= 0) m.correct.splice(k, 1); } else m.correct = o.id; m.__change(); } });
        var t = h("input", { class: "qb-input", type: "text", maxlength: "1000", value: o.text, placeholder: "الخيار " + String.fromCharCode(65 + i), "aria-label": "نص الخيار " + (i + 1), oninput: function () { o.text = t.value; m.__change(); } });
        box.appendChild(h("div", { class: "qb-opt-edit" }, h("label", { class: "qb-correct" }, chk, h("span", { text: "صحيح" })), t,
          h("button", { type: "button", class: "qb-icon-btn", "aria-label": "حذف الخيار", disabled: m.options.length <= minOpts, text: "×", onclick: function () { m.options.splice(i, 1); if (multi) m.correct = m.correct.filter(function (c) { return c !== o.id; }); else if (m.correct === o.id) m.correct = m.options[0].id; draw(); m.__change(); } })));
      });
      box.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "+ خيار", disabled: m.options.length >= 12, onclick: function () { m.options.push({ id: nid("o"), text: "" }); draw(); m.__change(); } }));
    }
    draw(); return box;
  }
  function checkbox(label, get, set) { var c = h("input", { type: "checkbox", checked: !!get(), onchange: function () { set(c.checked); } }); return h("label", { class: "qb-check" }, c, h("span", { text: label })); }

  function typeSection(m, type) {
    switch (type) {
      case "sba": case "mcq": return h("div", { class: "qb-stack" }, optionsEditor(m, false, 2), checkbox("خلط ترتيب الخيارات للطالب", function () { return m.shuffle; }, function (v) { m.shuffle = v; m.__change(); }));
      case "mrq": {
        var sc = h("select", { class: "qb-input", onchange: function () { m.scoring = sc.value; m.__change(); } }, [["partial", "درجة جزئية لكل اختيار صحيح"], ["all", "الدرجة كاملة أو صفر"]].map(function (o) { return h("option", { value: o[0], text: o[1], selected: m.scoring === o[0] }); }));
        return h("div", { class: "qb-stack" }, optionsEditor(m, true, 2), field("نمط التصحيح", sc), checkbox("خلط ترتيب الخيارات", function () { return m.shuffle; }, function (v) { m.shuffle = v; m.__change(); }));
      }
      case "tf": return h("div", { class: "qb-row" }, [[true, "صح"], [false, "خطأ"]].map(function (p) { var r = h("input", { type: "radio", name: "tf" + m.__uid, checked: m.correct === p[0], onchange: function () { m.correct = p[0]; m.__change(); } }); return h("label", { class: "qb-check" }, r, h("span", { text: "الإجابة: " + p[1] })); }));
      case "emq": {
        var wrap = h("div", { class: "qb-stack" });
        var draw = function () {
          QB.clear(wrap);
          wrap.appendChild(h("h4", { text: "قائمة الخيارات المشتركة" }));
          m.options.forEach(function (o, i) { var t = h("input", { class: "qb-input", type: "text", value: o.text, placeholder: "الخيار " + String.fromCharCode(65 + i), oninput: function () { o.text = t.value; m.__change(); } }); wrap.appendChild(h("div", { class: "qb-row" }, h("span", { class: "qb-opt-key", text: String.fromCharCode(65 + i) }), h("div", { class: "qb-grow" }, t), h("button", { type: "button", class: "qb-icon-btn", "aria-label": "حذف", disabled: m.options.length <= 2, text: "×", onclick: function () { m.options.splice(i, 1); m.items.forEach(function (it) { if (it.correct === o.id) it.correct = m.options[0].id; }); draw(); m.__change(); } }))); });
          wrap.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "+ خيار", onclick: function () { m.options.push({ id: nid("o"), text: "" }); draw(); m.__change(); } }));
          wrap.appendChild(h("h4", { text: "البنود (لكلٍّ إجابة صحيحة)" }));
          m.items.forEach(function (it, i) {
            var t = h("input", { class: "qb-input", type: "text", value: it.text, placeholder: "نص البند", oninput: function () { it.text = t.value; m.__change(); } });
            var sel = h("select", { class: "qb-input", "aria-label": "الإجابة الصحيحة", onchange: function () { it.correct = sel.value; m.__change(); } }, m.options.map(function (o, k) { return h("option", { value: o.id, text: String.fromCharCode(65 + k) + ". " + (o.text || "…"), selected: it.correct === o.id }); }));
            wrap.appendChild(h("div", { class: "qb-pair" }, t, sel, h("button", { type: "button", class: "qb-btn qb-btn-sm", disabled: m.items.length <= 1, text: "حذف البند", onclick: function () { m.items.splice(i, 1); draw(); m.__change(); } })));
          });
          wrap.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "+ بند", onclick: function () { m.items.push({ id: nid("i"), text: "", correct: m.options[0].id }); draw(); m.__change(); } }));
        };
        draw(); return wrap;
      }
      case "matching": {
        var mw = h("div", { class: "qb-stack" });
        var dm = function () {
          QB.clear(mw);
          m.pairs.forEach(function (p, i) {
            var l = h("input", { class: "qb-input", type: "text", value: p.left, placeholder: "العنصر " + (i + 1), oninput: function () { p.left = l.value; m.__change(); } });
            var r = h("input", { class: "qb-input", type: "text", value: p.right, placeholder: "ما يطابقه", oninput: function () { p.right = r.value; m.__change(); } });
            mw.appendChild(h("div", { class: "qb-pair" }, l, r, h("button", { type: "button", class: "qb-btn qb-btn-sm", disabled: m.pairs.length <= 2, text: "حذف", onclick: function () { m.pairs.splice(i, 1); dm(); m.__change(); } })));
          });
          mw.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "+ زوج", disabled: m.pairs.length >= 12, onclick: function () { m.pairs.push({ id: nid("p"), rid: nid("r"), left: "", right: "" }); dm(); m.__change(); } }));
        };
        dm(); return mw;
      }
      case "ordering": {
        var ow = h("div", { class: "qb-stack" });
        var dr = function () {
          QB.clear(ow); ow.appendChild(h("p", { class: "qb-hint", text: "اكتب العناصر بالترتيب الصحيح؛ سيراها الطالب مخلوطة." }));
          m.order.forEach(function (o, i) {
            var t = h("input", { class: "qb-input", type: "text", value: o.text, placeholder: "الخطوة " + (i + 1), oninput: function () { o.text = t.value; m.__change(); } });
            ow.appendChild(h("div", { class: "qb-row" }, h("span", { class: "qb-opt-key", text: String(i + 1) }), h("div", { class: "qb-grow" }, t),
              h("button", { type: "button", class: "qb-icon-btn", disabled: i === 0, "aria-label": "أعلى", text: "↑", onclick: function () { var x = m.order[i - 1]; m.order[i - 1] = o; m.order[i] = x; dr(); m.__change(); } }),
              h("button", { type: "button", class: "qb-icon-btn", disabled: i === m.order.length - 1, "aria-label": "أسفل", text: "↓", onclick: function () { var x = m.order[i + 1]; m.order[i + 1] = o; m.order[i] = x; dr(); m.__change(); } }),
              h("button", { type: "button", class: "qb-icon-btn", disabled: m.order.length <= 2, "aria-label": "حذف", text: "×", onclick: function () { m.order.splice(i, 1); dr(); m.__change(); } })));
          });
          ow.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "+ عنصر", disabled: m.order.length >= 12, onclick: function () { m.order.push({ id: nid("o"), text: "" }); dr(); m.__change(); } }));
          var sc2 = h("select", { class: "qb-input", onchange: function () { m.scoring = sc2.value; m.__change(); } }, [["partial", "درجة جزئية حسب المواضع الصحيحة"], ["all", "الدرجة كاملة أو صفر"]].map(function (o) { return h("option", { value: o[0], text: o[1], selected: m.scoring === o[0] }); }));
          ow.appendChild(field("نمط التصحيح", sc2));
        };
        dr(); return ow;
      }
      case "fill": {
        var fw = h("div", { class: "qb-stack" });
        var df = function () {
          QB.clear(fw); fw.appendChild(h("p", { class: "qb-hint", text: "اكتب الإجابات المقبولة لكل فراغ مفصولة بفاصلة. استعمل ____ في نص السؤال لتوضيح مكان الفراغ." }));
          m.blanks.forEach(function (b, i) {
            var t = h("input", { class: "qb-input", type: "text", value: (b.accepted || []).join("، "), placeholder: "إجابات مقبولة للفراغ " + (i + 1), oninput: function () { b.accepted = t.value.split(/[,،]/).map(function (x) { return x.trim(); }).filter(Boolean); m.__change(); } });
            fw.appendChild(h("div", { class: "qb-pair" }, h("strong", { text: "الفراغ " + (i + 1) }), t, checkbox("حساسية الحروف الإنجليزية الكبيرة/الصغيرة", function () { return b.caseSensitive; }, function (v) { b.caseSensitive = v; m.__change(); }), h("button", { type: "button", class: "qb-btn qb-btn-sm", disabled: m.blanks.length <= 1, text: "حذف الفراغ", onclick: function () { m.blanks.splice(i, 1); df(); m.__change(); } })));
          });
          fw.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "+ فراغ", disabled: m.blanks.length >= 10, onclick: function () { m.blanks.push({ id: nid("b"), accepted: [], caseSensitive: false }); df(); m.__change(); } }));
        };
        df(); return fw;
      }
      case "saq": { var ta = h("textarea", { class: "qb-input", rows: "4", placeholder: "إجابة مقبولة في كل سطر", value: (m.accepted || []).join("\n"), oninput: function () { m.accepted = ta.value.split("\n").map(function (x) { return x.trim(); }).filter(Boolean); m.__change(); } }); return field("الإجابات المقبولة (سطر لكل إجابة)", ta, "تُطابَق بعد توحيد الحروف والمسافات والتشكيل."); }
      case "numerical": {
        var num = function (k, label, hint) { var i = h("input", { class: "qb-input", type: "number", step: "any", dir: "ltr", value: String(m.numeric[k]), oninput: function () { m.numeric[k] = i.value === "" ? NaN : Number(i.value); m.__change(); } }); return field(label, i, hint); };
        var mode = h("select", { class: "qb-input", onchange: function () { m.numeric.mode = mode.value; m.__change(); } }, [["abs", "فرق مطلق"], ["percent", "نسبة مئوية"]].map(function (o) { return h("option", { value: o[0], text: o[1], selected: m.numeric.mode === o[0] }); }));
        var unit = h("input", { class: "qb-input", type: "text", maxlength: "20", value: m.numeric.unit || "", oninput: function () { m.numeric.unit = unit.value; m.__change(); } });
        return h("div", { class: "qb-grid2" }, num("value", "القيمة الصحيحة"), num("tolerance", "هامش التسامح"), field("نوع التسامح", mode), field("الوحدة", unit));
      }
      default: return h("p", { class: "qb-banner", text: "السؤال المقالي يُصحَّح يدوياً من قبل المراجع. النتيجة تبقى «غير نهائية» حتى يُصحَّح." });
    }
  }

  function mediaEditor(m) {
    var box = h("div", { class: "qb-stack" });
    var draw = function () {
      QB.clear(box);
      (m.media || []).forEach(function (md, i) {
        var kind = h("select", { class: "qb-input", "aria-label": "نوع الوسيط", onchange: function () { md.kind = kind.value; m.__change(); } }, [["image", "صورة"], ["xray", "أشعة سينية"], ["ct", "CT"], ["mri", "MRI"], ["ecg", "تخطيط قلب ECG"], ["histology", "شريحة نسيجية"], ["pathology", "باثولوجي"], ["clinical", "صورة سريرية"], ["video", "فيديو"]].map(function (o) { return h("option", { value: o[0], text: o[1], selected: md.kind === o[0] }); }));
        var url = h("input", { class: "qb-input", type: "url", dir: "ltr", placeholder: "https://…", value: md.url || "", "aria-label": "رابط الوسيط", oninput: function () { md.url = url.value.trim(); m.__change(); } });
        var cap = h("input", { class: "qb-input", type: "text", maxlength: "300", placeholder: "وصف مختصر (مهم لمن لا يرى الصورة)", value: md.caption || "", oninput: function () { md.caption = cap.value; m.__change(); } });
        box.appendChild(h("div", { class: "qb-pair" }, kind, url, cap, h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "حذف", onclick: function () { m.media.splice(i, 1); draw(); m.__change(); } })));
      });
      box.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "+ صورة / فيديو (رابط)", disabled: (m.media || []).length >= 8, onclick: function () { (m.media = m.media || []).push({ kind: "image", url: "", caption: "" }); draw(); } }));
      box.appendChild(h("p", { class: "qb-hint", text: "الروابط https فقط. رفع الصور المباشر غير متاح بعد؛ استعمل رابط ملف من المنصة أو من استضافة صور." }));
    };
    draw(); return box;
  }

  function tableToText(t) { return t && t.head ? [t.head.join(" | ")].concat(t.rows.map(function (r) { return r.join(" | "); })).join("\n") : ""; }
  function textToTable(s) { var lines = s.split("\n").map(function (l) { return l.trim(); }).filter(Boolean); if (lines.length < 2) return undefined; var sp = function (l) { return l.split("|").map(function (c) { return c.trim(); }); }; return { head: sp(lines[0]), rows: lines.slice(1).map(sp) }; }

  /* تحويل النموذج إلى محتوى للخادم (يتحقق الخادم من كل شيء ثانية) */
  function toContent(m, type) {
    var c = { text: m.text, points: Number(m.points), explanation: m.explanation, source: m.source, feedbackCorrect: m.feedbackCorrect, feedbackWrong: m.feedbackWrong, media: (m.media || []).filter(function (x) { return x.url; }), shuffle: !!m.shuffle, required: !!m.required };
    if (m.timeLimit) c.time_limit_sec = Number(m.timeLimit);
    if (m.negEnabled) c.negative = { enabled: true, penalty: Number(m.penalty) };
    if (m.tableText && m.tableText.trim()) c.table = textToTable(m.tableText);
    ["options", "correct", "scoring", "items", "pairs", "order", "blanks", "accepted", "numeric"].forEach(function (k) { if (m[k] !== undefined) c[k] = m[k]; });
    return c;
  }
  function fromContent(c) {
    var m = JSON.parse(JSON.stringify(c)); m.points = c.points; m.media = c.media || [];
    m.tableText = tableToText(c.table); if (c.negative) { m.negEnabled = true; m.penalty = c.negative.penalty; } m.timeLimit = c.time_limit_sec || "";
    return m;
  }

  /* opts: {type, id, subject: {id, review, lectures, categories, caseList}, onSaved(id), onClose(), embedded} */
  QE.open = function (host, opts) {
    var S = opts.subject, type = opts.type, qid = opts.id || null, meta = { difficulty: 2, lecture_id: "", category_id: "", case_id: "", tags: "" }, status = "draft", info = null;
    var m, previewHost = h("div", { class: "qb-preview" }), msgs = h("div", { class: "qb-stack" }), formHost = h("div", { class: "qb-stack" }), saveBtn;
    var dirty = false;
    var uidn = ++n;

    function mount() {
      m.__uid = uidn; Object.defineProperty(m, "__change", { value: onChange, enumerable: false, configurable: true });
      QB.clear(formHost);
      var lecSel = h("select", { class: "qb-input", onchange: function () { meta.lecture_id = lecSel.value; touch(); } }, [h("option", { value: "", text: "— بلا محاضرة —" })].concat(S.lectures.map(function (l) { return h("option", { value: String(l.id), text: l.number + ". " + l.title, selected: String(meta.lecture_id) === String(l.id) }); })));
      var catSel = h("select", { class: "qb-input", onchange: function () { meta.category_id = catSel.value; touch(); } }, [h("option", { value: "", text: "— بلا تصنيف —" })].concat(S.categories.map(function (c) { return h("option", { value: String(c.id), text: c.name, selected: String(meta.category_id) === String(c.id) }); })));
      var caseSel = h("select", { class: "qb-input", onchange: function () { meta.case_id = caseSel.value; touch(); } }, [h("option", { value: "", text: "— غير مرتبط بحالة —" })].concat((S.cases || []).map(function (c) { return h("option", { value: String(c.id), text: c.title + (c.status !== "published" ? " (غير منشورة)" : ""), selected: String(meta.case_id) === String(c.id) }); })));
      var diff = h("select", { class: "qb-input", onchange: function () { meta.difficulty = Number(diff.value); touch(); } }, [1, 2, 3].map(function (d) { return h("option", { value: String(d), text: QB.DIFF[d], selected: meta.difficulty === d }); }));
      var tags = h("input", { class: "qb-input", type: "text", maxlength: "200", value: meta.tags, placeholder: "وسم1، وسم2", oninput: function () { meta.tags = tags.value; touch(); } });
      var pts = h("input", { class: "qb-input", type: "number", min: "0.25", step: "0.25", dir: "ltr", value: String(m.points), oninput: function () { m.points = pts.value; onChange(); } });
      var tbl = h("textarea", { class: "qb-input", rows: "3", dir: "auto", placeholder: "العمود1 | العمود2\nقيمة | قيمة", value: m.tableText || "", oninput: function () { m.tableText = tbl.value; onChange(); } });
      var pen = h("input", { class: "qb-input", type: "number", min: "0", step: "0.25", dir: "ltr", value: String(m.penalty || 0), oninput: function () { m.penalty = pen.value; onChange(); } });
      var tlim = h("input", { class: "qb-input", type: "number", min: "0", step: "5", dir: "ltr", value: String(m.timeLimit || ""), placeholder: "اختياري", oninput: function () { m.timeLimit = tlim.value; onChange(); } });
      formHost.appendChild(h("div", { class: "qb-stack" },
        field("نص السؤال", text(m, "text", 4, "اكتب السؤال هنا…", 8000)),
        typeSection(m, type),
        h("div", { class: "qb-grid2" }, field("الدرجة", pts), field("الصعوبة", diff), field("المحاضرة", lecSel), field("التصنيف الأكاديمي", catSel)),
        field("حالة سريرية مرتبطة", caseSel), field("الوسوم", tags),
        h("details", { class: "qb-more", open: !!(m.explanation || m.source) }, h("summary", { text: "الشرح العلمي والمصدر والتغذية الراجعة" }), h("div", { class: "qb-stack" },
          field("الشرح العلمي (يظهر بعد الإجابة)", text(m, "explanation", 3, "", 4000)), field("المصدر", text(m, "source", 0, "كتاب / محاضرة / صفحة", 500)),
          field("رسالة عند الإجابة الصحيحة", text(m, "feedbackCorrect", 0, "", 1000)), field("رسالة عند الخطأ", text(m, "feedbackWrong", 0, "", 1000)))),
        h("details", { class: "qb-more", open: !!((m.media || []).length || m.tableText) }, h("summary", { text: "الصور والوسائط والجداول (أشعة، ECG، نسيج، مخطط…)" }), h("div", { class: "qb-stack" }, mediaEditor(m), field("جدول (اختياري)", tbl, "السطر الأول عناوين الأعمدة، والأعمدة مفصولة بـ |"))),
        h("details", { class: "qb-more", open: !!(m.negEnabled || m.timeLimit || m.required) }, h("summary", { text: "إعدادات متقدمة" }), h("div", { class: "qb-stack" },
          checkbox("إجابة مطلوبة", function () { return m.required; }, function (v) { m.required = v; onChange(); }),
          checkbox("درجة سالبة عند الخطأ (صريحة)", function () { return m.negEnabled; }, function (v) { m.negEnabled = v; onChange(); }), field("مقدار الخصم عند الخطأ", pen),
          field("وقت مقترح للسؤال بالثواني", tlim, "للإرشاد فقط؛ المؤقت الفعلي للاختبار كله."))))
      );
    }
    function touch() { dirty = true; setSaveState(); }
    var previewTimer;
    function onChange() { dirty = true; setSaveState(); clearTimeout(previewTimer); previewTimer = setTimeout(preview, 450); }
    function setSaveState() { if (saveBtn) saveBtn.textContent = qid ? (dirty ? "حفظ التعديلات" : "محفوظ") : "حفظ كمسودة"; }
    function preview() {
      api("POST", "admin/preview", { type: type, content: toContent(m, type) }).then(function (r) {
        QB.mount(previewHost, [h("h4", { text: "كما يراه الطالب" }), QB.renderQuestion(r.question, { qnum: 1 })]);
      }).catch(function (e) { QB.mount(previewHost, [h("h4", { text: "المعاينة" }), h("p", { class: "qb-banner bad", text: QB.errText(e) })]); });
    }
    function save(submit) {
      var content = toContent(m, type), body = { content: content, difficulty: meta.difficulty, lecture_id: meta.lecture_id || null, category_id: meta.category_id || null, case_id: meta.case_id || null, tags: meta.tags.split(/[,،]/).map(function (x) { return x.trim(); }).filter(Boolean) };
      var p = qid ? api("PUT", "admin/question/" + qid, body) : api("POST", "admin/questions", Object.assign({ subject_id: S.id, type: type, submit: !!submit }, body));
      saveBtn.disabled = true;
      return p.then(function (r) {
        dirty = false; var wasNew = !qid; qid = qid || r.id;
        QB.mount(msgs, r.duplicates && r.duplicates.length ? h("p", { class: "qb-banner", text: "تنبيه: يوجد سؤال مطابق في البنك (رقم " + r.duplicates.map(function (d) { return d.id; }).join("، ") + "). راجع التكرار." }) : null);
        QB.toast("تم الحفظ", "ok"); if (opts.onSaved) opts.onSaved(qid, wasNew, r); return load(); // أعد التحميل لتحديث الحالة والإصدارات
      }).catch(function (e) { QB.toast(QB.errText(e), "bad"); }).then(function () { saveBtn.disabled = false; });
    }
    function transition(to) {
      var needNote = to === "draft" && status !== "draft";
      (needNote ? QB.prompt("سبب الإرجاع للمسودة", "ملاحظة للمحرر", "") : Promise.resolve("")).then(function (note) {
        if (note === null) return;
        api("POST", "admin/question/" + qid + "/status", { to: to, note: note || "" }).then(function () { QB.toast("تم تغيير الحالة: " + QB.STATUS[to], "ok"); if (opts.onSaved) opts.onSaved(qid, false); return load(); }).catch(function (e) { QB.toast(QB.errText(e), "bad"); });
      });
    }
    function actions() {
      var bar = h("div", { class: "qb-row end qb-sticky-actions" });
      if (opts.onClose) bar.appendChild(h("button", { type: "button", class: "qb-btn", text: "إغلاق", onclick: function () { if (!dirty) return opts.onClose(); QB.confirm("تجاهل التعديلات غير المحفوظة؟", "", "تجاهل", true).then(function (ok) { if (ok) opts.onClose(); }); } }));
      if (qid && info) {
        var editable = info.editable;
        if (S.review) {
          if (status !== "published") bar.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-accent", text: "نشر", onclick: function () { (dirty ? save() : Promise.resolve()).then(function () { transition("published"); }); } }));
          if (status === "pending") bar.appendChild(h("button", { type: "button", class: "qb-btn", text: "اعتماد", onclick: function () { transition("approved"); } }));
          if (status !== "draft" && status !== "archived") bar.appendChild(h("button", { type: "button", class: "qb-btn", text: "إرجاع لمسودة", onclick: function () { transition("draft"); } }));
          if (status !== "archived") bar.appendChild(h("button", { type: "button", class: "qb-btn", text: "أرشفة", onclick: function () { transition("archived"); } }));
        } else if (status === "draft" && editable) bar.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-accent", text: "إرسال للمراجعة", onclick: function () { (dirty ? save() : Promise.resolve()).then(function () { transition("pending"); }); } }));
      }
      if (!qid || (info && info.editable)) { saveBtn = h("button", { type: "button", class: "qb-btn qb-btn-primary", onclick: function () { save(!qid && !S.review ? false : false); } }); bar.appendChild(saveBtn); setSaveState(); if (!qid && !S.review) bar.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-accent", text: "حفظ وإرسال للمراجعة", onclick: function () { save(true); } })); }
      else bar.appendChild(h("span", { class: "qb-muted", text: "لا يمكنك تعديل هذا السؤال في حالته الحالية." }));
      return bar;
    }
    function render() {
      var versions = info && info.versions ? h("details", { class: "qb-more" }, h("summary", { text: "سجل الإصدارات (" + info.versions.length + ")" }), h("ul", { class: "qb-list" }, info.versions.map(function (v) { return h("li", null, h("strong", { text: "الإصدار " + v.version }), " — " + (v.changed_by_name || "") + " — " + QB.fmtDate(v.changed_at) + " — " + (v.change_summary || "")); })), info.reviews && info.reviews.length ? h("ul", { class: "qb-list" }, info.reviews.map(function (r) { return h("li", { text: QB.STATUS[r.from_status] + " ← " + QB.STATUS[r.to_status] + (r.note ? ": " + r.note : "") + " (" + (r.reviewer || "") + ")" }); })) : null) : null;
      var stats = info && info.question && info.question.stats && info.question.stats.attempts ? h("p", { class: "qb-muted", text: "الاستخدام: " + info.question.stats.attempts + " إجابة، نسبة الصحة " + Math.round(info.question.stats.correct / info.question.stats.attempts * 100) + "%" + (info.question.reports_open ? " — بلاغات مفتوحة: " + info.question.reports_open : "") }) : null;
      QB.mount(host, h("div", { class: "qb-editor" },
        h("div", { class: "qb-row between" }, h("h2", { class: "qb-h", text: (qid ? "تعديل سؤال #" + qid : "سؤال جديد") + " — " + QB.TYPE_NAMES[type] }), qid ? h("span", { class: "qb-badge " + (status === "published" ? "ok" : status === "archived" ? "none" : "mid"), text: QB.STATUS[status] }) : null),
        msgs, stats, h("div", { class: "qb-editor-grid" }, h("div", { class: "qb-stack" }, formHost, versions), h("aside", { class: "qb-preview-col" }, previewHost)), actions()));
    }
    function load() {
      if (!qid) { m = blank(type); m.__uid = uidn; mount(); render(); preview(); return Promise.resolve(); }
      return api("GET", "admin/question/" + qid).then(function (r) {
        info = Object.assign({}, r.question, { versions: r.versions, reviews: r.reviews, question: r.question, editable: r.question.editable });
        info.question = r.question; type = r.question.type; status = r.question.status;
        meta = { difficulty: r.question.difficulty, lecture_id: r.question.lecture_id || "", category_id: r.question.category_id || "", case_id: r.question.case_id || "", tags: (r.question.tags || []).join("، ") };
        m = fromContent(r.question.content); dirty = false; mount(); render(); preview();
      }).catch(function (e) { QB.mount(host, h("p", { class: "qb-banner bad", text: QB.errText(e) })); });
    }
    return load();
  };
  QE.TYPES = ["sba", "mcq", "mrq", "tf", "emq", "saq", "essay", "fill", "matching", "ordering", "numerical"];
})();
