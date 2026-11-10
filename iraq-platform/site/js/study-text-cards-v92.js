/* MEDIXA Step 46: turn PDF text into a flashcard without retyping.
   Adds a "from the page text" block to the Cards tab of the study panel. It only fills the existing
   question/answer inputs; saving still goes through the panel's own "save card" button (and its storage guard).
   Needs pdf.js for text; with page images only (Step 43) it explains that text is unavailable. */
(function () {
  'use strict';
  var MIN = 20, MAX = 300, LIMIT = 60;
  /* Split page text into sentences on . ! ? ؟ ؛ and line breaks; keep readable lengths, drop duplicates. */
  function sentences(text) {
    var out = [], seen = {};
    String(text || '').replace(/[^\S\n]+/g, ' ').split(/(?<=[.!?؟؛])\s+|\s*\n\s*/).forEach(function (s) {
      s = s.trim(); if (s.length < MIN || s.length > MAX) return;
      var k = s.toLowerCase(); if (seen[k]) return; seen[k] = 1; out.push(s);
    });
    return out.slice(0, LIMIT);
  }
  /* Cloze: hide the longest word (letters only, 5+ chars). Returns null if none. */
  function cloze(sentence) {
    var words = sentence.match(/[A-Za-z؀-ۿ][A-Za-z؀-ۿ-]{4,}/g);
    if (!words) return null;
    var w = words.reduce(function (a, b) { return b.length > a.length ? b : a; });
    return { question: sentence.replace(w, '_____'), answer: w };
  }
  /* pdf.js text items -> plain text with line breaks where pdf.js marks the end of a line. */
  function itemsToText(items) {
    return (items || []).map(function (it) { return (it.str || '') + (it.hasEOL ? '\n' : ' '); }).join('');
  }
  window.MedixaTextCards = { sentences: sentences, cloze: cloze, itemsToText: itemsToText };

  var src = new URLSearchParams(location.search).get('file');
  if (!src || !document.getElementById('study-content')) return;
  var pdfPromise = null;
  function loadPdf() {
    if (!pdfPromise) pdfPromise = window.pdfjsLib.getDocument({ url: new URL(src, location.href).href }).promise.catch(function (e) { pdfPromise = null; throw e; });
    return pdfPromise;
  }
  function el(tag, cls, text) { var e = document.createElement(tag); if (cls) e.className = cls; if (text != null) e.textContent = text; return e; }
  function fill(q, a) {
    var qi = document.getElementById('card-question'), ai = document.getElementById('card-answer');
    if (!qi || !ai) return;
    qi.value = q; ai.value = a; (q ? ai : qi).focus();
  }
  function inject() {
    var q = document.getElementById('card-question');
    if (!q || document.getElementById('mx-text-cards')) return;
    var box = el('div', 'mx-text-cards'); box.id = 'mx-text-cards';
    box.appendChild(el('h3', '', 'من نص الصفحة'));
    if (!window.pdfjsLib) { box.appendChild(el('p', 'mx-tc-note', 'نص الصفحة يحتاج مكتبة عرض PDF، وهي غير متاحة الآن.')); q.parentNode.insertBefore(box, q); return; }
    // Its own page field, kept in sync with the card's page field so the saved card points to the same page.
    var main = document.getElementById('study-page');
    var lab = el('label', 'mx-tc-page', 'الصفحة '), pin = el('input'); pin.type = 'number'; pin.min = '1'; pin.id = 'mx-tc-page';
    pin.value = (main && main.value) || '1'; if (main && main.max) pin.max = main.max; lab.appendChild(pin); box.appendChild(lab);
    pin.addEventListener('input', function () { var m = document.getElementById('study-page'); if (m) m.value = pin.value; });
    var btn = el('button', 'study-action', 'اعرض جمل هذه الصفحة'); btn.type = 'button'; btn.id = 'mx-tc-load';
    var status = el('p', 'mx-tc-note'); status.setAttribute('role', 'status');
    var list = el('div', 'mx-tc-list'); list.id = 'mx-tc-list';
    box.appendChild(btn); box.appendChild(status); box.appendChild(list);
    btn.addEventListener('click', function () {
      var n = Math.floor(Number(pin.value) || 1), m = document.getElementById('study-page'); if (m) m.value = String(n);
      list.textContent = ''; status.textContent = 'جارٍ قراءة نص الصفحة ' + n + '…'; btn.disabled = true;
      loadPdf().then(function (pdf) {
        if (n < 1 || n > pdf.numPages) throw Error('رقم الصفحة خارج الملف');
        return pdf.getPage(n).then(function (p) { return p.getTextContent(); });
      }).then(function (tc) {
        var all = sentences(itemsToText(tc.items));
        status.textContent = all.length ? 'اختر جملة: «إجابة» تضعها في الإجابة، و«فراغ» تخفي أطول كلمة فيها.' : 'لا يوجد نص قابل للقراءة في هذه الصفحة (قد تكون صورة).';
        all.forEach(function (s) {
          var row = el('div', 'mx-tc-row'); row.appendChild(el('span', 'mx-tc-text', s));
          var a = el('button', '', 'إجابة'); a.type = 'button'; a.addEventListener('click', function () { fill('', s); });
          row.appendChild(a);
          var c = cloze(s);
          if (c) { var b = el('button', '', 'فراغ'); b.type = 'button'; b.addEventListener('click', function () { fill(c.question, c.answer); }); row.appendChild(b); }
          list.appendChild(row);
        });
      }).catch(function (e) { status.textContent = 'تعذرت قراءة نص الصفحة: ' + (e && e.message || ''); })
        .then(function () { btn.disabled = false; });
    });
    q.parentNode.insertBefore(box, q);
  }
  var css = document.createElement('style');
  css.textContent = '.mx-text-cards{border:1px solid #b7d5dc;border-radius:12px;padding:10px;margin:8px 0;background:#f4fafa}.mx-tc-note{font-size:13px;color:#335}.mx-tc-list{max-height:260px;overflow:auto;display:grid;gap:6px}.mx-tc-row{display:flex;gap:6px;align-items:flex-start;background:#fff;border:1px solid #d5e6ea;border-radius:9px;padding:6px}.mx-tc-text{flex:1;direction:auto;unicode-bidi:plaintext;font-size:13px;line-height:1.5}.mx-tc-page{display:block;margin:4px 0 8px}.mx-tc-page input{width:80px;margin-inline-start:6px}.mx-tc-row button{flex:0 0 auto;padding:5px 8px;border-radius:7px;border:1px solid #9db6bf;background:#e3f3f1;cursor:pointer}';
  document.head.appendChild(css);
  new MutationObserver(inject).observe(document.getElementById('study-content'), { childList: true, subtree: false });
  inject();
})();
