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
