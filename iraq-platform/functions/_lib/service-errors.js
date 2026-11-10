export function serviceErrorResponse(error, structured = false) {
  const detail = String(error?.message || error);
  const quota = /daily (?:row )?(?:read|write).*limit|exceeded D1.*limit/i.test(detail);
  const unavailable = quota || /D1_ERROR|database is (?:locked|unavailable)|overloaded/i.test(detail);
  const code = quota ? "database_quota_exceeded" : unavailable ? "service_unavailable" : "server";
  const message = quota
    ? "بلغت الخدمة حد الاستخدام اليومي. تعذّر عرض البيانات الآن. حاول لاحقًا."
    : "تعذّر تحميل البيانات حاليًا. أعد المحاولة بعد قليل.";
  console.error("api failure", code, detail.slice(0, 300));
  return new Response(JSON.stringify({
    ok: false,
    error: structured ? { code, message } : code,
    message
  }), {
    status: unavailable ? 503 : 500,
    headers: {
      "content-type": "application/json; charset=utf-8",
      "cache-control": "private, no-store",
      "x-content-type-options": "nosniff",
      ...(unavailable ? { "retry-after": "60" } : {})
    }
  });
}
