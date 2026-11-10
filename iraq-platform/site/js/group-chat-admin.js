(function () {
  "use strict";
  const $ = id => document.getElementById(id);
  const params = new URLSearchParams(location.search);
  const stageId = params.get("stage_id");
  const tabs = Array.from(document.querySelectorAll("[data-kind]"));
  let kind = "requests", cursor = null, requestVersion = 0;

  function element(tag, text) {
    const node = document.createElement(tag);
    node.textContent = text;
    return node;
  }
  function status(text) {
    $("manageStatus").textContent = text;
    $("manageStatus").hidden = !text;
  }
  function showError(error) {
    const errors = {
      unauthorized: "سجّل الدخول إلى المنصة أولاً.",
      forbidden: "ليس لديك صلاحية إدارة هذه المرحلة أو المجموعة.",
      not_found: "المرحلة غير موجودة.",
      conflict: "اسم المجموعة مستخدم في هذه المرحلة.",
      request_unavailable: "تغيّرت حالة الطلب أو العضوية أو البلاغ. حدّث القائمة.",
      feature_disabled: "لم تُفعّل إدارة المنصة الدردشة بعد."
    };
    status(errors[error.message] || "تعذرت العملية. حاول مرة أخرى.");
  }
  async function api(path, body) {
    const options = body && { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    const response = await fetch("/api/group-chat/" + path, options);
    const data = await response.json();
    if (!response.ok || !data.ok) throw new Error(data.error);
    return data;
  }
  const group = () => $("managedGroup").value;
  function managementButton(label, action, id, confirmation) {
    const button = element("button", label);
    button.className = "ghost";
    button.type = "button";
    const roomId = group();
    button.onclick = async () => {
      if (confirmation && !confirm(confirmation)) return;
      button.disabled = true;
      try {
        await api("manage", { room_id: roomId, action, id });
        if (group() === roomId) await loadList();
        status("تم حفظ الإجراء.");
      } catch (error) {
        if (error.message === "request_unavailable" && group() === roomId) await loadList();
        showError(error);
      } finally {
        button.disabled = false;
      }
    };
    return button;
  }
  function addRow(item) {
    const row = document.createElement("li");
    const actions = document.createElement("div");
    actions.className = "management-actions";
    if (kind === "reports") {
      row.append(element("strong", "رسالة من " + item.sender));
      row.append(element("p", item.deleted_at ? "الرسالة محذوفة." : item.body));
      row.append(element("p", "سبب البلاغ: " + item.reason));
      actions.append(managementButton("إغلاق البلاغ", "dismiss", item.id));
      if (!item.deleted_at) actions.append(managementButton("حذف الرسالة", "remove", item.id, "حذف الرسالة وإغلاق البلاغ؟"));
    } else {
      row.append(element("strong", item.name), element("small", item.email));
      if (kind === "requests") {
        if (item.eligible) actions.append(managementButton("موافقة", "approve", item.id));
        else row.append(element("p", "الحساب معطّل أو مرحلته الحالية مختلفة."));
        actions.append(managementButton("رفض", "reject", item.id));
      } else {
        actions.append(managementButton("سحب العضوية", "revoke", item.id, "سحب عضوية هذا الحساب من المجموعة؟"));
      }
    }
    row.append(actions);
    $("manageList").append(row);
  }
  async function loadList(append = false) {
    const version = ++requestVersion;
    const roomId = group();
    if (!roomId) return;
    $("openManagedGroup").href = "group-chat.html?room=" + roomId;
    $("moreItems").hidden = true;
    if (!append) $("manageList").replaceChildren(element("li", "جارٍ التحميل…"));
    try {
      const data = await api("manage?" + new URLSearchParams({
        room_id: roomId, kind, ...(append && cursor ? { after: cursor } : {})
      }));
      if (version !== requestVersion) return;
      if (!append) $("manageList").replaceChildren();
      data.items.forEach(addRow);
      if (!append && !data.items.length) $("manageList").append(element("li", "لا توجد عناصر في هذه القائمة."));
      cursor = data.next;
      $("moreItems").hidden = !cursor;
    } catch (error) {
      if (version !== requestVersion) return;
      if (!append) $("manageList").replaceChildren();
      $("moreItems").hidden = !append || !cursor;
      showError(error);
    }
  }
  function hideInvite() {
    $("inviteValue").textContent = "";
    $("inviteNotice").hidden = true;
  }
  function showInvite(code) {
    $("inviteValue").textContent = code;
    $("inviteNotice").hidden = false;
  }
  $("managedGroup").onchange = () => { hideInvite(); status(""); loadList(); };
  $("moreItems").onclick = () => loadList(true);
  $("refreshItems").onclick = () => { status(""); loadList(); };
  for (const tab of tabs) tab.onclick = () => {
    kind = tab.dataset.kind;
    tabs.forEach(other => other.setAttribute("aria-pressed", String(other === tab)));
    status("");
    loadList();
  };
  $("createGroup").onsubmit = async event => {
    event.preventDefault();
    const button = event.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      const name = $("groupName").value.trim();
      const data = await api("create", { stage_id: stageId, name });
      $("groupName").value = "";
      $("managedGroup").prepend(new Option(name, data.id, true, true));
      $("managedGroup").value = String(data.id);
      $("groupControls").hidden = false;
      $("noGroups").hidden = true;
      showInvite(data.invite_code);
      await loadList();
      status("أُنشئت المجموعة.");
    } catch (error) { showError(error); }
    finally { button.disabled = false; }
  };
  $("rotateInvite").onclick = async () => {
    const roomId = group();
    if (!confirm("سيصبح رمز الدعوة السابق غير صالح. هل تريد المتابعة؟")) return;
    $("rotateInvite").disabled = true;
    try {
      const data = await api("manage", { room_id: roomId, action: "rotate-code" });
      if (group() === roomId) showInvite(data.invite_code);
    } catch (error) { showError(error); }
    finally { $("rotateInvite").disabled = false; }
  };
  $("copyInvite").onclick = async () => {
    try {
      await navigator.clipboard.writeText($("inviteValue").textContent);
      status("نُسخ رمز الدعوة.");
    } catch (_) { status("حدد الرمز وانسخه يدوياً."); }
  };
  (async () => {
    if (!stageId) return status("افتح إدارة الدردشة من لوحة المرحلة.");
    $("stageBack").href = "admin.html?" + new URLSearchParams({ type: "stage", id: stageId });
    try {
      const data = await api("manage?" + new URLSearchParams({ stage_id: stageId }));
      const { stage, items } = data;
      $("stageName").textContent = stage.college + " / " + stage.department + " / المرحلة " + stage.number;
      $("managedGroup").replaceChildren(...items.map(item => new Option(item.name, item.id)));
      const requestedRoom = params.get("room");
      if (items.some(item => String(item.id) === requestedRoom)) $("managedGroup").value = requestedRoom;
      $("noGroups").hidden = !!items.length;
      $("groupControls").hidden = !items.length;
      $("manageContent").hidden = false;
      if (items.length) await loadList();
    } catch (error) { showError(error); }
  })();
})();
