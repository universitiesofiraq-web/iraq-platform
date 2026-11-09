// functions/_lib/kvstore.js — محوّل يجعل Cloudflare KV يشبه واجهة Netlify Blobs التي يتوقعها netlify/lib/core.mjs.
// قيود معروفة: KV نهائي الاتساق، ولا يدعم الكتابة الشرطية؛ لذا تُحاكى بمقارنة رقم نسخة (v) في البيانات الوصفية
// (قراءة ثم كتابة، غير ذرّية: تعارض نادر جداً بين رفعتين في الثانية نفسها).
const TTL = { "attempts/": 3600 }; // محاولات الدخول تنتهي تلقائياً (الحد الأدنى في KV: 60 ثانية)

export function kvStore(kv, rand = () => Math.random().toString(36).slice(2) + Date.now().toString(36)) {
  const ttlFor = (key) => {
    for (const p in TTL) if (key.startsWith(p)) return TTL[p];
    return undefined;
  };
  const decode = async (v, type) => (type === "json" ? v : v);
  return {
    async get(key, opts = {}) {
      const type = opts.type || "text";
      if (type === "json") return kv.get(key, "json");
      if (type === "arrayBuffer") return kv.get(key, "arrayBuffer");
      return kv.get(key, "text");
    },
    async getWithMetadata(key, opts = {}) {
      const type = opts.type === "json" ? "json" : opts.type === "arrayBuffer" ? "arrayBuffer" : "text";
      const r = await kv.getWithMetadata(key, type);
      if (r.value === null || r.value === undefined) return null;
      const metadata = r.metadata || {};
      return { data: await decode(r.value, type), etag: metadata.v || "", metadata };
    },
    async getMetadata(key) {
      const r = await kv.getWithMetadata(key, "stream");
      if (r.value === null || r.value === undefined) return null;
      try { await r.value.cancel(); } catch {}
      const metadata = r.metadata || {};
      return { etag: metadata.v || "", metadata };
    },
    async set(key, value, opts = {}) {
      if (opts.onlyIfNew || opts.onlyIfMatch !== undefined) {
        const cur = await kv.getWithMetadata(key, "stream");
        const exists = cur.value !== null && cur.value !== undefined;
        if (exists) { try { await cur.value.cancel(); } catch {} }
        if (opts.onlyIfNew && exists) return { modified: false };
        if (opts.onlyIfMatch !== undefined && (!exists || (cur.metadata || {}).v !== opts.onlyIfMatch)) return { modified: false };
      }
      const v = rand();
      const put = { metadata: { ...(opts.metadata || {}), v } };
      const ttl = ttlFor(key);
      if (ttl) put.expirationTtl = ttl;
      await kv.put(key, value, put);
      return { modified: true, etag: v };
    },
    async delete(key) {
      await kv.delete(key);
    }
  };
}
