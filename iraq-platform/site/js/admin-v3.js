const $ = id => document.getElementById(id);
const adminRoot = "/api/admin/universities";
const labels = {
  active: "مفعّلة",
  registered: "بانتظار التفعيل",
  suspended: "موقوفة",
  directory: "كل الجامعات",
  not_onboarded: "غير مفعّلة"
};
const errors = {
  database_quota_exceeded: "بلغت الخدمة حد الاستخدام اليومي. حاول لاحقًا.",
  service_unavailable: "خدمة البيانات غير متاحة مؤقتًا. أعد المحاولة بعد قليل.",
  server: "تعذّر تحميل البيانات حاليًا. أعد المحاولة بعد قليل.",
  unauthorized: "انتهت الجلسة. سجّل الدخول مرة أخرى.",
  forbidden: "لا يسمح نطاقك بهذا الإجراء.",
  onboarding_transition_conflict: "تغيّرت حالة الجامعة. حدّث الصفحة وحاول مرة أخرى.",
  inactive_account: "الحساب المختار غير نشط.",
  admin_locked: "صلاحية هذا الحساب محمية.",
  membership_conflict: "تعذّر تعديل العضوية. تحقق من الحساب وحالته والمرحلة المسجلة له.",
  assignment_conflict: "تعذّر التعيين. تحقق من الحساب أو حدّث اللوحة إذا تغيّر الممثل.",
  bad_request: "تحقق من الحقول المطلوبة."
};
let me;
let filter = "active";
let listing;
let listVersion = 0;
let dialogAction;

function element(tag, text, className) {
  const node = document.createElement(tag);
  if (text !== undefined) node.textContent = text;
  if (className) node.className = className;
  return node;
}

function link(text, href, className = "") {
  const node = element("a", text, className);
  node.href = href;
  return node;
}

function button(text, action, className = "") {
  const node = element("button", text, className);
  node.type = "button";
  node.addEventListener("click", action);
  return node;
}

const inFlight = new Set();
async function api(path, body) {
  if (body === undefined) return finish(await fetch(path, { cache: "no-store" }));
  /* منع تكرار الإرسال: الطلب نفسه لا يُرسل مرتين، والزر الذي أطلقه معطّل حتى الرد */
  const key = path + "|" + JSON.stringify(body);
  if (inFlight.has(key)) { const e = new Error("الطلب قيد التنفيذ…"); e.code = "busy"; throw e; }
  const active = typeof document !== "undefined" && document.activeElement;
  const btn = active && active.tagName === "BUTTON" && !active.disabled ? active : null;
  inFlight.add(key);
  if (btn) { btn.disabled = true; btn.setAttribute("aria-busy", "true"); }
  try {
    return finish(await fetch(path, { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) }));
  } finally {
    inFlight.delete(key);
    if (btn) { btn.disabled = false; btn.removeAttribute("aria-busy"); }
  }
}
async function finish(response) {
  const data = await response.json().catch(() => null);
  if (!response.ok || !data?.ok) {
    const code = data?.error;
    const error = new Error(errors[code] || "تعذّر الاتصال بالخادم. حاول مرة أخرى.");
    error.code = code;
    throw error;
  }
  return data;
}

function showNotice(text = "", isError = false) {
  const notice = $("notice");
  notice.textContent = text;
  notice.hidden = !text;
  notice.toggleAttribute("data-error", isError);
}

function number(value) {
  return new Intl.NumberFormat("ar-IQ").format(value);
}

function date(value) {
  return value ? new Intl.DateTimeFormat("ar-IQ", {
    dateStyle: "short", timeStyle: "short", timeZone: "Asia/Baghdad"
  }).format(value) : "—";
}

function empty(text) { return element("p", text, "empty"); }

function field(label, input) {
  const wrapper = element("label", label);
  wrapper.append(input);
  return wrapper;
}

function confirmAction(title, message, fields, action) {
  $("dialog-title").textContent = title;
  $("dialog-message").textContent = message;
  $("dialog-fields").replaceChildren(...fields);
  $("dialog-error").textContent = "";
  dialogAction = action;
  $("dialog").showModal();
}

$("dialog-close").addEventListener("click", () => $("dialog").close());
$("dialog").addEventListener("cancel", event => {
  if ($("dialog-confirm").disabled) event.preventDefault();
});
$("dialog-form").addEventListener("submit", async event => {
  event.preventDefault();
  if (!dialogAction || $("dialog-confirm").disabled) return;
  $("dialog-confirm").disabled = $("dialog-close").disabled = true;
  $("dialog-error").textContent = "";
  try {
    await dialogAction();
    $("dialog").close();
    showNotice("تم حفظ الإجراء.");
  } catch (error) {
    $("dialog-error").textContent = error.message;
  } finally {
    $("dialog-confirm").disabled = $("dialog-close").disabled = false;
  }
});

function panel(title, subtitle) {
  const card = element("section", undefined, "card");
  const head = element("div", undefined, "card-head");
  const text = element("div");
  text.append(element("h2", title));
  if (subtitle) text.append(element("p", subtitle, "muted"));
  head.append(text);
  card.append(head);
  return { card, head };
}

