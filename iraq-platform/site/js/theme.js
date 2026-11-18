/* theme.js — الوضع الليلي/النهاري الموحّد لكل صفحات دفعتنا.
   يُحمَّل في <head> قبل أوراق الأنماط فيضبط <html data-theme> قبل الرسم (بلا وميض).
   التفضيل في localStorage «ms.theme» (JSON: "dark" | "light")، مشترك بين كل الصفحات.
   بلا تفضيل: الهاتف ليلي، والشاشات الأكبر تتبع النظام.
   يضيف زر تبديل إلى .iq-top nav إن وُجد، ويعرّف window.DSTheme للصفحات ذات الأزرار الخاصة. */
(function () {
  var root = document.documentElement, KEY = "ms.theme";
  function saved() {
    var t = "";
    try { t = localStorage.getItem(KEY) || ""; } catch (e) { return ""; }
    try { t = JSON.parse(t); } catch (e) { /* قيمة قديمة بلا JSON: نقبلها كما هي */ }
    return t === "dark" || t === "light" ? t : "";
  }
  function auto() {
    try {
      if (window.matchMedia("(max-width: 760px)").matches) return "dark";
      return window.matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light";
    } catch (e) { return "light"; }
  }
  function apply(t) { root.setAttribute("data-theme", t); }
  apply(saved() || auto());

  var api = window.DSTheme = {
    get: function () { return root.getAttribute("data-theme") === "dark" ? "dark" : "light"; },
    set: function (t) {
      apply(t);
      try { localStorage.setItem(KEY, JSON.stringify(t)); } catch (e) { /* التخزين ممنوع: يبقى للجلسة */ }
      try { document.dispatchEvent(new CustomEvent("ds:theme", { detail: t })); } catch (e) { /* متصفح قديم */ }
    },
    toggle: function () { api.set(api.get() === "dark" ? "light" : "dark"); }
  };

  /* تغيّر الوضع في تبويب آخر: نطبّقه هنا أيضاً */
  window.addEventListener("storage", function (e) { if (e.key === KEY) apply(saved() || auto()); });

  function addToggle() {
    var nav = document.querySelector(".iq-top nav");
    if (!nav || nav.querySelector(".iq-theme")) return;
    /* الصفحة الحالية: تمييز رابطها في الشريط العلوي */
    var here = (location.pathname.split("/").pop() || "index.html").replace(/\.html$/, "");
    [].forEach.call(nav.querySelectorAll("a[href]"), function (a) {
      var t = (a.getAttribute("href") || "").split(/[?#]/)[0].replace(/\.html$/, "");
      if (t && t === here && !a.classList.contains("iq-login")) a.setAttribute("aria-current", "page");
    });
    var b = document.createElement("button");
    b.type = "button"; b.className = "iq-theme";
    function paint() {
      var d = api.get() === "dark";
      b.textContent = d ? "☀" : "☾";
      b.setAttribute("aria-label", d ? "الوضع النهاري" : "الوضع الليلي");
      b.title = b.getAttribute("aria-label");
    }
    b.addEventListener("click", function () { api.toggle(); });
    document.addEventListener("ds:theme", paint);
    paint(); nav.appendChild(b);
  }
  if (document.readyState === "loading") document.addEventListener("DOMContentLoaded", addToggle); else addToggle();

  /* منع تكرار الإرسال في كل الصفحات: أي طلب يغيّر بيانات (غير GET) يعطّل الزر الذي أطلقه
     ويعلّمه aria-busy حتى يصل الرد، فلا يُرسل الطلب مرتين بالضغط المتكرر. */
  /* صفحة القارئ (pdf-notes) تحفظ وتزامن في الخلفية كل ثوانٍ: لا تعطّل أزرار أدواتها (html data-no-guard) */
  if (window.fetch && !window.fetch.__dsGuard && !root.hasAttribute("data-no-guard")) {
    var raw = window.fetch;
    var guarded = function (input, init) {
      var method = (init && init.method || (input && input.method) || "GET").toUpperCase();
      var a = document.activeElement;
      var btn = method !== "GET" && method !== "HEAD" && a && a.tagName === "BUTTON" && !a.disabled ? a : null;
      if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
      var done = function () { if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); } };
      var p = raw.apply(this, arguments);
      p.then(done, done);
      return p;
    };
    guarded.__dsGuard = true;
    window.fetch = guarded;
  }
})();
