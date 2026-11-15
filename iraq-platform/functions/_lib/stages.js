// عدد مراحل الكلية حسب نوعها (بقرار محمد 2026-11-15):
//   معهد 2 · كلية الطب 6 · الصيدلة وطب الأسنان والطب الحياتي 5 · بقية الكليات 4.
// النسخة نفسها في site/js/stages.js للواجهة (يطابقهما tests/stages.test.mjs).
export function maxStages(collegeName) {
  const n = String(collegeName || "").replace(/[أإآ]/g, "ا").replace(/\s+/g, " ").trim();
  if (/(^|\s)(ال)?معهد(\s|$)/.test(n)) return 2;
  if (/صيدل|اسنان|حياتي|حيوي/.test(n)) return 5;
  if (/^(كلية )?(الطب|طب)(\s|$)/.test(n) && !/بيطري/.test(n)) return 6;
  return 4;
}