function stats(items) {
  const grid = element("div", undefined, "stats");
  for (const [label, value] of items) {
    const stat = element("div", undefined, "stat");
    stat.append(element("span", label), element("strong", number(value)));
    grid.append(stat);
  }
  return grid;
}

function table(headers, rows) {
  const wrap = element("div", undefined, "table-wrap");
  const grid = element("table");
  const head = grid.createTHead().insertRow();
  for (const label of headers) {
    const th = element("th", label);
    th.scope = "col";
    head.append(th);
  }
  const body = grid.createTBody();
  for (const cells of rows) {
    const row = body.insertRow();
    cells.forEach((cell, index) => {
      const td = row.insertCell();
      td.dataset.label = headers[index];
      if (cell instanceof Node) td.append(cell);
      else td.textContent = cell;
    });
  }
  wrap.append(grid);
  return wrap;
}

function auditItems(items, node) {
  if (!items.length) {
    node.replaceChildren(empty("لا توجد إجراءات مسجّلة بعد."));
    return;
  }
  const list = element("ul", undefined, "list");
  for (const entry of items) {
    const item = element("li");
    const activity = entry.previous_state === entry.state
      ? (entry.verified_at ? "تحديث التحقق أو المسؤول" : "تحديث المسؤول")
      : labels[entry.state];
    item.append(element("strong", [entry.university, activity].filter(Boolean).join(" · ")),
      element("small", [entry.actor, date(entry.created_at)].filter(Boolean).join(" · ")));
    list.append(item);
  }
  node.replaceChildren(list);
}

function profileForm(item) {
  const name = element("input"), city = element("input");
  name.required = true; name.maxLength = city.maxLength = 120;
  name.value = item?.name_ar || ""; city.value = item?.city || "";
  confirmAction(item ? "تعديل ملف الجامعة" : "إضافة جامعة إلى الدليل",
    "تُدار حالة التسجيل والتفعيل من قائمة الجامعات.",
    [field("اسم الجامعة", name), field("المحافظة أو المدينة", city)],
    async () => {
      if (item) {
        await api(adminRoot, { action: "edit_profile", id: item.id, name_ar: name.value, city: city.value });
      } else {
        await api("/api/catalog/add", { type: "university", name_ar: name.value, city: city.value });
        filter = "directory";
      }
      await loadUniversities();
    });
}

async function managerForm(item) {
  showNotice("جارٍ تحميل مسؤولي الجامعة…");
  try {
    const { items: candidates } = await api(adminRoot + "/managers?university_id=" + item.id);
    if (!candidates.length) {
      showNotice("عيّن مسؤولًا لهذه الجامعة من إدارة التعيينات قبل تسجيلها.", true);
      $("notice").append(" ", link("فتح إدارة التعيينات", "manage.html"));
      return;
    }
    showNotice();
    const select = element("select");
    select.required = true;
    select.append(new Option("اختر المسؤول", ""));
    for (const row of candidates) select.append(new Option(row.name + " — " + row.email, row.id));
    confirmAction(item.manager_id ? "تغيير مسؤول الجامعة" : "تسجيل الجامعة", item.name_ar,
      [field("مسؤول الجامعة", select)], async () => {
        await api(adminRoot, {
          action: item.manager_id ? "assign_manager" : "register",
          id: item.id, manager_id: Number(select.value)
        });
        await loadUniversities();
      });
  } catch (error) { showNotice(error.message, true); }
}

function transition(item, action, text) {
  confirmAction(text, item.name_ar, [], async () => {
    await api(adminRoot, { id: item.id, action });
    await loadUniversities();
  });
}

function universityActions(item) {
  const actions = element("div", undefined, "actions");
  actions.append(link("الممثلون", "manage.html?u=" + item.id, "button"), button("تعديل", () => profileForm(item)));
  if (item.state === "active") actions.append(button("إيقاف", () => transition(item, "suspend", "إيقاف الجامعة مؤقتاً")));
  else actions.append(button("تفعيل", () => transition(item, "activate", "تفعيل الجامعة"), "primary"));
  return actions;
}

function normalized(text) {
  return String(text || "").toLowerCase().replace(/[ً-ْـ]/g, "").replace(/[أإآٱ]/g, "ا").replace(/ى/g, "ي");
}

