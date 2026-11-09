/* js/auth.js — حساب الطالب ومزامنة المفضلة والتقدم بين الأجهزة (Cloudflare D1 عبر /api).
   بلا حساب يبقى كل شيء محلياً كما كان. مع الحساب: تُحفظ نسخة على الخادم وتُدمج عند الدخول. */
(function () {
  "use strict";
  var SYNC = ["ms.fav", "ms.read", "ms.last", "ms.exam", "ms.review", "ms.study"];
  var TKEY = "ms.sync.t"; // وقت آخر تعديل محلي لكل مفتاح
  var MS = window.MS || null;
  var user = null;
  var timer = null;

  function lsGet(k) { try { return localStorage.getItem(k); } catch (e) { return null; } }
  function lsSet(k, v) { try { localStorage.setItem(k, v); } catch (e) { /* لا شيء */ } }
  function lsDel(k) { try { localStorage.removeItem(k); } catch (e) { /* لا شيء */ } }
  function tmap() { try { return JSON.parse(lsGet(TKEY)) || {}; } catch (e) { return {}; } }
  function localVal(k) { var s = lsGet(k); if (s === null) return undefined; try { return JSON.parse(s); } catch (e) { return undefined; } }

  function api(method, path, body) {
    var opts = { method: method, credentials: "same-origin", headers: {} };
    if (body !== undefined) { opts.body = JSON.stringify(body); opts.headers["content-type"] = "application/json"; }
    return fetch("api/" + path, opts).then(function (res) {
      return res.json().catch(function () { return {}; }).then(function (data) { return { status: res.status, data: data }; });
    }, function () { return { status: 0, data: { error: "network" } }; });
  }

  /* ---------- مزامنة ---------- */
  function applyLocal(k, v, t) {
    window.__msApplying = true; // حتى لا يُعاد رفع ما نزل للتو
    try { if (MS && MS.save) MS.save(k, v); else lsSet(k, JSON.stringify(v)); } finally { window.__msApplying = false; }
    var m = tmap(); m[k] = t; lsSet(TKEY, JSON.stringify(m));
  }

  function union(a, b) {
    if (Array.isArray(a) && Array.isArray(b)) { return a.concat(b.filter(function (x) { return a.indexOf(x) === -1; })); }
    if (a && b && typeof a === "object" && typeof b === "object" && !Array.isArray(a) && !Array.isArray(b)) {
      var out = {};
      Object.keys(a).forEach(function (k) { out[k] = a[k]; });
      Object.keys(b).forEach(function (k) { out[k] = k in out ? union(out[k], b[k]) : b[k]; });
      return out;
    }
    return b; // قيمة مفردة: نفضّل ما في الحساب
  }

  function push(items) {
    return api("PUT", "sync", { items: items });
  }

  function flush() {
    clearTimeout(timer); timer = null;
    if (!user) return Promise.resolve();
    var m = tmap(), items = {};
    SYNC.forEach(function (k) {
      var v = localVal(k);
      if (v !== undefined && m[k] && m[k] > (m.__pushed && m.__pushed[k] || 0)) items[k] = { v: v, t: m[k] };
    });
    if (!Object.keys(items).length) return Promise.resolve();
    return push(items).then(function (r) {
      if (r.status === 200) {
        var mm = tmap(); mm.__pushed = mm.__pushed || {};
        Object.keys(items).forEach(function (k) { mm.__pushed[k] = items[k].t; });
        lsSet(TKEY, JSON.stringify(mm));
      }
    });
  }

  function onSave(k) {
    if (window.__msApplying || !user || SYNC.indexOf(k) === -1) return;
    var m = tmap(); m[k] = Date.now(); lsSet(TKEY, JSON.stringify(m));
    clearTimeout(timer);
    timer = setTimeout(flush, 1500);
  }
  if (MS) MS.onSave = onSave;

  function pull() {
    return api("GET", "sync").then(function (r) {
      if (r.status !== 200 || !r.data.data) return false;
      var server = r.data.data, m = tmap(), changed = false, up = {};
      SYNC.forEach(function (k) {
        var s = server[k], lv = localVal(k), lt = m[k] || 0;
        if (!s && lv === undefined) return;
        if (!s) { var t0 = lt || Date.now(); up[k] = { v: lv, t: t0 }; return; }
        if (lv === undefined) { applyLocal(k, s.v, s.t); changed = true; return; }
        if (!lt) { // أول مزامنة لهذا الجهاز: ندمج ولا نضيّع شيئاً
          var merged = union(s.v, lv);
          var now = Date.now();
          if (JSON.stringify(merged) !== JSON.stringify(lv)) changed = true;
          applyLocal(k, merged, now);
          up[k] = { v: merged, t: now };
        } else if (s.t > lt) { applyLocal(k, s.v, s.t); changed = true; }
        else if (lt > s.t) { up[k] = { v: lv, t: lt }; }
      });
      var p = Object.keys(up).length ? push(up).then(function (res) {
        if (res.status === 200) {
          var mm = tmap(); mm.__pushed = mm.__pushed || {};
          Object.keys(up).forEach(function (k) { mm.__pushed[k] = up[k].t; if (!mm[k]) mm[k] = up[k].t; });
          lsSet(TKEY, JSON.stringify(mm));
        }
      }) : Promise.resolve();
      return p.then(function () { return changed; });
    });
  }

  /* ---------- الرأس ---------- */
  function paintHeader() {
    var box = document.querySelector(".header-actions");
    if (!box || document.getElementById("accountBtn")) return;
    var a = document.createElement("a");
    a.id = "accountBtn";
    a.className = "btn btn-secondary btn-sm";
    a.href = "login.html?next=" + encodeURIComponent(location.pathname.split("/").pop() + location.search);
    a.textContent = user ? (user.name.split(" ")[0] || "حسابي") : "تسجيل الدخول";
    if (user) a.setAttribute("data-i18n-skip", "");
    box.insertBefore(a, box.firstChild);
  }

  window.MSAuth = {
    api: api,
    user: function () { return user; },
    me: function () {
      return api("GET", "auth/me").then(function (r) { user = r.status === 200 ? r.data.user : null; return user; });
    },
    afterLogin: function (u) { user = u; },
    logout: function () {
      return flush().then(function () { return api("POST", "auth/logout"); }).then(function () {
        SYNC.concat([TKEY]).forEach(lsDel); // البيانات صارت في الحساب؛ لا نتركها لمن يستعمل الجهاز بعدك
        user = null;
      });
    }
  };

  // صفحة الدخول تدير نفسها (js/login.js)
  if (/\/(login|admin|announce)\.html$/.test(location.pathname)) return;

  MSAuth.me().then(function () {
    paintHeader();
    if (!user) return;
    pull().then(function (changed) {
      var guard = "ms.sync.reloaded";
      var did = false; try { did = sessionStorage.getItem(guard) === "1"; } catch (e) { /* لا شيء */ }
      if (changed && !did) { try { sessionStorage.setItem(guard, "1"); } catch (e) { /* لا شيء */ } location.reload(); }
    });
  });
  document.addEventListener("visibilitychange", function () { if (document.hidden) flush(); });
})();
