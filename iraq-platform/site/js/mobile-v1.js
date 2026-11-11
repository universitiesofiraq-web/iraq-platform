/* js/mobile-v1.js — واجهة الهاتف (Mobile UI V1) لصفحة القسم platform.html.
   طبقة عرض فقط: تبني شريط تنقل سفلياً وشبكة اختصارات وورقة «حسابي» من العناصر والبيانات الموجودة،
   وتبدّل العرض بالرابط #hash (فيعمل زر الرجوع وتبقى ?dept= و?stage= كما هي). لا API جديد ولا تغيير صلاحيات.
   النصوص من الخادم تُكتب textContent فقط. */
(function () {
  "use strict";
  if (!window.MS) return;
  var MS = window.MS, el = MS.el, $ = MS.$;
  var T = function (s) { return window.I18N && I18N.t ? I18N.t(s) : s; };
  var VIEWS = { home: "home", semesters: "subjects", subjects: "subjects", favorites: "subjects", latest: "lectures", lectures: "lectures",
    tools: "tools", review: "tools", professors: "tools", help: "tools" };
  var body = document.body;
  var isHome = !!document.getElementById("home");
  body.classList.add("mv");
  /* صفحات المادة والكورس: شريط التنقل والرأس فقط، وروابطه تعود إلى صفحة القسم مع ?dept= و?stage= */
  var BASE = "";
  if (!isHome) {
    var d = window.IQ_DEPT && IQ_DEPT.id;
    BASE = "platform.html" + (d ? "?dept=" + d + (window.IQ_STAGE ? "&stage=" + IQ_STAGE : "") : "");
  }
  var SUB = /\/(course|semester)(\.html)?$/.test(location.pathname) ? "semesters" : null;

  function view() {
    if (!isHome) return "";
    var h = (location.hash || "#home").slice(1);
    return VIEWS[h] || "home";
  }
  function apply() {
    var v = view();
    body.setAttribute("data-mv", v || "page");
    var cur = isHome ? { home: "home", subjects: "semesters", lectures: "latest", tools: "tools" }[v] : SUB;
    var links = document.querySelectorAll(".mv-nav [data-v]");
    for (var i = 0; i < links.length; i++) {
      if (links[i].getAttribute("data-v") === cur) links[i].setAttribute("aria-current", "page"); else links[i].removeAttribute("aria-current");
    }
  }
  window.addEventListener("hashchange", function () { apply(); window.scrollTo(0, 0); });

  /* ---- M3: عنوان الشريط ---- */
  var inner = document.querySelector(".header-inner");
  if (inner && !inner.querySelector(".mv-title")) {
    var tt = el("span", "mv-title");
    tt.textContent = (window.IQ_DEPT && IQ_DEPT.name) || "المنصة العراقية";
    var sb = $("searchBtn");
    inner.insertBefore(tt, sb || null);
  }

  if (isHome) {
  /* ---- M1: هوية القسم المختصرة (جامعة · كلية · مرحلة) ---- */
  /* سطر واحد: الجامعة · الكلية · المرحلة، بلا تكرار لعنوان القسم */
  var text = document.querySelector(".hero-text");
  if (text && !text.querySelector(".mv-meta")) {
    var head = ($("heroTitle") && $("heroTitle").textContent.trim()) || "";
    var seen = {}; seen[head] = 1;
    var parts = String((window.SITE && SITE.subtitle) || "").split(" · ").map(function (p) { return p.trim(); })
      .filter(function (p) { if (!p || seen[p]) return false; seen[p] = 1; return true; });
    if (window.IQ_STAGE) parts.push("المرحلة " + IQ_STAGE);
    var meta = el("p", "mv-meta");
    meta.appendChild(MS.icon("cap", 16));
    meta.appendChild(el("span", "", parts.join(" · ")));
    if (parts.length) text.appendChild(meta);
  }

  /* ---- شبكة الاختصارات والبحث والترحيب ---- */
  var host = el("section", "mv-home");
  host.setAttribute("aria-label", "الصفحة الرئيسية");
  var welcome = el("p", "mv-welcome");
  var wName = el("strong", "", "مرحباً");
  var wDate = el("small", "", new Date().toLocaleDateString("ar-IQ", { weekday: "long", day: "numeric", month: "long" }));
  welcome.appendChild(wName); welcome.appendChild(wDate);
  var search = el("button", "mv-search", "ابحث عن مادة أو محاضرة…");
  search.type = "button"; search.insertBefore(MS.icon("search", 20), search.firstChild);
  search.addEventListener("click", function () { var b = $("searchBtn"); if (b) b.click(); });

  /* بطاقة خدمة: أيقونة بلون ثابت لكل خدمة + عنوان + سطر وصف (يظهر في عرض العمودين) */
  function tile(label, sub, ico, hue, opts) {
    var t = el(opts.href ? "a" : "button", "mv-tile hue-" + hue);
    if (opts.href) t.href = opts.href; else t.type = "button";
    var ic = el("span", "mv-ic"); ic.setAttribute("aria-hidden", "true"); ic.appendChild(MS.icon(ico, 22)); t.appendChild(ic);
    var tx = el("span", "mv-tx"); tx.appendChild(el("strong", "", label)); tx.appendChild(el("small", opts.soon ? "mv-soon" : "", opts.soon ? "قريباً" : sub)); t.appendChild(tx);
    if (opts.soon) { t.classList.add("is-soon"); t.setAttribute("aria-disabled", "true"); t.tabIndex = -1; }
    if (opts.click) t.addEventListener("click", opts.click);
    return t;
  }
  var openGuide = function () { var g = document.querySelector("[data-open-guide]"); if (g) g.click(); };
  var grid = el("div", "mv-grid");
  grid.appendChild(tile("المواد الدراسية", "مواد مرحلتك", "book", 1, { href: "#semesters" }));
  grid.appendChild(tile("المحاضرات", "أحدث الملفات", "file", 2, { href: "#latest" }));
  grid.appendChild(tile("المرشد الذكي", "اسأل ولخّص", "sparkles", 4, { click: openGuide }));
  grid.appendChild(tile("دردشة مجموعتي", "زملاء مرحلتك", "users", 5, { href: "group-chat.html" }));
  grid.appendChild(tile("المفضلة", "موادك المحفوظة", "star", 3, { href: "#favorites" }));
  grid.appendChild(tile("أدوات الطالب", "التقدم والامتحان", "tools", 6, { href: "#tools" }));
  grid.appendChild(tile("التقويم", "المواعيد", "calendar", 1, { soon: true }));
  grid.appendChild(tile("بنك الأسئلة", "تدرّب واختبر", "help", 2, { soon: true }));

  /* «تابع دراستك»: آخر مادة فتحها الطالب + تقدّمه المحفوظ في هذا المتصفح (لا بيانات وهمية) */
  var cont = el("a", "mv-continue"); cont.hidden = true;
  var last = null;
  try { last = MS.course(MS.getLast()); } catch (e) { last = null; }
  if (last) {
    cont.href = "course.html?id=" + encodeURIComponent(last.id);
    var ci = el("span", "mv-ic hue-1"); ci.setAttribute("aria-hidden", "true"); ci.appendChild(MS.icon("book", 22)); cont.appendChild(ci);
    var ct = el("span", "mv-ctx"); ct.appendChild(el("small", "", "تابع دراستك")); ct.appendChild(el("strong", "", last.name || ""));
    var total = (last.lectures || []).length, done = 0;
    try { done = MS.progress.done(last); } catch (e) { done = 0; }
    if (total) {
      var bar = el("span", "mv-bar"); bar.setAttribute("role", "progressbar"); bar.setAttribute("aria-valuemin", "0"); bar.setAttribute("aria-valuemax", String(total)); bar.setAttribute("aria-valuenow", String(done));
      bar.setAttribute("aria-label", "التقدّم في المادة");
      var fillBar = el("span"); fillBar.style.width = Math.round(done / total * 100) + "%"; bar.appendChild(fillBar);
      ct.appendChild(bar); ct.appendChild(el("small", "", done + " من " + total + " محاضرة مقروءة"));
    }
    cont.appendChild(ct);
    var go = el("span", "mv-go"); go.setAttribute("aria-hidden", "true"); go.appendChild(MS.icon("chevron", 18)); cont.appendChild(go);
    cont.hidden = false;
  }
  host.appendChild(welcome); host.appendChild(search); host.appendChild(grid); host.appendChild(cont);
  var hero = $("home");
  hero.parentNode.insertBefore(host, hero.nextSibling);

  /* «أحدث المحاضرات»: الملفات الحقيقية نفسها (في الرئيسية ثلاثة فقط) و«عرض الكل» بجانب العنوان */
  var latest = $("latest");
  if (latest) {
    var lh = latest.querySelector(".section-head");
    var more = el("a", "mv-more", "عرض الكل"); more.href = "#latest";
    if (lh) lh.appendChild(more);
    [].forEach.call(latest.querySelectorAll(".latest-sub"), function (n) {
      if (n.firstChild && n.firstChild.nodeType === 3) n.firstChild.nodeValue = n.firstChild.nodeValue.replace(/\s*·\s*$/, "");
    });
    if (!latest.querySelector(".latest-item")) latest.classList.add("mv-empty");
  }


  }

  /* ---- M2: شريط التنقل السفلي ---- */
  var nav = el("nav", "mv-nav"); nav.setAttribute("aria-label", "التنقل الرئيسي");
  function item(label, ico, v, href, click) {
    var a = el(href ? "a" : "button", ""); if (href) a.href = href; else a.type = "button";
    a.setAttribute("data-v", v); a.appendChild(MS.icon(ico, 22)); a.appendChild(el("span", "", label));
    if (click) a.addEventListener("click", click);
    return a;
  }
  nav.appendChild(item("الرئيسية", "home", "home", BASE + "#home"));
  nav.appendChild(item("المواد", "book", "semesters", BASE + "#semesters"));
  nav.appendChild(item("المحاضرات", "file", "latest", BASE + "#latest"));
  nav.appendChild(item("الدردشة", "users", "chat", "group-chat.html"));
  nav.appendChild(item("حسابي", "user", "me", null, function () { openSheet(); }));
  body.appendChild(nav);

  /* لوحة المفاتيح: نخفي الشريط حين تنكمش نافذة العرض كثيراً */
  if (window.visualViewport) {
    var base = window.innerHeight;
    visualViewport.addEventListener("resize", function () {
      body.classList.toggle("mv-kb", visualViewport.height < base - 150);
    });
  }

  /* ---- حسابي ---- */
  var sheet = el("div", "mv-sheet"); sheet.setAttribute("role", "dialog"); sheet.setAttribute("aria-modal", "true"); sheet.setAttribute("aria-label", "حسابي");
  var scrim = el("div", "mv-sheet-scrim");
  function closeSheet() { body.classList.remove("mv-sheet-open"); }
  function openSheet() { fill(); body.classList.add("mv-sheet-open"); if (who && who.user) Promise.all([loadPub(), loadProf()]).then(function () { if (body.classList.contains("mv-sheet-open")) fill(); }); }
  scrim.addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  var who = null;
  function row(label, href, click) {
    var r = el(href ? "a" : "button", "mv-row"); if (href) r.href = href; else r.type = "button";
    r.appendChild(el("span", "", label)); if (click) r.addEventListener("click", click); return r;
  }
  var pub = null;
  function hue(id) { return 1 + (Math.abs(Number(id) || 0) % 6); }
  function shrink(file) { /* مثل ميدكسا: مربع 256 JPEG أقل من 80 ألف حرف */
    return new Promise(function (res, rej) {
      var url = URL.createObjectURL(file), img = new Image();
      img.onload = function () {
        var S = 256, c = document.createElement("canvas"); c.width = c.height = S;
        var side = Math.min(img.naturalWidth, img.naturalHeight), sx = (img.naturalWidth - side) / 2, sy = (img.naturalHeight - side) / 2;
        var x = c.getContext("2d"); x.fillStyle = "#fff"; x.fillRect(0, 0, S, S); x.drawImage(img, sx, sy, side, side, 0, 0, S, S);
        URL.revokeObjectURL(url);
        var q = 0.86, out = c.toDataURL("image/jpeg", q);
        while (out.length > 80000 && q > 0.4) { q -= 0.1; out = c.toDataURL("image/jpeg", q); }
        out.length > 80000 ? rej(new Error("big")) : res(out);
      };
      img.onerror = function () { URL.revokeObjectURL(url); rej(new Error("bad")); };
      img.src = url;
    });
  }
  function postPub(body) {
    return fetch("/api/profile/public", { method: "POST", credentials: "same-origin", headers: { "content-type": "application/json" }, body: JSON.stringify(body) })
      .then(function (r) { return r.json().then(function (j) { if (!r.ok || !j.ok) throw new Error(j.error || "server"); return j; }); });
  }
  var prof = null;
  function loadProf() {
    return fetch("/api/catalog/me", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { prof = j && j.profile ? j.profile : null; }).catch(function () { prof = null; });
  }
  function loadPub() {
    return fetch("/api/profile/public", { credentials: "same-origin" }).then(function (r) { return r.ok ? r.json() : null; })
      .then(function (j) { pub = j && j.ok ? j : null; }).catch(function () { pub = null; });
  }
  function bigAvatar(u) {
    var shown = (pub && pub.display_name) || u.name || "?";
    var a = el("span", "mv-av hue-" + hue(u.id), String(shown).trim().charAt(0).toUpperCase());
    if (pub && pub.has_avatar) { var im = el("img"); im.alt = ""; im.src = "/api/avatar/" + u.id + "?v=" + pub.updated_at; im.onload = function () { a.textContent = ""; a.appendChild(im); }; }
    return a;
  }
  function fill() {
    sheet.textContent = "";
    sheet.appendChild(el("h2", "", "حسابي"));
    var u = who && who.user;
    var acct = el("div", "mv-acct");
    if (u) {
      acct.appendChild(bigAvatar(u));
      var tx = el("div", "mv-acct-txt");
      tx.appendChild(el("strong", "", (pub && pub.display_name) || u.name || ""));
      if (pub && pub.display_name && pub.display_name !== u.name) tx.appendChild(el("small", "", "الاسم في الحساب: " + u.name));
      tx.appendChild(el("small", "", u.email || ""));
      acct.appendChild(tx);
    } else acct.appendChild(el("p", "mv-who", "أنت تتصفح كزائر"));
    sheet.appendChild(acct);
    var facts = el("div", "mv-facts");
    if (prof) { /* المرحلة المسجّلة في الحساب (تتبعها الدردشة) */
      [prof.university, prof.college, prof.department, "المرحلة " + prof.stage].forEach(function (p) { if (p) facts.appendChild(el("span", "", p)); });
      if (prof.membership === "pending") facts.appendChild(el("span", "", "بانتظار تأكيد الممثل"));
    } else if (u) facts.appendChild(el("span", "", "لم تسجّل قسمك ومرحلتك بعد"));
    if (u && u.admin) facts.appendChild(el("span", "", "مشرف"));
    else if (u) (u.scopes || []).filter(function (x) { return x.level === "rep"; }).forEach(function (x) { facts.appendChild(el("span", "", "ممثل" + (x.label ? " · " + x.label : ""))); });
    if (facts.childNodes.length) sheet.appendChild(facts);

    if (u) { /* الصورة والاسم الظاهر (كما في ميدكسا): يراهما الزملاء في الدردشة ولا يغيّران الاسم الحقيقي */
      var box = el("div", "mv-pub");
      box.appendChild(el("strong", "", "صورتك واسمك في الدردشة"));
      box.appendChild(el("p", "", "يراهما زملاؤك في الدردشة والرسائل الخاصة. لا يغيّران اسمك في الحساب."));
      var msg = el("span", "mv-msg");
      var r1 = el("div", "mv-pub-row");
      var name = el("input", "field"); name.type = "text"; name.maxLength = 30; name.placeholder = "الاسم الظاهر"; name.value = (pub && pub.display_name) || "";
      var save = el("button", "btn btn-secondary btn-sm", "حفظ الاسم"); save.type = "button";
      save.onclick = function () { save.disabled = true; postPub({ name: name.value }).then(function () { msg.textContent = "حُفظ الاسم."; return loadPub(); }).then(fill).catch(function () { msg.textContent = "تعذّر الحفظ (حرفان على الأقل)."; }).then(function () { save.disabled = false; }); };
      r1.appendChild(name); r1.appendChild(save); box.appendChild(r1);
      var r2 = el("div", "mv-pub-row");
      var file = el("input"); file.type = "file"; file.accept = "image/*"; file.hidden = true;
      var pick = el("button", "btn btn-secondary btn-sm", pub && pub.has_avatar ? "تغيير الصورة" : "إضافة صورة"); pick.type = "button";
      pick.onclick = function () { file.click(); };
      file.onchange = function () {
        var f = file.files && file.files[0]; if (!f) return;
        msg.textContent = "جارٍ الرفع…";
        shrink(f).then(function (data) { return postPub({ image: data }); }).then(function () { msg.textContent = "حُفظت الصورة."; return loadPub(); }).then(fill)
          .catch(function () { msg.textContent = "تعذّر رفع الصورة. جرّب صورة أخرى."; });
      };
      r2.appendChild(pick); r2.appendChild(file);
      if (pub && pub.has_avatar) {
        var rm = el("button", "btn btn-secondary btn-sm", "إزالة الصورة"); rm.type = "button";
        rm.onclick = function () { postPub({ remove: true }).then(loadPub).then(fill).catch(function () { msg.textContent = "تعذّر الحذف."; }); };
        r2.appendChild(rm);
      }
      box.appendChild(r2); box.appendChild(msg);
      sheet.appendChild(box);
    }

    var lang = el("label", "mv-row"); lang.appendChild(el("span", "", "اللغة"));
    var sel = document.createElement("select"); sel.className = "field";
    [["ar", "عربي"], ["fa", "فارسی"], ["en", "English"]].forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; sel.appendChild(op); });
    sel.value = MS.lang || "ar";
    sel.addEventListener("change", function () { var s = $("langSel"); if (s) { s.value = sel.value; s.dispatchEvent(new Event("change")); } else if (window.I18N) I18N.set(sel.value); });
    lang.appendChild(sel); sheet.appendChild(lang);
    sheet.appendChild(row("تبديل الوضع الليلي/النهاري", null, function () { var b = $("themeBtn"); if (b) b.click(); }));
    sheet.appendChild(row("الرسائل الخاصة", "dm.html"));
    sheet.appendChild(row("المرشد الذكي", null, function () { closeSheet(); var g = document.querySelector("[data-open-guide]"); if (g) g.click(); }));
    sheet.appendChild(row("المفضلة", BASE + "#favorites", closeSheet));
    if (u) sheet.appendChild(row(prof ? "تغيير مرحلتي المسجّلة (تتبعها الدردشة)" : "تسجيل قسمي ومرحلتي", "join.html"));
    sheet.appendChild(row("تصفّح قسم آخر", "catalog.html"));
    if (u) {
      if (u.admin || (u.scopes || []).some(function (x) { return x.level === "rep"; })) sheet.appendChild(row("لوحة الإدارة", "admin.html"));
      sheet.appendChild(row("تسجيل الخروج", null, function () {
        if (window.MSAuth && MSAuth.logout) MSAuth.logout().then(function () { location.reload(); });
      }));
    } else {
      sheet.appendChild(row("تسجيل الدخول", "login.html?next=" + encodeURIComponent(location.pathname + location.search)));
    }
    sheet.appendChild(row("إغلاق", null, closeSheet));
  }
  body.appendChild(scrim); body.appendChild(sheet);

  fetch("/api/auth/me", { credentials: "same-origin" }).then(function (r) { return r.json(); }).then(function (m) {
    who = m || null;
    if (m && m.user && m.user.name) wName.textContent = "مرحباً، " + String(m.user.name).split(" ")[0];
  }).catch(function () {});

  apply();
  if (window.I18N && I18N.apply) try { I18N.apply(); } catch (e) { /* اختياري */ }
})();