function renderUniversities() {
  if (!listing) return;
  const query = normalized($("search").value).trim().split(/\s+/).filter(Boolean);
  const rows = listing.items.filter(row => {
    const label = normalized([row.name_ar, row.name_en, row.city].filter(Boolean).join(" "));
    return query.every(word => label.includes(word));
  });
  const choices = element("div", undefined, "filters");
  choices.setAttribute("aria-label", "نطاق عرض الجامعات");
  for (const key of ["active", "suspended", "not_onboarded", "directory"]) {
    const choice = button(labels[key], () => {
      if (filter !== key) { filter = key; loadUniversities(); }
    });
    choice.setAttribute("aria-pressed", String(filter === key));
    choices.append(choice);
  }
  const ov = listing.overview?.totals || {};
  const totals = stats([
    ["الطلاب المسجّلون", ov.students || 0],
    ["الجامعات المفعّلة", ov.active ?? listing.totals?.active ?? 0],
    ["الملفات المنشورة", ov.files || 0],
    ["ملفات بانتظار المراجعة", ov.pending || 0],
    ["بلاغات مفتوحة", ov.reports || 0],
    ["الممثلون", ov.reps || 0]
  ]);
  const universities = panel("نتائج الجامعات · " + number(rows.length));
  universities.card.id = "universities";
  if (rows.length) {
    universities.card.append(table(["الجامعة", "الحالة", "الطلاب", "الملفات", "الأقسام", "الإجراءات"],
      rows.map(item => {
        const name = element("div");
        name.append(element("strong", item.name_ar));
        if (item.city) name.append(element("small", item.city));
        const badge = element("span", labels[item.state] || "غير معروفة", "status");
        badge.dataset.state = item.state;
        return [name, badge, number(item.students || 0), number(item.files || 0), number(item.departments), universityActions(item)];
      })));
  } else {
    universities.card.append(empty(query.length ? "لا توجد جامعات تطابق البحث." : "لا توجد جامعات في هذا العرض."));
  }
  const log = panel("سجل تفعيل الجامعات", "متى تفعّلت كل جامعة ومن فعّلها");
  log.card.id = "audit";
  const history = element("div");
  auditItems(listing.audit || [], history);
  log.card.append(history);
  const content = $("content");
  const summary = element("details", undefined, "overview-summary");
  summary.open = Boolean($("overview-summary")?.open);
  summary.id = "overview-summary";
  summary.append(element("summary", "إحصاءات المنصة"), totals);
  content.replaceChildren(choices, universities.card, summary, log.card);
  content.hidden = false;
}

async function showRegistrations() {
  $("title").textContent = "التسجيلات الأخيرة";
  $("description").textContent = "آخر ٣٠ حسابًا مرتبطًا بمرحلة دراسية، مرتبة حسب تاريخ إنشاء الحساب.";
  navigation(globalNav, "التسجيلات الأخيرة");
  $("page-actions").append(link("العودة إلى لوحة الإدارة", "admin.html", "button"));
  const content = $("content");
  const { card } = panel("الطلاب المسجّلون");
  content.replaceChildren(card);
  content.hidden = false;

  async function load() {
    showNotice("جارٍ تحميل التسجيلات…");
    card.setAttribute("aria-busy", "true");
    const results = element("div");
    card.replaceChildren(card.firstElementChild, results);
    try {
      const { recent } = await api(adminRoot + "/overview");
      if (!recent.length) {
        results.append(empty("لا توجد تسجيلات لطلاب مرتبطين بمرحلة دراسية."));
        showNotice();
        return;
      }
      const form = element("div", undefined, "form");
      const search = element("input");
      search.type = "search";
      search.placeholder = "ابحث بالاسم أو الجامعة أو الكلية أو القسم";
      form.append(field("البحث في التسجيلات المعروضة", search));
      const count = element("p", undefined, "muted");
      count.setAttribute("role", "status");
      const rows = element("div");
      function render() {
        const terms = normalized(search.value).trim().split(/\s+/).filter(Boolean);
        const matches = recent.filter(r => {
          const text = normalized([r.name, r.university, r.college, r.department].join(" "));
          return terms.every(term => text.includes(term));
        });
        count.textContent = number(matches.length) + " من " + number(recent.length) + " تسجيلًا";
        rows.replaceChildren(matches.length
          ? table(["الطالب", "الجامعة والكلية", "القسم والمرحلة", "إنشاء الحساب"], matches.map(r => {
            const affiliation = element("div");
            affiliation.append(element("strong", r.university), element("small", r.college));
            const academic = element("div");
            academic.append(element("strong", r.department), element("small", stageLabel(r.stage)));
            return [element("strong", r.name), affiliation, academic, date(r.created_at)];
          }))
          : empty("لا توجد تسجيلات تطابق البحث."));
      }
      results.append(form, count, rows);
      search.addEventListener("input", render);
      render();
      showNotice();
    } catch (error) {
      showNotice(error.message, true);
      results.append(button("إعادة المحاولة", load));
    } finally {
      card.removeAttribute("aria-busy");
    }
  }
  await load();
}

async function showGrowth() {
  $("title").textContent = "تحليل النمو";
  $("description").textContent = "الطلاب النشطون والجامعات الأكثر استخداماً ومصادر التسجيل.";
  $("role").textContent = me.owner ? "مالك المنصة" : "مدير عام";
  $("scope-label").textContent = "جميع الجامعات";
  navigation(globalNav, "تحليل النمو");
  const body = element("div");
  body.append(empty("جارٍ تحميل التحليل…"));
  const content = $("content");
  content.replaceChildren(body);
  content.hidden = false;
  try { body.replaceChildren(growthPanel(await api(adminRoot + "/analytics"))); }
  catch { body.replaceChildren(empty("تعذّر تحميل التحليل.")); }
}

