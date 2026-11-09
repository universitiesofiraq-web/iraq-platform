/* js/nav.js — القائمة الجانبية المشتركة (نفسها في كل الصفحات).
   كل صفحة فيها <aside class="sidebar" id="sidebar"></aside> فارغ؛ يرسمه هذا الملف من الإعداد NAV أدناه.
   لتفعيل عنصر مخفي لاحقاً: غيّر enabled إلى true وضع href صفحته الحقيقية. لا تضف رابطاً لصفحة غير موجودة. */
(function () {
  "use strict";
  if (!window.MS) return;
  var MS = window.MS;
  var T = function (s) { return window.I18N && I18N.t ? I18N.t(s) : s; };
  var KEY_NAV = "ms.nav";       // تفضيل طي القائمة على الكمبيوتر: "min" أو "full"
  var KEY_SEM = "ms.sem";       // كورس الطالب الحقيقي (رقم) إن حُفظ؛ لا واجهة تضبطه بعد فلا تظهر شارة «الحالي»
  var DESKTOP = "(min-width: 1081px)";

  /* ---------- الإعداد ----------
   enabled: true = رابط فعلي. soon: true = صف رمادي بلا رابط وعليه «قريباً» (لا صفحة بعد، ولا يُنشأ رابط معطل).
   بلا أي منهما = مخفي (مثل «تسجيل الخروج» لأنه لا جلسة دخول). لتفعيل عنصر: enabled: true وhref صفحته الحقيقية. ---------- */
  var NAV = [
    { items: [{ id: "home", label: "الرئيسية", icon: "home", href: "index.html#home", enabled: true }] },
    { title: "دراستي", items: [
      { id: "courses", label: "الكورسات والمواد", icon: "book", href: "index.html#semesters", enabled: true, children: "semesters" },
      { id: "latest", label: "أحدث المحاضرات", icon: "play", href: "index.html#latest", enabled: true },
      { id: "favorites", label: "المفضلة", icon: "star", href: "index.html#favorites", enabled: true },
      { id: "resume", label: "متابعة القراءة", icon: "file", enabled: true, dynamic: "resume" },
      { id: "professors", label: "الأساتذة", icon: "users", href: "index.html#professors", enabled: true }
    ] },
    { title: "تنظيم الدراسة", items: [
      { id: "tools", label: "أدوات الطالب", icon: "tools", href: "index.html#tools", enabled: true },
      { id: "plan", label: "مخطط الدراسة", icon: "list", soon: true },        // لا صفحة بعد
      { id: "calendar", label: "التقويم والامتحانات", icon: "calendar", soon: true } // لا صفحة بعد
    ] },
    { title: "التدريب", items: [
      { id: "qbank", label: "بنك الأسئلة", icon: "help", soon: true },      // «قريباً»
      { id: "results", label: "نتائج التدريب", icon: "chart", soon: true }
    ] },
    { title: "حسابي", items: [
      { id: "grades", label: "درجاتي الجامعية", icon: "cap", soon: true },  // يحتاج تحقق هوية من الخادم قبل أي عرض
      { id: "profile", label: "الملف الشخصي", icon: "user", soon: true }
    ] }
  ];
  var FOOT = [
    { id: "settings", label: "الإعدادات", icon: "gear", soon: true },        // اللغة والوضع الليلي في الرأس حالياً
    { id: "help", label: "المساعدة", icon: "help", href: "index.html#help", enabled: true },
    { id: "logout", label: "تسجيل الخروج", icon: "logout", enabled: false }     // لا تسجيل دخول في الموقع
  ];
  /* قسم الصفحة الرئيسية الظاهر ← عنصر القائمة */
  var SPY = { home: "home", semesters: "courses", subjects: "courses", latest: "latest", professors: "professors", tools: "tools", help: "help" };
  var HASH = { "": "home", "#home": "home", "#semesters": "courses", "#subjects": "courses", "#search": "courses", "#latest": "latest", "#favorites": "favorites", "#professors": "professors", "#tools": "tools", "#help": "help" };

  /* ---------- أدوات صغيرة ---------- */
  function el(tag, cls, text) { var n = document.createElement(tag); if (cls) n.className = cls; if (text != null) n.textContent = text; return n; }
  function page() { var p = location.pathname.split("/").pop() || "index.html"; return p; }
  function semName(s) { return MS.lang === "en" && s.nameEn ? s.nameEn : s.name; }
  function mySem() { var v = MS.load ? MS.load(KEY_SEM, null) : null; return typeof v === "number" ? v : null; }
  function lastCourse() { try { return MS.getLast ? MS.course(MS.getLast()) : null; } catch (e) { return null; } }
  function pageSemester() {
    var p = page(), q = new URLSearchParams(location.search);
    if (p === "semester.html") return parseInt(q.get("id"), 10) || null;
    if (p === "course.html" || p === "study.html") {
      var c = MS.course ? MS.course(q.get("id")) : null;
      return c ? c.semester : null;
    }
    return null;
  }

  /* ---------- الرسم ---------- */
  var side, scroll, tip, links = {}, toggles = [], activeId = null, spyId = null;

  function linkNode(it, href) {
    var a = el("a", "nav-link");
    a.href = href;
    a.setAttribute("data-nav", it.id);
    a.appendChild(MS.icon(it.icon, 22));
    a.appendChild(el("span", "nav-label", it.label));
    links[it.id] = a;
    return a;
  }

  function soonNode(it) {
    var li = el("li", "nav-item");
    var sp = el("span", "nav-link is-soon");
    sp.setAttribute("aria-disabled", "true");
    sp.appendChild(MS.icon(it.icon, 22));
    sp.appendChild(el("span", "nav-label", it.label));
    sp.appendChild(el("span", "badge badge-soon nav-badge", "قريباً"));
    li.appendChild(sp);
    return li;
  }

  function itemNode(it) {
    if (it.soon) return soonNode(it);
    var li = el("li", "nav-item");
    if (it.dynamic === "resume") {
      var c = lastCourse();
      if (!c) return null;
      li.appendChild(linkNode(it, "course.html?id=" + encodeURIComponent(c.id)));
      return li;
    }
    if (!it.children) { li.appendChild(linkNode(it, it.href)); return li; }

    // مجموعة قابلة للتوسيع: رابط مباشر إلى صفحة الكورسات + زر توسيع مستقل
    var sems = typeof SEMESTERS !== "undefined" ? SEMESTERS : [];
    li.classList.add("nav-group-item");
    var row = el("div", "nav-row");
    row.appendChild(linkNode(it, it.href));
    var subId = "navSub-" + it.id;
    var btn = el("button", "nav-toggle");
    btn.type = "button";
    btn.setAttribute("aria-controls", subId);
    btn.appendChild(MS.icon("chevron", 18));
    row.appendChild(btn);
    li.appendChild(row);
    var wrap = el("div", "nav-sub-wrap");
    var ul = el("ul", "nav-sub");
    ul.id = subId;
    var cur = mySem();
    sems.forEach(function (s) {
      var sli = el("li");
      var a = el("a", "nav-sublink");
      a.href = "semester.html?id=" + s.id;
      a.setAttribute("data-nav", "sem-" + s.id);
      a.appendChild(MS.icon("book", 18));
      a.appendChild(el("span", "nav-label", semName(s)));
      if (cur === s.id) a.appendChild(el("span", "badge nav-badge", "الحالي"));
      links["sem-" + s.id] = a;
      sli.appendChild(a);
      ul.appendChild(sli);
    });
    wrap.appendChild(ul);
    li.appendChild(wrap);
    toggles.push({ li: li, btn: btn, ul: ul, id: it.id });
    return li;
  }

  function listNode(items) {
    var ul = el("ul", "nav-list");
    items.forEach(function (it) {
      if (!it.enabled && !it.soon) return;
      var n = itemNode(it);
      if (n) ul.appendChild(n);
    });
    return ul.childNodes.length ? ul : null;
  }

  function build() {
    side = document.getElementById("sidebar");
    if (!side) return false;
    side.textContent = "";

    var top = el("div", "sb-top");
    var brand = el("a", "brand");
    brand.href = "index.html";
    brand.innerHTML = '<svg width="32" height="32" viewBox="0 0 32 32" aria-hidden="true"><g fill="none" stroke="currentColor" stroke-linecap="round" stroke-linejoin="round"><path stroke-width="2.4" d="M6 24V8l10 10L26 8v16"/><path stroke-width="2" d="M13.5 24h5M16 21.5v5"/></g></svg>';
    var bt = el("span"); bt.setAttribute("data-site-title", ""); brand.appendChild(bt);
    top.appendChild(brand);
    var col = el("button", "sb-btn sb-collapse"); col.type = "button"; col.id = "sbCollapse";
    col.appendChild(MS.icon("chevrons", 20));
    top.appendChild(col);
    var cls = el("button", "sb-btn sb-close"); cls.type = "button"; cls.id = "sbClose";
    cls.setAttribute("aria-label", T("إغلاق القائمة"));
    cls.appendChild(MS.icon("close", 22));
    top.appendChild(cls);
    side.appendChild(top);

    // كتلة الحساب: لا حسابات للطلاب بعد، فتُعرض صفة الزائر الحقيقية بلا اسم أو درجات وهمية
    var user = el("div", "sb-user");
    var av = el("span", "sb-avatar"); av.appendChild(MS.icon("user", 22));
    user.appendChild(av);
    var ut = el("div", "sb-user-text");
    ut.appendChild(el("strong", "", "زائر"));
    var sem = mySem(), semObj = (typeof SEMESTERS !== "undefined" ? SEMESTERS : []).filter(function (x) { return x.id === sem; })[0];
    ut.appendChild(el("small", "", semObj ? semName(semObj) : "تقدّمك محفوظ على هذا الجهاز"));
    user.appendChild(ut);
    side.appendChild(user);

    scroll = el("div", "sb-scroll");
    var nav = el("nav", "nav"); nav.id = "nav"; nav.setAttribute("aria-label", T("التنقل الرئيسي"));
    NAV.forEach(function (sec, i) {
      var ul = listNode(sec.items);
      if (!ul) return;                       // مجموعة بلا عناصر فعّالة لا تُعرض
      var s = el("div", "nav-sec");
      if (sec.title) { var h = el("p", "nav-title", sec.title); h.setAttribute("aria-hidden", "true"); s.appendChild(h); ul.setAttribute("aria-label", T(sec.title)); }
      s.appendChild(ul);
      nav.appendChild(s);
    });
    scroll.appendChild(nav);
    side.appendChild(scroll);

    var fl = listNode(FOOT);
    if (fl) {
      var foot = el("div", "sb-foot");
      var fnav = el("nav", "nav"); fnav.setAttribute("aria-label", T("المساعدة"));
      fnav.appendChild(fl);
      foot.appendChild(fnav);
      side.appendChild(foot);
    }
    return true;
  }

  /* ---------- الحالة النشطة ---------- */
  function resolveActive() {
    var p = page();
    if (p === "index.html") {
      if (location.hash === "#favorites") return "favorites";
      if (spyId && (location.hash === "" || location.hash === "#home" || SPY[location.hash.slice(1)])) return spyId;
      return HASH[location.hash] || "home";
    }
    var s = pageSemester();
    return s ? "sem-" + s : null;
  }
  function paint() {
    var id = resolveActive();
    Object.keys(links).forEach(function (k) {
      var a = links[k];
      if (k === id) a.setAttribute("aria-current", "page"); else a.removeAttribute("aria-current");
    });
    activeId = id;
    var sem = pageSemester();
    toggles.forEach(function (t) {
      var inside = !!sem || id === t.id;
      t.li.classList.toggle("is-parent", inside && id !== t.id);   // المجموعة الأم: درجة أخف من الصفحة النشطة
      if (inside && !t.userSet) setOpen(t, true);
    });
  }

  function setOpen(t, open) {
    t.li.classList.toggle("is-open", open);
    t.btn.setAttribute("aria-expanded", String(open));
    t.btn.setAttribute("aria-label", T(open ? "طي الكورسات" : "توسيع الكورسات"));
  }

  /* ---------- الطي على الكمبيوتر ---------- */
  var root = document.documentElement;
  function isDesktop() { return window.matchMedia(DESKTOP).matches; }
  function paintCollapse() {
    var min = root.classList.contains("nav-min");
    var b = document.getElementById("sbCollapse");
    if (!b) return;
    b.setAttribute("aria-expanded", String(!min));
    b.setAttribute("aria-label", T(min ? "توسيع القائمة" : "طي القائمة"));
  }
  function setMin(min, persist) {
    root.classList.toggle("nav-min", min);
    if (persist) MS.save(KEY_NAV, min ? "min" : "full");
    paintCollapse();
    hideTip();
  }

  /* تلميح الاسم عند الطي: عنصر واحد ثابت الموضع لأن منطقة التمرير تقصّ ما يخرج منها */
  function showTip(a) {
    if (!isDesktop() || !root.classList.contains("nav-min")) return;
    var lab = a.querySelector(".nav-label");
    if (!lab) return;
    tip.textContent = lab.textContent;
    tip.hidden = false;
    var r = a.getBoundingClientRect();
    var rtl = getComputedStyle(root).direction === "rtl";
    tip.style.top = Math.round(r.top + r.height / 2 - tip.offsetHeight / 2) + "px";
    if (rtl) { tip.style.right = Math.round(window.innerWidth - r.left + 8) + "px"; tip.style.left = "auto"; }
    else { tip.style.left = Math.round(r.right + 8) + "px"; tip.style.right = "auto"; }
  }
  function hideTip() { if (tip) tip.hidden = true; }

  /* ---------- درج الهاتف ---------- */
  var menuBtn, lastFocus = null, isOpen = false;
  function focusables() {
    return [].slice.call(side.querySelectorAll("a[href], button")).filter(function (n) { return n.offsetParent !== null; });
  }
  function setDrawer(open) {
    if (open === isOpen) return;
    isOpen = open;
    side.classList.toggle("open", open);
    root.classList.toggle("nav-open", open);
    if (menuBtn) menuBtn.setAttribute("aria-expanded", String(open));
    syncInert();
    if (open) {
      lastFocus = document.activeElement;
      side.setAttribute("role", "dialog");
      side.setAttribute("aria-modal", "true");
      side.setAttribute("aria-label", T("القائمة"));
      var c = document.getElementById("sbClose");
      if (c) c.focus();
    } else {
      side.removeAttribute("role"); side.removeAttribute("aria-modal"); side.removeAttribute("aria-label");
      var back = menuBtn || lastFocus;
      if (back && back.focus) back.focus();
    }
  }
  function syncInert() {
    var hidden = !isDesktop() && !isOpen;       // الدرج المغلق لا يُصل إليه بلوحة المفاتيح
    if ("inert" in side) side.inert = hidden;
    if (hidden) side.setAttribute("aria-hidden", "true"); else side.removeAttribute("aria-hidden");
  }

  /* ---------- تمييز القسم الظاهر في الرئيسية ---------- */
  function startSpy() {
    if (page() !== "index.html") return;
    var secs = Object.keys(SPY).map(function (k) { return document.getElementById(k); }).filter(Boolean);
    secs.sort(function (a, b) { return a.getBoundingClientRect().top - b.getBoundingClientRect().top; });
    var ticking = false;
    function measure() {
      ticking = false;
      var line = window.innerHeight * 0.35, id = null;
      secs.forEach(function (s) { if (s.getBoundingClientRect().top <= line) id = SPY[s.id]; });
      if (id && id !== spyId) { spyId = id; if (location.hash !== "#favorites") paint(); }
    }
    window.addEventListener("scroll", function () { if (!ticking) { ticking = true; requestAnimationFrame(measure); } }, { passive: true });
    measure();
  }

  /* ---------- التهيئة ---------- */
  MS.nav = {
    init: function (menuButton) {
      if (!side) return;
      menuBtn = menuButton;
      tip = el("div", "nav-tip"); tip.hidden = true; tip.setAttribute("aria-hidden", "true");
      document.body.appendChild(tip);

      var pref = MS.load ? MS.load(KEY_NAV, null) : null;
      root.classList.toggle("nav-min", pref === "min");
      paintCollapse();
      document.getElementById("sbCollapse").addEventListener("click", function () { setMin(!root.classList.contains("nav-min"), true); });
      document.getElementById("sbClose").addEventListener("click", function () { setDrawer(false); });

      toggles.forEach(function (t) {
        setOpen(t, t.li.classList.contains("is-open"));
        t.btn.addEventListener("click", function () { t.userSet = true; setOpen(t, !t.li.classList.contains("is-open")); });
      });

      if (menuBtn) {
        menuBtn.setAttribute("aria-controls", "sidebar");
        menuBtn.addEventListener("click", function () { setDrawer(!isOpen); });
      }
      var scrim = document.getElementById("scrim");
      if (scrim) scrim.addEventListener("click", function () { setDrawer(false); });

      side.addEventListener("click", function (e) { if (e.target.closest("a")) { setDrawer(false); } });
      document.addEventListener("keydown", function (e) {
        if (!isOpen) return;
        if (e.key === "Escape") { e.preventDefault(); setDrawer(false); return; }
        if (e.key !== "Tab") return;
        var f = focusables();
        if (!f.length) return;
        var first = f[0], last = f[f.length - 1];
        if (e.shiftKey && (document.activeElement === first || !side.contains(document.activeElement))) { e.preventDefault(); last.focus(); }
        else if (!e.shiftKey && document.activeElement === last) { e.preventDefault(); first.focus(); }
      });

      var mq = window.matchMedia(DESKTOP);
      var onMq = function () { if (mq.matches && isOpen) { isOpen = true; setDrawer(false); } syncInert(); hideTip(); };
      if (mq.addEventListener) mq.addEventListener("change", onMq); else if (mq.addListener) mq.addListener(onMq);
      syncInert();

      scroll.addEventListener("scroll", hideTip, { passive: true });
      side.addEventListener("mouseover", function (e) { var a = e.target.closest(".nav-link, .nav-sublink"); if (a) showTip(a); });
      side.addEventListener("mouseout", function (e) { if (e.target.closest(".nav-link, .nav-sublink")) hideTip(); });
      side.addEventListener("focusin", function (e) { var a = e.target.closest(".nav-link, .nav-sublink"); if (a) showTip(a); });
      side.addEventListener("focusout", hideTip);

      window.addEventListener("hashchange", paint);
      paint();
      startSpy();
    }
  };

  build();
})();
