/* js/upload.js — صفحة المشرفين: الدخول بالرمز، لوحة المادة، رفع عدة ملفات بأسماء مقترحة، الروابط والاختبارات،
   قائمة المرفوعات مع التعديل والحذف والتصفية حسب المساعد. الأسماء المقترحة في js/upload-names.js */
(function () {
  "use strict";
  var $ = MS.$, el = MS.el, N = UploadNames;

  var KEY = "ms.uploadCode";
  var KEY_COURSE = "ms.uploadCourse";
  var CHUNK = 2 * 1024 * 1024;        // حجم القطعة المرسلة
  var MAX = 20 * 1024 * 1024;         // أكبر ملف
  var code = "";
  var busy = false;
  var items = [];                     // كل المرفوعات كما يعيدها الخادم (مع الرافع ووقت الرفع)
  var queue = [];                     // ملفات مختارة لم تُرفع بعد
  var rowSeq = 0;
  var wantedNumber = null;            // رقم ناقص ضغط عليه المشرف ليُستعمل للملف التالي

  var TYPE_NAME = { lecture: "محاضرة", quiz: "اختبار تفاعلي", exam: "أسئلة سنوات سابقة" };
  var LINK_LABEL = { quiz: "Interactive quiz", exam: "Past questions", lecture: "Online resource" };

  var ERR = {
    bad_code: "الرمز غير صحيح.",
    unauthorized: "سجّل الدخول بحساب مصرّح له بالرفع، أو اكتب رمز الرفع.",
    locked: "محاولات خاطئة كثيرة. انتظر ربع ساعة ثم حاول مرة أخرى.",
    not_configured: "لم تُضبط رموز الرفع بعد في إعدادات Cloudflare.",
    bad_request: "تأكد من تعبئة كل الحقول بشكل صحيح.",
    bad_url: "الرابط غير صالح. اكتب رابطاً كاملاً يبدأ بـ https://",
    not_pdf: "الملف ليس PDF صالحاً.",
    too_big: "الملف أكبر من 20 ميغا.",
    missing_chunk: "انقطع الرفع في المنتصف. حاول مرة أخرى.",
    busy: "الخادم مشغول. حاول بعد قليل.",
    not_found: "العنصر غير موجود.",
    network: "لا يوجد اتصال بالإنترنت. حاول مرة أخرى.",
    server: "حدث خطأ غير متوقع. حاول مرة أخرى."
  };
  function errText(c) { return ERR[c] || ERR.server; }

  document.querySelectorAll("[data-site-title]").forEach(function (n) { n.textContent = SITE.title; });

  function showMsg(node, text, ok) {
    node.textContent = "";
    if (!text) { node.hidden = true; return; }
    node.className = "up-msg" + (ok ? " is-ok" : "");
    if (typeof text === "string") node.textContent = text;
    else node.appendChild(text);
    node.hidden = false;
  }

  async function api(path, opts) {
    opts = opts || {};
    var headers = {};
    if (code) headers["x-upload-code"] = code;
    var body = opts.body;
    if (body && !(body instanceof Blob)) { body = JSON.stringify(body); headers["content-type"] = "application/json"; }
    var res;
    try { res = await fetch("api/" + path, { method: opts.method || "POST", headers: headers, body: body }); }
    catch (e) { return { status: 0, data: { error: "network" } }; }
    var data = {};
    try { data = await res.json(); } catch (e) { /* ردّ بلا JSON */ }
    return { status: res.status, data: data };
  }

  function uuid() {
    if (window.crypto && crypto.randomUUID) return crypto.randomUUID();
    var b = crypto.getRandomValues(new Uint8Array(16));
    b[6] = (b[6] & 0x0f) | 0x40; b[8] = (b[8] & 0x3f) | 0x80;
    var h = Array.prototype.map.call(b, function (x) { return ("0" + x.toString(16)).slice(-2); }).join("");
    return h.slice(0, 8) + "-" + h.slice(8, 12) + "-" + h.slice(12, 16) + "-" + h.slice(16, 20) + "-" + h.slice(20);
  }
  function mb(n) { return (n / 1048576).toFixed(1) + " ميغا"; }
  function store(k, v) { try { if (v) localStorage.setItem(k, v); else localStorage.removeItem(k); } catch (e) { /* التخزين ممنوع */ } }
  function stored(k) { try { return localStorage.getItem(k) || ""; } catch (e) { return ""; } }

  /* ---------- الدخول ---------- */
  async function login(candidate, silent) {
    code = candidate;
    var r = await api("check");
    if (r.status === 200 && r.data.ok) {
      store(KEY, candidate);
      $("who").textContent = "مرحباً " + r.data.name;
      $("loginCard").hidden = true;
      $("appArea").hidden = false;
      await refreshList();
      return true;
    }
    code = "";
    if (!silent || r.data.error === "locked") showMsg($("loginMsg"), errText(r.data.error));
    if (r.data.error === "bad_code") store(KEY, "");
    return false;
  }

  $("loginForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var v = $("code").value.trim();
    if (!v) return;
    $("loginBtn").disabled = true;
    showMsg($("loginMsg"), "");
    await login(v, false);
    $("loginBtn").disabled = false;
  });

  $("logout").addEventListener("click", function () {
    code = "";
    store(KEY, "");
    items = [];
    $("code").value = "";
    $("appArea").hidden = true;
    $("loginCard").hidden = false;
  });

  /* ---------- المادة المختارة ولوحتها ---------- */
  function fillCourses() {
    var sel = $("course");
    sel.appendChild(new Option("اختر المادة", ""));
    SEMESTERS.forEach(function (sem) {
      var group = document.createElement("optgroup");
      group.label = sem.name;
      COURSES.filter(function (c) { return c.semester === sem.id; }).forEach(function (c) {
        group.appendChild(new Option(c.nameAr, c.id));
      });
      if (group.children.length) sel.appendChild(group);
    });
    var last = stored(KEY_COURSE);
    if (last && MS.course(last)) sel.value = last;
  }
  fillCourses();

  function semesterOf(c) {
    return SEMESTERS.filter(function (s) { return s.id === c.semester; })[0];
  }

  /* المحاضرات الموجودة فعلاً لمادة: ما في courses.js من ملفات ثابتة + كل ما رُفع من الموقع (من القائمة الحية) */
  function liveLectures(courseId) {
    var map = {};
    var extras = { quiz: 0, exam: 0 };
    var c = MS.course(courseId);
    if (c) c.lectures.forEach(function (l) {
      var staticFiles = l.files.filter(function (f) { return !f.uploaded; });
      if (staticFiles.length) map[l.number] = { title: l.title, labels: staticFiles.map(function (f) { return f.label; }) };
    });
    items.forEach(function (it) {
      if (it.courseId !== courseId) return;
      if (!it.number) { extras[it.type] = (extras[it.type] || 0) + 1; return; }
      var e = map[it.number] || (map[it.number] = { title: it.title, labels: [] });
      e.labels.push(it.label);
    });
    return { map: map, extras: extras };
  }
  function numbersOf(map) {
    return Object.keys(map).map(Number).sort(function (a, b) { return a - b; });
  }

  function extrasText(x) {
    var parts = [];
    if (x.quiz) parts.push("اختبارات تفاعلية: " + x.quiz);
    if (x.exam) parts.push("أسئلة سنوات سابقة: " + x.exam);
    return parts.join(" · ");
  }

  function renderBoard() {
    var box = $("board");
    box.textContent = "";
    var c = MS.course($("course").value);
    $("courseEn").textContent = c ? c.name : "";
    if (!c) return;

    var lv = liveLectures(c.id);
    var nums = numbersOf(lv.map);
    var gaps = N.gaps(nums);
    var max = nums.length ? nums[nums.length - 1] : 0;

    box.appendChild(el("h3", "up-board-title", "حالة المادة"));
    if (!nums.length) {
      box.appendChild(el("p", "up-hint", "لم تُرفع محاضرات لهذه المادة بعد."));
    } else {
      var chips = el("div", "up-chips");
      for (var n = 1; n <= max; n++) {
        if (lv.map[n]) {
          var have = el("span", "up-chip is-have", n + " · " + MS.filesLabel(lv.map[n].labels.length));
          have.title = lv.map[n].title;
          chips.appendChild(have);
        } else {
          chips.appendChild(gapChip(n, "ناقصة"));
        }
      }
      chips.appendChild(gapChip(max + 1, "التالية"));
      box.appendChild(chips);
      box.appendChild(el("p", "up-hint", gaps.length
        ? "المحاضرات المنقطة لم يُرفع لها شيء بين المحاضرات الموجودة. اضغط على رقم لتستعمله للملف التالي."
        : "لا توجد أرقام ناقصة بين المحاضرات الموجودة. اضغط على «التالية» لرفع المحاضرة الجديدة."));
    }
    var extra = extrasText(lv.extras);
    if (extra) box.appendChild(el("p", "up-hint", extra));
    if (wantedNumber) box.appendChild(el("p", "up-wanted", "الرقم المختار للملف التالي: " + wantedNumber));
  }

  function gapChip(n, word) {
    var b = el("button", "up-chip is-gap", n + " " + word);
    b.type = "button";
    b.addEventListener("click", function () { chooseNumber(n); });
    return b;
  }
  function chooseNumber(n) {
    var blank = queue.filter(function (r) { return r.type === "lecture" && !r.number && r.state !== "done"; })[0];
    if (blank) {
      blank.number = n;
      refreshRows(true);
      MS.toast("وُضع الرقم " + n + " في الملف الأول بلا رقم");
    } else {
      wantedNumber = n;
      MS.toast("سيُستعمل الرقم " + n + " للملف التالي");
    }
    renderBoard();
  }

  function renderOverview() {
    var box = $("overview");
    box.textContent = "";
    SEMESTERS.forEach(function (sem) {
      var list = COURSES.filter(function (c) { return c.semester === sem.id; });
      if (!list.length) return;
      var group = el("section", "up-ov-group");
      group.appendChild(el("h3", "up-ov-title", sem.name));
      list.forEach(function (c) {
        var lv = liveLectures(c.id);
        var nums = numbersOf(lv.map);
        var gaps = N.gaps(nums);
        var row = el("button", "up-ov-row");
        row.type = "button";
        var names = el("span", "up-ov-names");
        names.appendChild(el("strong", "", c.nameAr));
        names.appendChild(el("small", "up-ltr", c.name));
        row.appendChild(names);
        var state = nums.length ? MS.lecturesLabel(nums.length) : "بلا محاضرات";
        if (gaps.length) state += " · ناقص: " + gaps.join("، ");
        var ex = extrasText(lv.extras);
        if (ex) state += " · " + ex;
        row.appendChild(el("span", "up-ov-state" + (nums.length ? "" : " is-empty"), state));
        row.addEventListener("click", function () {
          $("course").value = c.id;
          onCourseChange();
          $("course").scrollIntoView({ block: "center" });
        });
        group.appendChild(row);
      });
      box.appendChild(group);
    });
  }

  /* «أحدث المحاضرات»: الافتراضي مفعّل لمواد كورس الطالب الحالي فقط، ويستطيع المشرف تغييره لكل دفعة */
  function paintLatest() {
    var c = MS.course($("course").value);
    var on = !!c && c.semester === MS.currentSemester();
    $("latest").checked = on;
    $("linkLatest").checked = on;
    var hint = "";
    if (c) {
      var sem = semesterOf(c);
      hint = on
        ? "هذه مادة من كورس الطلاب الحالي، فالخيار مفعّل."
        : "هذه مادة من " + (sem ? sem.name : "كورس قديم") + "، فالخيار مطفأ حتى لا تظهر في أحدث المحاضرات.";
    }
    $("latestHint").textContent = hint;
  }

  function onCourseChange() {
    store(KEY_COURSE, $("course").value);
    wantedNumber = null;
    paintLatest();
    refreshRows(true);
    syncLinkLecture();
    renderBoard();
    renderList();
    updateSendState();
  }
  $("course").addEventListener("change", onCourseChange);

  /* ---------- رفع ملفات: قائمة الانتظار ---------- */
  function updateSendState() {
    var pending = queue.filter(function (r) { return r.state !== "done"; }).length;
    $("send").disabled = busy || !pending || !$("course").value;
    $("clearQueue").hidden = !queue.length || busy;
    $("queueOptions").hidden = !queue.length;
  }

  function addFiles(fileList) {
    var msg = $("formMsg");
    showMsg(msg, "");
    if (!$("course").value) { showMsg(msg, "اختر المادة أولاً، ثم اختر الملفات."); return; }
    var skipped = [];
    var added = 0;
    Array.prototype.forEach.call(fileList, function (f) {
      if (!/\.pdf$/i.test(f.name) && f.type !== "application/pdf") { skipped.push(f.name + ": ليس PDF"); return; }
      if (f.size > MAX) { skipped.push(f.name + ": أكبر من 20 ميغا"); return; }
      var s = N.suggest(f.name);
      var row = { id: ++rowSeq, file: f, type: s.type, number: s.number, title: s.title, label: s.label, titleAuto: true, labelAuto: true, state: "wait", error: "", hint: "", ui: null };
      if (!row.number && row.type === "lecture" && wantedNumber) { row.number = wantedNumber; wantedNumber = null; }
      queue.push(row);
      added++;
    });
    if (skipped.length) showMsg(msg, "لم تُضف هذه الملفات: " + skipped.join("، "));
    if (added) { renderQueue(); renderBoard(); }
    updateSendState();
  }

  /* يملأ الحقول المقترحة (لا يلمس ما كتبه المشرف بيده): عنوان المحاضرة الموجودة، واسم ظاهر غير مكرر */
  function autofillAll() {
    var lv = liveLectures($("course").value).map;
    queue.forEach(function (row, i) {
      if (row.state === "done") return;
      var earlier = queue.slice(0, i);
      if (row.number) {
        var existing = lv[row.number];
        var sibling = earlier.filter(function (r) { return r.number === row.number && r.title; })[0];
        if (existing) {
          if (row.titleAuto) row.title = existing.title;
          row.hint = "محاضرة موجودة، وسيُضاف الملف إليها.";
        } else {
          if (row.titleAuto && sibling) row.title = sibling.title;
          row.hint = "محاضرة جديدة: اكتب عنوانها كما هو في الملف.";
        }
        if (row.labelAuto) {
          var taken = (existing ? existing.labels : []).concat(earlier.filter(function (r) { return r.number === row.number; }).map(function (r) { return r.label; }));
          row.label = N.uniqueLabel(N.suggestLabel(row.file.name, row.type), taken);
        }
      } else {
        if (row.labelAuto) row.label = N.uniqueLabel(N.suggestLabel(row.file.name, row.type), earlier.filter(function (r) { return !r.number && r.type === row.type; }).map(function (r) { return r.label; }));
        row.hint = row.type === "lecture"
          ? "اكتب رقم المحاضرة."
          : "بلا رقم: يظهر في قسم الاختبارات وأسئلة السنوات للمادة كلها.";
      }
    });
  }

  /* يحدّث قيم الحقول في الصفحة من بيانات الصفوف (بلا إعادة بناء حتى لا يضيع المؤشر) */
  function refreshRows(force) {
    autofillAll();
    queue.forEach(function (row) {
      if (!row.ui) return;
      var u = row.ui;
      if (document.activeElement !== u.number || force) u.number.value = row.number || "";
      if (document.activeElement !== u.title || force) u.title.value = row.title || "";
      if (document.activeElement !== u.label || force) u.label.value = row.label || "";
      u.type.value = row.type;
      u.hint.textContent = row.hint;
      paintRowState(row);
    });
  }

  function paintRowState(row) {
    var u = row.ui;
    if (!u) return;
    u.root.classList.toggle("is-done", row.state === "done");
    u.root.classList.toggle("is-error", !!row.error);
    var text = "";
    if (row.state === "done") text = "تم الرفع";
    else if (row.state === "up") text = "جارٍ الرفع...";
    else if (row.error) text = row.error;
    u.status.textContent = text;
    u.status.hidden = !text;
    var locked = row.state === "up" || row.state === "done" || busy;
    [u.type, u.number, u.title, u.label, u.remove].forEach(function (n) { n.disabled = locked; });
  }

  function field(labelText, node) {
    var wrap = el("div");
    wrap.appendChild(el("label", "up-label", labelText));
    wrap.appendChild(node);
    return wrap;
  }

  function renderQueue() {
    var box = $("queue");
    box.textContent = "";
    queue.forEach(function (row) {
      var root = el("div", "up-row");
      var head = el("div", "up-row-head");
      head.appendChild(el("span", "up-row-file up-ltr", row.file.name + " (" + mb(row.file.size) + ")"));
      var remove = el("button", "btn btn-secondary btn-sm", "إزالة");
      remove.type = "button";
      remove.addEventListener("click", function () {
        queue = queue.filter(function (r) { return r !== row; });
        renderQueue();
        renderBoard();
        updateSendState();
      });
      head.appendChild(remove);
      root.appendChild(head);

      var grid = el("div", "up-grid up-grid-4");
      var type = el("select", "field");
      Object.keys(TYPE_NAME).forEach(function (k) { type.appendChild(new Option(TYPE_NAME[k], k)); });
      var number = el("input", "field up-ltr");
      number.type = "number"; number.inputMode = "numeric"; number.min = "1"; number.max = "999"; number.step = "1";
      var title = el("input", "field up-ltr");
      title.type = "text"; title.maxLength = 200;
      var label = el("input", "field up-ltr");
      label.type = "text"; label.maxLength = 120; label.setAttribute("list", "labelSuggest");
      grid.appendChild(field("النوع", type));
      grid.appendChild(field("رقم المحاضرة", number));
      grid.appendChild(field("عنوان المحاضرة (بالإنجليزية)", title));
      grid.appendChild(field("الاسم الذي يظهر للطلاب", label));
      root.appendChild(grid);

      var hint = el("p", "up-hint");
      var status = el("p", "up-row-status");
      status.hidden = true;
      root.appendChild(hint);
      root.appendChild(status);

      type.classList.add("r-type"); number.classList.add("r-number"); title.classList.add("r-title"); label.classList.add("r-label");
      row.ui = { root: root, type: type, number: number, title: title, label: label, hint: hint, status: status, remove: remove };

      type.addEventListener("change", function () { row.type = type.value; row.error = ""; refreshRows(false); });
      number.addEventListener("input", function () {
        var n = parseInt(number.value, 10);
        row.number = n >= 1 ? n : null;
        row.error = "";
        refreshRows(false);
      });
      title.addEventListener("input", function () { row.title = title.value; row.titleAuto = false; row.error = ""; refreshRows(false); });
      label.addEventListener("input", function () { row.label = label.value; row.labelAuto = false; row.error = ""; refreshRows(false); });
      box.appendChild(root);
    });
    refreshRows(true);
    updateSendState();
  }

  $("file").addEventListener("change", function () {
    addFiles($("file").files);
    $("file").value = "";
  });
  var drop = $("drop");
  ["dragenter", "dragover"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.add("is-over"); });
  });
  ["dragleave", "drop"].forEach(function (ev) {
    drop.addEventListener(ev, function (e) { e.preventDefault(); drop.classList.remove("is-over"); });
  });
  drop.addEventListener("drop", function (e) { if (e.dataTransfer && e.dataTransfer.files) addFiles(e.dataTransfer.files); });

  $("clearQueue").addEventListener("click", function () {
    queue = [];
    showMsg($("formMsg"), "");
    $("progress").hidden = true;
    renderQueue();
    renderBoard();
  });

  function progress(pct, text) {
    $("progress").hidden = false;
    $("progressFill").style.setProperty("--p", pct + "%");
    $("progressLabel").textContent = text || "";
  }

  function setBusy(on) {
    busy = on;
    $("send").textContent = on ? "جارٍ الرفع..." : "رفع الملفات";
    queue.forEach(paintRowState);
    updateSendState();
  }

  async function sendChunk(id, i, blob) {
    var last = "server";
    for (var t = 0; t < 3; t++) {
      var r = await api("chunk?id=" + id + "&index=" + i, { body: blob });
      if (r.status === 200) return;
      last = r.data.error || "server";
      if (r.status !== 0 && r.status < 500) break; // الخطأ ليس مؤقتاً
      await new Promise(function (res) { setTimeout(res, 800 * (t + 1)); });
    }
    var err = new Error(last);
    err.code = last;
    throw err;
  }

  /* يرفع ملفاً واحداً على قطع ثم يسجّله. onBytes تُستدعى بعد كل قطعة بعدد البايتات المرسلة من هذا الملف */
  async function uploadOne(row, courseId, onBytes) {
    var id = uuid();
    var file = row.file;
    var total = Math.max(1, Math.ceil(file.size / CHUNK));
    try {
      for (var i = 0; i < total; i++) {
        await sendChunk(id, i, file.slice(i * CHUNK, (i + 1) * CHUNK));
        onBytes(Math.min(file.size, (i + 1) * CHUNK));
      }
      var lecture = !!row.number;
      var body = {
        id: id, chunks: total, courseId: courseId, number: row.number || 0, type: row.type,
        title: lecture ? row.title.trim() : "", label: row.label.trim(), filename: file.name
      };
      if (lecture) body.showInLatest = $("latest").checked;
      var fin = await api("finish", { body: body });
      if (fin.status !== 200) { var fe = new Error(fin.data.error); fe.code = fin.data.error || "server"; throw fe; }
    } catch (err) {
      await api("abort", { body: { id: id } });
      throw err;
    }
  }

  function validateRows() {
    var bad = false;
    queue.forEach(function (r) {
      r.error = "";
      if (r.state === "done") return;
      if (r.type === "lecture" && !r.number) r.error = "اكتب رقم المحاضرة.";
      else if (r.number && !(r.number >= 1 && r.number <= 999)) r.error = "رقم المحاضرة بين 1 و999.";
      else if (r.number && !String(r.title || "").trim()) r.error = "اكتب عنوان المحاضرة.";
      else if (!String(r.label || "").trim()) r.error = "اكتب الاسم الذي يظهر للطلاب.";
      if (r.error) bad = true;
    });
    queue.forEach(paintRowState);
    return !bad;
  }

  $("send").addEventListener("click", async function () {
    if (busy) return;
    var msgBox = $("formMsg");
    showMsg(msgBox, "");
    var courseId = $("course").value;
    if (!courseId) { showMsg(msgBox, "اختر المادة أولاً."); return; }
    if (!validateRows()) { showMsg(msgBox, "أكمل الحقول الناقصة في الملفات المظللة ثم أعد المحاولة."); return; }

    var pending = queue.filter(function (r) { return r.state !== "done"; });
    var totalBytes = pending.reduce(function (n, r) { return n + r.file.size; }, 0) || 1;
    var sentBefore = 0, ok = 0, failed = 0, stopped = false;
    setBusy(true);
    progress(0, "بدأ الرفع");

    for (var k = 0; k < pending.length && !stopped; k++) {
      var row = pending[k];
      row.state = "up";
      paintRowState(row);
      try {
        await uploadOne(row, courseId, function (sent) {
          progress(Math.round(((sentBefore + sent) / totalBytes) * 100), "الملف " + (k + 1) + " من " + pending.length + ": تم رفع " + mb(sent) + " من " + mb(row.file.size));
        });
        row.state = "done";
        ok++;
      } catch (err) {
        row.state = "error";
        row.error = errText(err.code);
        failed++;
        if (err.code === "bad_code" || err.code === "locked") stopped = true;
      }
      sentBefore += row.file.size;
      paintRowState(row);
    }

    progress(100, failed ? "انتهى الرفع مع أخطاء" : "اكتمل الرفع");
    if (ok) {
      queue = queue.filter(function (r) { return r.state !== "done"; });
      renderQueue();
      MS.toast(ok === 1 ? "تم رفع الملف" : "تم رفع " + ok + " ملفات");
    }
    queue.forEach(function (r) { if (r.state === "error") r.state = "wait"; });
    setBusy(false);
    if (!failed) {
      var wrap = document.createElement("span");
      wrap.appendChild(document.createTextNode((ok === 1 ? "تم رفع الملف. " : "تم رفع " + ok + " ملفات. ")));
      var a = el("a", "", "افتح المادة");
      a.href = "course.html?id=" + encodeURIComponent(courseId);
      wrap.appendChild(a);
      wrap.appendChild(document.createTextNode(" (قد يتأخر ظهورها للطلاب نصف دقيقة)."));
      showMsg(msgBox, wrap, true);
    } else {
      showMsg(msgBox, "رُفع " + ok + " من " + (ok + failed) + ". الملفات التي فشلت بقيت في القائمة مع سبب الخطأ، وتستطيع إعادة المحاولة.");
    }
    await refreshList();
  });

  /* ---------- إضافة رابط أو اختبار تفاعلي ---------- */
  var linkLabelAuto = true;

  function syncLinkLecture() {
    var type = $("linkType").value;
    var n = parseInt($("linkNumber").value, 10);
    var has = n >= 1;
    $("linkTitleBox").hidden = !has;
    $("linkLatestBox").hidden = !has;
    if (!has) {
      $("linkLecHint").textContent = "";
      return;
    }
    var existing = liveLectures($("course").value).map[n];
    if (existing) {
      $("linkTitle").value = existing.title;
      $("linkLecHint").textContent = "هذه المحاضرة موجودة، وسيُضاف الرابط إليها.";
    } else {
      $("linkLecHint").textContent = "محاضرة جديدة: اكتب عنوانها كما هو في الملف.";
    }
    void type;
  }
  function syncLinkLabel() {
    var type = $("linkType").value;
    $("linkLabelHint").textContent = type === "quiz"
      ? "مثال: Interactive quiz أو Quiz 1. هذا ما يراه الطالب على زر الاختبار."
      : type === "exam" ? "مثال: Past questions 2025." : "مثال: Video أو Online resource.";
    if (linkLabelAuto) $("linkLabel").value = LINK_LABEL[type];
  }
  $("linkType").addEventListener("change", function () {
    syncLinkLabel();
    if ($("linkType").value === "lecture" && !$("linkNumber").value) showMsg($("linkMsg"), "رابط المحاضرة يحتاج رقم المحاضرة.");
    else showMsg($("linkMsg"), "");
  });
  $("linkNumber").addEventListener("input", syncLinkLecture);
  $("linkLabel").addEventListener("input", function () { linkLabelAuto = false; });
  syncLinkLabel();

  function normalizeUrl(v) {
    v = String(v || "").trim();
    if (!v) return "";
    if (!/^[a-z][a-z0-9+.-]*:/i.test(v)) v = "https://" + v;
    return v;
  }

  $("linkForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var box = $("linkMsg");
    showMsg(box, "");
    var courseId = $("course").value;
    var type = $("linkType").value;
    var n = parseInt($("linkNumber").value, 10);
    var number = n >= 1 ? n : 0;
    var url = normalizeUrl($("linkUrl").value);
    var label = $("linkLabel").value.trim();
    var title = $("linkTitle").value.trim();
    if (!courseId) { showMsg(box, "اختر المادة أولاً من أعلى الصفحة."); return; }
    if (!url) { showMsg(box, "اكتب الرابط."); return; }
    if (!label) { showMsg(box, "اكتب الاسم الذي يظهر للطلاب."); return; }
    if (type === "lecture" && !number) { showMsg(box, "رابط المحاضرة يحتاج رقم المحاضرة."); return; }
    if (number && !title) { showMsg(box, "اكتب عنوان المحاضرة."); return; }
    $("linkSend").disabled = true;
    var body = { courseId: courseId, type: type, number: number, title: number ? title : "", label: label, url: url };
    if (number) body.showInLatest = $("linkLatest").checked;
    var r = await api("link", { body: body });
    $("linkSend").disabled = false;
    if (r.status !== 200) { showMsg(box, errText(r.data.error)); return; }
    showMsg(box, "تمت إضافة الرابط.", true);
    MS.toast("تمت إضافة الرابط");
    $("linkUrl").value = "";
    await refreshList();
  });

  /* ---------- قائمة المرفوعات: التصفية والتعديل والحذف ---------- */
  function whenText(it) {
    if (!it.at) return it.added || "";
    try {
      return new Date(it.at).toLocaleString("ar-u-nu-latn", { timeZone: "Asia/Baghdad", day: "numeric", month: "long", hour: "numeric", minute: "2-digit" });
    } catch (e) { return it.added || ""; }
  }

  function latestText(it) {
    if (!it.number) return "";
    if (it.showInLatest === true) return "يظهر في أحدث المحاضرات";
    if (it.showInLatest === false) return "مخفي من أحدث المحاضرات";
    var c = MS.course(it.courseId);
    return c && c.semester === MS.currentSemester() ? "يظهر في أحدث المحاضرات (الافتراضي)" : "مخفي من أحدث المحاضرات (الافتراضي)";
  }

  function paintFilterBy() {
    var sel = $("filterBy");
    var keep = sel.value;
    sel.textContent = "";
    sel.appendChild(new Option("كل المساعدين", ""));
    var names = [];
    items.forEach(function (it) { if (it.by && names.indexOf(it.by) === -1) names.push(it.by); });
    names.forEach(function (n) { sel.appendChild(new Option(n, n)); });
    if (names.indexOf(keep) !== -1) sel.value = keep;
  }

  function visibleItems() {
    var by = $("filterBy").value, type = $("filterType").value, onlyCourse = $("filterCourse").checked ? $("course").value : "";
    return items.filter(function (it) {
      return (!by || it.by === by) && (!type || it.type === type) && (!onlyCourse || it.courseId === onlyCourse);
    }).reverse();
  }
  ["filterBy", "filterType", "filterCourse"].forEach(function (id) { $(id).addEventListener("change", renderList); });

  async function refreshList() {
    var r = await api("admin");
    if (r.status === 200 && r.data.ok) items = r.data.items || [];
    paintFilterBy();
    renderList();
    renderBoard();
    renderOverview();
  }

  function renderList() {
    var box = $("list");
    box.textContent = "";
    var list = visibleItems();
    if (!list.length) {
      var empty = el("div", "empty");
      empty.appendChild(el("strong", "", items.length ? "لا توجد نتائج بهذه التصفية" : "لم تُرفع ملفات من هنا بعد"));
      box.appendChild(empty);
      return;
    }
    list.forEach(function (it) { box.appendChild(itemRow(it)); });
  }

  function itemRow(it) {
    var c = MS.course(it.courseId);
    var row = el("div", "up-item");
    var main = el("div", "up-item-main");
    main.appendChild(el("div", "up-item-name", (c ? c.nameAr : it.courseId) + " — " + (it.number ? "محاضرة " + it.number : "للمادة كلها")));
    var sub = el("div", "up-item-sub");
    sub.appendChild(el("span", "up-type is-" + it.type, TYPE_NAME[it.type] || it.type));
    sub.appendChild(el("span", "up-ltr", " " + (it.title ? it.title + " / " : "") + it.label));
    main.appendChild(sub);
    if (it.kind === "link") main.appendChild(el("div", "up-item-sub up-ltr up-url", it.url));
    main.appendChild(el("div", "up-item-sub", (it.kind === "link" ? "رابط" : mb(it.size)) + " · رفعه " + (it.by || "غير معروف") + " · " + whenText(it)));
    var lt = latestText(it);
    if (lt) main.appendChild(el("div", "up-item-sub", lt));
    row.appendChild(main);

    var actions = el("div", "up-item-actions");
    var editBtn = el("button", "btn btn-secondary btn-sm up-edit", "تعديل");
    editBtn.type = "button";
    editBtn.addEventListener("click", function () { row.replaceWith(editRow(it)); });
    actions.appendChild(editBtn);
    var del = el("button", "btn btn-secondary btn-sm up-del", "حذف");
    del.type = "button";
    del.addEventListener("click", async function () {
      if (!window.confirm(it.kind === "link" ? "حذف هذا الرابط نهائياً من الموقع؟" : "حذف هذا الملف نهائياً من الموقع؟")) return;
      del.disabled = true;
      var d = await api("delete", { body: { id: it.id } });
      if (d.status === 200) MS.toast("تم الحذف");
      else MS.toast(errText(d.data.error));
      refreshList();
    });
    actions.appendChild(del);
    row.appendChild(actions);
    return row;
  }

  /* نموذج تعديل داخل الصف نفسه. عنوان المحاضرة يُطبَّق على كل ملفات المحاضرة المرفوعة من الموقع */
  function editRow(it) {
    var row = el("form", "up-item up-edit-form");
    row.noValidate = true;
    var body = el("div", "up-edit-body");

    var grid = el("div", "up-grid up-grid-4");
    var type = el("select", "field e-type");
    Object.keys(TYPE_NAME).forEach(function (k) { type.appendChild(new Option(TYPE_NAME[k], k)); });
    type.value = it.type;
    var number = el("input", "field up-ltr e-number");
    number.type = "number"; number.inputMode = "numeric"; number.min = "1"; number.max = "999"; number.step = "1";
    number.value = it.number || "";
    var title = el("input", "field up-ltr e-title");
    title.type = "text"; title.maxLength = 200; title.value = it.title || "";
    var label = el("input", "field up-ltr e-label");
    label.type = "text"; label.maxLength = 120; label.value = it.label || ""; label.setAttribute("list", "labelSuggest");
    grid.appendChild(field("النوع", type));
    grid.appendChild(field("رقم المحاضرة (فارغ = للمادة كلها)", number));
    grid.appendChild(field("عنوان المحاضرة", title));
    grid.appendChild(field("الاسم الذي يظهر للطلاب", label));
    body.appendChild(grid);

    var url = null;
    if (it.kind === "link") {
      url = el("input", "field up-ltr e-url");
      url.type = "url"; url.inputMode = "url"; url.value = it.url || "";
      body.appendChild(field("الرابط", url));
    }

    var latest = el("select", "field e-latest");
    latest.appendChild(new Option("حسب الكورس (الافتراضي)", ""));
    latest.appendChild(new Option("اعرضها في أحدث المحاضرات", "1"));
    latest.appendChild(new Option("لا تعرضها في أحدث المحاضرات", "0"));
    latest.value = it.showInLatest === true ? "1" : it.showInLatest === false ? "0" : "";
    var latestWrap = field("أحدث المحاضرات", latest);
    body.appendChild(latestWrap);

    function paintLatestBox() { latestWrap.hidden = !(parseInt(number.value, 10) >= 1); }
    number.addEventListener("input", paintLatestBox);
    paintLatestBox();

    var msg = el("p", "up-msg");
    msg.hidden = true;
    body.appendChild(msg);
    var actions = el("div", "up-actions");
    var save = el("button", "btn btn-primary btn-sm", "حفظ");
    save.type = "submit";
    var cancel = el("button", "btn btn-secondary btn-sm", "إلغاء");
    cancel.type = "button";
    cancel.addEventListener("click", function () { row.replaceWith(itemRow(it)); });
    actions.appendChild(save);
    actions.appendChild(cancel);
    body.appendChild(actions);
    row.appendChild(body);

    row.addEventListener("submit", async function (e) {
      e.preventDefault();
      showMsg(msg, "");
      var n = parseInt(number.value, 10);
      var payload = { id: it.id, type: type.value, number: n >= 1 ? n : 0, label: label.value.trim(), title: title.value.trim() };
      if (url) payload.url = normalizeUrl(url.value);
      payload.showInLatest = payload.number ? (latest.value === "" ? null : latest.value === "1") : null;
      if (payload.type === "lecture" && !payload.number) { showMsg(msg, "المحاضرة تحتاج رقماً."); return; }
      if (payload.number && !payload.title) { showMsg(msg, "اكتب عنوان المحاضرة."); return; }
      if (!payload.label) { showMsg(msg, "اكتب الاسم الذي يظهر للطلاب."); return; }
      save.disabled = true;
      var r = await api("edit", { body: payload });
      save.disabled = false;
      if (r.status !== 200) { showMsg(msg, errText(r.data.error)); return; }
      MS.toast("تم حفظ التعديل");
      refreshList();
    });
    return row;
  }

  /* دخول تلقائي بالرمز المحفوظ على هذا الجهاز */
  paintLatest();
  renderBoard();
  var saved = stored(KEY);
  if (saved) login(saved, true);
  else login("", true); // حساب مسجَّل بدور رافع أو ممثل أو مشرف يدخل بلا رمز
})();