async function loadUniversities() {
  const request = ++listVersion;
  showNotice("جارٍ تحميل الجامعات…");
  $("content").setAttribute("aria-busy", "true");
  try {
    const data = await api(adminRoot + "?filter=" + filter);
    if (request !== listVersion) return;
    const overviewData = await api(adminRoot + "/overview").catch(() => null);
    if (request !== listVersion) return;
    listing = { ...data, audit: listing?.audit || [], overview: overviewData || listing?.overview };
    renderUniversities();
    showNotice();
    const log = $("audit").lastElementChild;
    try {
      const audit = await api(adminRoot + "/audit");
      if (request !== listVersion) return;
      listing.audit = audit.items;
      auditItems(audit.items, $("audit").lastElementChild);
    } catch {
      if (request === listVersion && log.isConnected) log.replaceChildren(empty("تعذّر تحميل سجل النشاط."));
    }
  } catch (error) {
    if (request !== listVersion) return;
    listing = undefined;
    $("content").hidden = true;
    showNotice(error.message, true);
    $("notice").append(" ", button("إعادة المحاولة", loadUniversities));
  } finally {
    if (request === listVersion) $("content").removeAttribute("aria-busy");
  }
}

async function globalTeam() {
  showNotice("جارٍ تحميل الإدارة العامة…");
  try {
    const [team, directory] = await Promise.all([api("/api/auth/global-admins"), api("/api/auth/users")]);
    showNotice();
    const select = element("select");
    select.required = true;
    select.append(new Option("اختر حسابًا نشطًا", ""));
    const delegated = new Set(team.items.filter(item => item.active).map(item => item.id));
    for (const account of directory.users.filter(account => account.active && account.role !== "admin")) {
      if (!delegated.has(account.id)) select.append(new Option(account.name + " — " + account.email, account.id));
    }
    const revoked = element("select");
    revoked.append(new Option("اختر مديرًا لسحب التفويض", ""));
    for (const account of team.items.filter(account => account.active)) revoked.append(new Option(account.name + " — " + account.email, account.id));
    const action = element("select");
    action.append(new Option("منح إدارة عامة", "grant"), new Option("سحب الإدارة العامة", "revoke"));
    const grantField = field("الحساب المراد تفويضه", select);
    const revokeField = field("المدير العام", revoked);
    function syncAction() {
      const grant = action.value === "grant";
      grantField.hidden = !grant; revokeField.hidden = grant;
      select.required = grant; revoked.required = !grant;
    }
    action.addEventListener("change", syncAction);
    syncAction();
    confirmAction("إدارة التفويض العام", "صلاحية تشغيلية لجميع الجامعات. تفويض المديرين العامين من صلاحيات المالك.",
      [field("الإجراء", action), grantField, revokeField], async () => {
        await api("/api/auth/global-admins", { action: action.value, user_id: Number(action.value === "grant" ? select.value : revoked.value) });
      });
  } catch (error) { showNotice(error.message, true); }
}

function navigation(entries, current) {
  const nav = $("sidebar-nav");
  nav.replaceChildren();
  function appendEntry([title, href]) {
    const anchor = link(title, href);
    if (title === (current || entries[0][0])) anchor.setAttribute("aria-current", "page");
    nav.append(anchor);
  }
  if (entries === globalNav) {
    for (const [label, links] of globalNavGroups) {
      if (label) nav.append(element("h2", label, "nav-group"));
      links.forEach(appendEntry);
    }
  } else entries.forEach(appendEntry);
  nav.hidden = false;
}

const globalNavGroups = [
  ["", [["الرئيسية", "admin.html"]]],
  ["التنظيم الأكاديمي", [["الجامعات", "admin.html#universities"], ["طلبات تفعيل الجامعات", "activation-requests.html"], ["تنظيم أقسام «المرحلة»", "fix-departments.html"]]],
  ["الأشخاص والصلاحيات", [["تعيين الممثلين", "manage.html"], ["المستخدمون", "admin-tools.html#users"], ["روابط الدعوة", "invites.html"]]],
  ["المحتوى والتواصل", [["مركز الرفع", "upload-center.html"], ["الملفات والبلاغات", "admin-tools.html#files"], ["التبليغات العامة", "announce.html"]]],
  ["المتابعة", [["التسجيلات الأخيرة", "admin.html?view=registrations"], ["تحليل النمو", "admin.html?view=growth"]]]
];
const globalNav = globalNavGroups.flatMap(([, links]) => links);

function showGlobal() {
  const view = new URLSearchParams(location.search).get("view");
  $("role").textContent = me.owner ? "مالك المنصة" : "مدير عام";
  $("scope-label").textContent = "جميع الجامعات";
  if (view === "registrations" || (!view && location.hash === "#joins")) return showRegistrations();
  if (view === "growth") return showGrowth();
  $("title").textContent = "لوحة الإدارة العامة";
  $("description").textContent = "نظرة سريعة على الطلاب والجامعات والملفات.";
  $("admin-tasks").hidden = $("directory-tools").hidden = $("search-box").hidden = false;
  $("search").addEventListener("input", renderUniversities);
  const nav = globalNav;
  navigation(nav);
  $("page-actions").append(button("إضافة جامعة", () => profileForm(), "primary"));
  if (me.owner) $("page-actions").append(button("تفويض مدير عام", globalTeam));
  loadUniversities();
}

const roles = {
  university: "مسؤول الجامعة",
  college: "مشرف الكلية",
  department: "مسؤول القسم",
  stage: "ممثل المرحلة"
};
const ordinals = ["", "الأولى", "الثانية", "الثالثة", "الرابعة", "الخامسة", "السادسة", "السابعة", "الثامنة"];

