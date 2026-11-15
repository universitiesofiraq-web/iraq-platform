"""بيانات وهمية مشتركة لفحوص الواجهات حسب الدور (guest/student/stagerep/admin). أسماء عربية طويلة ونصوص مختلطة عمداً."""
import json
LONG_DEPT = "قسم هندسة تقنيات الحاسوب والاتصالات والشبكات المتقدمة"
UNI = "جامعة البصرة للنفط والغاز والعلوم التطبيقية"
COL = "كلية الطب البيطري والعلوم الصحية المساعدة"
USERS = {
  "student": {"id": 7, "name": "محمد علي حسين", "email": "student@test.iq", "admin": False, "scopes": []},
  "stagerep": {"id": 8, "name": "سارة أحمد", "email": "rep@test.iq", "admin": False, "scopes": [{"type": "stage", "level": "rep", "node_id": 11, "label": LONG_DEPT, "stage_number": 2, "department_id": 41}]},
  "admin": {"id": 1, "name": "المشرف العام", "email": "admin@test.iq", "admin": True, "owner": True, "scopes": []},
}
PLAT = {"ok": True, "dept": {"id": 41, "name": LONG_DEPT}, "site": {"department": LONG_DEPT, "university": UNI, "college": COL},
  "semesters": [{"id": 11, "name": "الكورس الأول", "nameEn": "1st", "current": True}, {"id": 12, "name": "الكورس الثاني", "nameEn": "2nd"}],
  "courses": [{"id": "s5", "semester": 11, "name": "التشريح العام وعلم الأنسجة (Histology)", "nameEn": "General Anatomy", "category": "general", "professors": [{"name": "د. أحمد"}],
    "lectures": [{"number": i, "title": "Lecture %d — مقدمة في الجهاز التنفسي Respiratory system overview part %d" % (i, i), "files": [{"label": "PDF", "url": "/api/file/x%d" % i, "added": "2026-11-0%d" % i, "size": 1234567}]} for i in range(1, 6)]},
    {"id": "s6", "semester": 11, "name": "الكيمياء الحياتية", "nameEn": "Biochemistry", "category": "general", "professors": [], "lectures": []}]}
IDX = {"ok": True, "u": [[1, UNI, "University of Basrah", "البصرة", "حكومية"], [2, "جامعة بغداد", "Baghdad", "بغداد", "حكومية"]],
  "c": [[3, 1, COL, ""], [4, 1, "كلية الطب", ""], [5, 2, "كلية الهندسة", ""]], "d": [[41, 3, LONG_DEPT], [42, 4, "الطب العام"], [51, 5, "الهندسة المدنية"]]}
OPTIONS = {"ok": True, "admin": True, "universities": [{"id": 1, "name_ar": UNI}], "colleges": [{"id": 3, "university_id": 1, "name_ar": COL}, {"id": 4, "university_id": 1, "name_ar": "كلية الطب"}],
  "departments": [{"id": 41, "college_id": 3, "name_ar": LONG_DEPT}, {"id": 42, "college_id": 4, "name_ar": "الطب العام"}]}
SUBJ = {"ok": True, "items": [{"id": 5, "name_ar": "التشريح العام وعلم الأنسجة", "stage": 2, "term": 1, "can_publish": True}, {"id": 6, "name_ar": "الكيمياء الحياتية Biochemistry", "stage": 2, "term": 2, "can_publish": True}]}
ITEMS = [{"id": "e%d" % i, "courseId": "s5", "type": "lecture", "number": i, "title": "Respiratory system overview part %d — الجهاز التنفسي" % i, "label": "ملزمة", "kind": "file", "size": 2_400_000, "added": "2026-11-0%d" % i, "status": "approved" if i % 3 else "pending"} for i in range(1, 7)]
WS = {"ok": True, "scope": {"type": "university", "id": 1, "university": UNI, "university_id": 1}, "can_assign": True, "items": [
  {"id": 11, "number": n, "department_id": 41, "department": LONG_DEPT, "college_id": 3, "college": COL, "university_id": 1, "university": UNI, "representative_id": 8 if n == 2 else None, "representative": "سارة أحمد" if n == 2 else None, "representative_active": 1, "students": 30 + n, "unverified": n, "subjects": 6} for n in range(1, 7)]}

