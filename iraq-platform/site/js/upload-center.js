/* مركز الرفع لكل كلية: رفع عدة ملفات دفعة واحدة مع استخراج الرقم والعنوان من اسم الملف، وطابور بتقدّم وإعادة محاولة. */
(function () {
  "use strict";
  var $ = function (i) { return document.getElementById(i); };
  var CH = 2 * 1024 * 1024, MAX = 20 * 1024 * 1024, CONC = 3;
  var params = new URLSearchParams(location.search);
  var options = null, canLogo = false, TYPE = "lecture", queue = [], uid = 0, running = 0, subjectOk = new Map();
  var C = $("c"), D = $("d"), S = $("s");

  function msg(t, ok) { var m = $("msg"); m.textContent = t || ""; m.className = "ct-msg" + (t ? (ok ? " ok" : " bad") : ""); }
  function esc(s) { var d = document.createElement("div"); d.textContent = s == null ? "" : String(s); return d.innerHTML; }
  function fill(sel, items, ph, preferred) {
    sel.replaceChildren(new Option(ph, ""));
    items.forEach(function (x) { sel.appendChild(new Option(x.name_ar, x.id)); });
    var p = items.find(function (x) { return x.id === Number(preferred); });
    sel.value = p ? String(p.id) : (items.length === 1 ? String(items[0].id) : "");
    sel.disabled = !items.length;
  }

  /* اسم الملف ← رقم وعنوان: «Lec 03 - Heart.pdf» → 3 / Heart */
  function parseName(name) {
    var base = String(name || "").replace(/\.[A-Za-z0-9]{1,5}$/, "").replace(/_+/g, " ").replace(/\s+/g, " ").trim();
    var m = /^(?:lec(?:ture)?|l|محاضرة)?\s*[-.#]?\s*(\d{1,3})(?=[\s\-–._):]|$)[\s\-–._):]*(.*)$/i.exec(base);
    if (m) return { num: Number(m[1]), title: (m[2] || "").trim() || base };
    return { num: 0, title: base };
  }
  function nextFree() {
    var used = new Set(queue.filter(function (q) { return q.type === "lecture"; }).map(function (q) { return q.num; }));
    var n = 1; while (used.has(n)) n++; return n;
  }

  function sub() { return S.value; }
  function addFiles(list) {
    if (!sub()) return msg("اختر المادة أولاً.");
    msg("");
    [].forEach.call(list, function (file) {
      if (!/\.pdf$/i.test(file.name) && file.type !== "application/pdf") return;
      var p = parseName(file.name), dup = queue.some(function (q) { return q.sid === sub() && q.name === file.name && q.size === file.size; });
      queue.push({ id: ++uid, sid: sub(), type: TYPE, file: file, name: file.name, size: file.size, src: "file",
        num: TYPE === "lecture" ? (p.num || nextFree()) : 0, title: p.title, status: dup ? "dup" : file.size > MAX ? "error" : "ready", err: file.size > MAX ? "أكبر من 20 ميغا" : "", pct: 0 });
    });
    draw();
  }
  function addLinks(text) {
    if (!sub()) return msg("اختر المادة أولاً.");
    var n = 0;
    String(text || "").split(/\r?\n/).forEach(function (line) {
      var m = line.match(/https?:\/\/\S+/); if (!m) return;
      var url = m[0].replace(/[)\],.]+$/, ""), t = line.replace(m[0], "").replace(/^[\s\-–—|:•*]+|[\s\-–—|:•*]+$/g, "").trim();
      queue.push({ id: ++uid, sid: sub(), type: TYPE, src: "link", url: url, name: url, size: 0, num: TYPE === "lecture" ? nextFree() : 0, title: t || "رابط", status: "ready", err: "", pct: 0 });
      n++;
    });
    if (!n) return msg("لم أجد روابط صالحة.");
    $("links").value = ""; draw();
  }

  function stateText(q) {
    return { ready: "جاهز", queued: "بالانتظار", uploading: q.pct + "٪", done: "تم ✓", error: "فشل", dup: "مكرر" }[q.status] || "";
  }
  function draw() {
    $("queueCard").hidden = !queue.length;
    var c = { ready: 0, done: 0, error: 0, uploading: 0 };
    queue.forEach(function (q) { if (c[q.status] != null) c[q.status]++; if (q.status === "queued") c.uploading++; });
    $("count").textContent = queue.length + " ملف";
    $("sum").innerHTML = "<span>جاهز " + c.ready + "</span><span>قيد الرفع " + c.uploading + "</span><span>تم " + c.done + "</span>" + (c.error ? "<span>فشل " + c.error + "</span>" : "");
    $("start").disabled = !c.ready && !c.error;
    $("start").textContent = c.error && !c.ready ? "إعادة محاولة الفاشل" : "ابدأ الرفع (" + c.ready + ")";
    var ul = $("list"); ul.textContent = "";
    queue.forEach(function (q) {
      var li = document.createElement("li"); li.className = "uc-item " + q.status; li.dataset.id = q.id;
      var lock = q.status === "uploading" || q.status === "queued" || q.status === "done";
      li.innerHTML = '<span class="uc-kind">' + (q.src === "link" ? "رابط" : "PDF") + '</span>' +
        '<div class="uc-fields">' + (q.type === "lecture" ? '<input type="number" min="1" max="999" value="' + q.num + '" data-f="num" aria-label="رقم المحاضرة"' + (lock ? " disabled" : "") + '>' : '<span></span>') +
        '<input maxlength="200" value="' + esc(q.title).replace(/"/g, "&quot;") + '" data-f="title" aria-label="العنوان"' + (lock ? " disabled" : "") + '></div>' +
        '<div class="uc-state">' + stateText(q) + (q.status === "error" ? ' <button data-a="retry">↻</button>' : "") + (q.status === "ready" || q.status === "dup" || q.status === "error" ? ' <button data-a="del" aria-label="حذف">✕</button>' : "") + '</div>' +
        '<div class="uc-name">' + esc(q.name) + (q.err ? " — " + esc(q.err) : "") + '</div>' +
        (q.status === "uploading" ? '<div class="uc-prog"><i style="width:' + q.pct + '%"></i></div>' : "");
      ul.appendChild(li);
    });
  }
  $("list").addEventListener("input", function (e) {
    var li = e.target.closest(".uc-item"); if (!li) return;
    var q = queue.find(function (x) { return x.id === Number(li.dataset.id); }); if (!q) return;
    if (e.target.dataset.f === "num") q.num = Number(e.target.value) || 0; else if (e.target.dataset.f === "title") q.title = e.target.value;
  });
  $("list").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    var li = b.closest(".uc-item"), q = queue.find(function (x) { return x.id === Number(li.dataset.id); }); if (!q) return;
    if (b.dataset.a === "del") queue = queue.filter(function (x) { return x !== q; });
    if (b.dataset.a === "retry") { q.status = "ready"; q.err = ""; }
    draw();
  });

  function post(p, body, raw) {
    return IQApi.request("/api/" + p, { method: "POST", headers: raw ? {} : { "content-type": "application/json" }, body: raw || JSON.stringify(body) })
      .catch(function (e) { return { ok: false, error: e.code || "network" }; });
  }
  var ERR = { not_pdf: "ليس PDF صالحاً", too_big: "أكبر من 20 ميغا", unauthorized: "سجّل الدخول", forbidden: "لا تملك صلاحية", bad_request: "تحقق من الرقم والعنوان", network: "انقطع الاتصال" };
  function fail(q, d) { q.status = "error"; q.err = ERR[d.error] || "تعذّر الرفع"; draw(); }
  function ok(q) { q.status = "done"; q.pct = 100; draw(); }

  function uploadOne(q) {
    var cid = "s" + q.sid, label = q.type === "lecture" ? "ملزمة" : q.type === "exam" ? "أسئلة سابقة" : "اختبار", num = q.type === "lecture" ? q.num : 0, title = num ? String(q.title || "").trim() : "";
    if (q.type === "lecture" && (num < 1 || !title)) { q.status = "error"; q.err = "اكتب الرقم والعنوان"; draw(); return Promise.resolve(); }
    q.status = "uploading"; q.pct = 0; draw();
    if (q.src === "link") return post("link", { courseId: cid, type: q.type, number: num, title: title, label: label, url: q.url }).then(function (d) { d.ok ? ok(q) : fail(q, d); });
    var id = (crypto.randomUUID && crypto.randomUUID()) || String(Date.now()) + Math.random().toString(16).slice(2), total = Math.ceil(q.file.size / CH), i = 0;
    return new Promise(function (resolve) {
      (function next() {
        if (i >= total) return post("finish", { id: id, chunks: total, courseId: cid, number: num, type: q.type, title: title, label: label, filename: q.file.name }).then(function (d) { d.ok ? ok(q) : fail(q, d); resolve(); });
        q.file.slice(i * CH, (i + 1) * CH).arrayBuffer().then(function (buf) {
          return post("chunk?id=" + id + "&index=" + i + "&courseId=" + encodeURIComponent(cid), null, buf);
        }).then(function (d) {
          if (!d.ok) { fail(q, d); return resolve(); }
          i++; q.pct = Math.round(i / total * 100); var bar = document.querySelector('.uc-item[data-id="' + q.id + '"] .uc-prog i'); if (bar) bar.style.width = q.pct + "%"; next();
        }).catch(function () { fail(q, { error: "network" }); resolve(); });
      })();
    });
  }
  function pump() {
    while (running < CONC) {
      var q = queue.find(function (x) { return x.status === "queued"; }); if (!q) break;
      running++;
      uploadOne(q).then(function () { running--; pump(); });
    }
    if (!running && !queue.some(function (x) { return x.status === "queued"; })) {
      var done = queue.filter(function (x) { return x.status === "done"; }).length;
      if (done) msg("تم رفع " + done + " ملف ✓", true);
    }
  }
  $("start").onclick = function () {
    msg("");
    queue.forEach(function (q) { if (q.status === "ready" || q.status === "error") { q.status = "queued"; q.err = ""; } });
    draw(); pump();
  };
  $("clear").onclick = function () { queue = queue.filter(function (q) { return q.status !== "done"; }); draw(); };

  $("drop").onclick = function () { $("f").click(); };
  $("f").onchange = function () { addFiles($("f").files); $("f").value = ""; };
  ["dragover", "dragenter"].forEach(function (ev) { $("drop").addEventListener(ev, function (e) { e.preventDefault(); $("drop").classList.add("on"); }); });
  ["dragleave", "drop"].forEach(function (ev) { $("drop").addEventListener(ev, function () { $("drop").classList.remove("on"); }); });
  $("drop").addEventListener("drop", function (e) { e.preventDefault(); addFiles(e.dataTransfer.files); });
  $("addLinks").onclick = function () { addLinks($("links").value); };
  $("typeSeg").addEventListener("click", function (e) {
    var b = e.target.closest("button"); if (!b) return;
    [].forEach.call($("typeSeg").children, function (x) { x.classList.toggle("on", x === b); }); TYPE = b.dataset.v;
  });

  /* ---------- الاختيارات ---------- */
  function setLogo() {
    var id = Number(C.value), img = $("logo");
    $("collegeName").textContent = C.selectedOptions[0] ? C.selectedOptions[0].text : "";
    $("logoBtn").hidden = !(canLogo && id);
    if (!id) { img.hidden = true; $("logoFallback").hidden = false; return; }
    img.onload = function () { img.hidden = false; $("logoFallback").hidden = true; };
    img.onerror = function () { img.hidden = true; $("logoFallback").hidden = false; };
    img.src = "/api/college-logo/" + id + "?v=" + Date.now();
  }
  function loadSubjects(preferred) {
    subjectOk.clear(); fill(S, [], "اختر المادة"); $("subjNote").textContent = "";
    if (!D.value) return Promise.resolve();
    return IQApi.request("/api/upload-options?department_id=" + D.value + "&college_id=" + C.value + "&university_id=" + (options.colleges.find(function (c) { return c.id === Number(C.value); }) || {}).university_id).then(function (data) {
      var items = data.items.filter(function (i) { return i.can_publish; }).map(function (i) { return { id: i.id, name_ar: "المرحلة " + i.stage + " · الكورس " + i.term + " — " + i.name_ar }; });
      fill(S, items, items.length ? "اختر المادة" : "لا توجد مواد", preferred);
      if (!items.length) $("subjNote").textContent = "لا توجد مواد تستطيع النشر عليها في هذا القسم. أضف المواد من صفحة «رفع محاضرة».";
    }).catch(function (e) { IQApi.showError($("msg"), e, function () { loadSubjects(); }); });
  }
  function loadDepts() {
    var items = options.departments.filter(function (d) { return d.college_id === Number(C.value); });
    fill(D, items, "اختر القسم"); $("deptRow").hidden = items.length === 1;
    return loadSubjects(Number(params.get("subject")) || 0);
  }
  C.addEventListener("change", function () { setLogo(); loadDepts(); });
  D.addEventListener("change", function () { loadSubjects(); });

  /* شعار الكلية: تصغير في المتصفح (256px) ثم رفع */
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
      post("college-logo/" + C.value, { image: data }).then(function (d) { d.ok ? (msg("تم حفظ الشعار ✓", true), setLogo()) : msg(d.error === "forbidden" ? "لا تملك صلاحية تغيير شعار هذه الكلية." : "تعذّر حفظ الشعار."); });
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
      var pre = Number(params.get("college")) || 0;
      fill(C, options.colleges, "اختر الكلية", pre);
      $("collegeRow").hidden = options.colleges.length === 1;
      setLogo();
      return loadDepts();
    }).then(function () { $("gate").hidden = true; $("form").hidden = false; })
      .catch(function (e) {
        IQApi.showError($("gate"), e, start);
        if (e.code === "unauthorized") { var a = document.createElement("a"); a.href = "login.html?next=" + encodeURIComponent("upload-center.html" + location.search); a.textContent = "تسجيل الدخول"; $("gate").appendChild(a); }
      });
  }
  start();
})();
