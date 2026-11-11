(function () {
  "use strict";
  var $ = function (id) { return document.getElementById(id); };
  var active = null, rooms = [], messages = new Map(), more = false, loading = false;
  var replyTo = null, editing = null, me = null, polling = false, attach = null;
  var ATT = "[[att]]";
  var pollTimer = null, pollDelay = 15000, roomsUpdatedAt = 0;
  var removedCount = null, historyEpoch = 0, roomSignature, requestSignature;
  var stamp = new Intl.DateTimeFormat("ar-IQ", { hour: "2-digit", minute: "2-digit" });

  var mobile = matchMedia("(max-width: 850px)");
  var viewport = window.visualViewport;
  if (viewport) {
    function sizeToViewport() {
      if (viewport.scale === 1) $("chatLayout").style.setProperty("--chat-viewport", Math.floor(viewport.height) + "px");
    }
    viewport.addEventListener("resize", sizeToViewport);
    sizeToViewport();
  }

  function status(text) { $("status").textContent = text || ""; }
  function node(tag, className, content) {
    var e = document.createElement(tag);
    if (className) e.className = className;
    if (content !== undefined) e.textContent = String(content);
    return e;
  }
  async function api(path, body) {
    var o = body === undefined ? {} : { method: "POST", headers: { "content-type": "application/json" }, body: JSON.stringify(body) };
    var res = await fetch("/api/group-chat/" + path, o);
    var data = await res.json().catch(function () { return {}; });
    if (!res.ok || !data.ok) throw Error(data.error || "network_error");
    return data;
  }
  function errorText(err) {
    var errors = { unauthorized: "يرجى تسجيل الدخول بحسابك أولاً.", forbidden: "ليس لديك صلاحية لهذه العملية أو لا تنتمي لهذه المجموعة.",
      invalid_invite: "رمز الدعوة غير صحيح أو تغيّر.", conflict: "اسم المجموعة مستخدم لهذه المرحلة بالفعل.", slow_down: "أرسل الرسائل بوتيرة أبطأ قليلاً.",
      database_quota_exceeded: "بلغت الخدمة حد الاستخدام اليومي. حاول لاحقًا.", service_unavailable: "خدمة الدردشة غير متاحة مؤقتًا.", server: "تعذّر تحميل الدردشة حاليًا. أعد المحاولة بعد قليل.",
      feature_disabled: "لم تُفعّل إدارة المنصة الدردشة بعد.", not_configured: "خدمة الدردشة غير مهيأة.", bad_request: "تحقق من البيانات المدخلة.", network_error: "تعذر الاتصال بالخادم." };
    return errors[err && err.message] || "تعذرت العملية. حاول مرة أخرى.";
  }
  function chosenRoom() { return rooms.find(function (r) { return r.id === active; }) || null; }
  function isModerator(r) {
    return !!(me && (me.admin || (me.scopes || []).some(function (s) {
      return s.level === "rep" && s.node_id === ({ stage: r.stage_id, department: r.department_id, college: r.college_id, university: r.university_id })[s.type];
    })));
  }
  function renderRooms() {
    var root = $("roomList"); root.textContent = "";
    $("roomCount").textContent = rooms.length;
    if (!rooms.length) root.appendChild(node("p", "muted", "لا توجد مجموعة بعد. اختر قسمك ومرحلتك في ملفك الشخصي لتنضم تلقائياً."));
    rooms.forEach(function (r) {
      var b = node("button", "room" + (r.id === active ? " is-active" : "")); b.type = "button"; b.dataset.roomId = r.id;
      var avatar = node("span", "room-avatar", "✦");
      var info = node("span", "room-info"); info.appendChild(node("strong", null, r.name));
      info.appendChild(node("small", null, r.department + " · المرحلة " + r.stage));
      b.appendChild(avatar); b.appendChild(info);
      if (r.unread) b.appendChild(node("span", "unread", Math.min(99, r.unread) + (r.unread > 99 ? "+" : "")));
      b.onclick = function () { openRoom(r.id); };
      root.appendChild(b);
    });
  }
  async function refreshRooms() {
    var d = await api("rooms");
    roomsUpdatedAt = Date.now();
    var next = d.items || [];
    var nextSignature = JSON.stringify(next);
    if (nextSignature !== roomSignature) {
      roomSignature = nextSignature;
      rooms = next;
      renderRooms();
    }
    var requests = d.requests || [], nextRequests = JSON.stringify(requests);
    if (nextRequests !== requestSignature) {
      requestSignature = nextRequests;
      var labels = { pending: "بانتظار الموافقة", rejected: "رُفض الطلب", revoked: "سُحبت العضوية" };
      $("requestList").replaceChildren(...requests.map(function (r) {
        return node("li", null, r.name + " — " + labels[r.status]);
      }));
      $("requestList").hidden = !requests.length;
      if (!requests.some(function (r) { return r.status === "pending"; })) $("joinStatus").textContent = "";
    }
    if (active && !rooms.some(function (r) { return r.id === active; })) resetThread();
  }
  function resetThread() {
    delete $("chatLayout").dataset.view;
    active = null; messages.clear(); more = false; replyTo = null; editing = null;
    removedCount = null; historyEpoch++;
    $("activeTitle").textContent = "اختر مجموعتك";
    $("activeSubtitle").textContent = "ستظهر هنا رسائل مجموعتك الدراسية";
    $("conversation").textContent = "";
    $("conversation").appendChild(node("div", "empty-thread", "اختر مجموعة من القائمة لعرض الرسائل."));
    $("sendForm").hidden = true; $("olderBtn").hidden = true; $("pinnedBar").hidden = true;
    $("muteBtn").hidden = true; $("manageLink").hidden = true; $("replyBar").hidden = true;
    renderRooms();
  }
  /* المرفق في السطر الأول "[[att]]{json}" (يتحقق منه الخادم) */
  function parseAtt(body) {
    var t = String(body || ""), att = null;
    if (t.indexOf(ATT) === 0) {
      var nl = t.indexOf("\n"), line = nl < 0 ? t.slice(ATT.length) : t.slice(ATT.length, nl);
      try { att = JSON.parse(line); } catch (_) { att = null; }
      t = nl < 0 ? "" : t.slice(nl + 1);
    }
    return { att: att, text: t };
  }
  function plain(body) { var p = parseAtt(body); return p.text || (p.att ? "📎 " + p.att.title : ""); }
  function hue(id) { return 1 + (Math.abs(Number(id) || 0) % 6); }
  function avatarFor(m) {
    var a = node("span", "m-av hue-" + hue(m.sender_id), (String(m.sender || "?").trim().charAt(0) || "?").toUpperCase());
    a.setAttribute("aria-hidden", "true");
    if (m.av) {
      var im = document.createElement("img"); im.alt = ""; im.decoding = "async";
      im.src = "/api/avatar/" + m.sender_id + "?v=" + m.av;
      im.onload = function () { a.textContent = ""; a.appendChild(im); a.classList.add("has-img"); };
    }
    return a;
  }
  function attCard(att) {
    var a = node("a", "att-card"); a.href = att.href;
    a.appendChild(node("span", "att-ico", att.type === "announcement" ? "📣" : "📄"));
    var t = node("span", "att-txt"); t.appendChild(node("strong", null, att.title)); if (att.sub) t.appendChild(node("small", null, att.sub));
    a.appendChild(t); return a;
  }
  function actionsFor(msg, r) {
    var actionRow = node("span", "msg-actions");
    function action(label, callback) { var a = node("button", null, label); a.type = "button"; a.onclick = function (e) { e.stopPropagation(); callback(); }; actionRow.appendChild(a); }
    if (msg.deleted_at) return actionRow;
    action("رد", function () { replyTo = msg; editing = null; composeBar(); $("messageInput").focus(); });
    var canEdit = msg.sender_id === me.id && Date.now() - msg.created_at < 15 * 60 * 1000;
    if (canEdit && !parseAtt(msg.body).att) action("تعديل", function () { editing = msg; replyTo = null; $("messageInput").value = msg.body; composeBar(); $("messageInput").focus(); });
    if (canEdit || isModerator(r)) action("حذف للجميع", function () { if (confirm("حذف هذه الرسالة من عند الجميع؟")) mutate("delete", { message_id: msg.id }); });
    if (isModerator(r)) action(msg.pinned_at ? "إلغاء التثبيت" : "تثبيت", function () { mutate("pin", { message_id: msg.id, pinned: !msg.pinned_at }); });
    if (msg.sender_id !== me.id) {
      action("رسالة خاصة", function () { location.href = "dm.html?u=" + msg.sender_id; });
      action("إبلاغ", function () {
        var reason = prompt("ما سبب الإبلاغ عن هذه الرسالة؟");
        if (reason) mutate("report", { message_id: msg.id, reason: reason });
      });
    }
    return actionRow;
  }
  function dayKey(t) { return new Date(t).toDateString(); }
  function drawMessages(keepPosition) {
    var root = $("conversation"), oldHeight = root.scrollHeight, oldTop = root.scrollTop;
    var nearBottom = root.scrollHeight - root.scrollTop - root.clientHeight < 90;
    root.textContent = "";
    var r = chosenRoom();
    /* الحذف للجميع بلا أثر: الرسالة المحذوفة لا تُرسم أصلاً */
    var sorted = Array.from(messages.values()).filter(function (m) { return !m.deleted_at; }).sort(function (a, b) { return a.id - b.id; });
    if (!sorted.length) root.appendChild(node("div", "empty-thread", "ابدأ المحادثة مع زملائك في مجموعتك."));
    var prev = null;
    sorted.forEach(function (m) {
      if (!prev || dayKey(prev.created_at) !== dayKey(m.created_at)) {
        root.appendChild(node("div", "day-sep", new Date(m.created_at).toLocaleDateString("ar-IQ", { weekday: "long", day: "numeric", month: "long" })));
        prev = null;
      }
      var mine = m.sender_id === me.id;
      var cont = !!prev && prev.sender_id === m.sender_id && m.created_at - prev.created_at < 300000;
      var item = node("article", "message" + (mine ? " mine" : "") + (cont ? " cont" : ""));
      if (!mine) item.appendChild(avatarFor(m));
      var bubble = node("div", "bubble");
      if (!mine && !cont) bubble.appendChild(node("div", "msg-label hue-" + hue(m.sender_id), m.sender));
      if (m.reply_to) bubble.appendChild(node("span", "msg-reply", (m.reply_sender || "عضو") + ": " + (m.reply_body ? plain(m.reply_body).slice(0, 120) : "رسالة محذوفة")));
      var parsed = parseAtt(m.body);
      if (parsed.att) bubble.appendChild(attCard(parsed.att));
      if (parsed.text) { var tx = node("span", "msg-text", parsed.text); tx.dir = "auto"; bubble.appendChild(tx); }
      bubble.appendChild(node("span", "msg-time", stamp.format(new Date(m.created_at)) + (m.edited_at ? " · معدلة" : "") + (m.pinned_at ? " · 📌" : "")));
      bubble.appendChild(actionsFor(m, r));
      bubble.addEventListener("click", function (e) { if (e.target.closest("a,button")) return; bubble.classList.toggle("show-actions"); });
      item.appendChild(bubble);
      root.appendChild(item);
      prev = m;
    });
    var pinned = sorted.filter(function (m) { return m.pinned_at; });
    $("pinnedBar").hidden = !pinned.length;
    $("pinnedBar").textContent = pinned.length ? "📌 " + pinned.map(function (m) { return plain(m.body).slice(0, 80); }).join(" · ") : "";
    $("olderBtn").hidden = !more;
    if (keepPosition === "older") root.scrollTop = root.scrollHeight - oldHeight + oldTop;
    else if (!keepPosition || nearBottom) root.scrollTop = root.scrollHeight;
  }
  function composeBar() {
    $("replyBar").hidden = !replyTo && !editing;
    $("replyText").textContent = editing ? "تعديل الرسالة" : replyTo ? "الرد على " + replyTo.sender + ": " + plain(replyTo.body).slice(0, 90) : "";
    $("attachBar").hidden = !attach;
    $("attachText").textContent = attach ? "📎 " + attach.title : "";
    $("sendBtn").firstChild.textContent = editing ? "حفظ " : "إرسال ";
  }
  async function markRead() {
    if (!active || !messages.size || document.hidden) return;
    var last = Math.max.apply(null, Array.from(messages.keys()));
    try { await api("read", { room_id: active, last_read_id: last }); } catch (_) { /* لا تُعطل القراءة */ }
  }
  async function openRoom(id) {
    if (active === id) return;
    var r = rooms.find(function (x) { return x.id === id; }); if (!r) return;
    $("chatLayout").dataset.view = "thread";
    active = id; messages.clear(); more = false; replyTo = null; editing = null;
    removedCount = null; historyEpoch++;
    status("");
    $("messageInput").value = ""; composeBar();
    $("activeTitle").textContent = r.name;
    $("activeSubtitle").textContent = r.university + " / " + r.college + " / " + r.department + " / المرحلة " + r.stage;
    $("sendForm").hidden = false;
    $("muteBtn").hidden = false; $("muteBtn").textContent = r.muted ? "إلغاء الكتم" : "كتم";
    $("manageLink").hidden = !isModerator(r);
    $("manageLink").href = "group-chat-admin.html?" + new URLSearchParams({ stage_id: r.stage_id, room: r.id });
    if (mobile.matches) {
      window.scrollTo(0, 0);
      $("activeTitle").focus({ preventScroll: true });
    }
    $("conversation").textContent = "";
    $("conversation").appendChild(node("p", "muted", "جارٍ تحميل المحادثة..."));
    renderRooms();
    var epoch = historyEpoch;
    try {
      var d = await api("messages?room_id=" + id);
      if (active !== id || epoch !== historyEpoch) return;
      removedCount = d.removed_count;
      (d.items || []).forEach(function (m) { messages.set(m.id, m); });
      more = !!d.has_more; drawMessages(); await markRead(); await refreshRooms();
    } catch (e) { if (active === id) status(errorText(e)); }
  }
  async function loadOlder() {
    if (!active || loading || !more || !messages.size) return;
    var roomId = active, epoch = historyEpoch;
    loading = true; $("olderBtn").disabled = true;
    try {
      var before = Math.min.apply(null, Array.from(messages.keys()));
      var d = await api("messages?room_id=" + roomId + "&before=" + before);
      if (active !== roomId || epoch !== historyEpoch) return;
      (d.items || []).forEach(function (m) { messages.set(m.id, m); });
      more = !!d.has_more; drawMessages("older");
    } catch (e) { status(errorText(e)); }
    finally { loading = false; $("olderBtn").disabled = false; }
  }
  function schedulePoll() {
    clearTimeout(pollTimer);
    if (me && !document.hidden) pollTimer = setTimeout(poll, pollDelay);
  }
  async function poll() {
    if (polling || document.hidden || !me) return;
    clearTimeout(pollTimer);
    polling = true;
    var roomId = active, epoch = historyEpoch;
    try {
      if (roomId) {
        var d = await api("messages?room_id=" + roomId);
        if (roomId === active && epoch === historyEpoch) {
          var changed = removedCount !== null && removedCount !== d.removed_count;
          removedCount = d.removed_count;
          if (changed) {
            // Older cached pages may include a message removed by moderation.
            historyEpoch++;
            messages.clear();
            more = !!d.has_more;
          }
          (d.items || []).forEach(function (m) {
            if (JSON.stringify(messages.get(m.id)) !== JSON.stringify(m)) { messages.set(m.id, m); changed = true; }
          });
          if (changed) { drawMessages(true); await markRead(); }
        }
      }
      if (Date.now() - roomsUpdatedAt >= 30000) await refreshRooms();
      pollDelay = 15000;
    } catch (err) {
      pollDelay = Math.min(60000, pollDelay * 2);
      status(errorText(err));
      if (["unauthorized", "feature_disabled"].includes(err.message)) me = null;
      if (roomId && roomId === active && ["forbidden", "unauthorized", "feature_disabled"].includes(err.message)) {
        rooms = rooms.filter(function (r) { return r.id !== roomId; });
        roomSignature = JSON.stringify(rooms);
        resetThread();
        $("joinStatus").textContent = errorText(err);
      }
    } finally { polling = false; schedulePoll(); }
  }
  async function mutate(op, data) {
    var roomId = active;
    if (!roomId) return;
    try {
      var d = await api(op, Object.assign({ room_id: roomId }, data));
      if (active !== roomId) return;
      if (d.item) { messages.set(d.item.id, d.item); drawMessages(true); }
      await poll(); status(op === "report" ? "أُرسل البلاغ للمراجعة." : "");
    } catch (e) { status(errorText(e)); }
  }
  $("sendForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var value = $("messageInput").value.trim(); if (!active || (!value && !attach)) return;
    var roomId = active;
    $("sendBtn").disabled = true; status("");
    try {
      var d;
      if (editing) d = await api("edit", { room_id: roomId, message_id: editing.id, body: value });
      else d = await api("send", { room_id: roomId, body: value, client_id: crypto.randomUUID(), reply_to: replyTo ? replyTo.id : null, attach: attach || undefined });
      if (active === roomId) {
        messages.set(d.item.id, d.item); $("messageInput").value = "";
        replyTo = null; editing = null; attach = null; composeBar(); drawMessages(); await markRead(); await refreshRooms();
      }
    } catch (err) { status(errorText(err)); }
    finally { $("sendBtn").disabled = false; }
  });
  /* ---- إرفاق: ملفات القسم والتبليغات ---- */
  var deptCache = {};
  function sheetRow(icon, title, sub, pick) {
    var b = node("button", "sheet-row"); b.type = "button";
    b.appendChild(node("span", "att-ico", icon));
    var t = node("span", "att-txt"); t.appendChild(node("strong", null, title)); if (sub) t.appendChild(node("small", null, sub));
    b.appendChild(t); b.onclick = function () { pick(); closeSheet(); }; return b;
  }
  function closeSheet() { $("attachSheet").hidden = true; }
  async function filesOf(r) {
    if (deptCache[r.department_id]) return deptCache[r.department_id];
    var res = await fetch("/api/platform?dept=" + r.department_id); var d = await res.json();
    var out = [];
    (d.courses || []).forEach(function (c) {
      if (r.stage && Math.floor(Number(c.semester) / 10) !== Number(r.stage)) return;
      (c.lectures || []).forEach(function (l) {
        if (!(l.files || []).length) return;
        out.push({ type: "file", title: (l.title || ("المحاضرة " + l.number)).slice(0, 120), sub: (c.name || "").slice(0, 160), href: "course.html?id=" + c.id + "&dept=" + r.department_id + "#lec-" + l.number });
      });
    });
    return (deptCache[r.department_id] = out);
  }
  async function openSheet(tab) {
    var r = chosenRoom(); if (!r) return;
    $("attachSheet").hidden = false;
    var list = $("sheetList"); list.textContent = "";
    [].forEach.call(document.querySelectorAll("[data-tab]"), function (b) { b.setAttribute("aria-pressed", String(b.dataset.tab === tab)); });
    list.appendChild(node("p", "muted", "جارٍ التحميل..."));
    try {
      if (tab === "files") {
        var files = await filesOf(r), q = node("input", "sheet-search"); q.type = "search"; q.placeholder = "ابحث في ملفات القسم";
        var box = node("div");
        function draw() {
          box.textContent = ""; var k = q.value.trim();
          var hit = files.filter(function (f) { return !k || (f.title + " " + f.sub).indexOf(k) >= 0; }).slice(0, 80);
          if (!hit.length) box.appendChild(node("p", "muted", "لا توجد ملفات."));
          hit.forEach(function (f) { box.appendChild(sheetRow("📄", f.title, f.sub, function () { attach = f; composeBar(); })); });
        }
        q.oninput = draw; list.textContent = ""; list.appendChild(q); list.appendChild(box); draw();
      } else {
        var res = await fetch("/api/stage-announcements"); var d = await res.json();
        list.textContent = "";
        if (!(d.items || []).length) list.appendChild(node("p", "muted", "لا توجد تبليغات."));
        (d.items || []).slice(0, 30).forEach(function (a) {
          list.appendChild(sheetRow("📣", a.title, String(a.body || "").slice(0, 100), function () {
            attach = { type: "announcement", title: String(a.title).slice(0, 120), sub: String(a.body || "").slice(0, 160), href: "platform.html?dept=" + r.department_id + "&stage=" + r.stage + "#announcements" }; composeBar();
          }));
        });
      }
    } catch (_) { list.textContent = ""; list.appendChild(node("p", "muted", "تعذّر التحميل.")); }
  }
  $("attachBtn").onclick = function () { openSheet("files"); };
  [].forEach.call(document.querySelectorAll("[data-tab]"), function (b) { b.onclick = function () { openSheet(b.dataset.tab); }; });
  $("sheetClose").onclick = closeSheet;
  $("attachSheet").addEventListener("click", function (e) { if (e.target === $("attachSheet")) closeSheet(); });
  $("cancelAttach").onclick = function () { attach = null; composeBar(); };
  $("cancelReply").onclick = function () { editing = null; replyTo = null; $("messageInput").value = ""; composeBar(); };
  $("olderBtn").onclick = loadOlder;
  $("backToRooms").onclick = function () {
    var roomId = active;
    resetThread();
    status("");
    $("roomList").querySelector("[data-room-id='" + roomId + "']")?.focus();
  };
  $("joinForm").addEventListener("submit", async function (e) {
    e.preventDefault();
    var button = e.currentTarget.querySelector("button");
    button.disabled = true;
    try {
      var d = await api("join", { invite_code: $("joinCode").value });
      $("joinCode").value = "";
      $("joinPanel").open = false;
      $("joinStatus").textContent = d.status === "pending" ? "أُرسل الطلب إلى ممثل المرحلة للمراجعة." : "";
      await refreshRooms();
      if (d.status === "member") await openRoom(d.id);
    } catch (err) { $("joinStatus").textContent = errorText(err); }
    finally { button.disabled = false; }
  });
  $("muteBtn").onclick = async function () {
    var r = chosenRoom(); if (!r) return;
    try { await api("mute", { room_id: r.id, muted: !r.muted }); await refreshRooms();
      var n = chosenRoom(); if (n) $("muteBtn").textContent = n.muted ? "إلغاء الكتم" : "كتم"; }
    catch (err) { status(errorText(err)); }
  };
  $("messageInput").addEventListener("keydown", function (e) {
    if (e.key === "Enter" && !e.shiftKey && !e.isComposing) { e.preventDefault(); if (this.value.trim()) $("sendForm").requestSubmit(); }
  });
  document.addEventListener("visibilitychange", function () {
    clearTimeout(pollTimer);
    if (!document.hidden) poll();
  });
  async function init() {
    clearTimeout(pollTimer);
    $("authBanner").hidden = true;
    try {
      var res = await fetch("/api/auth/me"); var data = await res.json();
      if (!res.ok || !data.ok || !data.user) throw Error(data.error || (res.status === 401 ? "unauthorized" : "server"));
      me = data.user;
      await refreshRooms();
      var requestedRoom = Number(new URLSearchParams(location.search).get("room"));
      var first = requestedRoom || (!mobile.matches && rooms[0] && rooms[0].id);
      if (requestedRoom && !rooms.some(function (r) { return r.id === requestedRoom; })) {
        $("joinStatus").textContent = "هذه المجموعة تظهر للأعضاء المقبولين.";
      } else if (first) await openRoom(first);
      pollDelay = 15000;
      schedulePoll();
    } catch (err) {
      $("roomList").textContent = "";
      $("authBanner").hidden = false;
      $("authBanner").textContent = errorText(err) + " ";
      if (err.message === "unauthorized") {
        var a = node("a", null, "تسجيل الدخول"); a.href = "login.html?next=group-chat.html";
        $("authBanner").appendChild(a);
      }
      $("joinPanel").hidden = true;
      var retry = node("button", null, "إعادة المحاولة"); retry.type = "button";
      retry.onclick = init; $("authBanner").appendChild(retry);
      status(errorText(err));
    }
  }
  init();
})();