function stageLabel(stage) {
  return "المرحلة " + (ordinals[stage] || number(stage));
}

function workspaceLink(type, id) {
  return "admin.html?" + new URLSearchParams({ type, id });
}

function assignmentForm(row, revoke, reload) {
  const email = element("input");
  email.type = "email"; email.dir = "ltr"; email.required = true; email.maxLength = 254;
  const action = revoke ? "سحب التعيين" : row.representative_id ? "استبدال الممثل" : "تعيين ممثل";
  const fields = revoke ? [] : [field("بريد الحساب المسجل", email)];
  confirmAction(action, [stageLabel(row.number), row.department].join(" — "), fields, async () => {
    const target = revoke ? { user_id: 0 } : { user_email: email.value };
    await api("/api/admin/stage-representative", {
      stage_id: row.id, expected_user_id: row.representative_id || 0, ...target
    });
    await reload();
  });
}

function fileLink(file) {
  if (file.kind !== "link") return "/api/file/" + encodeURIComponent(file.id);
  try {
    const url = new URL(file.url);
    if (url.protocol === "https:" || url.protocol === "http:") return url.href;
  } catch {}
  return null;
}

function appendNoticeRows(items, target) {
  if (!items.length) {
    target.replaceChildren(empty("لا توجد إعلانات لهذه المرحلة."));
    return;
  }
  const list = element("ul", undefined, "list");
  for (const entry of items) {
    const row = element("li");
    row.append(element("strong", entry.title), element("small", entry.by + " · " + date(entry.at)));
    if (entry.body) row.append(element("p", entry.body));
    list.append(row);
  }
  target.replaceChildren(list);
}

// رابط دعوة لقسم أو مرحلة: ينشره الممثل في مجموعات تيليغرام، ويُحصى من سجّل عبره
function invitePanel(type, id, title) {
  const box = panel(title, "انشر الرابط في مجموعة الطلاب. يفتح للطالب صفحة تسجيل جاهزة لهذا " + (type === "stage" ? "الصف" : "القسم") + ".");
  box.card.id = type + "-invites";
  const body = element("div");
  box.card.append(body);
  const root = "/api/admin/invites";
  const linkOf = code => location.origin + "/join.html?inv=" + code;
  async function load() {
    body.replaceChildren(empty("جارٍ التحميل…"));
    try {
      const { items } = await api(root + "?type=" + type + "&id=" + id);
      const live = items.filter(row => !row.revoked_at);
      if (!live.length) { body.replaceChildren(empty("لا يوجد رابط بعد. اضغط «إنشاء رابط».")); return; }
      const list = element("ul", undefined, "list");
      for (const row of live) {
        const url = linkOf(row.code);
        const item = element("li");
        const text = element("input"); text.readOnly = true; text.value = url; text.dir = "ltr";
        text.setAttribute("aria-label", "رابط الدعوة");
        const actions = element("div", undefined, "actions");
        actions.append(
          button("نسخ", async () => {
            try { await navigator.clipboard.writeText(url); showNotice("نُسخ الرابط."); } catch { text.select(); showNotice("حدّد الرابط وانسخه.", true); }
          }, "primary"),
          link("نشر في تيليغرام", "https://t.me/share/url?url=" + encodeURIComponent(url) + "&text=" + encodeURIComponent("سجّل في دفعتنا واحصل على ملازم قسمك"), "button"),
          button("إيقاف الرابط", () => confirmAction("إيقاف الرابط", "لن يعمل الرابط بعد الآن، ويبقى من سجّلوا عبره.", [], async () => {
            await api(root, { action: "revoke", code: row.code });
            await load();
          })));
        item.append(text, element("small", "سجّل عبره " + number(row.uses) + " · أنشأه " + (row.creator || "") + " · " + date(row.created_at)), actions);
        list.append(item);
      }
      body.replaceChildren(list);
    } catch (error) { body.replaceChildren(empty(error.message), button("إعادة المحاولة", load)); }
  }
  box.head.append(button("إنشاء رابط", async () => {
    try { await api(root, { action: "create", type, id }); await load(); }
    catch (error) { showNotice(error.message, true); }
  }, "primary"));
  load();
  return box.card;
}

function barList(rows, label, value, suffix = "") {
  const max = Math.max(1, ...rows.map(value));
  const list = element("ul", undefined, "list bars");
  for (const row of rows) {
    const item = element("li");
    const bar = element("span", undefined, "bar");
    bar.style.setProperty("--w", Math.round(value(row) / max * 100) + "%");
    item.append(element("strong", label(row)), element("small", number(value(row)) + suffix), bar);
    list.append(item);
  }
  return list;
}

