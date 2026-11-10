(function () {
  "use strict";
  var pending = new Map();
  var messages = {
    database_quota_exceeded: "بلغت الخدمة حد الاستخدام اليومي. تعذّر عرض البيانات الآن. حاول لاحقًا.",
    service_unavailable: "خدمة البيانات غير متاحة مؤقتًا. أعد المحاولة بعد قليل.",
    server: "تعذّر تحميل البيانات حاليًا. أعد المحاولة بعد قليل.",
    unauthorized: "سجّل دخولك للمتابعة.",
    forbidden: "لا تملك صلاحية الوصول إلى هذه البيانات.",
    not_configured: "الخدمة قيد التجهيز. أعد المحاولة لاحقًا.",
    not_found: "العنصر المطلوب غير متاح. ارجع إلى قائمة الجامعات.",
    network: "تعذّر الاتصال. تحقق من الإنترنت ثم أعد المحاولة."
  };

  function errorText(error) {
    var code = typeof error === "string" ? error : error && (error.code || error.message);
    return messages[code] || messages.server;
  }

  function read(response) {
    return response.json().catch(function () { return null; }).then(function (data) {
      if (response.ok && data && data.ok === true) return data;
      var code = data && data.error;
      if (code && typeof code === "object") code = code.code;
      if (!code) code = response.status === 401 ? "unauthorized" : response.status === 503 ? "service_unavailable" : "server";
      var error = new Error(errorText(code));
      error.code = code;
      error.status = response.status;
      throw error;
    });
  }

  function request(url, options) {
    var get = !options || !options.method || options.method === "GET";
    if (get && pending.has(url)) return pending.get(url);
    var promise = fetch(url, options).then(read, function () {
      var error = new Error(messages.network);
      error.code = "network";
      throw error;
    });
    if (get) {
      pending.set(url, promise);
      promise.then(function () { pending.delete(url); }, function () { pending.delete(url); });
    }
    return promise;
  }

  function showError(target, error, retry) {
    target.replaceChildren();
    target.setAttribute("role", "alert");
    var text = document.createElement("span");
    text.textContent = errorText(error);
    var button = document.createElement("button");
    button.type = "button";
    button.className = "btn btn-secondary";
    button.textContent = "إعادة المحاولة";
    button.onclick = retry || function () { location.reload(); };
    target.append(text, " ", button);
  }

  window.IQApi = { request: request, read: read, errorText: errorText, showError: showError };
})();
