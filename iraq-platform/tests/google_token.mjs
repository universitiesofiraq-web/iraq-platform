// tests/google_token.mjs — يصنع رموز Google وهمية موقّعة بمفتاح اختبار، ويحاكي شهادات Google العامة.
export const CLIENT_ID = "test-client.apps.googleusercontent.com";
const { publicKey, privateKey } = await crypto.subtle.generateKey(
  { name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"]);
const jwkPub = { ...(await crypto.subtle.exportKey("jwk", publicKey)), kid: "test-kid", alg: "RS256", use: "sig" };
const b64 = (u8) => Buffer.from(u8).toString("base64url");
const enc = new TextEncoder();

export async function mint(claims = {}, { kid = "test-kid", alg = "RS256", key = privateKey } = {}) {
  const now = Math.floor(Date.now() / 1000);
  const payload = { iss: "https://accounts.google.com", aud: CLIENT_ID, sub: "sub-1", email: "a@x.com", email_verified: true,
    name: "Ali Test", iat: now, exp: now + 3600, ...claims };
  const h = b64(enc.encode(JSON.stringify({ alg, kid, typ: "JWT" })));
  const p = b64(enc.encode(JSON.stringify(payload)));
  const sig = new Uint8Array(await crypto.subtle.sign("RSASSA-PKCS1-v1_5", key, enc.encode(h + "." + p)));
  return h + "." + p + "." + b64(sig);
}
export async function otherKey() {
  return (await crypto.subtle.generateKey({ name: "RSASSA-PKCS1-v1_5", modulusLength: 2048, publicExponent: new Uint8Array([1, 0, 1]), hash: "SHA-256" }, true, ["sign", "verify"])).privateKey;
}
export const fakeFetch = async () => new Response(JSON.stringify({ keys: [jwkPub] }), { status: 200, headers: { "content-type": "application/json" } });
