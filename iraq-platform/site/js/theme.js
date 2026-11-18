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
})();
