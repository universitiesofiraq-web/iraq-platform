/*
  data/courses.js — يبني بيانات منصة القسم المختار (SITE, SEMESTERS, CATEGORIES, COURSES)
  من /api/platform?dept=ID بنفس الشكل الذي تقرؤه واجهة المنصة (app.js وبقية الصفحات).
  القسم يأتي من ?dept= ثم من المحفوظ في المتصفح (iq.dept)، وإلا نعود لصفحة الجامعات.
*/
var SITE = {
  title: "المنصة العراقية", subtitle: "ملفات المواد الدراسية لقسمك في مكان واحد.",
  filesBase: "files/", aiEndpoint: "", disclaimer: "",
  university: { name: "", nameEn: "", nameFa: "", image: "", imageWidth: 0, imageHeight: 0, imageAlt: "" }
};
var SEMESTERS = [{ id: 11, name: "الكورس الأول", nameEn: "1st semester", current: true }];
var CATEGORIES = [{ id: "general", name: "المواد", nameEn: "Subjects", layout: "list" }];
var COURSES = [];
var IQ_DEPT = null;
(function () {
  var id = Number(new URLSearchParams(location.search).get("dept")) || 0;
  try { if (!id) id = Number((JSON.parse(localStorage.getItem("iq.dept")) || {}).id) || 0; } catch (e) {}
  if (!id) { location.replace("catalog.html"); return; }
  try {
    var x = new XMLHttpRequest();
    x.open("GET", "/api/platform?dept=" + id, false);
    x.send();
    var d = JSON.parse(x.responseText);
    if (!d.ok) { try { localStorage.removeItem("iq.dept"); } catch (e) {} location.replace("catalog.html"); return; }
    IQ_DEPT = d.dept;
    SEMESTERS = d.semesters; COURSES = d.courses;
    SITE.university = { name: d.site.department, nameEn: "", nameFa: "", image: "", imageWidth: 0, imageHeight: 0, imageAlt: "" };
    SITE.title = d.site.department + " — " + d.site.university;
    SITE.subtitle = d.site.university + " · " + d.site.college;
    try { localStorage.setItem("iq.dept", JSON.stringify({ id: id, name: d.dept.name })); } catch (e) {}
  } catch (e) { /* يبقى الهيكل الفارغ */ }
})();
/*
  data/courses.js — هيكل بيانات المنصة العراقية (بدون محتوى بعد)
  ----------------------------------------------------------------
  النسخة الحالية موروثة من موقع جامعة واحدة وما زالت تعرض "كورسات ومواد".
  المرحلة التالية: استبدالها بالهيكل  جامعة > كلية > قسم > مرحلة > كورس > مادة
  (انظر migrations/0003_multi_university.sql).

  كل مادة في COURSES:
    { id, semester, category, icon, name, nameAr, code, credits:{theory,practical,total},
      professors:[{name}], lectures:[{ number, title, files:[{label, path, added}] }] }
*/

const SITE = {
  title: "المنصة العراقية",
  subtitle: "ملفات المواد الدراسية لجامعات وكليات العراق في مكان واحد.",
  filesBase: "files/",
  aiEndpoint: "",
  disclaimer: "",
  university: { name: "", nameEn: "", nameFa: "", image: "", imageWidth: 0, imageHeight: 0, imageAlt: "" }
};

const SEMESTERS = [
  { id: 1, name: "الكورس الأول", nameEn: "1st semester", current: true },
  { id: 2, name: "الكورس الثاني", nameEn: "2nd semester" }
];

const CATEGORIES = [
  { id: "general", name: "المواد", nameEn: "Subjects", layout: "list" }
];

const COURSES = [];
