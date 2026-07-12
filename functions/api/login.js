import { deriveToken } from "./_auth.js";

// POST /api/login  { password }
// On success sets an HttpOnly cookie holding the derived token.
export async function onRequestPost({ request, env }) {
  if (!env.EDIT_PASSWORD) {
    return json({ error: "server not configured" }, 500);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad request" }, 400);
  }

  const password = body && typeof body.password === "string" ? body.password : "";
  if (password !== env.EDIT_PASSWORD) {
    return json({ error: "wrong password" }, 401);
  }

  const token = await deriveToken(env.EDIT_PASSWORD);
  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": buildAuthCookie(token, request, 2592000),
    },
  });
}

function buildAuthCookie(token, request, maxAge) {
  const secure = new URL(request.url).protocol === "https:";
  const parts = [`token=${token}`, "HttpOnly"];
  if (secure) parts.push("Secure");
  parts.push("SameSite=Lax", "Path=/", `Max-Age=${maxAge}`);
  return parts.join("; ");
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
