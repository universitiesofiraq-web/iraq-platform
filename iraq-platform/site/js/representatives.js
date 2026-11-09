(function () {
  "use strict";

  const $ = id => document.getElementById(id);
  const scopeTypes = { university: "جامعة", college: "كلية", department: "قسم" };
  const sessionStatus = $("session-status");
  let scopeController;

  class ApiError extends Error {
    constructor(status) {
      super("Representative API request failed");
      this.status = status;
    }
  }

  async function read(path, signal) {
    const response = await fetch("/api/" + path, { credentials: "same-origin", cache: "no-store", signal });
    if (!response.ok) throw new ApiError(response.status);
    const data = await response.json();
    if (!data || data.ok !== true) throw new ApiError(response.status);
    return data;
  }

  function numericId(value) {
    return Number.isSafeInteger(value) && value > 0;
  }

  function representativeScopes(user) {
    return (Array.isArray(user.scopes) ? user.scopes : []).filter(scope =>
      scope && scope.level === "rep" && Object.hasOwn(scopeTypes, scope.type) && numericId(scope.node_id)
    );
  }

  function isAdmin(user) {
    return user.admin === true || user.role === "admin";
  }

  const service = {
    session: signal => read("auth/me", signal),
    team: signal => read("auth/scopes", signal),
    announcements: signal => read("announcements", signal),
    requests: signal => read("auth/rep-requests", signal),
    department: (id, signal) => read("catalog/department?id=" + id, signal),
    subjects: (id, signal) => read("catalog/subjects?department_id=" + id, signal),
    uploads: signal => read("uploads", signal)
  };

  function node(tag, text, className) {
    const element = document.createElement(tag);
    if (text !== undefined) element.textContent = text;
    if (className) element.className = className;
    return element;
  }

  function action(label, href, description) {
    const item = node("li");
    const control = node(href ? "a" : "button", label, "rp-action");
    if (href) control.href = href;
    else {
      control.type = "button";
      control.disabled = true;
    }
    item.append(control);
    if (description) item.append(node("p", description, "rp-muted"));
    return item;
  }

  function link(label, href) {
    const anchor = node("a", label, "rp-action");
    anchor.href = href;
    return anchor;
  }

  function showError(area, message, retry) {
    const button = node("button", "حاول مرة أخرى");
    button.type = "button";
    button.addEventListener("click", retry);
    area.replaceChildren(node("p", message), button);
  }

  function items(data) {
    return Array.isArray(data.items) ? data.items : [];
  }

  function scopeName(scope, team) {
    if (!scope) return "";
    const row = team.find(item => item.type === scope.type && item.node_id === scope.node_id);
    return row?.node || scopeTypes[scope.type] + " رقم " + scope.node_id;
  }

  function context(scope, team, department, admin) {
    const row = scope && team.find(item => item.type === scope.type && item.node_id === scope.node_id);
    const names = [
      ["الجامعة", department?.university || row?.university || (admin && !scope ? "جميع الجامعات" : "غير محددة")],
      ["الكلية", department?.college || (scope?.type === "college" ? scopeName(scope, team) : "غير محددة")],
      ["القسم", department?.name_ar || (scope?.type === "department" ? scopeName(scope, team) : "غير محدد")],
      ["المرحلة", "غير متاحة لهذا النطاق"],
      ["الشعبة", "غير متاحة لهذا النطاق"]
    ];
    $("context").replaceChildren(...names.map(([label, value]) => {
      const group = node("div");
      group.append(node("dt", label), node("dd", value));
      return group;
    }));
  }

  function quickActions(admin, department, scope) {
    $("quick-actions").replaceChildren(
      action("رفع محاضرة", "contribute.html", "تتحقق صفحة الرفع من نطاق صلاحيتك."),
      action("إدارة المحتوى", department?.can && scope ? "dept.html?id=" + scope.node_id + "&manage=1" : "admin.html"),
      action("إنشاء تبليغ عام", admin ? "admin.html" : null, admin ? "من تبويب التبليغات في لوحة الإدارة." : "متاح للمشرف العام في النظام الحالي."),
      action("الجدول الأكاديمي", null, "بيانات الجدول غير متاحة لهذا النطاق."),
      action("مراجعة طلبات التمثيل", admin ? "admin.html" : null, admin ? "من تبويب طلبات التمثيل في لوحة الإدارة." : "تعرض الواجهة الحالية الطلبات للمشرف العام."),
      action("معلومات نطاق التمثيل", "#overview")
    );
  }

  async function loadAnnouncements(signal) {
    const area = $("announcements");
    area.replaceChildren(node("p", "جارٍ تحميل التبليغات…"));
    try {
      const notices = items(await service.announcements(signal));
      if (signal.aborted) return;
      if (!notices.length) {
        area.replaceChildren(node("p", "لا توجد تبليغات عامة حاليًا.", "rp-muted"));
        return;
      }
      const list = node("ul", undefined, "rp-list");
      for (const notice of notices.slice(0, 5)) {
        const item = node("li");
        item.append(node("strong", notice.title || "تبليغ"), node("p", notice.body || ""));
        list.append(item);
      }
      area.replaceChildren(list);
    } catch (error) {
      if (!signal.aborted) showError(area, "تعذّر تحميل التبليغات العامة.", () => loadAnnouncements(signal));
    }
  }

  function lectureActivity(subjects, uploads) {
    const names = new Map(subjects.filter(item => numericId(item.id)).map(item => ["s" + item.id, item.name_ar]));
    const lectures = uploads.filter(upload => names.has(upload.courseId) && upload.type === "lecture");
    return {
      count: new Set(lectures.map(upload => upload.courseId + ":" + (upload.number || upload.id))).size,
      recent: lectures.slice().sort((a, b) => String(b.added || "").localeCompare(String(a.added || ""))).slice(0, 5)
        .map(upload => (upload.title || upload.label || "محاضرة") + " — " + names.get(upload.courseId))
    };
  }

  async function loadScope(user, scope, team) {
    scopeController?.abort();
    scopeController = new AbortController();
    const signal = scopeController.signal;
    const admin = isAdmin(user);
    const isDepartment = scope?.type === "department";
    const status = $("scope-status");
    const activity = $("activity");
    status.textContent = isDepartment ? "جارٍ تحميل تفاصيل القسم…" : "";
    context(scope, team, null, admin);
    quickActions(admin, null, scope);
    activity.replaceChildren(node("p", "جارٍ تحميل النشاط…"));
    void loadAnnouncements(signal);
    const [department, subjects, uploads, requests] = await Promise.allSettled([
      isDepartment ? service.department(scope.node_id, signal) : null,
      isDepartment ? service.subjects(scope.node_id, signal) : null,
      isDepartment ? service.uploads(signal) : null,
      admin ? service.requests(signal) : null
    ]);
    if (signal.aborted) return;

    if (department.status === "fulfilled" && department.value) {
      context(scope, team, department.value.item, admin);
      quickActions(admin, { ...department.value.item, can: department.value.can === true }, scope);
      status.textContent = "";
    } else if (isDepartment) {
      status.textContent = "تعذّر تحميل تفاصيل القسم.";
    }

    activity.replaceChildren();
    const retry = () => loadScope(user, scope, team);
    if (isDepartment && subjects.status === "fulfilled" && uploads.status === "fulfilled") {
      const { count, recent } = lectureActivity(items(subjects.value), items(uploads.value));
      activity.append(node("p", count.toLocaleString("ar-IQ") + " محاضرة منشورة", "rp-metric"));
      if (recent.length) {
        const list = node("ul", undefined, "rp-list");
        list.replaceChildren(...recent.map(title => node("li", title)));
        activity.append(list);
      } else activity.append(node("p", "لا توجد محاضرات منشورة في هذا القسم.", "rp-muted"));
    } else if (isDepartment) {
      showError(activity, "تعذّر تحميل المحاضرات المنشورة.", retry);
    } else {
      activity.append(node("p", "عدد المحاضرات متاح عند اختيار نطاق قسم.", "rp-muted"));
    }

    if (admin) {
      const pending = requests.status === "fulfilled"
        ? items(requests.value).filter(item => item.status === "pending").length : null;
      activity.append(node("p", pending === null ? "تعذّر تحميل عدد الطلبات المعلّقة." :
        pending.toLocaleString("ar-IQ") + " طلب تمثيل معلّق"));
    }
    activity.append(node("p", "الأنشطة الأكاديمية القادمة غير متاحة من الخدمة الحالية.", "rp-muted"));
  }

  async function showTeamDirectory(teamRequest) {
    $("team-directory")?.remove();
    const section = node("section", undefined, "rp-card rp-session");
    section.id = "team-directory";
    section.setAttribute("aria-labelledby", "team-title");
    const heading = node("h2", "دليل الممثلين");
    heading.id = "team-title";
    const content = node("div");
    content.setAttribute("aria-live", "polite");
    section.append(heading, content);
    $("dashboard").append(section);
    content.append(node("p", "جارٍ تحميل الممثلين المتاحين لحسابك…"));

    let team;
    try {
      team = (await teamRequest).filter(row => row && row.level === "rep");
    } catch (error) {
      if (error.status === 401) {
        content.replaceChildren(link("أعد تسجيل الدخول", "login.html?next=representatives.html"));
      } else if (error.status === 403) {
        content.replaceChildren(node("p", "صلاحية عرض الدليل غير متاحة لحسابك."));
      } else {
        showError(content, "تعذّر تحميل دليل الممثلين.", () => showTeamDirectory(service.team().then(items)));
      }
      return;
    }

    const filter = node("input");
    filter.type = "search";
    filter.id = "team-filter";
    filter.className = "rp-action";
    const label = node("label", "ابحث بالاسم أو النطاق");
    label.htmlFor = filter.id;
    const list = node("ul", undefined, "rp-list");
    const filterTeam = () => {
      const query = filter.value.trim().toLocaleLowerCase("ar-IQ");
      const matches = team.filter(row => [row.name, row.node, row.university].some(value =>
        typeof value === "string" && value.toLocaleLowerCase("ar-IQ").includes(query)
      ) || !query);
      list.replaceChildren(...matches.map(row => {
        const item = node("li");
        const scope = [row.university, row.node].filter(Boolean).filter((value, index, names) => names.indexOf(value) === index);
        item.append(node("strong", row.name || "ممثل"), node("p", scope.join(" · ") || "النطاق غير مسمّى", "rp-muted"),
          node("p", "ممثل مسجّل • إدارة المحتوى ضمن النطاق", "rp-muted"));
        return item;
      }));
      if (!matches.length) list.append(node("li", query ? "لا توجد نتائج مطابقة." : "لا يوجد ممثلون ظاهرون ضمن صلاحيتك."));
    };
    filter.addEventListener("input", filterTeam);
    content.replaceChildren(label, filter, list);
    filterTeam();
    const actions = node("ul", undefined, "rp-action-list");
    actions.append(
      action("إدارة الفريق الحالية", "admin.html", "تطبّق لوحة الإدارة صلاحيات النطاق الحالية."),
      action("تعيين ممثل رئيسي أو مساعد", null, "يتطلب سجل الطلبة المؤهلين وصلاحية التعيين الجديدة."),
      action("تعديل التفويض أو إلغاؤه", null, "يتطلب دعم الصلاحيات التفصيلية من الخدمة الجديدة.")
    );
    section.append(actions);
  }

  async function loadSession() {
    scopeController?.abort();
    $("dashboard").hidden = true;
    $("session-actions").replaceChildren();
    sessionStatus.textContent = "جارٍ التحقق من الجلسة…";
    let user;
    try {
      ({ user } = await service.session());
      if (!user || typeof user !== "object") throw new ApiError(401);
    } catch (error) {
      if (error.status === 401) {
        sessionStatus.textContent = "سجّل الدخول لمتابعة طلبات التمثيل أو الوصول إلى أدوات حسابك.";
        $("session-actions").append(link("تسجيل الدخول", "login.html?next=representatives.html"));
      } else if (error.status === 403) {
        sessionStatus.textContent = "حسابك غير مخوّل للوصول إلى هذه الصفحة.";
      } else {
        sessionStatus.textContent = "تعذّر التحقق من الجلسة.";
        showError($("session-actions"), "تحقّق من الاتصال ثم أعد المحاولة.", loadSession);
      }
      return;
    }
    const scopes = representativeScopes(user);
    const admin = isAdmin(user);
    if (!admin && !scopes.length) {
      sessionStatus.textContent = "يمكنك طلب تمثيل قسمك من صفحته الأكاديمية. تظهر أدوات الإدارة بعد اعتماد صلاحيتك.";
      $("session-actions").append(link("اختر قسمك", "catalog.html"));
      return;
    }
    sessionStatus.textContent = admin ? "مشرف عام" : "ممثل معتمد ضمن نطاقه الأكاديمي";
    $("dashboard").hidden = false;
    $("capabilities").replaceChildren(...[
      "رفع مواد وفق صلاحيات الحساب",
      "إدارة المحتوى في النطاق المسموح",
      ...(admin ? ["مراجعة طلبات التمثيل", "نشر تبليغات عامة"] : [])
    ].map(label => node("li", label)));

    const selector = $("scope");
    $("scope-picker").hidden = !scopes.length;
    const teamRequest = service.team().then(items);
    void showTeamDirectory(teamRequest);
    const team = await teamRequest.catch(() => []);
    selector.replaceChildren(...scopes.map((scope, index) => new Option(scopeName(scope, team), String(index))));
    selector.onchange = () => loadScope(user, scopes[Number(selector.value)], team);
    await loadScope(user, scopes[0], team);
  }

  void loadSession();
})();
