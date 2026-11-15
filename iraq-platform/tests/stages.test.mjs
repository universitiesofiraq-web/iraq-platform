import test from "node:test";
import assert from "node:assert/strict";
import fs from "node:fs";
import vm from "node:vm";
import { maxStages } from "../functions/_lib/stages.js";

const win = {}; vm.runInNewContext(fs.readFileSync(new URL("../site/js/stages.js", import.meta.url), "utf8"), { window: win });
const cases = [
  ["معهد التقنيات الإدارية", 2], ["المعهد التقني - بغداد", 2], ["معهد الفنون الجميلة", 2],
  ["كلية الطب", 6], ["كلية الطب البشري", 6], ["الطب", 6],
  ["كلية الصيدلة", 5], ["كلية طب الأسنان", 5], ["كلية الطب الحياتي", 5], ["كلية الطب الحيوي", 5],
  ["كلية الهندسة", 4], ["كلية التمريض", 4], ["كلية الاختبار", 4], ["", 4],
];
test("عدد المراحل حسب نوع الكلية، والواجهة تطابق الخادم", () => {
  for (const [name, n] of cases) {
    assert.equal(maxStages(name), n, name);
    assert.equal(win.IQStages.max(name), n, "client " + name);
  }
});
