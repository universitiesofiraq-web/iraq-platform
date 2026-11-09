/* js/app.js — أدوات مشتركة بين الصفحات: التخزين، الأيقونات، المفضلة، التقدم، الإشعارات */
(function () {
  "use strict";

  var MS = (window.MS = {});
  var KEY = { fav: "ms.fav", read: "ms.read", last: "ms.last", exam: "ms.exam", theme: "ms.theme", review: "ms.review", study: "ms.study", nav: "ms.nav" };

  MS.lang = (window.I18N && I18N.lang) || "ar";

  /* المحتوى غير المنشور (draft: true) لا يظهر في القوائم والأرقام والبحث.
     تنبيه: الموقع ثابت، فأي ملف داخل files/ يبقى متاحاً لمن يعرف رابطه. لا ترفع ملفاً غير جاهز. */
  if (typeof COURSES !== "undefined") {
    COURSES.forEach(function (c) {
      c.lectures = (c.lectures || []).filter(function (l) { return !l.draft; }).map(function (l) {
        var copy = {};
        for (var k in l) copy[k] = l[k];
        copy.files = (l.files || []).filter(function (f) { return !f.draft; });
        return copy;
      });
    });
  }

  /* توحيد النص للبحث: الحروف العربية والفارسية، والهمزات، والتشكيل، و"ال" و"لل" في أول الكلمة */
  MS.norm = function (s) {
    return String(s || "").toLowerCase()
      .replace(/[\u064B-\u065F\u0670\u0640]/g, "")
      .replace(/[يىی]/g, "ي").replace(/[كک]/g, "ك")
      .replace(/[أإآٱ]/g, "ا").replace(/ة/g, "ه").replace(/ؤ/g, "و").replace(/ئ/g, "ي")
      .replace(/(^|\s)(?:لل|ال)(?=\S{2,})/g, "$1")
      .replace(/\s+/g, " ").trim();
  };
  /* حالة الخطأ: إن لم تُحمَّل البيانات تظهر رسالة بدل صفحة فارغة */
  MS.dataError = function () {
    if (typeof COURSES !== "undefined" && typeof SITE !== "undefined") return false;
    var box = document.createElement("div");
    box.className = "load-error";
    box.setAttribute("role", "alert");
    box.textContent = "تعذّر تحميل بيانات المواد. حدّث الصفحة، وإن استمر الخطأ فأبلغ مُعدّ الموقع.";
    if (window.I18N) box.textContent = I18N.t(box.textContent);
    document.body.insertBefore(box, document.body.firstChild);
    return true;
  };

  MS.$ = function (id) { return document.getElementById(id); };

  MS.el = function (tag, cls, text) {
    var n = document.createElement(tag);
    if (cls) n.className = cls;
    if (text !== undefined) n.textContent = text;
    return n;
  };

  /* ---------- تخزين محلي (يعمل حتى لو منعه المتصفح) ---------- */
  var mem = {};
  function load(k, d) {
    if (k in mem) return mem[k];
    try {
      var v = localStorage.getItem(k);
      return v ? JSON.parse(v) : d;
    } catch (e) { return d; }
  }
  function save(k, v) {
    mem[k] = v;
    try { localStorage.setItem(k, JSON.stringify(v)); } catch (e) { /* يبقى في الذاكرة */ }
    if (MS.onSave) MS.onSave(k); // مزامنة الحساب (js/auth.js)
  }
  MS.load = load;
  MS.save = save;
  MS.KEY = KEY;

  /* ---------- الأيقونات ---------- */
  var ICONS = {
    lungs: '<path d="M12 4v7"/><path d="M12 8c-1.6 0-5 2-6 6-.7 2.6-.3 4.6 1.5 4.6 2 0 3-1.5 3.5-3 .3-1 .5-2 .5-3.4"/><path d="M12 8c1.6 0 5 2 6 6 .7 2.6.3 4.6-1.5 4.6-2 0-3-1.5-3.5-3-.3-1-.5-2-.5-3.4"/>',
    kidney: '<path d="M14.5 4.5C11 3 7 5 6 9c-1 4 1 9 5 10 2.5.6 3.5-1.2 2-3-1.2-1.4-.8-3 .6-3.8 2.2-1.2 3.4-3.2 2.9-5.2-.3-1-.9-1.8-2-2.5z"/>',
    flask: '<path d="M9 3h6M10 3v6l-5 9a2 2 0 0 0 1.8 3h10.4a2 2 0 0 0 1.8-3l-5-9V3"/><path d="M7.5 15h9"/>',
    hormone: '<path d="M12 3l7 4v8l-7 4-7-4V7z"/><circle cx="12" cy="11" r="2.2"/>',
    shield: '<path d="M12 3l7 3v6c0 4.5-3 7.5-7 9-4-1.5-7-4.5-7-9V6z"/><path d="M9 12l2 2 4-4"/>',
    leaf: '<path d="M12 7c-2-2-6-1.5-7 2-1 4 1 9 4 11 1 .6 2 .2 3 .2s2 .4 3-.2c3-2 5-7 4-11-1-3.5-5-4-7-2z"/><path d="M12 7c0-2 1-3.5 3-4"/>',
    book: '<path d="M4 5.5C6.5 4.5 9.5 4.5 12 6c2.5-1.5 5.5-1.5 8-.5V19c-2.5-1-5.5-1-8 .5-2.5-1.5-5.5-1.5-8-.5z"/><path d="M12 6v13.5"/>',
    quill: '<path d="M20 4c-6 0-12 4-13 11l-2 5 5-2c7-1 11-7 10-14z"/><path d="M9 15l6-6"/>',
    dumbbell: '<path d="M3 9v6M6 7v10M18 7v10M21 9v6M6 12h12"/>',
    heart: '<path d="M12 20s-7-4.4-7-10a4 4 0 0 1 7-2.5A4 4 0 0 1 19 10c0 5.6-7 10-7 10z"/>',
    droplet: '<path d="M12 3s6 6.5 6 11a6 6 0 0 1-12 0c0-4.5 6-11 6-11z"/>',
    chat: '<path d="M4 5h16v11H9l-4 4v-4H4z"/>',
    crescent: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    star: '<path d="M12 3.5l2.6 5.3 5.9.9-4.3 4.1 1 5.8L12 16.9 6.8 19.6l1-5.8-4.3-4.1 5.9-.9z"/>',
    check: '<path d="M5 12.5l4.5 4.5L19 7.5"/>',
    moon: '<path d="M20 14.5A8 8 0 1 1 9.5 4a6.5 6.5 0 0 0 10.5 10.5z"/>',
    sun: '<circle cx="12" cy="12" r="4"/><path d="M12 2v2.5M12 19.5V22M2 12h2.5M19.5 12H22M4.9 4.9l1.8 1.8M17.3 17.3l1.8 1.8M4.9 19.1l1.8-1.8M17.3 6.7l1.8-1.8"/>',
    menu: '<path d="M4 7h16M4 12h16M4 17h16"/>',
    close: '<path d="M6 6l12 12M18 6L6 18"/>',
    search: '<circle cx="11" cy="11" r="7"/><path d="M20 20l-4-4"/>',
    share: '<circle cx="6" cy="12" r="2.5"/><circle cx="18" cy="6" r="2.5"/><circle cx="18" cy="18" r="2.5"/><path d="M8.2 10.8l7.6-3.6M8.2 13.2l7.6 3.6"/>',
    download: '<path d="M12 4v11M7.5 11l4.5 4.5 4.5-4.5M5 20h14"/>',
    external: '<path d="M14 5h5v5M19 5l-8 8M18 14v4a1 1 0 0 1-1 1H6a1 1 0 0 1-1-1V7a1 1 0 0 1 1-1h4"/>',
    calendar: '<rect x="4" y="5.5" width="16" height="14.5" rx="2"/><path d="M4 10h16M8.5 3.5v4M15.5 3.5v4"/>',
    file: '<path d="M7 3h7l5 5v13H7z"/><path d="M14 3v5h5"/>',
    home: '<path d="M4 11l8-7 8 7"/><path d="M6 10v9h12v-9"/><path d="M10 19v-5h4v5"/>',
    grid: '<rect x="4" y="4" width="7" height="7" rx="1.5"/><rect x="13" y="4" width="7" height="7" rx="1.5"/><rect x="4" y="13" width="7" height="7" rx="1.5"/><rect x="13" y="13" width="7" height="7" rx="1.5"/>',
    users: '<circle cx="9" cy="8.5" r="3.2"/><path d="M3.5 19c.5-3.2 2.8-5 5.5-5s5 1.8 5.5 5"/><path d="M16 5.6a3 3 0 0 1 0 5.8M17.5 14.3c1.6.6 2.7 2.2 3 4.7"/>',
    help: '<circle cx="12" cy="12" r="9"/><path d="M9.5 9.5a2.5 2.5 0 1 1 3.5 2.3c-.7.4-1 1-1 1.7M12 17h.01"/>',
    tools: '<path d="M5 7h9M18 7h1M5 17h1M10 17h9"/><circle cx="16" cy="7" r="2"/><circle cx="8" cy="17" r="2"/>',
    arrow: '<path d="M19 12H5M11 6l-6 6 6 6"/>',
    list: '<path d="M9 6h11M9 12h11M9 18h11"/><path d="M4.5 6h.01M4.5 12h.01M4.5 18h.01"/>',
    chevron: '<path d="M6 9l6 6 6-6"/>',
    chevrons: '<path d="M11 7l-5 5 5 5M18 7l-5 5 5 5"/>',
    play: '<circle cx="12" cy="12" r="9"/><path d="M10.5 8.8l4.2 3.2-4.2 3.2z"/>',
    chart: '<path d="M6 20v-7M12 20V6M18 20v-10"/>',
    cap: '<path d="M3 9l9-4 9 4-9 4z"/><path d="M7 11.5V16c1.5 1.4 3.2 2 5 2s3.5-.6 5-2v-4.5"/><path d="M21 9v5"/>',
    user: '<circle cx="12" cy="8.5" r="3.5"/><path d="M5 20c.6-3.6 3.4-5.5 7-5.5s6.4 1.9 7 5.5"/>',
    gear: '<circle cx="12" cy="12" r="3"/><path d="M12 3v2.2M12 18.8V21M3 12h2.2M18.8 12H21M5.6 5.6l1.6 1.6M16.8 16.8l1.6 1.6M5.6 18.4l1.6-1.6M16.8 7.2l1.6-1.6"/>',
    logout: '<path d="M10 4H6a1 1 0 0 0-1 1v14a1 1 0 0 0 1 1h4"/><path d="M15 8l4 4-4 4M19 12H9"/>'
  };

  MS.icon = function (name, size) {
    var span = document.createElement("span");
    span.className = "ico";
    span.innerHTML =
      '<svg viewBox="0 0 24 24" width="' + (size || 22) + '" height="' + (size || 22) +
      '" fill="none" stroke="currentColor" stroke-width="1.8" stroke-linecap="round" stroke-linejoin="round" aria-hidden="true">' +
      (ICONS[name] || ICONS.book) + "</svg>";
    return span;
  };

  /* ---------- بيانات مساعدة ---------- */
  MS.course = function (id) {
    return COURSES.filter(function (c) { return c.id === id; })[0] || null;
  };
  MS.category = function (c) {
    return CATEGORIES.filter(function (x) { return x.id === c.category; })[0];
  };
  MS.fileCount = function (c) {
    return c.lectures.reduce(function (n, l) { return n + l.files.length; }, 0);
  };
  /* الملفات المرفوعة من صفحة الرفع: تأتي من api/uploads.js (window.UPLOADS) وتُدمج في المواد قبل رسم أي صفحة.
     المحاضرة الجديدة تُنشأ عند أول ملف، والموجودة يُضاف إليها الملف. بدون الخادم تبقى القائمة فارغة ولا يتأثر شيء. */
  /* أنواع المرفوعات (type): lecture = ملف أو رابط محاضرة، quiz = اختبار تفاعلي، exam = أسئلة السنوات السابقة.
     kind: file = PDF مرفوع، link = رابط خارجي. العنصر برقم محاضرة 0 يخصّ المادة كلها ويُحفظ في c.extras بدل المحاضرات. */
  MS.applyUploads = function (items) {
    (items || []).forEach(function (u) {
      var c = u && u.id ? MS.course(u.courseId) : null;
      if (!c) return;
      var external = u.kind === "link";
      var file = {
        label: u.label,
        url: external ? u.url : "api/file/" + u.id,
        added: u.added,
        uploaded: true,
        type: u.type || "lecture",
        external: external,
        latest: typeof u.showInLatest === "boolean" ? u.showInLatest : undefined
      };
      if (!u.number) {
        (c.extras = c.extras || []).push(file);
        return;
      }
      var lec = c.lectures.filter(function (l) { return l.number === u.number; })[0];
      if (!lec) {
        lec = { number: u.number, title: u.title, files: [] };
        c.lectures.push(lec);
      }
      lec.files.push(file);
    });
  };
  if (window.UPLOADS) MS.applyUploads(window.UPLOADS);

  /* هل يُحتسب هذا الملف في «أحدث المحاضرات»؟ القرار الصريح (latest) أولاً.
     بلا قرار: تظهر ملفات كورس الطالب الحالي فقط، فلا تظهر مواد الكورسات القديمة. */
  MS.currentSemester = function () {
    var s = (typeof SEMESTERS !== "undefined" ? SEMESTERS : []).filter(function (x) { return x.current; })[0];
    return s ? s.id : null;
  };
  MS.inLatest = function (c, f) {
    if (typeof f.latest === "boolean") return f.latest;
    return c.semester === MS.currentSemester();
  };

  /* شكل الملف في القوائم: نص الأيقونة وزر الفتح حسب النوع (محاضرة، اختبار تفاعلي، أسئلة سنوات سابقة) */
  MS.fileKind = function (f) {
    var type = f.type || "lecture";
    if (type === "quiz") return { ico: "اختبار", open: "ابدأ الاختبار", cls: "is-quiz" };
    if (type === "exam") return { ico: "أسئلة", open: f.external ? "فتح الرابط" : "فتح الأسئلة", cls: "is-exam" };
    return f.external ? { ico: "رابط", open: "فتح الرابط", cls: "is-link" } : { ico: "PDF", open: "فتح الملف", cls: "" };
  };

  MS.orderedCourses = function () {
    var out = [];
    CATEGORIES.forEach(function (cat) {
      COURSES.forEach(function (c) { if (c.category === cat.id) out.push(c); });
    });
    return out;
  };

  MS.subjectsLabel = function (n) {
    if (n === 1) return "مادة واحدة";
    if (n === 2) return "مادتان";
    return n + (n <= 10 ? " مواد" : " مادة");
  };
  // gen = true بعد حرف الجر (من، في...): محاضرتين بدل محاضرتان
  MS.lecturesLabel = function (n, gen) {
    if (n === 1) return "محاضرة واحدة";
    if (n === 2) return gen ? "محاضرتين" : "محاضرتان";
    return n + (n <= 10 ? " محاضرات" : " محاضرة");
  };
  MS.filesLabel = function (n) {
    if (n === 1) return "ملف واحد";
    if (n === 2) return "ملفان";
    return n + (n <= 10 ? " ملفات" : " ملفاً");
  };

  // الأساتذة بلا تكرار، ومعهم موادهم وأدوارهم (مثل histo)
  MS.professors = function () {
    var map = {}, out = [];
    MS.orderedCourses().forEach(function (c) {
      c.professors.forEach(function (p) {
        var e = map[p.name];
        if (!e) { e = map[p.name] = { name: p.name, roles: [], courses: [] }; out.push(e); }
        if (p.role && e.roles.indexOf(p.role) === -1) e.roles.push(p.role);
        if (e.courses.indexOf(c) === -1) e.courses.push(c);
      });
    });
    out.sort(function (a, b) { return a.name.replace(/^(Dr|Mr|Mrs)\.\s*/, "").localeCompare(b.name.replace(/^(Dr|Mr|Mrs)\.\s*/, "")); });
    return out;
  };

  /* ---------- المفضلة ---------- */
  MS.favs = {
    all: function () { return load(KEY.fav, []); },
    has: function (id) { return MS.favs.all().indexOf(id) !== -1; },
    toggle: function (id) {
      var list = MS.favs.all().slice();
      var i = list.indexOf(id);
      if (i === -1) list.push(id); else list.splice(i, 1);
      save(KEY.fav, list);
      return i === -1;
    }
  };

  /* ---------- التقدم (المحاضرات المقروءة) ---------- */
  MS.progress = {
    set: function (id) { return (load(KEY.read, {}) || {})[id] || []; },
    isRead: function (id, n) { return MS.progress.set(id).indexOf(n) !== -1; },
    toggle: function (id, n) {
      var all = load(KEY.read, {}) || {};
      var list = (all[id] || []).slice();
      var i = list.indexOf(n);
      if (i === -1) list.push(n); else list.splice(i, 1);
      all[id] = list;
      save(KEY.read, all);
      return i === -1;
    },
    done: function (c) {
      var set = MS.progress.set(c.id);
      return c.lectures.filter(function (l) { return set.indexOf(l.number) !== -1; }).length;
    }
  };

  MS.review = {
    all: function () { return load(KEY.review, {}) || {}; },
    has: function (id, n) { return (MS.review.all()[id] || []).indexOf(n) !== -1; },
    toggle: function (id, n) {
      var all = MS.review.all();
      var list = (all[id] || []).slice();
      var i = list.indexOf(n);
      if (i === -1) list.push(n); else list.splice(i, 1);
      all[id] = list;
      save(KEY.review, all);
      return i === -1;
    }
  };

  MS.setLast = function (id) { save(KEY.last, id); };
  MS.getLast = function () { return load(KEY.last, null); };

  /* ---------- بطاقة المادة (الرئيسية وصفحة الكورس) ---------- */
  MS.courseCard = (function () {
      function favButton(c, onFav) {
        var b = MS.el("button", "fav");
        b.type = "button";
        b.appendChild(MS.icon("star", 20));
        function paint() {
          var on = MS.favs.has(c.id);
          b.classList.toggle("is-fav", on);
          b.setAttribute("aria-pressed", String(on));
          b.setAttribute("aria-label", (on ? "إزالة من المفضلة: " : "إضافة إلى المفضلة: ") + c.nameAr);
        }
        paint();
        b.addEventListener("click", function () {
          var on = MS.favs.toggle(c.id);
          paint();
          MS.toast(on ? "أُضيفت المادة إلى المفضلة" : "أُزيلت المادة من المفضلة");
          if (onFav) onFav();
        });
        return b;
      }

      /* بطاقة عمودية (flex): الصورة في مساحة ثابتة، ثم المعلومات بعرض البطاقة، ثم التذييل في الأسفل.
         المفضلة في زاوية البطاقة، وزر الفتح الدائري هو رابط البطاقة كلها. */
      var uid = 0;
      function card(c, onFav) {
        var art = MS.el("article", "course-card card hue-" + (MS.orderedCourses().indexOf(c) % 6 + 1));
        art.appendChild(favButton(c, onFav));

        var media = MS.el("div", "cc-media");
        if (c.image) {
          var pic = MS.el("img", "cc-img");
          pic.src = c.image; pic.width = 180; pic.height = 180; pic.alt = ""; pic.loading = "lazy"; pic.decoding = "async";
          media.appendChild(pic);
        } else {
          art.classList.add("no-img");
          media.appendChild(MS.icon(c.icon, 40));
        }
        art.appendChild(media);

        var info = MS.el("div", "cc-info");
        if (c.field) info.appendChild(MS.el("p", "cc-kicker", c.field));
        info.appendChild(MS.el("h3", "cc-title en", c.name));
        info.appendChild(MS.el("p", "cc-ar", c.nameAr));
        if (c.professors.length) {
          var profs = MS.el("p", "cc-profs en", c.professors.map(function (p) { return p.name + (p.role ? " (" + p.role + ")" : ""); }).join(" · "));
          profs.id = "ccp-" + (++uid);
          info.appendChild(profs);
          // الأسماء الطويلة تُختصر إلى سطرين، وزر «عرض المزيد» يظهر فقط إذا كان هناك نص مخفي
          var more = MS.el("button", "cc-more", "عرض المزيد");
          more.type = "button";
          more.hidden = true;
          more.setAttribute("aria-expanded", "false");
          more.setAttribute("aria-controls", profs.id);
          more.addEventListener("click", function () {
            var open = profs.classList.toggle("is-open");
            more.setAttribute("aria-expanded", String(open));
            more.textContent = open ? "عرض أقل" : "عرض المزيد";
          });
          info.appendChild(more);
          var measure = function () {
            if (profs.classList.contains("is-open")) return;
            more.hidden = profs.scrollHeight <= profs.clientHeight + 1;
          };
          requestAnimationFrame(measure);
          if (window.ResizeObserver) new ResizeObserver(measure).observe(profs);
        }
        if (c.code || c.credits) {
          var facts = MS.el("p", "cc-facts");
          if (c.code) facts.appendChild(MS.el("span", "cc-code", c.code));
          if (c.credits) facts.appendChild(MS.el("span", "", "الدرجة " + c.credits.total));
          info.appendChild(facts);
        }
        art.appendChild(info);

        var foot = MS.el("div", "cc-foot");
        var total = c.lectures.length;
        var onlyExtras = !total && c.extras && c.extras.length;
        var state = MS.el("div", "cc-state");
        state.appendChild(MS.el("span", total || onlyExtras ? "cc-status has-files" : "cc-status", total ? MS.lecturesLabel(total) : onlyExtras ? "اختبارات وأسئلة سابقة" : "لم تُرفع ملفات بعد"));
        if (total) {
          var done = MS.progress.done(c);
          var bar = MS.el("div", "bar");
          var fill = MS.el("i");
          fill.style.setProperty("--p", Math.round(done / total * 100) + "%");
          bar.appendChild(fill);
          state.appendChild(bar);
          state.appendChild(MS.el("span", "bar-label", done + " من " + total + " مقروءة"));
        }
        foot.appendChild(state);
        var go = MS.el("a", "cc-go cover");
        go.href = "course.html?id=" + encodeURIComponent(c.id);
        go.setAttribute("aria-label", "فتح المادة: " + c.name);
        go.appendChild(MS.icon("arrow", 20));
        foot.appendChild(go);
        art.appendChild(foot);
        return art;
      }
    return card;
  })();

  /* ---------- إشعار قصير بعد كل إجراء ---------- */
  var toastTimer;
  MS.toast = function (msg) {
    var t = MS.$("toast");
    if (!t) return;
    t.textContent = msg;
    t.classList.add("show");
    clearTimeout(toastTimer);
    toastTimer = setTimeout(function () { t.classList.remove("show"); }, 2200);
  };

  /* ---------- الأرقام: تُكتب مباشرة بلا حركة (نظام التصميم: لا مؤثرات غير ضرورية) ---------- */
  MS.countUp = function (node, to, decimals) {
    node.textContent = Number(to).toFixed(decimals || 0);
  };

  /* ---------- الرأس: القائمة، الوضع الليلي، تمييز القسم الحالي ---------- */
  function effectiveTheme() {
    // الوضع النهاري هو الأصل؛ الليلي فقط باختيار المستخدم
    return document.documentElement.getAttribute("data-theme") === "dark" ? "dark" : "light";
  }

  MS.initHeader = function () {
    var themeBtn = MS.$("themeBtn");
    var menuBtn = MS.$("menuBtn");

    function paintTheme() {
      var dark = effectiveTheme() === "dark";
      themeBtn.textContent = "";
      themeBtn.appendChild(MS.icon(dark ? "sun" : "moon", 20));
      themeBtn.setAttribute("aria-label", dark ? "التبديل إلى الوضع النهاري" : "التبديل إلى الوضع الليلي");
    }
    paintTheme();
    themeBtn.addEventListener("click", function () {
      var next = effectiveTheme() === "dark" ? "light" : "dark";
      document.documentElement.setAttribute("data-theme", next);
      save(KEY.theme, next);
      paintTheme();
    });

    var langSel = MS.$("langSel");
    if (langSel) {
      langSel.value = MS.lang;
      langSel.addEventListener("change", function () { I18N.set(langSel.value); });
    }
    var searchBtn = MS.$("searchBtn");
    if (searchBtn) {
      searchBtn.insertBefore(MS.icon("search", 20), searchBtn.firstChild);
      searchBtn.addEventListener("click", function () {
        var box = MS.$("search");
        if (box) {
          box.scrollIntoView({ block: "center" });
          box.focus({ preventScroll: true });
        } else {
          location.href = "index.html#search";
        }
      });
    }

    var favLink = MS.$("favLink");
    if (favLink) {
      favLink.appendChild(MS.icon("star", 20));
      favLink.addEventListener("click", function (e) {
        // في الرئيسية: الضغط مرة ثانية على نفس الرابط يعيد تطبيق التصفية
        if (favLink.getAttribute("href") === "#favorites" && location.hash === "#favorites") {
          e.preventDefault();
          window.dispatchEvent(new Event("hashchange"));
        }
      });
    }

    // القائمة الجانبية (الرسم والطي والدرج والتمييز) في js/nav.js
    if (MS.nav) MS.nav.init(menuBtn);
    menuBtn.appendChild(MS.icon("menu", 22));
  };

  /* ---------- نصوص مشتركة ---------- */
  MS.initShared = function () {
    // أيقونات القائمة والبطاقات: تُرسم من اسمها في data-ico
    [].forEach.call(document.querySelectorAll("[data-ico]"), function (n) {
      n.insertBefore(MS.icon(n.getAttribute("data-ico"), n.classList.contains("tile") ? 22 : 20), n.firstChild);
    });
    ["notice", "footNotice"].forEach(function (id) {
      var n = MS.$(id);
      if (!n) return;
      n.textContent = SITE.disclaimer || "";
      n.hidden = !SITE.disclaimer;
    });
    [].forEach.call(document.querySelectorAll("[data-site-title]"), function (n) {
      n.textContent = SITE.title;
    });

    // اسم الجامعة وصورتها (من SITE.university). الصورة لا تظهر إلا إذا وُجد الملف فعلاً
    var U = SITE.university;
    if (!U || !U.name) return;

    var hu = MS.$("heroUni");
    if (hu) {
      hu.hidden = false;
      if (MS.lang === "en") {
        hu.appendChild(document.createTextNode("Site for international students of "));
        hu.appendChild(MS.el("strong", "", U.nameEn || U.name));
      } else if (MS.lang === "fa") {
        hu.appendChild(document.createTextNode("سایت برای دانشجویان بین‌المللی "));
        hu.appendChild(MS.el("strong", "", U.nameFa || U.name));
        if (U.nameEn) hu.appendChild(MS.el("span", "en uni-en", U.nameEn));
      } else {
        hu.appendChild(document.createTextNode("موقع لطلاب "));
        hu.appendChild(MS.el("strong", "", U.name));
        hu.appendChild(document.createTextNode(" الدوليين"));
        if (U.nameEn) hu.appendChild(MS.el("span", "en uni-en", U.nameEn));
      }
    }

    var fu = MS.$("footUni");
    if (fu) {
      fu.hidden = false;
      if (MS.lang === "en") {
        fu.appendChild(document.createTextNode("For international students at "));
        fu.appendChild(MS.el("strong", "", U.nameEn || U.name));
      } else if (MS.lang === "fa") {
        fu.appendChild(document.createTextNode("برای دانشجویان بین‌المللی "));
        fu.appendChild(MS.el("strong", "", U.nameFa || U.name));
        if (U.nameEn) fu.appendChild(MS.el("span", "en uni-en", U.nameEn));
      } else {
        fu.appendChild(document.createTextNode("للطلاب الدوليين في "));
        fu.appendChild(MS.el("strong", "", U.name));
        if (U.nameEn) fu.appendChild(MS.el("span", "en uni-en", U.nameEn));
      }
    }

    // الصورة تُحجز مساحتها من البداية (width/height) فلا يتحرك المحتوى عند التحميل
    var ph = MS.$("uniPhoto");
    if (ph && U.image) {
      var img = new Image();
      img.alt = U.imageAlt || U.name;
      if (U.imageWidth) { img.width = U.imageWidth; img.height = U.imageHeight; }
      img.decoding = "async";
      img.setAttribute("fetchpriority", "high");
      img.onerror = function () { ph.hidden = true; };
      img.src = U.image;
      ph.textContent = "";
      ph.appendChild(img);
      var cap = MS.el("figcaption", "", MS.lang === "en" ? (U.nameEn || U.name) : MS.lang === "fa" ? (U.nameFa || U.name) : U.name);
      if (U.nameEn && MS.lang !== "en") cap.appendChild(MS.el("span", "en", U.nameEn));
      ph.appendChild(cap);
      ph.hidden = false;
    }
  };
})();
