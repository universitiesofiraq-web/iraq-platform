/* وضع ليلي/نهاري لصفحات دفعتنا العامة: يشارك مفتاح ms.theme مع الصفحة الرئيسية للطالب. */
(function () {
  var root = document.documentElement;
  function saved() { try { var t = JSON.parse(localStorage.getItem("ms.theme")); return t === "dark" || t === "light" ? t : ""; } catch (e) { return ""; } }
  function current() { var t = saved(); return t || (window.matchMedia && matchMedia("(prefers-color-scheme: dark)").matches ? "dark" : "light"); }
  if (saved()) root.setAttribute("data-theme", saved());
  document.addEventListener("DOMContentLoaded", function () {
    var nav = document.querySelector(".iq-top nav"); if (!nav) return;
    var b = document.createElement("button"); b.type = "button"; b.className = "iq-theme";
    function paint() { var d = current() === "dark"; b.textContent = d ? "☀" : "☾"; b.setAttribute("aria-label", d ? "الوضع النهاري" : "الوضع الليلي"); }
    b.onclick = function () {
      var next = current() === "dark" ? "light" : "dark";
      root.setAttribute("data-theme", next);
      try { localStorage.setItem("ms.theme", JSON.stringify(next)); } catch (e) { /* لا شيء */ }
      paint();
    };
    paint(); nav.appendChild(b);
  });
})();
