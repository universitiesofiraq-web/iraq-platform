/* js/mobile-v1.js — واجهة الهاتف (Mobile UI V1) لصفحة القسم platform.html.
   طبقة عرض فقط: تبني شريط تنقل سفلياً وشبكة اختصارات وورقة «حسابي» من العناصر والبيانات الموجودة،
   وتبدّل العرض بالرابط #hash (فيعمل زر الرجوع وتبقى ?dept= و?stage= كما هي). لا API جديد ولا تغيير صلاحيات.
   النصوص من الخادم تُكتب textContent فقط. */
(function () {
  "use strict";
  if (!window.MS || !document.getElementById("home")) return;
  var MS = window.MS, el = MS.el, $ = MS.$;
  var T = function (s) { return window.I18N && I18N.t ? I18N.t(s) : s; };
  var VIEWS = { home: "home", semesters: "subjects", subjects: "subjects", favorites: "subjects", latest: "lectures", lectures: "lectures",
    tools: "tools", review: "tools", professors: "tools", help: "tools" };
  var body = document.body;
  body.classList.add("mv");

  function view() {
    var h = (location.hash || "#home").slice(1);
    return VIEWS[h] || "home";
  }
  function apply() {
    var v = view();
    body.setAttribute("data-mv", v);
    var cur = { home: "home", subjects: "semesters", lectures: "latest", tools: "tools" }[v];
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

  /* ---- M1: هوية القسم المختصرة (جامعة · كلية · مرحلة) ---- */
  var text = document.querySelector(".hero-text");
  if (text && !text.querySelector(".mv-chips")) {
    var chips = el("div", "mv-chips");
    var parts = String((window.SITE && SITE.subtitle) || "").split(" · ").filter(Boolean);
    parts.forEach(function (p) { chips.appendChild(el("span", "mv-chip", p)); });
    if (window.IQ_STAGE) chips.appendChild(el("span", "mv-chip", "المرحلة " + IQ_STAGE));
    text.appendChild(chips);
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

  function tile(label, ico, opts) {
    var t = el(opts.href ? "a" : "button", "mv-tile");
    if (opts.href) t.href = opts.href; else t.type = "button";
    var ic = el("span", "tile"); ic.setAttribute("data-ico", ico); ic.appendChild(MS.icon(ico, 22)); t.appendChild(ic);
    t.appendChild(el("strong", "", label));
    if (opts.soon) { t.classList.add("is-soon"); t.setAttribute("aria-disabled", "true"); t.appendChild(el("span", "mv-soon", "قريباً")); }
    if (opts.click) t.addEventListener("click", opts.click);
    return t;
  }
  var grid = el("div", "mv-grid");
  grid.appendChild(tile("المواد الدراسية", "book", { href: "#semesters" }));
  grid.appendChild(tile("المحاضرات", "file", { href: "#latest" }));
  grid.appendChild(tile("المرشد الذكي", "sparkles", { click: function () { var g = document.querySelector("[data-open-guide]"); if (g) g.click(); } }));
  grid.appendChild(tile("دردشة مجموعتي", "users", { href: "group-chat.html" }));
  grid.appendChild(tile("المفضلة", "star", { href: "#favorites" }));
  grid.appendChild(tile("أدوات الطالب", "tools", { href: "#tools" }));
  grid.appendChild(tile("التقويم", "calendar", { soon: true }));
  grid.appendChild(tile("بنك الأسئلة", "help", { soon: true }));

  var cont = el("a", "mv-continue"); cont.hidden = true;
  var last = null;
  try { last = MS.course(MS.getLast()); } catch (e) { last = null; }
  if (last) {
    cont.href = "course.html?id=" + encodeURIComponent(last.id) + (window.IQ_STAGE ? "" : "");
    cont.appendChild(MS.icon("book", 22));
    var ct = el("span"); ct.appendChild(el("small", "", "متابعة آخر مادة")); ct.appendChild(el("strong", "", last.name || ""));
    cont.appendChild(ct); cont.hidden = false;
  }
  host.appendChild(welcome); host.appendChild(search); host.appendChild(grid); host.appendChild(cont);
  var hero = $("home");
  hero.parentNode.insertBefore(host, hero.nextSibling);

  /* «عرض الكل» لأحدث المحاضرات (في الرئيسية يظهر ثلاث فقط) */
  var latest = $("latest");
  if (latest) {
    var more = el("a", "btn btn-secondary btn-sm mv-more", "عرض كل المحاضرات"); more.href = "#latest";
    latest.querySelector(".container").appendChild(more);
  }

  /* ---- M2: شريط التنقل السفلي ---- */
  var nav = el("nav", "mv-nav"); nav.setAttribute("aria-label", "التنقل الرئيسي");
  function item(label, ico, v, href, click) {
    var a = el(href ? "a" : "button", ""); if (href) a.href = href; else a.type = "button";
    a.setAttribute("data-v", v); a.appendChild(MS.icon(ico, 22)); a.appendChild(el("span", "", label));
    if (click) a.addEventListener("click", click);
    return a;
  }
  nav.appendChild(item("الرئيسية", "home", "home", "#home"));
  nav.appendChild(item("المواد", "book", "semesters", "#semesters"));
  nav.appendChild(item("المحاضرات", "file", "latest", "#latest"));
  nav.appendChild(item("المساعد", "sparkles", "ai", null, function () { var g = document.querySelector("[data-open-guide]"); if (g) g.click(); }));
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
  function openSheet() { fill(); body.classList.add("mv-sheet-open"); }
  scrim.addEventListener("click", closeSheet);
  document.addEventListener("keydown", function (e) { if (e.key === "Escape") closeSheet(); });
  var who = null;
  function row(label, href, click) {
    var r = el(href ? "a" : "button", "mv-row"); if (href) r.href = href; else r.type = "button";
    r.appendChild(el("span", "", label)); if (click) r.addEventListener("click", click); return r;
  }
  function fill() {
    sheet.textContent = "";
    sheet.appendChild(el("h2", "", "حسابي"));
    sheet.appendChild(el("p", "mv-who", who && who.user ? (who.user.name || who.user.email || "") : "أنت تتصفح كزائر"));
    var lang = el("label", "mv-row"); lang.appendChild(el("span", "", "اللغة"));
    var sel = document.createElement("select"); sel.className = "field";
    [["ar", "عربي"], ["fa", "فارسی"], ["en", "English"]].forEach(function (o) { var op = el("option", "", o[1]); op.value = o[0]; sel.appendChild(op); });
    sel.value = MS.lang || "ar";
    sel.addEventListener("change", function () { var s = $("langSel"); if (s) { s.value = sel.value; s.dispatchEvent(new Event("change")); } else if (window.I18N) I18N.set(sel.value); });
    lang.appendChild(sel); sheet.appendChild(lang);
    sheet.appendChild(row("تبديل الوضع الليلي/النهاري", null, function () { var b = $("themeBtn"); if (b) b.click(); }));
    sheet.appendChild(row("المفضلة", "#favorites", closeSheet));
    sheet.appendChild(row("دردشة مجموعتي", "group-chat.html"));
    sheet.appendChild(row("تغيير القسم", "catalog.html"));
    if (who && who.user) {
      var u = who.user;
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
