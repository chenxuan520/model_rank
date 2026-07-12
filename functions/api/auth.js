import { isAuthed } from "./_auth.js";

// GET /api/auth — soft session probe for the frontend (cookie already HttpOnly).
export async function onRequestGet({ request, env }) {
  if (await isAuthed(request, env)) {
    return json({ ok: true });
  }
  return json({ ok: false }, 401);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