function growthPanel(data) {
  const wrap = element("div");
  const t = data.totals;
  wrap.append(stats([
    ["الطلاب المسجّلون", t.students], ["دخلوا آخر ٧ أيام", t.active7], ["دخلوا آخر ٣٠ يوماً", t.active30],
    ["تسجيلات آخر ٧ أيام", t.signups7], ["حسابات جديدة آخر ٧ أيام", t.accounts7]
  ]));
  const grid = element("div", undefined, "panel-grid");
  const top = panel("الجامعات الأكثر استخداماً", "حسب عدد الطلاب المسجّلين");
  top.card.append(data.top.length
    ? barList(data.top, r => r.name_ar, r => r.students, " طالب")
    : empty("لا يوجد طلاب مسجّلون بعد."));
  const src = panel("مصادر التسجيل", "من أين جاء الطلاب: رابط دعوة أو تسجيل مباشر");
  src.card.append(data.sources.length
    ? barList(data.sources, r => r.code === "direct" ? "تسجيل مباشر" :
        (r.department || "رابط دعوة") + (r.stage ? " — " + stageLabel(r.stage) : "") + " (" + r.code.slice(0, 4) + "…)", r => r.n)
    : empty("لا توجد تسجيلات بعد."));
  const days = panel("التسجيلات اليومية", "آخر ١٤ يوماً");
  days.card.append(data.daily.length
    ? barList(data.daily, r => r.day, r => r.n)
    : empty("لا توجد تسجيلات في آخر ١٤ يوماً."));
  grid.append(top.card, src.card, days.card);
  wrap.append(grid);
  return wrap;
}

function stagePanels(data) {
  const { scope, subjects } = data;
  const key = { stage_id: scope.id };
  const stageApi = "/api/admin/stage-announcements?stage_id=" + scope.id;
  const uploadUrl = "contribute.html?stage_id=" + scope.id;
  const files = panel("المحاضرات والملفات", "المواد والملفات ضمن هذه المرحلة.");
  const news = panel("إعلانات المرحلة");
  const reports = panel("البلاغات");
  const students = panel("طلبة المرحلة", "الطلاب المسجّلون في مرحلتك. أكّد من تعرفه أنه طالب في قسمك.");
  files.card.id = "stage-files";
  news.card.id = "stage-announcements";
  reports.card.id = "stage-reports";
  students.card.id = "stage-students";
  const filesBody = element("div"), newsBody = element("div"), reportsBody = element("div"), studentsBody = element("div");
  files.card.append(filesBody); news.card.append(newsBody); reports.card.append(reportsBody); students.card.append(studentsBody);
  files.head.append(link("رفع ملف", uploadUrl, "button primary"));
  const publish = button("نشر إعلان", () => {
    const title = element("input"), body = element("textarea");
    title.required = true; title.maxLength = 120; body.maxLength = 2000;
    confirmAction("نشر إعلان لهذه المرحلة", stageLabel(scope.stage), [field("العنوان", title), field("نص الإعلان", body)], async () => {
      await api(stageApi, { title: title.value, body: body.value });
      await loadNews();
    });
  });
  news.head.append(publish);
  const chatUrl = "group-chat-admin.html?" + new URLSearchParams({ stage_id: scope.id });
  $("page-actions").append(link("رفع ملف جديد", uploadUrl, "button primary"),
    link("إدارة الدردشة وإنشاء مجموعة", chatUrl, "button"));
  $("sidebar-nav").append(link("الملفات", "#stage-files"), link("الطلبة", "#stage-students"),
    link("الإعلانات", "#stage-announcements"), link("البلاغات", "#stage-reports"));

  const guarded = async (target, load, render) => {
    target.replaceChildren(empty("جارٍ التحميل…"));
    try { render(await load(), target); }
    catch (error) {
      target.replaceChildren(empty(error.message), button("إعادة المحاولة", () => guarded(target, load, render)));
    }
  };

  const names = new Map((subjects || []).map(subject => ["s" + subject.id, subject.name_ar]));
  function loadFiles() {
    return guarded(filesBody, () => api("/api/admin", key), ({ items }, target) => {
      if (!items.length) {
        target.replaceChildren(empty("لا توجد ملفات لهذه المرحلة."));
        return;
      }
      target.replaceChildren(table(["الملف", "المادة", "الحالة", "الإجراءات"], items.map(file => {
        const actions = element("div", undefined, "actions");
        const href = fileLink(file);
        if (href) {
          const view = link("فتح", href, "button");
          view.target = "_blank"; view.rel = "noopener";
          actions.append(view);
        }
        if (file.status === "pending") {
          for (const [action, label] of [["approve", "اعتماد"], ["reject", "رفض"]]) {
            actions.append(button(label, () => confirmAction(label + " الملف", file.label, [], async () => {
              await api("/api/review", { id: file.id, action });
              await loadFiles();
            })));
          }
        }
        const state = file.status === "approved" ? "منشور" : file.status === "rejected" ? "مرفوض" : "قيد المراجعة";
        const badge = element("span", state, "status");
        badge.dataset.state = file.status === "approved" ? "active" : file.status === "rejected" ? "suspended" : "registered";
        return [file.label, names.get(file.courseId) || "—", badge, actions];
      })));
    });
  }

  function loadReports() {
    return guarded(reportsBody, () => api("/api/reports", key), ({ items }, target) => {
      if (!items.length) {
        target.replaceChildren(empty("لا توجد بلاغات لهذه المرحلة."));
        return;
      }
      const list = element("ul", undefined, "list");
      for (const report of items) {
        const row = element("li");
        row.append(element("p", report.reason), element("small", report.open ? "مفتوح" : "مغلق"));
        if (report.open) row.append(button("إغلاق البلاغ", () => confirmAction("إغلاق البلاغ", report.reason, [], async () => {
          await api("/api/reportdone", { rid: report.rid });
          await loadReports();
        })));
        list.append(row);
      }
      target.replaceChildren(list);
    });
  }

  function loadNews() {
    return guarded(newsBody, () => api(stageApi), ({ items }, target) => appendNoticeRows(items, target));
  }

  function loadStudents(after = 0) {
    return guarded(studentsBody, () => api("/api/admin/stage-students?stage_id=" + scope.id + "&after=" + after),
      ({ items, next }, target) => {
        if (!items.length) {
          target.replaceChildren(empty("لا توجد حسابات مرتبطة بهذه المرحلة."));
          return;
        }
        const list = element("ul", undefined, "list");
        for (const student of items) {
          const row = element("li");
          row.append(element("strong", student.name));
          if (student.verified) row.append(element("span", "مؤكَّد", "status"));
          else row.append(element("span", "غير مؤكَّد", "status"),
            button("تأكيد", async () => {
              try { await api("/api/admin/stage-students?stage_id=" + scope.id, { action: "verify", user_id: student.id }); await loadStudents(after); }
              catch (error) { showNotice(error.message, true); }
            }, "primary"));
          if (student.verified) row.append(button("إلغاء التأكيد", async () => {
            try { await api("/api/admin/stage-students?stage_id=" + scope.id, { action: "unverify", user_id: student.id }); await loadStudents(after); }
            catch (error) { showNotice(error.message, true); }
          }));
          list.append(row);
        }
        target.replaceChildren(list);
        if (next) target.append(button("الصفحة التالية", () => loadStudents(next)));
        if (after) target.append(button("الصفحة الأولى", () => loadStudents()));
      });
  }

  if (data.can_assign) {
    for (const [action, label] of [["enroll", "ربط طالب"], ["unenroll", "إلغاء ارتباط طالب"]]) {
      students.head.append(button(label, () => {
        const email = element("input");
        email.type = "email"; email.dir = "ltr"; email.required = true; email.maxLength = 254;
        confirmAction(label, stageLabel(scope.stage), [field("بريد حساب الطالب المسجل", email)], async () => {
          await api("/api/admin/stage-students?stage_id=" + scope.id, { email: email.value, action });
          await loadStudents();
        });
      }));
    }
  }

  $("content").append(files.card, news.card, reports.card, students.card, invitePanel("stage", scope.id, "رابط دعوة المرحلة"));
  students.head.append(button("تأكيد كل الطلبة", () => confirmAction("تأكيد كل طلبة المرحلة", stageLabel(scope.stage), [], async () => {
    await api("/api/admin/stage-students?stage_id=" + scope.id, { action: "verify_all" });
    await loadStudents();
  }), "primary"));
  loadStudents();
  loadFiles();
  loadNews();
  loadReports();
}

