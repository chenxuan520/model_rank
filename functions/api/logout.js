// POST /api/logout  clears the auth cookie.
export async function onRequestPost({ request }) {
  const secure = new URL(request.url).protocol === "https:";
  const parts = ["token=", "HttpOnly"];
  if (secure) parts.push("Secure");
  parts.push("SameSite=Lax", "Path=/", "Max-Age=0");

  return new Response(JSON.stringify({ ok: true }), {
    status: 200,
    headers: {
      "Content-Type": "application/json",
      "Set-Cookie": parts.join("; "),
    },
  });
}
