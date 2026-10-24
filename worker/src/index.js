/* ============================================================
   home-push · Cloudflare Worker que envía notificaciones Web Push
   a los móviles de Home.
   - Solo acepta peticiones con un token de sesión válido de Firebase
     (proyecto home-app-e7e7e). El registro está cerrado, así que solo
     pueden ser Javi o Andrea.
   - Cifrado del mensaje: RFC 8291 (aes128gcm). Firma: VAPID (RFC 8292).
   Secretos (wrangler secret put): VAPID_PRIVATE_JWK
   Variables (wrangler.toml):      VAPID_PUBLIC, FIREBASE_PROJECT, ALLOWED_ORIGIN
   ============================================================ */

const PUSH_HOSTS = [/\.push\.apple\.com$/, /^fcm\.googleapis\.com$/, /\.push\.services\.mozilla\.com$/, /\.notify\.windows\.com$/];
const enc = new TextEncoder();

/* ---------- utilidades base64url ---------- */
function b64uToBytes(s) {
  s = s.replace(/-/g, "+").replace(/_/g, "/");
  while (s.length % 4) s += "=";
  return Uint8Array.from(atob(s), c => c.charCodeAt(0));
}
function bytesToB64u(b) {
  let s = ""; new Uint8Array(b).forEach(x => { s += String.fromCharCode(x); });
  return btoa(s).replace(/\+/g, "-").replace(/\//g, "_").replace(/=+$/, "");
}
function concat(...arrs) {
  const len = arrs.reduce((n, a) => n + a.length, 0);
  const out = new Uint8Array(len); let o = 0;
  for (const a of arrs) { out.set(a, o); o += a.length; }
  return out;
}

/* ---------- verificación del token de Firebase ---------- */
let jwksCache = { keys: null, until: 0 };
async function googleKeys() {
  if (jwksCache.keys && Date.now() < jwksCache.until) return jwksCache.keys;
  const r = await fetch("https://www.googleapis.com/service_accounts/v1/jwk/securetoken@system.gserviceaccount.com");
  const j = await r.json();
  jwksCache = { keys: j.keys, until: Date.now() + 3600e3 };
  return j.keys;
}
async function verifyFirebaseToken(token, project) {
  const [h, p, s] = token.split(".");
  if (!h || !p || !s) throw new Error("token mal formado");
  const header = JSON.parse(new TextDecoder().decode(b64uToBytes(h)));
  const claims = JSON.parse(new TextDecoder().decode(b64uToBytes(p)));
  if (header.alg !== "RS256") throw new Error("alg");
  const jwk = (await googleKeys()).find(k => k.kid === header.kid);
  if (!jwk) throw new Error("kid");
  const key = await crypto.subtle.importKey("jwk", jwk, { name: "RSASSA-PKCS1-v1_5", hash: "SHA-256" }, false, ["verify"]);
  const ok = await crypto.subtle.verify("RSASSA-PKCS1-v1_5", key, b64uToBytes(s), enc.encode(h + "." + p));
  if (!ok) throw new Error("firma");
  const now = Math.floor(Date.now() / 1000);
  if (claims.aud !== project) throw new Error("aud");
  if (claims.iss !== "https://securetoken.google.com/" + project) throw new Error("iss");
  if (!(claims.exp > now) || !(claims.iat <= now + 300)) throw new Error("caducado");
  if (!claims.sub) throw new Error("sub");
  return claims;
}

/* ---------- VAPID ---------- */
let vapidKey = null;
async function vapidHeader(endpoint, env) {
  if (!vapidKey) vapidKey = await crypto.subtle.importKey("jwk", JSON.parse(env.VAPID_PRIVATE_JWK),
    { name: "ECDSA", namedCurve: "P-256" }, false, ["sign"]);
  const aud = new URL(endpoint).origin;
  const head = bytesToB64u(enc.encode(JSON.stringify({ typ: "JWT", alg: "ES256" })));
  const body = bytesToB64u(enc.encode(JSON.stringify({
    aud, exp: Math.floor(Date.now() / 1000) + 12 * 3600, sub: "https://javattjones.github.io/home-app/",
  })));
  const sig = await crypto.subtle.sign({ name: "ECDSA", hash: "SHA-256" }, vapidKey, enc.encode(head + "." + body));
  return `vapid t=${head}.${body}.${bytesToB64u(sig)}, k=${env.VAPID_PUBLIC}`;
}

/* ---------- cifrado aes128gcm (RFC 8291) ---------- */
async function hkdf(salt, ikm, info, bytes) {
  const key = await crypto.subtle.importKey("raw", ikm, "HKDF", false, ["deriveBits"]);
  return new Uint8Array(await crypto.subtle.deriveBits({ name: "HKDF", hash: "SHA-256", salt, info }, key, bytes * 8));
}
async function encryptPayload(sub, payload) {
  const uaPublic = b64uToBytes(sub.keys.p256dh);
  const authSecret = b64uToBytes(sub.keys.auth);
  const as = await crypto.subtle.generateKey({ name: "ECDH", namedCurve: "P-256" }, true, ["deriveBits"]);
  const asPublic = new Uint8Array(await crypto.subtle.exportKey("raw", as.publicKey));
  const uaKey = await crypto.subtle.importKey("raw", uaPublic, { name: "ECDH", namedCurve: "P-256" }, false, []);
  const ecdh = new Uint8Array(await crypto.subtle.deriveBits({ name: "ECDH", public: uaKey }, as.privateKey, 256));
  const ikm = await hkdf(authSecret, ecdh, concat(enc.encode("WebPush: info\0"), uaPublic, asPublic), 32);
  const salt = crypto.getRandomValues(new Uint8Array(16));
  const cek = await hkdf(salt, ikm, enc.encode("Content-Encoding: aes128gcm\0"), 16);
  const nonce = await hkdf(salt, ikm, enc.encode("Content-Encoding: nonce\0"), 12);
  const aes = await crypto.subtle.importKey("raw", cek, "AES-GCM", false, ["encrypt"]);
  const plain = concat(enc.encode(payload), new Uint8Array([2]));   // delimitador de último registro
  const cipher = new Uint8Array(await crypto.subtle.encrypt({ name: "AES-GCM", iv: nonce }, aes, plain));
  const rs = new Uint8Array([0, 0, 16, 0]);                          // record size 4096
  return concat(salt, rs, new Uint8Array([asPublic.length]), asPublic, cipher);
}

async function sendPush(sub, payload, env) {
  const host = new URL(sub.endpoint).hostname;
  if (!PUSH_HOSTS.some(rx => rx.test(host))) return { endpoint: host, status: "host-no-permitido" };
  const body = await encryptPayload(sub, payload);
  const r = await fetch(sub.endpoint, {
    method: "POST",
    headers: {
      Authorization: await vapidHeader(sub.endpoint, env),
      "Content-Encoding": "aes128gcm",
      "Content-Type": "application/octet-stream",
      TTL: "86400",
      Urgency: "normal",
    },
    body,
  });
  return { endpoint: host, status: r.status, gone: r.status === 404 || r.status === 410 };
}

/* ---------- HTTP ---------- */
function cors(env) {
  return {
    "Access-Control-Allow-Origin": env.ALLOWED_ORIGIN,
    "Access-Control-Allow-Methods": "POST, OPTIONS",
    "Access-Control-Allow-Headers": "Authorization, Content-Type",
    "Access-Control-Max-Age": "86400",
  };
}
const json = (obj, status, env) => new Response(JSON.stringify(obj), { status, headers: { "Content-Type": "application/json", ...cors(env) } });

export default {
  async fetch(req, env) {
    if (req.method === "OPTIONS") return new Response(null, { status: 204, headers: cors(env) });
    if (req.method !== "POST" || new URL(req.url).pathname !== "/notify") return json({ error: "not found" }, 404, env);
    try {
      const token = (req.headers.get("Authorization") || "").replace(/^Bearer\s+/i, "");
      await verifyFirebaseToken(token, env.FIREBASE_PROJECT);
    } catch (e) {
      return json({ error: "no autorizado" }, 401, env);
    }
    let data;
    try { data = await req.json(); } catch (e) { return json({ error: "json" }, 400, env); }
    const subs = Array.isArray(data.subs) ? data.subs.slice(0, 10) : [];
    const msg = { title: String(data.title || "Home").slice(0, 80), body: String(data.body || "").slice(0, 240), tag: String(data.tag || "home").slice(0, 40) };
    const results = await Promise.all(subs.map(s =>
      (s && s.endpoint && s.keys) ? sendPush(s, JSON.stringify(msg), env).catch(e => ({ status: "error", error: String(e) })) : { status: "invalida" }));
    return json({ results }, 200, env);
  },
};