function renderScope(data, reload) {
  const { scope, items } = data;
  const { type, id, university, college, department, stage } = scope;
  const stageOnly = type === "stage";
  const name = stageOnly ? stageLabel(stage) : scope[type];
  $("title").textContent = (stageOnly ? "لوحة ممثل " : "إدارة ") + name;
  $("description").textContent = stageOnly
    ? "ملفات ومحاضرات وإعلانات هذه المرحلة ضمن النطاق المصرّح به."
    : "تابع المراحل الدراسية وممثليها ضمن نطاق مسؤوليتك.";
  $("breadcrumb").textContent = ["الإدارة", university, college, department, stageOnly && stageLabel(stage)].filter(Boolean).join(" / ");
  $("role").textContent = me.admin ? (me.owner ? "مالك المنصة" : "مدير عام") : roles[type];
  $("scope-label").textContent = stageOnly ? "مرحلة واحدة" : name;
  const nav = [["نظرة عامة", workspaceLink(type, id)]];
  if (stageOnly) nav.push(["رفع ملف", "contribute.html"]);
  if (!stageOnly) {
    nav.push(["المراحل الدراسية", "#stage-list"], ["الفرق والتعيينات", "manage.html"],
      ["المحاضرات والملفات", "admin-tools.html#files"], ["البلاغات", "admin-tools.html#reports"]);
    if (type === "college" || type === "university") nav.push(["مركز الرفع", "upload-center.html"]);
  }
  nav.push(["روابط الدعوة", "invites.html"]);
  if (me.admin) nav.push(["الإدارة العامة", "admin.html"]);
  navigation(nav);
  const controls = [];
  const assignments = me.scopes?.filter(entry => entry.level === "rep" && Object.hasOwn(roles, entry.type)) || [];
  if (assignments.length > 1) {
    const select = element("select");
    select.setAttribute("aria-label", "تبديل نطاق الإدارة");
    for (const entry of assignments) {
      select.append(new Option(roles[entry.type] + " · " + number(entry.node_id), workspaceLink(entry.type, entry.node_id)));
    }
    select.value = workspaceLink(type, id);
    select.addEventListener("change", () => { location.href = select.value; });
    controls.push(select);
  }
  $("page-actions").replaceChildren(...controls);

  const banner = element("section", undefined, "scope-banner");
  banner.append(element("h2", stageOnly ? stageLabel(stage) + " — " + department : name),
    element("p", stageOnly ? "نطاق العمل الإداري لهذه المرحلة فقط." : "المراحل التي تقع ضمن " + name + "."));
  const summary = stats([
    ["المراحل الدراسية", items.length],
    ["الممثلون النشطون", items.filter(row => row.representative_active).length],
    ["الطلبة المرتبطون بالمراحل", items.reduce((sum, row) => sum + row.students, 0)],
    ["المواد الدراسية", items.reduce((sum, row) => sum + row.subjects, 0)]
  ]);
  const stages = panel("المراحل الدراسية وممثلوها");
  stages.card.id = "stage-list";
  if (!items.length) stages.card.append(empty("لا توجد مراحل دراسية مسجلة في هذا النطاق."));
  const cards = element("div", undefined, "stage-grid");
  for (const row of items) {
    const card = element("article", undefined, "card");
    card.append(element("h3", stageLabel(row.number)), element("p", row.department, "muted"));
    const badge = element("span", row.representative_active ? "ممثل معيّن" : row.representative_id ? "الممثل غير نشط" : "لم يُعيّن ممثل", "status");
    badge.dataset.state = row.representative_active ? "active" : "registered";
    card.append(badge);
    if (row.representative) card.append(element("p", row.representative));
    card.append(element("p", number(row.students || 0) + " طالب" + (row.unverified ? " · " + number(row.unverified) + " بانتظار التأكيد" : ""), "muted"));
    const actions = element("div", undefined, "actions");
    if (!stageOnly) actions.append(link("عرض المرحلة", workspaceLink("stage", row.id), "button"));
    if (data.can_assign) {
      actions.append(button(row.representative_id ? "استبدال الممثل" : "تعيين ممثل", () => assignmentForm(row, false, reload)));
      if (row.representative_id) actions.append(button("سحب التعيين", () => assignmentForm(row, true, reload)));
    }
    card.append(actions);
    cards.append(card);
  }
  stages.card.append(cards);
  const hierarchy = panel("التسلسل والصلاحيات");
  hierarchy.card.append(empty(stageOnly
    ? "تنحصر إدارة الملفات والإعلانات في المرحلة المعروضة."
    : "مسؤول القسم هو المرجع الإداري لقسمه. يبقى إشراف الكلية محصورًا في كليتها."));
  const grid = element("div", undefined, "panel-grid");
  grid.append(stages.card, hierarchy.card);
  $("content").replaceChildren(banner, summary, grid);
  if (type === "department") $("content").append(invitePanel("department", id, "رابط دعوة القسم"));
  if (stageOnly) stagePanels(data);
  $("content").hidden = false;
}

