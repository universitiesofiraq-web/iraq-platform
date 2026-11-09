/* js/upload-names.js — اقتراح بيانات المحاضرة من اسم الملف: الرقم، العنوان، الاسم الظاهر للطلاب، والنوع.
   دوال نقية بلا DOM، فتُفحص في Node (tests/upload_names_check.js) وتعمل في المتصفح عبر UploadNames. */
(function (root, factory) {
  if (typeof module === "object" && module.exports) module.exports = factory();
  else root.UploadNames = factory();
})(typeof self !== "undefined" ? self : this, function () {
  "use strict";

  // كلمات لا تدخل في العنوان: نوع الملف أو نسخته
  var NOISE = /\b(?:slides?|ppt|pptx|pdf|powerpoint|handout|notes?|summary|summaries|final|copy|draft|new|updated?|v\d+|scan(?:ned)?)\b/gi;
  var SMALL = /^(?:a|an|and|the|of|in|on|for|to|with|at|by|vs)$/i;

  var LECTURE_NUM = [
    /(?:^|[^a-z])(?:lecture|lect|lec|session|week|l)[\s._-]*0*(\d{1,3})(?!\d)/i,
    /(?:المحاضرة|محاضرة|المحاضره|محاضره)[\s._-]*0*(\d{1,3})(?!\d)/,
    /^\s*0*(\d{1,3})(?=[\s._-]|$)/
  ];
  var EXAM_WORDS = /(?:past[\s._-]*(?:papers?|exams?|questions?)|previous[\s._-]*(?:years?|exams?|questions?)|(?:^|[^a-z])(?:exam|midterm|mcqs?|qbank|questions?|quiz)(?:[^a-z]|$)|أسئلة|اسئلة|امتحان)/i;

  function baseName(filename) {
    return String(filename || "").replace(/^.*[\\/]/, "").replace(/\.[a-z0-9]{1,5}$/i, "");
  }

  function titleCase(s) {
    var letters = s.replace(/[^A-Za-z]/g, "");
    if (!letters) return s;
    var lower = letters === letters.toLowerCase();
    var upper = letters === letters.toUpperCase() && letters.length > 4;
    if (!lower && !upper) return s;
    return s.toLowerCase().split(" ").map(function (w, i) {
      if (!w) return w;
      if (i > 0 && SMALL.test(w)) return w;
      return w.charAt(0).toUpperCase() + w.slice(1);
    }).join(" ");
  }

  /* رقم المحاضرة من اسم الملف: null إن لم يُعرف. "Chapter 26" ليس رقم محاضرة. */
  function lectureNumber(filename) {
    var base = baseName(filename);
    for (var i = 0; i < LECTURE_NUM.length; i++) {
      var m = base.match(LECTURE_NUM[i]);
      if (m) {
        var n = parseInt(m[1], 10);
        if (n >= 1 && n <= 999) return { number: n, match: m[0] };
      }
    }
    return null;
  }

  /* عنوان مقترح (إنجليزي كما في الملف): اسم الملف بلا الرقم ولا كلمات النوع */
  function suggestTitle(filename) {
    var base = baseName(filename);
    var num = lectureNumber(filename);
    if (num) base = base.replace(num.match, " ");
    base = base.replace(/\(\d+\)/g, " ").replace(/[_]+/g, " ").replace(/\s*[-–—.]+\s*/g, " ");
    base = base.replace(NOISE, " ").replace(/\s+/g, " ").trim();
    // بقايا فارغة أو أرقام فقط لا تصلح عنواناً
    if (!/[A-Za-z؀-ۿ]/.test(base)) return "";
    return titleCase(base);
  }

  /* الاسم الذي يظهر للطلاب بجانب الملف */
  function suggestLabel(filename, type) {
    var base = baseName(filename).replace(/[_]+/g, " ");
    var low = base.toLowerCase();
    var year = (low.match(/(?:^|[^0-9])(20\d\d)(?!\d)/) || [])[1];
    if (type === "exam") return "Past questions" + (year ? " " + year : "");
    if (type === "quiz") return "Interactive quiz";
    var ch = low.match(/chapter[\s._-]*0*(\d{1,3})/);
    if (/guyton/.test(low)) return "Guyton & Hall" + (ch ? ", Chapter " + ch[1] : "");
    if (ch) return "Chapter " + ch[1];
    if (/summar/.test(low)) return "Summary";
    if (/handout/.test(low)) return "Handout";
    if (/notes?\b/.test(low)) return "Lecture notes";
    if (/\b(?:lab|practical)\b/.test(low)) return "Practical";
    return "Slides";
  }

  /* نوع مقترح: ملف بلا رقم محاضرة وفيه كلمات الأسئلة أو الامتحان يُقترح أسئلة سنوات سابقة */
  function suggestType(filename) {
    if (lectureNumber(filename)) return "lecture";
    return EXAM_WORDS.test(baseName(filename)) ? "exam" : "lecture";
  }

  /* يمنع تكرار الاسم داخل المحاضرة الواحدة: Slides ثم Slides 2 ثم Slides 3 */
  function uniqueLabel(label, taken) {
    var set = {};
    (taken || []).forEach(function (t) { set[String(t).trim().toLowerCase()] = true; });
    if (!set[label.toLowerCase()]) return label;
    for (var i = 2; i < 100; i++) {
      var candidate = label + " " + i;
      if (!set[candidate.toLowerCase()]) return candidate;
    }
    return label;
  }

  function suggest(filename) {
    var type = suggestType(filename);
    var num = lectureNumber(filename);
    return {
      type: type,
      number: num ? num.number : null,
      title: suggestTitle(filename),
      label: suggestLabel(filename, type)
    };
  }

  /* ناقص الأرقام: أرقام محاضرات بين 1 وأكبر رقم موجود لم يُرفع لها شيء */
  function gaps(numbers) {
    var have = {}, max = 0, out = [];
    (numbers || []).forEach(function (n) { have[n] = true; if (n > max) max = n; });
    for (var i = 1; i < max; i++) if (!have[i]) out.push(i);
    return out;
  }

  return { suggest: suggest, lectureNumber: lectureNumber, suggestTitle: suggestTitle, suggestLabel: suggestLabel, suggestType: suggestType, uniqueLabel: uniqueLabel, gaps: gaps };
});
