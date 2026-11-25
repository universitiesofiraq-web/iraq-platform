/* qb-builder.js — محرر الاختبارات المرئي: لوحة العناصر | الاختبار | الإعدادات. سحب وإفلات + أزرار بديلة للمس، تراجع/إعادة، حفظ تلقائي،
   معاينة بمنطق شرطي حي، وتوليد من البنك. كل الحفظ والتحقق على الخادم. */
(function () {
  "use strict";
  var h = QB.h, api = QB.api;
  var B = window.QBBuilder = {};
  var DISPLAY = [["section", "قسم", "§"], ["heading", "عنوان", "H"], ["text", "نص / وصف", "¶"], ["image", "صورة", "▣"], ["video", "فيديو", "▶"], ["divider", "فاصل", "—"], ["pagebreak", "فاصل صفحة", "⇥"]];
  var KIND_NAME = { section: "قسم", heading: "عنوان", text: "نص", image: "صورة", video: "فيديو", divider: "فاصل", pagebreak: "فاصل صفحة", question: "سؤال" };
  var OPS = [["eq", "تساوي"], ["ne", "لا تساوي"], ["in", "إحدى القيم"], ["answered", "أُجيب عنه"], ["notanswered", "لم يُجب عنه"]];
  var SETS = [["shuffleOptions", "خلط الخيارات"], ["shuffleQuestions", "خلط الأسئلة (قريباً)", true], ["allowBack", "السماح بالرجوع للأسئلة السابقة"], ["showResults", "إظهار النتيجة بعد التسليم"], ["allowReview", "السماح بمراجعة الإجابات"], ["showExplanations", "إظهار الشرح في المراجعة"], ["official", "امتحان رسمي (يعطّل المنطق الشرطي)"]];

  /* S: السياق {id, review, lectures, categories, cases}; quizId؛ host: عنصر الحاوية؛ onExit() */
  B.open = function (host, S, quizId, onExit) {
    var doc = null, hist = [], hpos = -1, selected = null, multi = new Set(), qcache = {}, saveT = null, saving = false, dirtySave = false, lastSaved = null, preview = false, sheet = "", insertAfter = null;
    var counter = 0, nk = function () { return "n" + (++counter) + Math.random().toString(36).slice(2, 5); };
    var root = h("div", { class: "qb-builder", "data-sheet": "" });
    var stateEl = h("span", { class: "qb-save", text: "" });
    var titleIn = h("input", { class: "qb-input qb-title-in", type: "text", maxlength: "200", "aria-label": "عنوان الاختبار", oninput: function () { doc.meta.title = titleIn.value; changed(true); } });
    var undoBtn = h("button", { type: "button", class: "qb-icon-btn", "aria-label": "تراجع", text: "↶", onclick: undo }), redoBtn = h("button", { type: "button", class: "qb-icon-btn", "aria-label": "إعادة", text: "↷", onclick: redo });
    var canvas = h("div", { class: "qb-canvas", role: "list" }), props = h("aside", { class: "qb-props" }), palette = h("aside", { class: "qb-palette" }), bulk = h("div", { class: "qb-bulk", hidden: true });
    var badgeStatus = h("span", { class: "qb-badge none" });
    QB.mount(host, root);

    /* ---------- تحميل وتحويل ---------- */
    function load() {
      return api("GET", "admin/quiz/" + quizId).then(function (r) {
        var q = r.quiz, secs = {}; r.sections.forEach(function (s) { secs[s.id] = s; });
        var entries = [], lastSec = null;
        r.items.forEach(function (it) {
          if (it.section_id !== lastSec) { if (it.section_id && secs[it.section_id]) entries.push({ key: it.section_id, kind: "section", title: secs[it.section_id].title, description: secs[it.section_id].description || "" }); lastSec = it.section_id; }
          entries.push({ key: it.id, kind: it.kind, question_id: it.question_id, qinfo: it.question, content: it.content || {}, points_override: it.points_override, required: it.required });
        });
        r.sections.forEach(function (s) { if (!entries.some(function (e) { return e.kind === "section" && e.key === s.id; })) entries.push({ key: s.id, kind: "section", title: s.title, description: s.description || "" }); });
        doc = { meta: { title: q.title, description: q.description || "", mode: q.mode, duration_min: q.duration_min, pass_score: q.pass_score, attempts_allowed: q.attempts_allowed, starts_at: q.starts_at, ends_at: q.ends_at, lecture_id: q.lecture_id, settings: Object.assign({ shuffleOptions: true, allowBack: true, showResults: true, allowReview: true, showExplanations: true, official: false }, q.settings || {}), status: q.status, version: q.version, attempts: q.attempts }, entries: entries, conditions: r.conditions.map(function (c) { return { kind: c.kind, source: c.source, op: c.op, value: c.value, target: c.target }; }) };
        titleIn.value = doc.meta.title; hist = [snap()]; hpos = 0; renderAll(); setState("saved");
      }).catch(function (e) { QB.mount(host, h("p", { class: "qb-banner bad", text: QB.errText(e) })); });
    }
    var snap = function () { return JSON.stringify({ meta: doc.meta, entries: doc.entries, conditions: doc.conditions }); };
    function restore(s) { var o = JSON.parse(s); doc.meta = o.meta; doc.entries = o.entries; doc.conditions = o.conditions; titleIn.value = doc.meta.title; if (selected !== null && !find(selected)) selected = null; multi = new Set(); renderAll(); queueSave(); }
    function commit() { // سجل تراجع جديد
      hist = hist.slice(0, hpos + 1); hist.push(snap()); if (hist.length > 80) hist.shift(); hpos = hist.length - 1; queueSave(); renderAll();
    }
    function changed(textOnly) { // تعديلات حقول نصية: نسجّل في التراجع بعد توقف
      clearTimeout(changed.t); changed.t = setTimeout(function () { hist = hist.slice(0, hpos + 1); hist.push(snap()); if (hist.length > 80) hist.shift(); hpos = hist.length - 1; syncUndo(); }, 700); queueSave(); if (!textOnly) renderAll();
    }
    function undo() { if (hpos > 0) { hpos--; restore(hist[hpos]); } }
    function redo() { if (hpos < hist.length - 1) { hpos++; restore(hist[hpos]); } }
    function syncUndo() { undoBtn.disabled = hpos <= 0; redoBtn.disabled = hpos >= hist.length - 1; }
    var find = function (key) { return doc.entries.filter(function (e) { return e.key === key; })[0]; };

    /* ---------- الحفظ التلقائي ---------- */
    function setState(s, msg) { stateEl.className = "qb-save" + (s === "error" ? " err" : ""); stateEl.textContent = { saving: "جارٍ الحفظ…", saved: "تم الحفظ تلقائياً", error: msg || "تعذّر الحفظ", dirty: "تعديلات غير محفوظة" }[s] || ""; }
    function queueSave() { setState("dirty"); dirtySave = true; clearTimeout(saveT); saveT = setTimeout(save, 1400); }
    function payload() {
      var secKey = null, sections = [], items = [];
      doc.entries.forEach(function (e) {
        if (e.kind === "section") { secKey = e.key; sections.push({ id: e.key, title: e.title || "قسم", description: e.description || "" }); return; }
        var it = { id: e.key, kind: e.kind, section: secKey, points_override: e.points_override === "" ? null : e.points_override, required: !!e.required };
        if (e.kind === "question") it.question_id = e.question_id; else it.content = e.content || {};
        items.push(it);
      });
      var m = doc.meta;
      return { meta: { title: m.title, description: m.description, mode: m.mode, duration_min: m.duration_min || null, pass_score: m.pass_score === "" ? null : m.pass_score, attempts_allowed: m.attempts_allowed, starts_at: m.starts_at || null, ends_at: m.ends_at || null, lecture_id: m.lecture_id || null, settings: m.settings }, sections: sections, items: items, conditions: doc.conditions };
    }
    function save() {
      if (saving) { saveT = setTimeout(save, 600); return Promise.resolve(); }
      if (!dirtySave) return Promise.resolve();
      dirtySave = false; saving = true; setState("saving"); var before = snap();
      return api("PUT", "admin/quiz/" + quizId, payload()).then(function (r) {
        saving = false; lastSaved = before;
        // استبدال المفاتيح المؤقتة بالمعرّفات الحقيقية في المستند الحالي (حتى لو تغيّر أثناء الحفظ)
        var im = r.ids.items || {}, sm = r.ids.sections || {}, rekey = {};
        doc.entries.forEach(function (e) { var map = e.kind === "section" ? sm : im, real = map[String(e.key)]; if (real !== undefined && real !== e.key) { rekey[e.key] = real; if (selected === e.key) selected = real; e.key = real; } });
        doc.conditions.forEach(function (c) { if (rekey[c.source] !== undefined) c.source = rekey[c.source]; if (rekey[c.target] !== undefined) c.target = rekey[c.target]; });
        if (Object.keys(rekey).length) { // نحدّث مفاتيح لقطات التراجع ليبقى التراجع صالحاً بعد كل حفظ
          var rk = function (k) { return rekey[k] !== undefined ? rekey[k] : k; };
          hist = hist.map(function (s) { var o = JSON.parse(s); o.entries.forEach(function (e) { e.key = rk(e.key); }); o.conditions.forEach(function (c) { c.source = rk(c.source); c.target = rk(c.target); }); return JSON.stringify(o); });
        }
        syncUndo();
        if (dirtySave) queueSave(); else setState("saved");
      }).catch(function (e) {
        saving = false; dirtySave = true;
        if (e.code === "invalid_rules" || e.code === "too_many_items" || (e.status >= 400 && e.status < 500 && e.status !== 429)) { setState("error", QB.errText(e)); QB.toast(QB.errText(e), "bad"); } else { setState("error", "غير محفوظ — نعيد المحاولة"); saveT = setTimeout(save, 4000); }
      });
    }
    var onUnload = function (e) { if (dirtySave || saving) { e.preventDefault(); e.returnValue = ""; } };
    window.addEventListener("beforeunload", onUnload);
    B.destroy = function () { window.removeEventListener("beforeunload", onUnload); clearTimeout(saveT); };

    /* ---------- عمليات المحتوى ---------- */
    function newEntry(kind, extra) {
      var e = Object.assign({ key: nk(), kind: kind }, extra || {});
      if (kind === "section") { e.title = "قسم جديد"; e.description = ""; } else if (kind === "heading" || kind === "text") e.content = { text: "" }; else if (kind === "image" || kind === "video") e.content = { url: "", caption: "" }; else if (kind === "divider" || kind === "pagebreak") e.content = {};
      return e;
    }
    function insert(entry, index) {
      var i = index !== undefined && index !== null ? index : (selected !== null && doc.entries.indexOf(find(selected)) >= 0 ? doc.entries.indexOf(find(selected)) + 1 : doc.entries.length);
      doc.entries.splice(i, 0, entry); selected = entry.key; commit();
      setTimeout(function () { var el = canvas.querySelector('[data-key="' + entry.key + '"]'); if (el && el.scrollIntoView) el.scrollIntoView({ block: "nearest", behavior: "smooth" }); }, 50);
    }
    function addQuestion(id, index) {
      if (doc.entries.some(function (e) { return e.question_id === id; })) { QB.toast("هذا السؤال موجود في الاختبار", ""); return Promise.resolve(); }
      return api("GET", "admin/question/" + id).then(function (r) { var q = r.question; qcache[id] = q; insert({ key: nk(), kind: "question", question_id: id, qinfo: { type: q.type, status: q.status, difficulty: q.difficulty, points: q.points, text: String(q.content.text || "").slice(0, 300), case_id: q.case_id }, content: {}, required: !!q.content.required }, index); }).catch(function (e) { QB.toast(QB.errText(e), "bad"); });
    }
    function removeKeys(keys) {
      var removed = doc.entries.filter(function (e) { return keys.indexOf(e.key) >= 0; }), before = snap();
      doc.entries = doc.entries.filter(function (e) { return keys.indexOf(e.key) < 0; });
      doc.conditions = doc.conditions.filter(function (c) { return keys.indexOf(c.source) < 0 && keys.indexOf(c.target) < 0; });
      if (keys.indexOf(selected) >= 0) selected = null; multi = new Set(); commit();
      QB.toast(removed.length === 1 ? "تم الحذف" : "تم حذف " + removed.length + " عناصر", "", { label: "تراجع", run: function () { undo(); } });
    }
    function move(key, to) { var i = doc.entries.indexOf(find(key)); if (i < 0) return; var e = doc.entries.splice(i, 1)[0]; if (to > i) to--; doc.entries.splice(Math.max(0, Math.min(doc.entries.length, to)), 0, e); commit(); }
    function duplicate(key) { var e = find(key); if (!e || e.kind === "question") return; var c = JSON.parse(JSON.stringify(e)); c.key = nk(); doc.entries.splice(doc.entries.indexOf(e) + 1, 0, c); selected = c.key; commit(); }
    function qEntries() { return doc.entries.filter(function (e) { return e.kind === "question"; }); }
    function getQ(id) { return qcache[id] ? Promise.resolve(qcache[id]) : api("GET", "admin/question/" + id).then(function (r) { qcache[id] = r.question; return r.question; }); }

    /* ---------- الرسم ---------- */
    function renderAll() { syncUndo(); renderBadge(); renderCanvas(); renderProps(); renderBulk(); root.setAttribute("data-sheet", sheet); }
    function renderBadge() { var st = doc.meta.status; badgeStatus.className = "qb-badge " + (st === "published" ? "ok" : st === "draft" ? "mid" : "none"); badgeStatus.textContent = QB.STATUS[st] || st; }
    var dropLine = h("div", { class: "qb-drop-line", hidden: true });
    function renderCanvas() {
      QB.clear(canvas);
      if (preview) { previewView(); return; }
      if (!doc.entries.length) canvas.appendChild(h("div", { class: "qb-empty qb-dropzone", dataset: { index: "0" } }, h("strong", { text: "الاختبار فارغ" }), "اسحب عناصر من اللوحة أو اضغط عليها لإضافتها، أو أضف أسئلة من البنك."));
      var secNo = 0, qno = 0, vis = null;
      doc.entries.forEach(function (e, i) {
        if (e.kind === "question") qno++; if (e.kind === "section") secNo++;
        canvas.appendChild(entryCard(e, i, qno));
      });
      canvas.appendChild(dropLine);
    }
    function summary(e) {
      if (e.kind === "section") return e.title || "قسم";
      if (e.kind === "question") return (e.qinfo && e.qinfo.text) || "سؤال #" + e.question_id;
      if (e.kind === "heading" || e.kind === "text") return (e.content && e.content.text) || "(فارغ)";
      if (e.kind === "image" || e.kind === "video") return (e.content && (e.content.caption || e.content.url)) || "(بلا رابط)";
      return KIND_NAME[e.kind];
    }
    function entryCard(e, i, qno) {
      var isSel = selected === e.key, bad = e.kind === "question" && e.qinfo && e.qinfo.status !== "published";
      var rules = doc.conditions.filter(function (c) { return c.target === e.key || c.source === e.key; }).length;
      var card = h("div", { class: "qb-entry k-" + e.kind + (isSel ? " sel" : "") + (multi.has(e.key) ? " multi" : "") + (e.collapsed ? " collapsed" : ""), role: "listitem", draggable: "true", dataset: { key: String(e.key), index: String(i) },
        onclick: function (ev) { if (ev.target.closest("input,button,select,textarea,label")) return; selected = e.key; sheet = window.innerWidth < 1024 ? "props" : sheet; renderAll(); } });
      card.addEventListener("dragstart", function (ev) { ev.dataTransfer.setData("text/qb", JSON.stringify({ t: "move", key: e.key })); ev.dataTransfer.effectAllowed = "move"; card.classList.add("dragging"); });
      card.addEventListener("dragend", function () { card.classList.remove("dragging"); dropLine.hidden = true; });
      var chk = h("input", { type: "checkbox", "aria-label": "تحديد", checked: multi.has(e.key), onchange: function () { if (chk.checked) multi.add(e.key); else multi.delete(e.key); renderBulk(); card.classList.toggle("multi", chk.checked); } });
      var head = h("div", { class: "qb-entry-head" }, h("span", { class: "qb-handle", "aria-hidden": "true", title: "اسحب لإعادة الترتيب", text: "⋮⋮" }), chk,
        h("span", { class: "qb-kind", text: e.kind === "question" ? "س" + qno : KIND_NAME[e.kind] }),
        e.kind === "question" && e.qinfo ? [h("span", { class: "qb-chip", text: QB.TYPE_SHORT[e.qinfo.type] || e.qinfo.type }), h("span", { class: "qb-chip d" + e.qinfo.difficulty, text: QB.DIFF[e.qinfo.difficulty] })] : null,
        bad ? h("span", { class: "qb-badge bad", text: QB.STATUS[e.qinfo.status] + " — لن يُنشر الاختبار" }) : null, rules ? h("span", { class: "qb-chip on", title: "قواعد منطقية", text: "⚙ " + rules }) : null,
        h("span", { class: "qb-grow" }),
        h("button", { type: "button", class: "qb-icon-btn", "aria-label": "أعلى", disabled: i === 0, text: "↑", onclick: function () { move(e.key, i - 1); } }),
        h("button", { type: "button", class: "qb-icon-btn", "aria-label": "أسفل", disabled: i === doc.entries.length - 1, text: "↓", onclick: function () { move(e.key, i + 2); } }),
        h("button", { type: "button", class: "qb-icon-btn", "aria-label": e.collapsed ? "توسيع" : "طيّ", "aria-expanded": String(!e.collapsed), text: e.collapsed ? "▾" : "▴", onclick: function () { e.collapsed = !e.collapsed; renderCanvas(); } }),
        e.kind !== "question" ? h("button", { type: "button", class: "qb-icon-btn", "aria-label": "تكرار", text: "⎘", onclick: function () { duplicate(e.key); } }) : null,
        h("button", { type: "button", class: "qb-icon-btn", "aria-label": "حذف", text: "🗑", onclick: function () { removeKeys([e.key]); } }));
      var body = null;
      if (!e.collapsed) {
        if (e.kind === "section") { var t = h("input", { class: "qb-input", type: "text", value: e.title || "", maxlength: "200", "aria-label": "عنوان القسم", oninput: function () { e.title = t.value; changed(true); } }); body = t; }
        else if (e.kind === "question") body = h("p", { class: "qb-entry-text", text: summary(e) });
        else if (e.kind === "heading" || e.kind === "text") { var ta = h(e.kind === "heading" ? "input" : "textarea", { class: "qb-input", type: e.kind === "heading" ? "text" : null, rows: e.kind === "text" ? "3" : null, maxlength: "4000", value: e.content.text || "", placeholder: e.kind === "heading" ? "عنوان…" : "نص أو وصف…", "aria-label": "النص", oninput: function () { e.content.text = ta.value; changed(true); } }); body = ta; }
        else if (e.kind === "image" || e.kind === "video") body = h("div", { class: "qb-stack" }, h("input", { class: "qb-input", type: "url", dir: "ltr", placeholder: "https://…", value: e.content.url || "", "aria-label": "رابط", oninput: function () { e.content.url = this.value.trim(); changed(true); } }), e.kind === "image" && QB.safeSrc(e.content.url) ? h("img", { class: "qb-thumb", src: e.content.url, alt: e.content.caption || "" }) : null);
        else if (e.kind === "divider") body = h("hr");
        else if (e.kind === "pagebreak") body = h("p", { class: "qb-muted", text: "بداية صفحة جديدة" });
      }
      card.appendChild(head); if (body) card.appendChild(h("div", { class: "qb-entry-body" }, body));
      return card;
    }
    // منطقة الإفلات على اللوحة
    canvas.addEventListener("dragover", function (ev) {
      ev.preventDefault(); var cards = [].slice.call(canvas.querySelectorAll(".qb-entry")), idx = cards.length;
      for (var i = 0; i < cards.length; i++) { var r = cards[i].getBoundingClientRect(); if (ev.clientY < r.top + r.height / 2) { idx = i; break; } }
      canvas.dataset.drop = String(idx); dropLine.hidden = false;
      var ref = cards[idx]; if (ref) canvas.insertBefore(dropLine, ref); else canvas.appendChild(dropLine);
    });
    canvas.addEventListener("dragleave", function (ev) { if (!canvas.contains(ev.relatedTarget)) dropLine.hidden = true; });
    canvas.addEventListener("drop", function (ev) {
      ev.preventDefault(); dropLine.hidden = true; var idx = Number(canvas.dataset.drop || doc.entries.length), data; try { data = JSON.parse(ev.dataTransfer.getData("text/qb")); } catch (e) { return; }
      if (data.t === "move") move(data.key, idx); else if (data.t === "display") insert(newEntry(data.kind), idx); else if (data.t === "bank") addQuestion(data.id, idx); else if (data.t === "type") createQuestion(data.type, idx);
    });

    /* ---------- التحديد الجماعي ---------- */
    function renderBulk() {
      bulk.hidden = !multi.size; QB.clear(bulk); if (!multi.size) return;
      var secs = doc.entries.filter(function (e) { return e.kind === "section"; });
      var sel = h("select", { class: "qb-input", "aria-label": "نقل إلى قسم" }, [h("option", { value: "", text: "نقل إلى قسم…" }), h("option", { value: "__start", text: "بداية الاختبار (بلا قسم)" })].concat(secs.map(function (s) { return h("option", { value: String(s.key), text: s.title || "قسم" }); })));
      sel.addEventListener("change", function () { if (!sel.value) return; moveToSection(sel.value); });
      QB.mount(bulk, [h("strong", { text: multi.size + " محدد" }), sel, h("button", { type: "button", class: "qb-btn qb-btn-sm qb-btn-danger", text: "حذف المحدد", onclick: function () { removeKeys(Array.from(multi)); } }), h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "إلغاء التحديد", onclick: function () { multi = new Set(); renderAll(); } })]);
    }
    function moveToSection(secKey) {
      var keys = Array.from(multi), moving = doc.entries.filter(function (e) { return keys.indexOf(e.key) >= 0 && e.kind !== "section"; });
      var rest = doc.entries.filter(function (e) { return moving.indexOf(e) < 0; }), at;
      if (secKey === "__start") at = 0; else { var sIdx = rest.indexOf(rest.filter(function (e) { return String(e.key) === secKey; })[0]); at = sIdx + 1; while (at < rest.length && rest[at].kind !== "section") at++; }
      var out = rest.slice(0, at).concat(moving, rest.slice(at)); doc.entries = out; multi = new Set(); commit();
    }

    /* ---------- لوحة الخصائص ---------- */
    function renderProps() {
      var e = selected !== null ? find(selected) : null, kids = [h("div", { class: "qb-sheet-head" }, h("strong", { text: e ? "خصائص: " + (KIND_NAME[e.kind] || "") : "الخصائص" }), h("button", { type: "button", class: "qb-icon-btn qb-sheet-x", "aria-label": "إغلاق", text: "×", onclick: function () { sheet = ""; renderAll(); } }))];
      if (!e) { kids.push(h("p", { class: "qb-muted", text: "اختر عنصراً من الاختبار لتعديل خصائصه، أو افتح «إعدادات الاختبار» لتعديل المدة والمحاولات والتوقيت." })); kids.push(h("button", { type: "button", class: "qb-btn", text: "إعدادات الاختبار", onclick: settingsDialog })); QB.mount(props, kids); return; }
      if (e.kind === "section") { var d = h("textarea", { class: "qb-input", rows: "3", maxlength: "1000", value: e.description || "", oninput: function () { e.description = d.value; changed(true); } }); kids.push(h("label", { class: "qb-label" }, "وصف القسم", d)); }
      if (e.kind === "image" || e.kind === "video") { var cap = h("input", { class: "qb-input", type: "text", maxlength: "300", value: e.content.caption || "", oninput: function () { e.content.caption = cap.value; changed(true); } }); kids.push(h("label", { class: "qb-label" }, "وصف / تعليق", cap)); }
      if (e.kind === "question") {
        var po = h("input", { class: "qb-input", type: "number", min: "0.25", step: "0.25", dir: "ltr", placeholder: "الأصلية: " + (e.qinfo ? e.qinfo.points : ""), value: e.points_override == null ? "" : String(e.points_override), oninput: function () { e.points_override = po.value === "" ? null : Number(po.value); changed(true); } });
        var rq = h("input", { type: "checkbox", checked: !!e.required, onchange: function () { e.required = rq.checked; changed(true); } });
        kids.push(h("div", { class: "qb-card" }, h("p", { class: "qb-entry-text", text: summary(e) }), h("div", { class: "qb-row" }, e.qinfo ? h("span", { class: "qb-badge " + (e.qinfo.status === "published" ? "ok" : "mid"), text: QB.STATUS[e.qinfo.status] }) : null, h("a", { class: "qb-btn qb-btn-sm", href: "#/s/" + S.id + "/q/" + e.question_id, target: "_blank", rel: "noopener", text: "تعديل السؤال ↗" }))));
        kids.push(h("label", { class: "qb-label" }, "درجة السؤال في هذا الاختبار", po)); kids.push(h("label", { class: "qb-check" }, rq, h("span", { text: "إجابة مطلوبة" })));
      }
      if (e.kind !== "section") kids.push(conditionsPanel(e));
      QB.mount(props, kids);
    }
    function conditionsPanel(e) {
      var wrap = h("div", { class: "qb-stack" }), off = doc.meta.settings.official && doc.meta.mode === "exam";
      wrap.appendChild(h("h4", { text: "المنطق الشرطي" }));
      if (off) { wrap.appendChild(h("p", { class: "qb-banner", text: "المنطق الشرطي معطّل في الامتحانات الرسمية لمنع كشف الإجابات." })); return wrap; }
      var idx = doc.entries.indexOf(e), earlier = doc.entries.slice(0, idx).filter(function (x) { return x.kind === "question"; }), later = doc.entries.slice(idx + 1).filter(function (x) { return x.kind !== "pagebreak"; });
      var ruleRow = function (c, ci, mode) {
        var srcSel = h("select", { class: "qb-input", "aria-label": "السؤال المصدر", disabled: mode === "jump" }, (mode === "jump" ? [e] : earlier).map(function (s) { return h("option", { value: String(s.key), text: "س" + (qEntries().indexOf(s) + 1) + ": " + summary(s).slice(0, 36), selected: s.key === c.source }); }));
        var opSel = h("select", { class: "qb-input", "aria-label": "الشرط" }, OPS.map(function (o) { return h("option", { value: o[0], text: o[1], selected: c.op === o[0] }); }));
        var valHost = h("div");
        var tgtSel = mode === "jump" ? h("select", { class: "qb-input", "aria-label": "الوجهة" }, later.map(function (s) { return h("option", { value: String(s.key), text: (s.kind === "question" ? "س" + (qEntries().indexOf(s) + 1) + ": " : KIND_NAME[s.kind] + ": ") + summary(s).slice(0, 32), selected: s.key === c.target }); })) : null;
        function drawVal() {
          QB.clear(valHost); if (c.op === "answered" || c.op === "notanswered") return;
          var src = find(c.source); var q = src && src.question_id ? qcache[src.question_id] : null;
          var opts = q && q.content && q.content.options ? q.content.options : (q && q.type === "tf" ? [{ id: "true", text: "صح" }, { id: "false", text: "خطأ" }] : null);
          if (opts) { var s = h("select", { class: "qb-input", multiple: c.op === "in" ? "" : null, "aria-label": "القيمة" }, opts.map(function (o) { var cur = c.op === "in" ? [].concat(c.value || []).map(String) : [String(c.value)]; return h("option", { value: o.id, text: o.text, selected: cur.indexOf(String(o.id)) >= 0 }); })); s.addEventListener("change", function () { var vals = [].slice.call(s.selectedOptions).map(function (o) { return o.value; }); var conv = function (v) { return v === "true" ? true : v === "false" ? false : v; }; c.value = c.op === "in" ? vals.map(conv) : conv(vals[0]); changed(true); }); valHost.appendChild(s); }
          else { var t = h("input", { class: "qb-input", type: "text", value: c.value == null ? "" : String([].concat(c.value).join("، ")), placeholder: "القيمة", "aria-label": "القيمة", oninput: function () { c.value = c.op === "in" ? t.value.split(/[,،]/).map(function (x) { return x.trim(); }).filter(Boolean) : t.value; changed(true); } }); valHost.appendChild(t); }
        }
        srcSel.addEventListener("change", function () { c.source = isNaN(srcSel.value) ? srcSel.value : Number(srcSel.value); var s = find(c.source); if (s && s.question_id) getQ(s.question_id).then(function () { drawVal(); }); c.value = null; changed(true); drawVal(); });
        opSel.addEventListener("change", function () { c.op = opSel.value; if (c.op === "in") c.value = c.value == null ? [] : [].concat(c.value); else if (Array.isArray(c.value)) c.value = c.value[0]; drawVal(); changed(true); });
        if (tgtSel) tgtSel.addEventListener("change", function () { c.target = isNaN(tgtSel.value) ? tgtSel.value : Number(tgtSel.value); changed(true); });
        var srcEntry = find(c.source); if (srcEntry && srcEntry.question_id) getQ(srcEntry.question_id).then(drawVal); else drawVal();
        return h("div", { class: "qb-pair" }, mode === "show" ? h("small", { class: "qb-muted", text: "أظهر هذا العنصر إذا كانت إجابة:" }) : h("small", { class: "qb-muted", text: "إذا كانت إجابة هذا السؤال:" }), srcSel, opSel, valHost, tgtSel ? [h("small", { class: "qb-muted", text: "فتخطَّ كل ما بينه وبين:" }), tgtSel] : null,
          h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "حذف القاعدة", onclick: function () { doc.conditions.splice(ci, 1); commit(); } }));
      };
      doc.conditions.forEach(function (c, ci) { if (c.kind === "show_if" && c.target === e.key) wrap.appendChild(ruleRow(c, ci, "show")); if (c.kind === "jump" && c.source === e.key) wrap.appendChild(ruleRow(c, ci, "jump")); });
      var addRow = h("div", { class: "qb-row" });
      if (earlier.length) addRow.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "+ شرط ظهور", onclick: function () { doc.conditions.push({ kind: "show_if", source: earlier[earlier.length - 1].key, op: "answered", value: null, target: e.key }); commit(); } }));
      if (e.kind === "question" && later.length) addRow.appendChild(h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "+ قفزة", onclick: function () { doc.conditions.push({ kind: "jump", source: e.key, op: "eq", value: "", target: later[0].key }); commit(); } }));
      wrap.appendChild(addRow);
      if (!earlier.length && !(e.kind === "question" && later.length)) wrap.appendChild(h("p", { class: "qb-muted", text: "تُبنى الشروط على إجابة سؤال سابق فقط؛ لا رجوع للخلف ولا حلقات." }));
      return wrap;
    }

    /* ---------- لوحة العناصر ---------- */
    function renderPalette() {
      var tabs = ["items", "bank", "gen"], tab = renderPalette.tab || "items";
      var bar = h("div", { class: "qb-tabs" }, [["items", "عناصر"], ["bank", "من البنك"], ["gen", "توليد"]].map(function (t) { return h("button", { type: "button", class: "qb-tab", role: "tab", "aria-selected": String(t[0] === tab), text: t[1], onclick: function () { renderPalette.tab = t[0]; renderPalette(); } }); }));
      var body = h("div", { class: "qb-stack" });
      if (tab === "items") {
        body.appendChild(h("h4", { text: "عناصر العرض" }));
        body.appendChild(h("div", { class: "qb-pal-grid" }, DISPLAY.map(function (d) { return palItem(d[2], d[1], { t: "display", kind: d[0] }, function () { insert(newEntry(d[0])); closeSheet(); }); })));
        body.appendChild(h("h4", { text: "سؤال جديد" }));
        body.appendChild(h("div", { class: "qb-pal-grid" }, QBEditor.TYPES.map(function (t) { return palItem(QB.TYPE_SHORT[t], QB.TYPE_NAMES[t], { t: "type", type: t }, function () { createQuestion(t); closeSheet(); }); })));
      } else if (tab === "bank") bankPicker(body); else genPanel(body);
      QB.mount(palette, [h("div", { class: "qb-sheet-head" }, h("strong", { text: "إضافة" }), h("button", { type: "button", class: "qb-icon-btn qb-sheet-x", "aria-label": "إغلاق", text: "×", onclick: closeSheet })), bar, body]);
    }
    function closeSheet() { sheet = ""; root.setAttribute("data-sheet", ""); }
    function palItem(icon, label, data, onclick) {
      var b = h("button", { type: "button", class: "qb-pal-item", draggable: "true", onclick: onclick }, h("span", { class: "qb-pal-ico", text: icon }), h("span", { text: label }));
      b.addEventListener("dragstart", function (ev) { ev.dataTransfer.setData("text/qb", JSON.stringify(data)); ev.dataTransfer.effectAllowed = "copy"; }); return b;
    }
    function bankPicker(body) {
      var q = "", type = "", offset = 0, list = h("div", { class: "qb-stack" }), more = h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "المزيد", hidden: true });
      var search = h("input", { class: "qb-input", type: "search", placeholder: "ابحث في الأسئلة المنشورة…", "aria-label": "بحث", oninput: QB.debounce(function () { q = search.value; offset = 0; QB.clear(list); fetchPage(); }, 300) });
      var ts = h("select", { class: "qb-input", "aria-label": "النوع", onchange: function () { type = ts.value; offset = 0; QB.clear(list); fetchPage(); } }, [h("option", { value: "", text: "كل الأنواع" })].concat(QBEditor.TYPES.map(function (t) { return h("option", { value: t, text: QB.TYPE_SHORT[t] }); })));
      function fetchPage() {
        api("GET", "admin/questions?subject=" + S.id + "&status=published&limit=20&offset=" + offset + "&q=" + encodeURIComponent(q) + (type ? "&type=" + type : "")).then(function (r) {
          if (!r.questions.length && !offset) list.appendChild(h("p", { class: "qb-muted", text: "لا توجد أسئلة منشورة مطابقة." }));
          r.questions.forEach(function (it) {
            var used = doc.entries.some(function (e) { return e.question_id === it.id; });
            var row = h("div", { class: "qb-bank-item", draggable: "true" }, h("div", { class: "qb-grow" }, h("p", { class: "qb-entry-text", text: String(it.content.text || "").slice(0, 110) }), h("span", { class: "qb-chip", text: QB.TYPE_SHORT[it.type] }), " ", h("span", { class: "qb-chip d" + it.difficulty, text: QB.DIFF[it.difficulty] })),
              h("button", { type: "button", class: "qb-icon-btn", "aria-label": "إضافة", disabled: used, text: used ? "✓" : "+", onclick: function (ev) { addQuestion(it.id).then(function () { ev.target.disabled = true; ev.target.textContent = "✓"; }); } }));
            row.addEventListener("dragstart", function (ev) { ev.dataTransfer.setData("text/qb", JSON.stringify({ t: "bank", id: it.id })); ev.dataTransfer.effectAllowed = "copy"; });
            list.appendChild(row);
          });
          offset += r.questions.length; more.hidden = offset >= r.total;
        }).catch(function (e) { list.appendChild(h("p", { class: "qb-banner bad", text: QB.errText(e) })); });
      }
      more.addEventListener("click", fetchPage); body.appendChild(search); body.appendChild(ts); body.appendChild(list); body.appendChild(more); fetchPage();
    }
    function genPanel(body) {
      var count = h("input", { class: "qb-input", type: "number", min: "1", max: "200", value: "10", dir: "ltr" });
      var lec = h("select", { class: "qb-input", "aria-label": "المحاضرة" }, [h("option", { value: "", text: "كل المحاضرات" })].concat(S.lectures.map(function (l) { return h("option", { value: String(l.id), text: l.number + ". " + l.title }); })));
      var cat = h("select", { class: "qb-input", "aria-label": "التصنيف" }, [h("option", { value: "", text: "كل التصنيفات" })].concat(S.categories.map(function (c) { return h("option", { value: String(c.id), text: c.name }); })));
      var mix = [1, 2, 3].map(function (d) { return h("input", { class: "qb-input", type: "number", min: "0", max: "200", placeholder: "0", dir: "ltr", "aria-label": QB.DIFF[d] }); });
      var go = h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "ولّد وأضف", onclick: function () {
        var b = { subject_id: S.id, count: Number(count.value) || 10, exclude_ids: doc.entries.map(function (e) { return e.question_id; }).filter(Boolean) };
        if (lec.value) b.lectures = [Number(lec.value)]; if (cat.value) b.categories = [Number(cat.value)];
        var m = {}, any = false; mix.forEach(function (i, k) { if (i.value) { m[k + 1] = Number(i.value); any = true; } }); if (any) b.difficulty = m;
        go.disabled = true;
        api("POST", "admin/quizzes/generate", b).then(function (r) {
          if (!r.ids.length) { QB.toast("لا توجد أسئلة منشورة مطابقة", ""); return; }
          return r.ids.reduce(function (p, id) { return p.then(function () { return addQuestion(id, doc.entries.length); }); }, Promise.resolve()).then(function () { QB.toast("أُضيف " + r.ids.length + " سؤالاً" + (r.shortfall ? " (المتاح أقل من المطلوب بـ" + r.shortfall + ")" : ""), "ok"); });
        }).catch(function (e) { QB.toast(QB.errText(e), "bad"); }).then(function () { go.disabled = false; });
      } });
      body.appendChild(h("p", { class: "qb-hint", text: "يختار أسئلة منشورة من البنك دون تكرار ودون ما هو موجود في الاختبار." }));
      body.appendChild(h("label", { class: "qb-label" }, "العدد", count)); body.appendChild(lec); body.appendChild(cat);
      body.appendChild(h("details", { class: "qb-more" }, h("summary", { text: "توزيع الصعوبة (اختياري)" }), h("div", { class: "qb-grid2" }, [1, 2, 3].map(function (d, k) { return h("label", { class: "qb-label" }, QB.DIFF[d], mix[k]); }))));
      body.appendChild(go);
    }

    /* ---------- إنشاء سؤال جديد داخل الاختبار ---------- */
    function createQuestion(type, index) {
      var dlg = h("div", { class: "qb-overlay qb-full" }, h("div", { class: "qb-dialog qb-dialog-wide" })), inner = dlg.firstChild;
      document.body.appendChild(dlg);
      QBEditor.open(inner, { type: type, subject: S, onSaved: function (id, wasNew) { if (wasNew) { dlg.remove(); addQuestion(id, index); } }, onClose: function () { dlg.remove(); } });
    }

    /* ---------- المعاينة ---------- */
    function previewView() {
      var answers = {}, wrap = h("div", { class: "qb-stack" }), official = doc.meta.settings.official && doc.meta.mode === "exam";
      var items = doc.entries.filter(function (e) { return e.kind !== "section"; }), all = doc.entries;
      function drawP() {
        var itemsPos = all.map(function (e, i) { return { id: e.key, kind: e.kind, position: i + 1 }; });
        var rules = doc.conditions.map(function (c) { return { kind: c.kind, source: c.source, op: c.op, value: c.value, target: c.target }; });
        var vis = QBLogic.computeVisible(itemsPos, rules, answers, { disabled: official });
        QB.clear(wrap); wrap.appendChild(h("p", { class: "qb-banner", text: "معاينة: هكذا يرى الطالب الاختبار" + (official ? " (المنطق الشرطي معطّل)" : "") + ". الإجابات هنا لا تُحفظ." }));
        var qn = 0;
        all.forEach(function (e) {
          if (!vis.has(e.key) && e.kind !== "section") return;
          if (e.kind === "section") wrap.appendChild(h("h2", { class: "qb-sect", text: e.title }));
          else if (e.kind === "heading") wrap.appendChild(h("h2", { class: "qb-sect", text: e.content.text }));
          else if (e.kind === "text") wrap.appendChild(h("p", { class: "qb-card", text: e.content.text }));
          else if (e.kind === "image" || e.kind === "video") wrap.appendChild(QB.media([{ kind: e.kind === "video" ? "video" : "image", url: e.content.url, caption: e.content.caption }]));
          else if (e.kind === "divider") wrap.appendChild(h("hr")); else if (e.kind === "pagebreak") wrap.appendChild(h("div", { class: "qb-pagebreak", text: "— صفحة جديدة —" }));
          else if (e.kind === "question") { qn++; var holder = h("div", { class: "qb-pv-q", dataset: { key: String(e.key) } }); wrap.appendChild(holder); getQ(e.question_id).then(function (q) { return api("POST", "admin/preview", { type: q.type, content: q.content }); }).then(function (r) { r.question.points = e.points_override || r.question.points; QB.mount(holder, QB.renderQuestion(r.question, { qnum: qn, answer: answers[e.key], onChange: function (v) { var old = JSON.stringify(answers[e.key]); if (v === null) delete answers[e.key]; else answers[e.key] = v; if (doc.conditions.length) drawP(); } })); }).catch(function (er) { QB.mount(holder, h("p", { class: "qb-banner bad", text: QB.errText(er) })); }); }
        });
      }
      drawP(); canvas.appendChild(wrap);
    }

    /* ---------- الإعدادات والحالة ---------- */
    function settingsDialog() {
      var m = doc.meta, ro = m.status === "published" && m.attempts > 0;
      var inp = function (label, key, type, opts) { var i = h("input", { class: "qb-input", type: type || "text", dir: type === "number" ? "ltr" : null, min: opts && opts.min, step: opts && opts.step, value: m[key] == null ? "" : String(m[key]), placeholder: opts && opts.ph || "" }); i.addEventListener("input", function () { m[key] = type === "number" ? (i.value === "" ? null : Number(i.value)) : i.value; changed(true); }); return h("label", { class: "qb-label" }, label, i, opts && opts.hint ? h("small", { class: "qb-muted", text: opts.hint }) : null); };
      var dt = function (label, key) { var i = h("input", { class: "qb-input", type: "datetime-local", dir: "ltr", value: m[key] ? toLocal(m[key]) : "" }); i.addEventListener("change", function () { m[key] = i.value ? new Date(i.value).getTime() : null; changed(true); }); return h("label", { class: "qb-label" }, label, i); };
      var mode = h("select", { class: "qb-input", onchange: function () { m.mode = mode.value; changed(false); } }, [["practice", "تدريب (شرح فوري)"], ["exam", "امتحان"]].map(function (o) { return h("option", { value: o[0], text: o[1], selected: m.mode === o[0] }); }));
      var lec = h("select", { class: "qb-input", onchange: function () { m.lecture_id = lec.value ? Number(lec.value) : null; changed(true); } }, [h("option", { value: "", text: "— كل المادة —" })].concat(S.lectures.map(function (l) { return h("option", { value: String(l.id), text: l.number + ". " + l.title, selected: m.lecture_id === l.id }); })));
      var chks = SETS.map(function (s) { var c = h("input", { type: "checkbox", checked: !!m.settings[s[0]], disabled: !!s[2], onchange: function () { m.settings[s[0]] = c.checked; changed(false); } }); return h("label", { class: "qb-check" }, c, h("span", { text: s[1] })); });
      var desc = h("textarea", { class: "qb-input", rows: "2", maxlength: "2000", value: m.description || "", oninput: function () { m.description = desc.value; changed(true); } });
      var dlg = h("div", { class: "qb-overlay", onclick: function (e) { if (e.target === dlg) dlg.remove(); } }, h("div", { class: "qb-dialog qb-dialog-wide" }, h("h3", { text: "إعدادات الاختبار" }), ro ? h("p", { class: "qb-banner", text: "للاختبار محاولات؛ تغيير الإعدادات يسري على المحاولات الجديدة فقط (اللقطات القديمة ثابتة)." }) : null,
        h("div", { class: "qb-stack" }, h("label", { class: "qb-label" }, "الوصف", desc), h("div", { class: "qb-grid2" }, h("label", { class: "qb-label" }, "النمط", mode), h("label", { class: "qb-label" }, "المحاضرة", lec), inp("المدة (دقائق)", "duration_min", "number", { min: "1", ph: "بلا مؤقت" }), inp("درجة النجاح", "pass_score", "number", { min: "0", step: "0.5", ph: "بلا حد" }), inp("عدد المحاولات (0 = بلا حد)", "attempts_allowed", "number", { min: "0" }), h("span"), dt("يبدأ في", "starts_at"), dt("ينتهي في", "ends_at")), h("div", { class: "qb-stack" }, chks),
          h("div", { class: "qb-row end" }, h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "تم", onclick: function () { dlg.remove(); } })))));
      document.body.appendChild(dlg);
    }
    function toLocal(t) { var d = new Date(t), p = function (n) { return String(n).padStart(2, "0"); }; return d.getFullYear() + "-" + p(d.getMonth() + 1) + "-" + p(d.getDate()) + "T" + p(d.getHours()) + ":" + p(d.getMinutes()); }
    function setStatus(to) {
      save().then(function () { return api("POST", "admin/quiz/" + quizId + "/status", { to: to }); }).then(function (r) { doc.meta.status = r.status; QB.toast("الحالة: " + QB.STATUS[r.status], "ok"); renderAll(); })
        .catch(function (e) {
          var msg = QB.errText(e);
          if (e.code === "questions_not_published" && e.data && e.data.question_ids) { doc.entries.forEach(function (x) { if (e.data.question_ids.indexOf(x.question_id) >= 0 && x.qinfo) x.qinfo.status = x.qinfo.status === "published" ? "draft" : x.qinfo.status; }); renderCanvas(); msg += " (" + e.data.question_ids.length + ")"; }
          QB.toast(msg, "bad");
        });
    }
    function statusMenu() {
      var st = doc.meta.status, acts = [];
      if (!S.review) { QB.toast("النشر للممثل أو المشرف. اترك الاختبار مسودة ليراجعه.", ""); return; }
      if (st === "draft" || st === "closed" || st === "archived") acts.push(["نشر الآن", "published"]);
      if (st === "draft") acts.push(["جدولة (حسب وقت البدء)", "scheduled"]);
      if (st === "published" || st === "scheduled") { acts.push(["إغلاق", "closed"]); acts.push(["إرجاع لمسودة", "draft"]); }
      if (st !== "archived") acts.push(["أرشفة", "archived"]);
      var dlg = h("div", { class: "qb-overlay", onclick: function (e) { if (e.target === dlg) dlg.remove(); } }, h("div", { class: "qb-dialog" }, h("h3", { text: "حالة الاختبار: " + QB.STATUS[st] }), h("div", { class: "qb-stack" }, acts.map(function (a) { return h("button", { type: "button", class: "qb-btn" + (a[1] === "published" ? " qb-btn-accent" : ""), text: a[0], onclick: function () { dlg.remove(); setStatus(a[1]); } }); }), h("button", { type: "button", class: "qb-btn qb-btn-link", text: "إلغاء", onclick: function () { dlg.remove(); } }))));
      document.body.appendChild(dlg);
    }
    function statsDialog() {
      api("GET", "admin/quiz/" + quizId + "/stats").then(function (r) {
        var dlg = h("div", { class: "qb-overlay", onclick: function (e) { if (e.target === dlg) dlg.remove(); } }, h("div", { class: "qb-dialog qb-dialog-wide" }, h("h3", { text: "إحصاءات الاختبار" }),
          h("div", { class: "qb-stats" }, stat(r.attempts, "محاولة"), stat(r.avg_percent + "%", "المتوسط"), stat(r.min + "–" + r.max, "أدنى/أعلى %"), stat(r.pass_rate == null ? "—" : r.pass_rate + "%", "نسبة النجاح"), stat(r.pending_review, "تنتظر التصحيح")),
          r.per_question.length ? [h("h4", { text: "الأسئلة الأصعب (الأقل صحة)" }), r.per_question.slice(0, 10).map(function (p) { var en = doc.entries.filter(function (e) { return e.question_id === p.question_id; })[0]; return h("div", { class: "qb-bar-row" }, h("span", { text: en ? summary(en).slice(0, 40) : "#" + p.question_id }), h("div", { class: "qb-progress" }, h("i", { style: "width:" + p.correct_percent + "%" })), h("span", { text: p.correct_percent + "%" })); })] : h("p", { class: "qb-muted", text: "لا محاولات بعد." }),
          h("div", { class: "qb-row end" }, h("button", { type: "button", class: "qb-btn", text: "إغلاق", onclick: function () { dlg.remove(); } }))));
        document.body.appendChild(dlg);
      }).catch(function (e) { QB.toast(QB.errText(e), "bad"); });
    }
    function stat(v, l) { return h("div", { class: "qb-stat" }, h("b", { text: String(v) }), h("span", { text: l })); }

    /* ---------- الهيكل ---------- */
    root.appendChild(h("div", { class: "qb-b-bar" },
      h("button", { type: "button", class: "qb-icon-btn", "aria-label": "رجوع", text: "→", onclick: function () { save().then(function () { B.destroy(); onExit(); }); } }),
      h("div", { class: "qb-grow" }, titleIn), badgeStatus, stateEl, undoBtn, redoBtn,
      h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "معاينة", "aria-pressed": "false", onclick: function (ev) { preview = !preview; ev.target.textContent = preview ? "تحرير" : "معاينة"; renderAll(); } }),
      h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "الإعدادات", onclick: settingsDialog }),
      h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "إحصاءات", onclick: statsDialog }),
      h("button", { type: "button", class: "qb-btn qb-btn-sm", text: "نسخ", onclick: function () { save().then(function () { return api("POST", "admin/quiz/" + quizId + "/duplicate", {}); }).then(function (r) { B.destroy(); location.hash = "#/s/" + S.id + "/quiz/" + r.id; }).catch(function (e) { QB.toast(QB.errText(e), "bad"); }); } }),
      h("button", { type: "button", class: "qb-btn qb-btn-accent qb-btn-sm", text: "الحالة / نشر", onclick: statusMenu })));
    root.appendChild(h("div", { class: "qb-b-grid" }, palette, h("section", { class: "qb-center" }, bulk, canvas), props));
    root.appendChild(h("div", { class: "qb-fab-row" }, h("button", { type: "button", class: "qb-btn qb-btn-primary", text: "+ إضافة", onclick: function () { sheet = "palette"; renderPalette(); renderAll(); } }), h("button", { type: "button", class: "qb-btn", text: "الخصائص", onclick: function () { sheet = "props"; renderAll(); } })));
    root.appendChild(h("div", { class: "qb-sheet-backdrop", onclick: function () { sheet = ""; renderAll(); } }));
    document.addEventListener("keydown", function kd(ev) { if (!document.body.contains(root)) { document.removeEventListener("keydown", kd); return; } if ((ev.ctrlKey || ev.metaKey) && ev.key.toLowerCase() === "z" && !/INPUT|TEXTAREA|SELECT/.test((document.activeElement || {}).tagName || "")) { ev.preventDefault(); ev.shiftKey ? redo() : undo(); } });
    renderPalette();
    return load();
  };
})();
