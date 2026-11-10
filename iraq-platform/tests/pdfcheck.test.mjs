// node --test tests/pdfcheck.test.mjs
import test from "node:test";
import assert from "node:assert/strict";
import { checkPdf } from "../netlify/lib/pdfcheck.mjs";

const enc = (s) => new TextEncoder().encode(s);
function pdf(extra = "") {
  const body = "%PDF-1.4\n1 0 obj\n<< /Type /Catalog /Pages 2 0 R >>\nendobj\n2 0 obj\n<< /Type /Pages /Kids [3 0 R] /Count 1 >>\nendobj\n3 0 obj\n<< /Type /Page /Parent 2 0 R " + extra + ">>\nendobj\n";
  const x = body.length;
  const off = (n) => String(n).padStart(10, "0");
  const o1 = body.indexOf("1 0 obj"), o2 = body.indexOf("2 0 obj"), o3 = body.indexOf("3 0 obj");
  return enc(body + "xref\n0 4\n0000000000 65535 f \n" + off(o1) + " 00000 n \n" + off(o2) + " 00000 n \n" + off(o3) + " 00000 n \ntrailer\n<< /Size 4 /Root 1 0 R >>\nstartxref\n" + x + "\n%%EOF\n");
}

test("valid simple pdf passes", () => assert.equal(checkPdf(pdf()).ok, true));
test("javascript actions are rejected", () => {
  assert.equal(checkPdf(pdf("/AA << /O << /S /JavaScript /JS (app.alert(1)) >> >> ")).code, "active_content");
  assert.equal(checkPdf(pdf("/A << /S /Launch /F (cmd.exe) >> ")).code, "active_content");
});
test("html with fake pdf markers is rejected", () => {
  const fake = enc("%PDF-1.7\n<html><script>alert(1)</script></html>\n/Type /XRef /Pages /ObjStm /Root 1 0 R\nstartxref\n10\n%%EOF\n");
  assert.equal(checkPdf(fake).ok, false);
});
