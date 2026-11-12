/* مركز الرفع (تصميم AXON بألوان المنصة): رفع عشرات الملفات، مطابقة تلقائية مع المحاضرات، طابور بتقدّم وإيقاف وإعادة محاولة. */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var CH = 2 * 1024 * 1024, MAX = 20 * 1024 * 1024, CONC = 3, RETRY = [2000, 5000, 10000];
  var params = new URLSearchParams(location.search);
  var uploaded = [], options = null, canLogo = false, TYPE = "lecture", items = [], uid = 0, existing = [], batchStart = Date.now();
  var C = $("c"), D = $("d"), S = $("s");

  var P = { upload: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M12 16V4M7 9l5-5 5 5M4 16v3a1 1 0 0 0 1 1h14a1 1 0 0 0 1-1v-3"/></svg>',
    file: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M14 3H7a2 2 0 0 0-2 2v14a2 2 0 0 0 2 2h10a2 2 0 0 0 2-2V8z"/><path d="M14 3v5h5"/></svg>',
    folder: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M3 7a2 2 0 0 1 2-2h4l2 2h8a2 2 0 0 1 2 2v8a2 2 0 0 1-2 2H5a2 2 0 0 1-2-2z"/></svg>',
    link: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M10 14a4 4 0 0 0 5.7 0l3-3a4 4 0 0 0-5.7-5.7l-1 1M14 10a4 4 0 0 0-5.7 0l-3 3A4 4 0 0 0 11 18.7l1-1"/></svg>',
    pause: '<svg viewBox="0 0 24 24" fill="currentColor"><rect x="6" y="5" width="4" height="14" rx="1"/><rect x="14" y="5" width="4" height="14" rx="1"/></svg>',
    play: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M7 4.5v15l13-7.5z"/></svg>',
    retry: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M20 11a8 8 0 1 0-2.3 5.7M20 4v7h-7"/></svg>',
    x: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.4" stroke-linecap="round"><path d="M6 6l12 12M18 6L6 18"/></svg>',
    check: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="3" stroke-linecap="round" stroke-linejoin="round"><path d="M5 12.5l4.5 4.5L19 7"/></svg>',
    trash: '<svg viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round"><path d="M4 7h16M10 11v6M14 11v6M6 7l1 12a1 1 0 0 0 1 1h8a1 1 0 0 0 1-1l1-12M9 7V4h6v3"/></svg>',
    spark: '<svg viewBox="0 0 24 24" fill="currentColor"><path d="M12 2l2.2 6.3L20 10l-5.8 1.7L12 18l-2.2-6.3L4 10l5.8-1.7z"/></svg>' };
  $("orb").innerHTML = P.upload; $("dicon").innerHTML = P.upload;
  [["i-file", P.file], ["i-folder", P.folder], ["i-link", P.link]].forEach(function (x) { document.querySelector("." + x[0]).innerHTML = x[1]; });

  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML.replace(/"/g, "&quot;"); }
  function msg(t, ok) { var m = $("msg"); m.textContent = t || ""; m.className = "uc2-msg" + (t ? (ok ? " ok" : " bad") : ""); }
  function fmt(b) { if (!b && b !== 0) return ""; var u = ["B", "KB", "MB", "GB"], i = 0, n = b; while (n >= 1024 && i < 3) { n /= 1024; i++; } return (n >= 100 || i === 0 ? Math.round(n) : n.toFixed(1)) + " " + u[i]; }
  function fill(sel, list, ph, preferred) {
    sel.replaceChildren(new Option(ph, ""));
    list.forEach(function (x) { sel.appendChild(new Option(x.name_ar, x.id)); });
    var p = list.find(function (x) { return x.id === Number(preferred); });
    sel.value = p ? String(p.id) : (list.length === 1 ? String(list[0].id) : "");
    sel.disabled = !list.length;
  }

  /* ---------- أسماء الملفات والمطابقة ---------- */
  function cleanName(n) {
    var base = String(n || "").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
    var out = base.replace(/^\s*(?:lec(?:ture)?|l|محاضرة)?\s*[-.#]?\s*\d{1,3}[-–.:)_\s]+/i, "").replace(/\s+/g, " ").trim();
    return out || base;
  }
  function numOf(n) { var m = /^\s*(?:lec(?:ture)?|l|محاضرة)?\s*[-.#]?\s*(\d{1,3})(?=[\s\-–._):]|\.|$)/i.exec(String(n || "").replace(/_+/g, " ")); return m ? Number(m[1]) : 0; }
  var STOP = new Set(["and", "the", "of", "in", "with", "to", "for", "its", "part", "lecture", "lec", "pdf", "slides", "final", "new", "copy", "notes", "summary"]);
  function toks(s) { return String(s || "").toLowerCase().replace(/[_\-–.,:;()[\]/\\]+/g, " ").split(/\s+/).filter(function (w) { return w.length > 2 && !STOP.has(w); }).map(function (w) { return w.replace(/(ies)$/, "y").replace(/s$/, ""); }); }
  function match(name) {
    if (TYPE !== "lecture") return { lec: "", type: "none" };
    var n = numOf(name), title = cleanName(name);
    if (n && existing.some(function (l) { return l.number === n; })) return { lec: String(n), type: "sure" };
    var ta = toks(title), best = null, score = 0;
    existing.forEach(function (l) {
      var tb = toks(l.title); if (!ta.length || !tb.length) return;
      var inter = ta.filter(function (w) { return tb.indexOf(w) >= 0; }).length, s = inter / Math.min(ta.length, tb.length);
      if (s > score) { score = s; best = l; }
    });
    if (best && score >= 0.75) return { lec: String(best.number), type: "sure" };
    if (best && score >= 0.45) return { lec: String(best.number), type: "maybe" };
    if (n) return { lec: "__new", type: "sure" }; /* رقم صريح في الاسم: محاضرة جديدة بهذا الرقم */
    return { lec: "", type: "none" };
  }
  function nextFree() { var used = new Set(existing.map(function (l) { return l.number; }).concat(items.filter(function (i) { return i.lec === "__new"; }).map(function (i) { return i.newNum; }))); var n = 1; while (used.has(n)) n++; return n; }

  function kindOfUrl(u) { return /youtu\.be\/|youtube\.com\//i.test(u) ? "yt" : "lnk"; }
  function mk(base) { return Object.assign({ id: ++uid, status: "queued", loaded: 0, attempts: 0, err: "", lec: "", match: "none", linked: false, uploaded: false, ctrl: null, url: "", newNum: 0, newTitle: "", label: "" }, base); }
  function assign(it) {
    var m = match(it.orig); it.lec = m.lec; it.match = m.type;
    if (it.lec === "__new") { it.newNum = numOf(it.orig) || nextFree(); it.newTitle = cleanName(it.orig); }
    if (TYPE !== "lecture") it.label = cleanName(it.orig) || it.orig;
  }
  function isDup(it) {
    return items.some(function (o) { return o !== it && o.sid === it.sid && o.status !== "dup" && o.src === it.src && (it.src === "file" ? o.orig === it.orig && o.size === it.size : o.url === it.url); });
  }

  /* ---------- إضافة ---------- */
  function addFiles(list) {
    if (!S.value) return msg("اختر المادة أولاً.");
    msg("");
    var files = [].filter.call(list, function (f) { return f.size > 0 && !/^\./.test(f.name); });
    var skipped = files.filter(function (f) { return !/\.pdf$/i.test(f.name) && f.type !== "application/pdf"; }).length;
    files = files.filter(function (f) { return /\.pdf$/i.test(f.name) || f.type === "application/pdf"; });
    if (skipped) msg("تجاوزت " + skipped + " ملف ليس PDF. ضع غير PDF رابطاً.");
    if (!files.length) return;
    files.forEach(function (f) {
      var it = mk({ src: "file", file: f, orig: f.name, name: cleanName(f.name), size: f.size, sid: S.value, type: TYPE });
      assign(it);
      if (f.size > MAX) { it.status = "error"; it.err = "big"; }
      else if (isDup(it)) it.status = "dup";
      items.push(it);
    });
    batchStart = Math.min(batchStart, Date.now()); render(); pump();
  }
  function addLinks(text) {
    if (!S.value) return msg("اختر المادة أولاً.");
    var n = 0;
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var m = line.match(/https?:\/\/\S+/); if (!m) return;
      var url = m[0].replace(/[)\],.]+$/, ""), nm = line.replace(m[0], "").replace(/^[\s\-–—|:•*]+|[\s\-–—|:•*]+$/g, "").trim();
      var it = mk({ src: "link", url: url, orig: nm || url, name: nm || "رابط", size: 0, sid: S.value, type: TYPE, kind: kindOfUrl(url), uploaded: true });
      assign(it);
      if (isDup(it)) it.status = "dup"; else it.status = "ready";
      items.push(it); n++;
      if (it.status === "ready") tryAttach(it);
    });
    if (!n) return msg("لم أجد روابط صالحة.");
    $("linksText").value = ""; $("linksPanel").hidden = true; render(); msg("أُضيف " + n + " رابط.", true);
  }

  /* ---------- الشبكة ---------- */
  function jpost(p, body) {
    return fetch("/api/" + p, { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().catch(function () { return { ok: false, error: "server" }; }); }).catch(function () { return { ok: false, error: "network" }; });
  }
  function uploadChunks(it) {
    it.status = "uploading"; it.err = ""; it.t0 = Date.now(); it.l0 = it.loaded;
    it.uid = it.uid || ((crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2));
    var total = Math.max(1, Math.ceil(it.size / CH)); it.chunk = it.chunk || 0; it.total = total;
    it.ctrl = new AbortController();
    var ctrl = it.ctrl;
    (function next() {
      if (it.status !== "uploading") return;
      if (it.chunk >= total) { it.uploaded = true; it.loaded = it.size; it.status = "ready"; it.ctrl = null; tryAttach(it); render(); pump(); return; }
      var i = it.chunk;
      fetch("/api/chunk?id=" + it.uid + "&index=" + i + "&courseId=" + encodeURIComponent("s" + it.sid), { method: "POST", credentials: "same-origin", body: it.file.slice(i * CH, (i + 1) * CH), signal: ctrl.signal })
        .then(function (r) { return r.json().then(function (d) { return { st: r.status, d: d }; }); })
        .then(function (x) {
          if (!x.d.ok) return failItem(it, x.d.error || "http" + x.st, x.st >= 500 || x.st === 429);
          it.chunk++; it.loaded = Math.min(it.size, it.chunk * CH); tick(); next();
        }).catch(function (e) { if (e && e.name === "AbortError") return; failItem(it, "network", true); });
    })();
  }
  function failItem(it, code, retry) {
    it.ctrl = null;
    if (retry && it.attempts < RETRY.length) { var d = RETRY[it.attempts++]; it.status = "waiting"; render(); setTimeout(function () { if (it.status === "waiting") { it.status = "queued"; pump(); } }, d); return; }
    it.status = "error"; it.err = code; render(); pump();
  }
  /* ربط الملف المرفوع بمحاضرة (يتم بعد الرفع أو عند اختيار المحاضرة) */
  function target(it) {
    if (it.type !== "lecture") return { num: 0, title: "", label: it.label || it.name || "ملف" };
    if (it.lec === "__new") return { num: Number(it.newNum) || 0, title: String(it.newTitle || "").trim(), label: "ملزمة" };
    var l = existing.find(function (x) { return String(x.number) === it.lec; });
    return l ? { num: l.number, title: l.title, label: "ملزمة" } : null;
  }
  function tryAttach(it) {
    if (it.linked || !it.uploaded || it.attaching || ["error", "dup", "paused"].indexOf(it.status) >= 0) return;
    var t = target(it); if (!t || (it.type === "lecture" && (t.num < 1 || !t.title))) { render(); return; }
    it.attaching = true;
    var body = { courseId: "s" + it.sid, type: it.type, number: t.num, title: t.title, label: t.label };
    var req = it.src === "link" ? jpost("link", Object.assign({ url: it.url }, body)) : jpost("finish", Object.assign({ id: it.uid, chunks: it.total, filename: it.file.name }, body));
    req.then(function (d) {
      it.attaching = false;
      if (d.ok) { it.linked = true; it.eid = d.entry && d.entry.id; it.status = "done"; it.doneAt = Date.now(); it.tNum = t.num; it.tTitle = t.title; if (t.num && !existing.some(function (l) { return l.number === t.num; })) existing.push({ number: t.num, title: t.title }); afterOne(); }
      else { it.status = "error"; it.err = d.error || "server"; }
      render(); pump();
    });
  }
  function pump() {
    var active = items.filter(function (i) { return i.status === "uploading"; }).length;
    for (var k = 0; k < items.length && active < CONC; k++) {
      var it = items[k];
      if (it.status === "queued" && it.src === "file") { active++; uploadChunks(it); }
    }
    render();
  }
  function afterOne() {
    var pending = items.some(function (i) { return ["queued", "uploading", "waiting"].indexOf(i.status) >= 0; });
    if (!pending) { var n = items.filter(function (i) { return i.status === "done" && i.doneAt >= batchStart; }).length; if (n) msg("تم رفع " + n + " ✓", true); }
  }
  function action(id, act) {
    var it = items.find(function (i) { return i.id === id; }); if (!it) return;
    if (act === "pause") { if (it.ctrl) it.ctrl.abort(); it.ctrl = null; if (["uploading", "queued", "waiting"].indexOf(it.status) >= 0) it.status = "paused"; }
    else if (act === "resume" || act === "retry") { it.status = it.uploaded ? "ready" : "queued"; it.attempts = 0; it.err = ""; if (it.uploaded) tryAttach(it); }
    else if (act === "delete") {
      if (!it.eid || !window.confirm("حذف هذا الملف من المنصة نهائياً؟")) return;
      jpost("delete", { id: it.eid }).then(function (d) {
        if (d.ok) { items = items.filter(function (i) { return i !== it; }); render(); msg("تم حذف الملف.", true); }
        else msg(d.error === "forbidden" ? "لا تملك صلاحية حذف هذا الملف." : "تعذّر الحذف.");
      });
      return;
    }
    else if (act === "remove") { if (it.ctrl) it.ctrl.abort(); items = items.filter(function (i) { return i !== it; }); }
    pump();
  }

  /* ---------- العرض ---------- */
  var raf = 0; function tick() { if (!raf) raf = requestAnimationFrame(function () { raf = 0; progressOnly(); }); }
  function stats() {
    var files = items.filter(function (i) { return i.src === "file" && i.status !== "dup"; });
    var total = files.reduce(function (a, i) { return a + i.size; }, 0), loaded = files.reduce(function (a, i) { return a + (i.status === "done" ? i.size : i.loaded); }, 0);
    var c = function (s) { return items.filter(function (i) { return s.indexOf(i.status) >= 0; }).length; };
    return { total: total, loaded: loaded, pct: total ? Math.round(loaded / total * 100) : (items.length ? 100 : 0), done: c(["done"]), active: c(["uploading", "queued", "waiting"]), err: c(["error"]), paused: c(["paused"]), dup: c(["dup"]), all: items.length,
      unlinked: items.filter(function (i) { return i.uploaded && !i.linked && i.status !== "dup" && i.status !== "error"; }).length };
  }
  function ring(p, size, stroke) {
    var r = (size - stroke) / 2, c = 2 * Math.PI * r;
    return '<svg width="' + size + '" height="' + size + '" viewBox="0 0 ' + size + ' ' + size + '" aria-hidden="true"><circle cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--uc-ring)" stroke-width="' + stroke + '"/><circle id="ringArc" cx="' + size / 2 + '" cy="' + size / 2 + '" r="' + r + '" fill="none" stroke="var(--uc-brand)" stroke-width="' + stroke + '" stroke-linecap="round" stroke-dasharray="' + c.toFixed(1) + '" stroke-dashoffset="' + (c * (1 - p / 100)).toFixed(1) + '"/></svg>';
  }
  function renderSummary() {
    var s = stats(), box = $("summary"); box.hidden = !s.all; if (!s.all) return;
    var allDone = !s.active && !s.err && !s.paused && !s.unlinked;
    box.innerHTML = '<div class="uc2-sum"><div class="uc2-ring">' + ring(s.pct, 58, 6) + '<b id="pctTxt">' + (allDone ? P.check.replace("<svg", '<svg width="20" height="20"') : s.pct + "٪") + '</b></div>' +
      '<div class="t"><b>' + (allDone ? "تم رفع " + s.done + " ✓" : "تم " + s.done + " من " + (s.all - s.dup)) + '</b><small id="bytesTxt">' + (s.total ? fmt(s.loaded) + " / " + fmt(s.total) : "") +
      (s.err ? ' · <b style="color:#ef6b6b">فشل ' + s.err + "</b>" : "") + (s.unlinked ? ' · <b style="color:#d97706">' + s.unlinked + " بانتظار اختيار المحاضرة</b>" : "") + '</small></div>' +
      '<div class="acts">' + (s.active ? '<button class="uc2-btn sm" data-a="pause-all">' + P.pause + "إيقاف الكل</button>" : "") +
      (s.paused || s.err ? '<button class="uc2-btn sm" data-a="resume-all">' + P.retry + "استئناف الكل</button>" : "") +
      (s.done ? '<button class="uc2-btn sm" data-a="clear-done">مسح المنتهي</button>' : "") + "</div></div>";
  }
  function progressOnly() {
    var s = stats(), t = $("pctTxt"); if (t && s.active) t.textContent = s.pct + "٪";
    var arc = $("ringArc"); if (arc) { var r = 26, c = 2 * Math.PI * r; arc.setAttribute("stroke-dashoffset", (c * (1 - s.pct / 100)).toFixed(1)); }
    var b = $("bytesTxt"); if (b && s.total && !s.err && !s.unlinked) b.textContent = fmt(s.loaded) + " / " + fmt(s.total);
    items.forEach(function (it) { if (it.status !== "uploading") return; var li = document.querySelector('.uc2-row[data-id="' + it.id + '"]'); if (!li) return;
      var bar = li.querySelector(".uc2-bar i"); if (bar) bar.style.width = Math.round(it.loaded / it.size * 100) + "%"; var m = li.querySelector(".st"); if (m) m.innerHTML = stateLine(it); });
    fabUpdate(s);
  }
  var ERRS = { big: "أكبر من 20 ميغا", network: "انقطع الاتصال", not_pdf: "ليس PDF صالحاً", forbidden: "لا تملك صلاحية", unauthorized: "سجّل الدخول", bad_request: "تحقق من الرقم والعنوان", too_big: "أكبر من 20 ميغا" };
  function stateLine(it) {
    var pct = it.src === "link" ? 100 : it.size ? Math.round((it.status === "done" ? it.size : it.loaded) / it.size * 100) : 0;
    if (it.status === "uploading") { var dt = (Date.now() - (it.t0 || Date.now())) / 1000, sp = dt > 1 ? (it.loaded - (it.l0 || 0)) / dt : 0; return '<b style="color:var(--uc-brand)">' + pct + "٪</b><span>" + fmt(it.loaded) + " / " + fmt(it.size) + "</span>" + (sp > 0 ? "<span>" + fmt(sp) + "/s</span>" : ""); }
    if (it.status === "queued") return "<span>بالانتظار</span><span>" + fmt(it.size) + "</span>";
    if (it.status === "waiting") return '<b style="color:#d97706">إعادة المحاولة ' + it.attempts + "…</b>";
    if (it.status === "paused") return "<b>متوقف</b><span>" + pct + "٪ · " + fmt(it.size) + "</span>";
    if (it.status === "error") return '<b style="color:#ef6b6b">' + esc(ERRS[it.err] || "تعذّر الرفع") + "</b><span>" + pct + "٪</span>";
    if (it.status === "dup") return '<b style="color:#d97706">مكرر، تم تجاهله</b>';
    if (it.status === "done") return '<b style="color:#10b981">تم ✓ ' + esc(it.tNum ? "المحاضرة " + it.tNum : "") + "</b><span>" + esc(it.tTitle || "") + "</span>";
    if (it.uploaded && !it.linked) return '<b style="color:#d97706">' + (it.src === "link" ? "حُفظ الرابط، اختر المحاضرة" : "تم الرفع، اختر المحاضرة") + "</b>";
    return "";
  }
  function lecSelect(it) {
    var opts = existing.slice().sort(function (a, b) { return a.number - b.number; }).map(function (l) { return '<option value="' + l.number + '"' + (String(l.number) === it.lec ? " selected" : "") + ">المحاضرة " + l.number + " — " + esc(l.title) + "</option>"; }).join("");
    return '<select data-f="lec" aria-label="ربط بمحاضرة"><option value=""' + (!it.lec ? " selected" : "") + ">اختر المحاضرة…</option>" + opts + '<option value="__new"' + (it.lec === "__new" ? " selected" : "") + ">محاضرة جديدة: " + esc(it.name) + "</option></select>";
  }
  function row(it) {
    var cls = { done: "is-done", error: "is-error", dup: "is-dup" }[it.status] || "", kind = it.src === "link" ? (it.kind === "yt" ? "yt" : "lnk") : "pdf", lab = it.src === "link" ? (it.kind === "yt" ? "YT" : "رابط") : "PDF";
    var editable = it.status !== "done" && it.status !== "dup";
    var edit = "";
    if (editable && it.type === "lecture") edit = '<div class="uc2-edit">' + lecSelect(it) + (it.lec === "__new" ? '<input type="number" min="1" max="999" data-f="newNum" value="' + it.newNum + '" aria-label="رقم المحاضرة"><input type="text" maxlength="200" data-f="newTitle" value="' + esc(it.newTitle) + '" aria-label="عنوان المحاضرة">' : "") + "</div>";
    else if (editable) edit = '<div class="uc2-edit one"><input type="text" maxlength="120" data-f="label" value="' + esc(it.label) + '" aria-label="اسم الملف"></div>';
    var chip = it.status !== "done" ? (it.match === "sure" ? '<span class="uc2-chip sure">مطابقة مؤكدة</span>' : it.match === "maybe" ? '<span class="uc2-chip maybe">مطابقة محتملة</span>' : "") : "";
    var acts = "";
    if (it.status === "uploading" || it.status === "queued" || it.status === "waiting") acts += '<button data-a="pause" aria-label="إيقاف">' + P.pause + "</button>";
    if (it.status === "paused") acts += '<button data-a="resume" aria-label="استئناف">' + P.play + "</button>";
    if (it.status === "error") acts += '<button data-a="retry" aria-label="إعادة">' + P.retry + "</button>";
    if (it.status === "done" && it.eid) acts += '<button data-a="delete" aria-label="حذف الملف من المنصة" title="حذف الملف من المنصة">' + P.trash + "</button>";
    else if (it.status !== "uploading") acts += '<button data-a="remove" aria-label="حذف">' + P.x + "</button>";
    var pct = it.src === "link" ? 100 : it.size ? Math.round((it.status === "done" ? it.size : it.loaded) / it.size * 100) : 0;
    return '<li class="uc2-row ' + cls + '" data-id="' + it.id + '"><span class="uc2-tile ' + kind + '">' + lab + '</span><div class="uc2-main"><div class="uc2-name" dir="auto">' + esc(it.orig) + '</div><div class="uc2-meta"><span class="st" style="display:contents">' + stateLine(it) + "</span>" + chip + '</div></div><div class="uc2-acts">' + acts + "</div>" +
      (it.src === "file" && it.status !== "dup" ? '<div class="uc2-bar"><i style="width:' + pct + '%"></i></div>' : "") + edit + "</li>";
  }
  function render() {
    renderSummary();
    var order = { error: 0, uploading: 1, waiting: 2, paused: 3, queued: 4, ready: 5, done: 6, dup: 7 };
    var keep = document.activeElement && document.activeElement.closest && document.activeElement.closest(".uc2-edit");
    if (keep && document.activeElement.tagName === "INPUT") { fabUpdate(stats()); return; } /* لا نقاطع الكتابة */
    $("list").innerHTML = items.slice().sort(function (a, b) { return (order[a.status] - order[b.status]) || 0; }).map(row).join("");
    $("target").innerHTML = P.spark + "<span>" + (TYPE === "lecture" ? "تُطابَق الملفات مع المحاضرات تلقائياً من اسم الملف (رقم المحاضرة أو عنوانها)، وتقدر تغيّر الربط لكل ملف." : "تُرفع كملفات للمادة كلها، واسم الملف قابل للتعديل.") + "</span>";
    renderUploaded(); fabUpdate(stats());
  }
  function renderUploaded() {
    var box = $("uploaded");
    if (!box) { box = document.createElement("section"); box.id = "uploaded"; box.className = "uc2-uploaded"; $("list").parentNode.insertBefore(box, $("list").nextSibling); }
    var mine = {}; items.forEach(function (i) { if (i.eid) mine[i.eid] = 1; });
    var rows = uploaded.filter(function (u) { return !mine[u.id]; });
    box.hidden = !rows.length;
    if (!rows.length) { box.innerHTML = ""; return; }
    var TL = { lecture: "محاضرة", quiz: "اختبار", exam: "أسئلة سنوات" };
    box.innerHTML = "<h3 style=\"margin:16px 0 8px;font-size:15px\">الملفات المرفوعة سابقاً (" + rows.length + ")</h3><ul class=\"uc2-list\" style=\"list-style:none;padding:0;margin:0\">" + rows.map(function (u) {
      var name = (u.type === "lecture" && u.number ? "المحاضرة " + u.number + " — " : (TL[u.type] || "") + " — ") + (u.title || u.label || "");
      return '<li class="uc2-row" data-eid="' + esc(u.id) + '"><span class="uc2-tile ' + (u.kind === "link" ? "lnk" : "pdf") + '">' + (u.kind === "link" ? "رابط" : "PDF") + '</span><div class="uc2-main"><div class="uc2-name" dir="auto">' + esc(name) + '</div><div class="uc2-meta"><span>' + esc(u.label || "") + (u.size ? " · " + fmt(u.size) : "") + '</span></div></div><div class="uc2-acts"><button data-a="delup" aria-label="حذف" title="حذف من المنصة">' + P.trash + "</button></div></li>";
    }).join("") + "</ul>";
  }
  document.addEventListener("click", function (e) {
    var b = e.target.closest && e.target.closest("#uploaded [data-a=delup]"); if (!b) return;
    var id = b.closest("[data-eid]").dataset.eid;
    if (!window.confirm("حذف هذا الملف من المنصة نهائياً؟")) return;
    jpost("delete", { id: id }).then(function (d) {
      if (d.ok) { uploaded = uploaded.filter(function (u) { return u.id !== id; }); render(); msg("تم حذف الملف.", true); }
      else msg(d.error === "forbidden" ? "لا تملك صلاحية حذف هذا الملف." : "تعذّر الحذف.");
    });
  });
  function fabUpdate(s) {
    var f = $("fab"), show = s.active > 0 && window.scrollY > 380;
    f.hidden = !show; if (show) f.textContent = "جارٍ رفع " + s.active + " · " + s.pct + "٪";
  }
  $("fab").onclick = function () { window.scrollTo({ top: 0, behavior: "smooth" }); };
  window.addEventListener("scroll", function () { fabUpdate(stats()); }, { passive: true });
  window.addEventListener("beforeunload", function (e) { if (stats().active) { e.preventDefault(); e.returnValue = ""; } });

  $("summary").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    if (b.dataset.a === "pause-all") items.forEach(function (i) { action(i.id, "pause"); });
    if (b.dataset.a === "resume-all") items.forEach(function (i) { if (i.status === "paused" || i.status === "error") action(i.id, "resume"); });
    if (b.dataset.a === "clear-done") { items = items.filter(function (i) { return i.status !== "done"; }); render(); }
  });
  $("list").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b || !b.dataset.a) return;
    action(Number(b.closest(".uc2-row").dataset.id), b.dataset.a);
  });
  $("list").addEventListener("change", function (e) {
    var li = e.target.closest(".uc2-row"); if (!li) return;
    var it = items.find(function (i) { return i.id === Number(li.dataset.id); }); if (!it) return;
    var f = e.target.dataset.f, v = e.target.value;
    if (f === "lec") { it.lec = v; it.match = "none"; if (v === "__new") { it.newNum = it.newNum || numOf(it.orig) || nextFree(); it.newTitle = it.newTitle || cleanName(it.orig); } render(); tryAttach(it); }
  });
  $("list").addEventListener("input", function (e) {
    var li = e.target.closest(".uc2-row"); if (!li) return;
    var it = items.find(function (i) { return i.id === Number(li.dataset.id); }); if (!it) return;
    var f = e.target.dataset.f, v = e.target.value;
    if (f === "newNum") it.newNum = Number(v) || 0; else if (f === "newTitle") it.newTitle = v; else if (f === "label") it.label = v;
  });
  $("list").addEventListener("focusout", function (e) { var li = e.target.closest(".uc2-row"); if (!li || !e.target.dataset.f) return; var it = items.find(function (i) { return i.id === Number(li.dataset.id); }); if (it && it.uploaded && !it.linked) tryAttach(it); });

  /* ---------- الإفلات والاختيار ---------- */
  var drag = 0;
  window.addEventListener("dragenter", function (e) { if (e.dataTransfer && [].indexOf.call(e.dataTransfer.types || [], "Files") >= 0) { drag++; $("ovl").hidden = false; $("drop").classList.add("drag"); } });
  window.addEventListener("dragleave", function () { drag = Math.max(0, drag - 1); if (!drag) { $("ovl").hidden = true; $("drop").classList.remove("drag"); } });
  window.addEventListener("dragover", function (e) { e.preventDefault(); });
  window.addEventListener("drop", function (e) { e.preventDefault(); drag = 0; $("ovl").hidden = true; $("drop").classList.remove("drag"); if (e.dataTransfer && e.dataTransfer.files.length) addFiles(e.dataTransfer.files); });
  $("drop").onclick = function (e) { if (!e.target.closest("button")) $("fileInput").click(); };
  $("drop").onkeydown = function (e) { if (e.key === "Enter" || e.key === " ") { e.preventDefault(); $("fileInput").click(); } };
  $("pickFiles").onclick = function () { $("fileInput").click(); };
  $("pickFolder").onclick = function () { $("folderInput").click(); };
  $("fileInput").onchange = function () { addFiles($("fileInput").files); $("fileInput").value = ""; };
  $("folderInput").onchange = function () { addFiles($("folderInput").files); $("folderInput").value = ""; };
  $("linksBtn").onclick = function () { $("linksPanel").hidden = !$("linksPanel").hidden; if (!$("linksPanel").hidden) $("linksText").focus(); };
  $("linksAdd").onclick = function () { addLinks($("linksText").value); };
  $("typeSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    [].forEach.call($("typeSeg").children, function (x) { x.setAttribute("aria-selected", String(x === b)); }); TYPE = b.dataset.v; render();
  });

  /* ---------- الكلية والقسم والمادة ---------- */
  function setCollege() {
    var id = Number(C.value), img = $("logo"), name = C.selectedOptions[0] ? C.selectedOptions[0].text : "";
    var col = options.colleges.find(function (c) { return c.id === id; }), uni = col && (options.universities.find(function (u) { return u.id === col.university_id; }) || {});
    $("cName").textContent = name; $("cPath").textContent = uni ? uni.name_ar : "";
    $("logoBtn").hidden = !(canLogo && id);
    if (!id) { img.hidden = true; $("logoFb").hidden = false; return; }
    img.onload = function () { img.hidden = false; $("logoFb").hidden = true; };
    img.onerror = function () { img.hidden = true; $("logoFb").hidden = false; };
    img.src = "/api/college-logo/" + id + "?v=" + Date.now();
  }
  function subLine() {
    var p = [$("cPath").textContent, $("cName").textContent, D.selectedOptions[0] && D.value ? D.selectedOptions[0].text : "", S.selectedOptions[0] && S.value ? S.selectedOptions[0].text.replace(/^.*— /, "") : ""].filter(Boolean);
    $("sub").textContent = p.join(" · ");
  }
  function loadExisting() {
    existing = []; uploaded = [];
    if (!S.value) return Promise.resolve();
    var cid = "s" + S.value;
    return jpost("admin", {}).then(function (d) { return d && d.items ? d : fetch("/api/uploads").then(function (r) { return r.json(); }).catch(function () { return {}; }); }).then(function (d) {
      var seen = {};
      uploaded = ((d && d.items) || []).filter(function (i) { return i.courseId === cid; });
      ((d && d.items) || []).filter(function (i) { return i.courseId === cid && i.type === "lecture" && i.number; }).forEach(function (i) { if (!seen[i.number]) { seen[i.number] = 1; existing.push({ number: i.number, title: i.title || "" }); } });
    }).catch(function () { /* القائمة اختيارية: نبقى بلا مطابقة */ });
  }
  function loadSubjects(preferred) {
    fill(S, [], "اختر المادة"); existing = []; subLine();
    if (!D.value) return Promise.resolve();
    var col = options.colleges.find(function (c) { return c.id === Number(C.value); }) || {};
    return IQApi.request("/api/upload-options?department_id=" + D.value + "&college_id=" + C.value + "&university_id=" + col.university_id).then(function (data) {
      var list = data.items.filter(function (i) { return i.can_publish; }).map(function (i) { return { id: i.id, name_ar: "المرحلة " + i.stage + " · الكورس " + i.term + " — " + i.name_ar }; });
      fill(S, list, list.length ? "اختر المادة" : "لا توجد مواد تستطيع النشر عليها", preferred);
      subLine(); return loadExisting();
    }).catch(function (e) { IQApi.showError($("msg"), e, function () { loadSubjects(); }); });
  }
  function loadDepts() {
    var list = options.departments.filter(function (d) { return d.college_id === Number(C.value); });
    fill(D, list, "اختر القسم"); $("deptRow").hidden = list.length === 1; subLine();
    return loadSubjects(Number(params.get("subject")) || 0);
  }
  C.addEventListener("change", function () { setCollege(); loadDepts(); });
  D.addEventListener("change", function () { loadSubjects(); });
  S.addEventListener("change", function () { subLine(); loadExisting().then(function () { render(); }); });

  $("logoFile").onchange = function () {
    var f = $("logoFile").files[0]; $("logoFile").value = "";
    if (!f || !Number(C.value)) return;
    var img = new Image(), url = URL.createObjectURL(f);
    img.onload = function () {
      var k = Math.min(1, 256 / Math.max(img.width, img.height)), cv = document.createElement("canvas");
      cv.width = Math.max(1, Math.round(img.width * k)); cv.height = Math.max(1, Math.round(img.height * k));
      cv.getContext("2d").drawImage(img, 0, 0, cv.width, cv.height); URL.revokeObjectURL(url);
      var data = cv.toDataURL("image/png"); if (data.length > 130000) data = cv.toDataURL("image/jpeg", 0.88);
      msg("جارٍ حفظ الشعار…", true);
      jpost("college-logo/" + C.value, { image: data }).then(function (d) { d.ok ? (msg("تم حفظ الشعار ✓", true), setCollege()) : msg(d.error === "forbidden" ? "لا تملك صلاحية تغيير شعار هذه الكلية." : "تعذّر حفظ الشعار."); });
    };
    img.onerror = function () { msg("تعذّر قراءة الصورة."); };
    img.src = url;
  };

  function start() {
    Promise.all([
      IQApi.request("/api/upload-options"),
      (typeof fetch === "function" ? fetch("/api/auth/me", { credentials: "same-origin" }).then(function (r) { return r.json(); }) : Promise.resolve({})).catch(function () { return {}; })
    ]).then(function (r) {
      options = r[0];
      var me = (r[1] && r[1].user) || {}, sc = me.scopes || [];
      canLogo = !!options.admin || sc.some(function (x) { return x.level === "rep" && (x.type === "college" || x.type === "university"); });
      if (!options.colleges.length) { var e = new Error("forbidden"); e.code = "forbidden"; throw e; }
      fill(C, options.colleges, "اختر الكلية", Number(params.get("college")) || 0);
      $("collegeRow").hidden = options.colleges.length === 1;
      setCollege(); return loadDepts();
    }).then(function () {
      $("gate").hidden = true; $("main").hidden = false; $("pill").classList.add("on"); $("pillT").textContent = "متصل بالمنصة"; render();
    }).catch(function (e) {
      IQApi.showError($("gate"), e, start); $("pillT").textContent = "غير متاح";
      if (e.code === "unauthorized") { var a = document.createElement("a"); a.href = "login.html?next=" + encodeURIComponent("upload-center.html" + location.search); a.textContent = " تسجيل الدخول"; $("gate").appendChild(a); }
    });
  }
  start();
})();
