/* عدد مراحل الكلية حسب نوعها: معهد 2 · الطب 6 · الصيدلة وطب الأسنان والطب الحياتي 5 · غيرها 4.
   مطابق لـ functions/_lib/stages.js (يفحصه tests/stages.test.mjs). */
(function (w) {
  w.IQStages = {
    max: function (collegeName) {
      var n = String(collegeName || "").replace(/[أإآ]/g, "ا").replace(/\s+/g, " ").trim();
      if (/(^|\s)(ال)?معهد(\s|$)/.test(n)) return 2;
      if (/صيدل|اسنان|حياتي|حيوي/.test(n)) return 5;
      if (/^(كلية )?(الطب|طب)(\s|$)/.test(n) && !/بيطري/.test(n)) return 6;
      return 4;
    }
  };
})(window);