def respond(role, u, method, post):
    me = USERS.get(role)
    if "/api/auth/me" in u: return {"ok": True, "user": me} if me else ({"ok": False, "error": "unauthorized"}, 401)
    if not me and any(k in u for k in ("/api/admin", "/api/group-chat", "/api/dm", "/api/catalog/me", "/api/upload-options", "/api/profile", "/api/sync")): return ({"ok": False, "error": "unauthorized"}, 401)
    if "/api/auth/config" in u: return {"ok": True, "clientId": ""}
    if "/api/platform" in u: return PLAT
    if "/api/catalog/me" in u: return {"ok": True, "profile": None if role == "admin" else {"stage": 2, "department_id": 41, "department": LONG_DEPT, "college_id": 3, "college": COL, "university_id": 1, "university": UNI, "university_state": "active", "membership": "confirmed"}}
    if "/api/catalog/index" in u: return IDX
    if "/api/catalog/universities" in u: return {"ok": True, "items": [{"id": 1, "name_ar": UNI, "city": "البصرة"}, {"id": 2, "name_ar": "جامعة بغداد", "city": "بغداد"}]}
    if "/api/catalog/colleges" in u: return {"ok": True, "items": [{"id": 3, "name_ar": COL}, {"id": 4, "name_ar": "كلية الطب"}]}
    if "/api/catalog/departments" in u: return {"ok": True, "items": [{"id": 41, "name_ar": LONG_DEPT}, {"id": 42, "name_ar": "الطب العام"}]}
    if "/api/catalog/stages" in u: return {"ok": True, "items": [{"id": 10 + n, "number": n} for n in range(1, 7)]}
    if "/api/catalog/subjects" in u: return {"ok": True, "items": [{"id": 5, "name_ar": "التشريح العام وعلم الأنسجة", "name_en": "Anatomy", "professor": "د. أحمد", "stage": 2, "term": 1}, {"id": 6, "name_ar": "الكيمياء الحياتية", "stage": 2, "term": 2}]}
    if "/api/catalog/department" in u: return {"ok": True, "item": {"id": 41, "name_ar": LONG_DEPT, "college_id": 3, "college": COL, "university_id": 1, "university": UNI}, "can": role == "admin"}
    if "/api/catalog/subject" in u: return {"ok": True, "item": {"id": 5, "name_ar": "التشريح العام وعلم الأنسجة", "name_en": "Anatomy", "professor": "د. أحمد", "stage": 2, "term": 1, "department_id": 41, "department": LONG_DEPT, "college_id": 3, "college": COL, "university_id": 1, "university": UNI}, "can": role != "student", "can_upload": role != "student"}
    if "/api/catalog/fixdepts" in u: return {"ok": True, "preview": True, "colleges": []}
    if "/api/invite" in u and "/api/admin" not in u: return ({"ok": False, "error": "not_found"}, 404)
    if "/api/upload-options" in u: return SUBJ if "department_id" in u else (OPTIONS if role == "admin" else {**OPTIONS, "admin": False, "colleges": OPTIONS["colleges"][:1], "departments": OPTIONS["departments"][:1]})
    if u.endswith("/api/uploads") or "uploads.js" in u: return {"ok": True, "items": [i for i in ITEMS if i["status"] == "approved"]}
    if "/api/admin/invites" in u: return {"ok": True, "items": []}
    if "/api/admin/activation-requests" in u: return {"ok": True, "items": [{"university_id": 2, "university": "جامعة بغداد", "requests": 3, "last_at": 0, "departments": [{"id": 51, "name": "كلية الهندسة — الهندسة المدنية", "requests": 3}]}]}
    if "/api/admin/workspace" in u: return WS
    if "/api/admin/universities" in u: return {"ok": True, "items": [{"id": 1, "name_ar": UNI, "state": "active", "colleges": 2, "departments": 2, "students": 40, "files": 6}], "totals": {"directory": 2, "active": 1}, "students": 40, "users": 50, "active": 1, "files": 6, "pending": 2, "reports": 0, "reps": 1, "recent": []}
    if "/api/admin/stage-students" in u: return {"ok": True, "items": [{"id": 9, "name": "طالب باسم طويل جداً للتجربة على الهاتف", "verified": False}], "next": None}
    if "/api/admin/stage-announcements" in u or "/api/stage-announcements" in u or "/api/announcements" in u: return {"ok": True, "items": [{"id": 1, "title": "تبليغ مهم", "body": "امتحان التشريح يوم الأحد الساعة 9 صباحاً في القاعة A-12", "created_at": 1700000000000}]}
    if "/api/auth/users" in u: return {"ok": True, "items": [{"id": 7, "name": "محمد علي حسين", "email": "student@test.iq", "role": "student", "active": 1}], "next": None}
    if "/api/auth/scopes" in u or "/api/auth/scope" in u or "/api/auth/rep-request" in u or "/api/auth/global-admins" in u: return {"ok": True, "items": []}
    if "/api/admin" in u: return {"ok": True, "items": ITEMS}
    if "/api/reports" in u: return {"ok": True, "items": []}
    if "/api/profile/public" in u: return {"ok": True, "display_name": "أبو علي", "has_avatar": False, "updated_at": 0}
    if "/api/group-chat/rooms" in u: return {"ok": True, "items": [{"id": 1, "name": "مجموعة المرحلة", "stage_id": 11, "stage": 2, "department_id": 41, "department": LONG_DEPT, "college": COL, "university": UNI, "unread": 2, "muted": 0}], "requests": []}
    if "/api/group-chat/messages" in u: return {"ok": True, "items": [{"id": i, "group_id": 1, "sender_id": 8 if i % 2 else 7, "sender": "سارة أحمد" if i % 2 else "محمد", "av": 0, "body": ("رسالة طويلة جداً https://example.com/a/very/long/path/that/should/wrap/properly " * (2 if i == 3 else 1)) + "مع English words mixed in", "created_at": 1700000000000 + i * 60000, "reply_to": None} for i in range(1, 9)], "has_more": False, "removed_count": 0}
    if "/api/group-chat/manage" in u: return {"ok": True, "items": []}
    if "/api/dm/threads" in u: return {"ok": True, "items": [{"peer": {"id": 8, "name": "سارة أحمد", "role": "rep", "av": 0}, "last": {"body": "هلا", "at": 1700000000000, "mine": False}, "unread": 1}], "me": {"id": 7, "mod": False}}
    if "/api/dm/messages" in u: return {"ok": True, "items": [{"id": 1, "sender_id": 8, "body": "هلا", "created_at": 1700000000000}], "gone": [], "now": 1, "peer": {"id": 8, "name": "سارة أحمد", "role": "rep", "av": 0}, "blocked": False, "me": 7}
    if "/api/dm/staff" in u: return {"ok": True, "items": []}
    if "/api/study-assistant" in u: return {"ok": True, "items": [], "documents": [], "principal": {"university": UNI, "college": COL, "department": LONG_DEPT}, "quota": {"used": 1, "limit": 30}}
    if "/api/college-logo" in u or "/api/avatar/" in u: return ("", 404)
    if "/api/sync" in u: return {"ok": True, "data": {}}
    return None