async function showScoped(type, id) {
  showNotice("جارٍ تحميل نطاق الإدارة…");
  $("content").hidden = true;
  try {
    const data = await api("/api/admin/workspace?type=" + encodeURIComponent(type) + "&id=" + id);
    renderScope(data, () => showScoped(type, id));
    showNotice();
  } catch (error) {
    showNotice(error.message, true);
    if (me.admin) $("notice").append(" ", link("العودة إلى الإدارة العامة", "admin.html"));
  }
}

function setupChrome() {
  const theme = $("theme");
  /* الوضع موحّد مع كل الصفحات (js/theme.js، المفتاح ms.theme) */
  function paint() {
    const dark = window.DSTheme ? DSTheme.get() === "dark" : document.documentElement.dataset.theme === "dark";
    theme.setAttribute("aria-pressed", String(dark));
    theme.textContent = dark ? "الوضع الفاتح" : "الوضع الداكن";
  }
  paint();
  if (typeof document.addEventListener === "function") document.addEventListener("ds:theme", paint);
  theme.addEventListener("click", () => { if (window.DSTheme) DSTheme.toggle(); paint(); });
  $("nav-toggle").addEventListener("click", () => {
    const open = document.querySelector(".sidebar").toggleAttribute("data-menu-open");
    $("nav-toggle").setAttribute("aria-expanded", String(open));
  });
}

async function boot() {
  setupChrome();
  try {
    me = (await api("/api/auth/me")).user;
    $("account").textContent = me.name;
    $("account").hidden = $("sidebar-account").hidden = false;
    const params = new URLSearchParams(location.search);
    const type = params.get("type"), id = Number(params.get("id"));
    if (Object.hasOwn(roles, type) && Number.isSafeInteger(id) && id > 0) {
      await showScoped(type, id);
    } else if (me.admin) showGlobal();
    else {
      const first = me.scopes?.find(entry => entry.level === "rep" && Object.hasOwn(roles, entry.type));
      if (first) await showScoped(first.type, first.node_id);
      else showNotice("لا توجد صلاحية إدارة لهذا الحساب.", true);
    }
  } catch (error) {
    showNotice(error.message, true);
    $("notice").append(" ", error.code === "unauthorized"
      ? link("تسجيل الدخول", "login.html?next=admin.html")
      : button("إعادة المحاولة", () => location.reload()));
  }
}

boot();
