// Shared auth helpers for Pages Functions.
// Token is a deterministic HMAC of a fixed message keyed by the edit password.
// The password itself never leaves the server; only the derived token is stored
// in an HttpOnly cookie and compared on write requests.

const TOKEN_MESSAGE = "model_rank_edit";

async function deriveToken(password) {
  const enc = new TextEncoder();
  const key = await crypto.subtle.importKey(
    "raw",
    enc.encode(password),
    { name: "HMAC", hash: "SHA-256" },
    false,
    ["sign"]
  );
  const sig = await crypto.subtle.sign("HMAC", key, enc.encode(TOKEN_MESSAGE));
  return [...new Uint8Array(sig)].map((b) => b.toString(16).padStart(2, "0")).join("");
}

function parseCookies(request) {
  const header = request.headers.get("Cookie") || "";
  const out = {};
  for (const part of header.split(";")) {
    const idx = part.indexOf("=");
    if (idx === -1) continue;
    const k = part.slice(0, idx).trim();
    const v = part.slice(idx + 1).trim();
    if (k) out[k] = v;
  }
  return out;
}

// Constant-time-ish comparison for equal-length hex strings.
function safeEqual(a, b) {
  if (typeof a !== "string" || typeof b !== "string" || a.length !== b.length) {
    return false;
  }
  let diff = 0;
  for (let i = 0; i < a.length; i++) {
    diff |= a.charCodeAt(i) ^ b.charCodeAt(i);
  }
  return diff === 0;
}

async function isAuthed(request, env) {
  if (!env.EDIT_PASSWORD) return false;
  const cookies = parseCookies(request);
  const token = cookies.token;
  if (!token) return false;
  const expected = await deriveToken(env.EDIT_PASSWORD);
  return safeEqual(token, expected);
}

export { deriveToken, parseCookies, safeEqual, isAuthed };