def route_for(role):
    def handler(r, seen):
        u = r.request.url
        if "/api/" not in u and not u.endswith("uploads.js"):
            if u.startswith("http://127.0.0.1"): return r.continue_()
            if "fonts.g" in u: return r.abort()
            return r.continue_()
        res = respond(role, u.split("?")[0] if False else u, r.request.method, r.request.post_data)
        if res is None:
            seen.append(r.request.method + " " + u.split("127.0.0.1:8797")[-1].split("?")[0])
            return r.fulfill(status=404, content_type="application/json", body='{"ok":false,"error":"not_found"}')
        body, code = (res if isinstance(res, tuple) else (res, 200))
        if u.endswith("uploads.js"): return r.fulfill(status=200, content_type="application/javascript", body="window.__UPLOADS=" + json.dumps(body))
        r.fulfill(status=code, content_type="application/json", body=body if isinstance(body, str) else json.dumps(body))
    return handler

S = "student"
PAGES = [("guest", "index.html"), ("guest", "login.html"), ("guest", "catalog.html"), ("guest", "privacy.html"), ("guest", "terms.html"),
  (S, "join.html"), (S, "join.html?change=1"), (S, "catalog.html"), (S, "dept.html?id=41"), (S, "stage.html?dept=41&n=2"), (S, "subject.html?id=5"),
  (S, "platform.html?dept=41&stage=2"), (S, "semester.html?id=11&dept=41&stage=2"), (S, "course.html?id=s5&dept=41&stage=2"),
  (S, "group-chat.html"), (S, "dm.html"), (S, "study-assistant.html"), (S, "study.html"),
  ("stagerep", "contribute.html"), ("stagerep", "upload.html"), ("stagerep", "admin.html"), ("stagerep", "invites.html"), ("stagerep", "group-chat-admin.html"), ("stagerep", "representatives.html"),
  ("admin", "admin.html"), ("admin", "admin-tools.html"), ("admin", "upload-center.html"), ("admin", "manage.html"), ("admin", "team.html"), ("admin", "announce.html"),
  ("admin", "activation-requests.html"), ("admin", "fix-departments.html"), ("admin", "invites.html"), ("admin", "representatives.html")]
