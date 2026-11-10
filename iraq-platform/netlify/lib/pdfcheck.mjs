// netlify/lib/pdfcheck.mjs — فحص بنيوي لملف PDF مجمّع قبل اعتماده.
// لا يعتمد على مكتبات خارجية (يعمل في Cloudflare Workers و Node دون حزم إضافية).
// يتحقق من: الترويسة، ونهاية الملف (startxref و%%EOF)، وأن جدول xref أو xref stream يشير إلى داخل الملف،
// وأن جدول xref يحتوي إدخالات تشير إلى كائنات حقيقية، وأن الشجرة فيها صفحة واحدة على الأقل.
// الحدود: لا يفكّ ضغط تدفقات الكائنات المضغوطة (ObjStm)؛ فإذا وُجدت لا يُحكم بوجود صفحات إلا بوجود /Pages.

const td = new TextDecoder("latin1");
const str = (b, from, to) => td.decode(b.subarray(Math.max(0, from), Math.min(b.length, to)));

const bad = (code, reason) => ({ ok: false, code, reason });
const good = () => ({ ok: true });

export const PDF_LIMITS = { minBytes: 80, maxBytes: 20 * 1024 * 1024, maxXrefEntries: 200000 };

export function checkPdf(b) {
  if (!(b instanceof Uint8Array)) return bad("not_pdf", "الملف غير صالح");
  const n = b.length;
  if (n < PDF_LIMITS.minBytes) return bad("truncated", "الملف أصغر من أن يكون PDF صالحاً");
  if (n > PDF_LIMITS.maxBytes) return bad("too_big", "حجم الملف يتجاوز الحد المسموح");

  // 1) الترويسة: %PDF-x.y ضمن أول 1024 بايت، والإصدار معروف
  const head = str(b, 0, 1024);
  const hi = head.indexOf("%PDF-");
  if (hi < 0) return bad("not_pdf", "الملف لا يبدأ بترويسة PDF");
  if (!/^%PDF-(1\.[0-7]|2\.0)/.test(head.slice(hi))) return bad("not_pdf", "إصدار PDF غير معروف");

  // 2) نهاية الملف: startxref متبوعاً برقم، ثم %%EOF بعده
  const tail = str(b, n - 4096, n);
  const sx = tail.lastIndexOf("startxref");
  if (sx < 0) return bad("truncated", "الملف مبتور: لا يوجد startxref في نهايته");
  const after = tail.slice(sx + 9);
  const m = /^\s*(\d+)\s*/.exec(after);
  if (!m) return bad("truncated", "الملف مبتور: مؤشر startxref غير مكتمل");
  const xref = Number(m[1]);
  if (!(xref > 0 && xref < n)) return bad("corrupt", "مؤشر startxref يشير خارج الملف");
  if (!after.includes("%%EOF")) return bad("truncated", "الملف مبتور: لا توجد علامة %%EOF في النهاية");

  // 3) جدول xref: جدول كلاسيكي أو xref stream
  const at = str(b, xref, xref + 64);
  let entries = null;
  let trailerText = "";
  if (/^\s*xref\b/.test(at)) {
    const trailerPos = (() => {
      const t = str(b, xref, Math.min(n, xref + 64 * 1024 * 1024));
      const p = t.indexOf("trailer");
      return p < 0 ? -1 : xref + p;
    })();
    if (trailerPos < 0) return bad("corrupt", "جدول xref بلا trailer");
    trailerText = str(b, trailerPos, trailerPos + 2048);
    if (!/\/Root\s+\d+\s+\d+\s+R/.test(trailerText)) return bad("corrupt", "trailer بلا /Root");
    if (!/\/Size\s+\d+/.test(trailerText)) return bad("corrupt", "trailer بلا /Size");
    // إدخالات الجدول: 10 أرقام إزاحة، 5 أرقام جيل، n أو f
    const tableText = str(b, xref, trailerPos);
    entries = [];
    const re = /(\d{10}) (\d{5}) ([nf])/g;
    let x;
    while ((x = re.exec(tableText)) !== null) {
      if (entries.length >= PDF_LIMITS.maxXrefEntries) break;
      entries.push({ off: Number(x[1]), gen: Number(x[2]), type: x[3] });
    }
    if (entries.length === 0) return bad("corrupt", "جدول xref فارغ");
    for (const e of entries) if (e.type === "n" && (e.off <= 0 || e.off >= n)) return bad("corrupt", "إزاحة كائن في xref تشير خارج الملف");
    // أول إدخالات مستخدمة يجب أن تبدأ بترويسة كائن حقيقية "N G obj"
    let checked = 0;
    for (const e of entries) {
      if (e.type !== "n" || checked >= 3) continue;
      if (!/^\d+ \d+ obj/.test(str(b, e.off, e.off + 32))) return bad("corrupt", "إزاحة كائن في xref لا تشير إلى كائن");
      checked++;
    }
    if (checked === 0) return bad("corrupt", "لا توجد كائنات مستخدمة في xref");
  } else if (/^\s*\d+\s+\d+\s+obj/.test(at)) {
    const dict = str(b, xref, xref + 1024);
    if (!/\/Type\s*\/XRef/.test(dict)) return bad("corrupt", "الكائن عند startxref ليس xref stream");
    if (!/\/Root\s+\d+\s+\d+\s+R/.test(dict)) return bad("corrupt", "xref stream بلا /Root");
    trailerText = dict;
  } else {
    return bad("corrupt", "startxref لا يشير إلى جدول xref");
  }

  // 4) شجرة الصفحات: صفحة واحدة على الأقل، أو تدفقات مضغوطة مع /Pages (لا يمكن فكها هنا)
  const all = td.decode(b);
  const pages = (all.match(/\/Type\s*\/Page(?![s\w])/g) || []).length;
  if (pages === 0) {
    const hasPages = /\/Type\s*\/Pages\b/.test(all);
    const hasObjStm = /\/Type\s*\/ObjStm\b/.test(all);
    if (!(hasPages && hasObjStm)) return bad("no_pages", "لا توجد صفحات في الملف");
  }

  // 5) محاضرات الطلبة لا تحتاج جافاسكربت ولا إطلاق برامج؛ نرفض ما فيه ذلك (ما داخل ObjStm المضغوط لا يُفحص هنا)
  if (/\/JavaScript\b|\/JS\s*[(<]|\/Launch\b|\/SubmitForm\b|\/ImportData\b/.test(all)) return bad("active_content", "الملف يحوي محتوى نشطاً (جافاسكربت أو إطلاق برامج) غير مسموح");

  return { ok: true, pages, xrefEntries: entries ? entries.length : null, xrefStream: !entries };
}

export function pdfRejection(res) {
  return { ok: false, error: "invalid_pdf", code: res.code, reason: res.reason };
}
