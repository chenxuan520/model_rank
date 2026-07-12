import { isAuthed } from "./_auth.js";

const KV_KEY = "board";

// Default board shown when KV is empty, with a few example blocks.
function defaultBoard() {
  const now = Date.now();
  return {
    productionLineY: 0.6,
    models: [
      {
        id: "m_gpt",
        name: "GPT-X",
        logo: "",
        x: 0.28,
        y: 0.82,
        tags: ["代码强", "综合"],
        comments: [
          { id: "c1", text: "综合能力最强的一档，日常主力。", createdAt: now, updatedAt: now },
        ],
      },
      {
        id: "m_claude",
        name: "Claude-X",
        logo: "",
        x: 0.5,
        y: 0.74,
        tags: ["写作", "长文本"],
        comments: [
          { id: "c1", text: "写作和长文本很稳，能上生产。", createdAt: now, updatedAt: now },
        ],
      },
      {
        id: "m_small",
        name: "Small-7B",
        logo: "",
        x: 0.4,
        y: 0.32,
        tags: ["便宜", "本地"],
        comments: [
          { id: "c1", text: "便宜能跑，但离生产线还差点。", createdAt: now, updatedAt: now },
        ],
      },
    ],
  };
}

// GET /api/data  -> public read
export async function onRequestGet({ env }) {
  const raw = await env.MODEL_RANK_KV.get(KV_KEY);
  const board = raw ? JSON.parse(raw) : defaultBoard();
  return json(board);
}

// PUT /api/data  -> authed write, replaces whole board
export async function onRequestPut({ request, env }) {
  if (!(await isAuthed(request, env))) {
    return json({ error: "unauthorized" }, 401);
  }

  let body;
  try {
    body = await request.json();
  } catch {
    return json({ error: "bad json" }, 400);
  }

  const clean = sanitize(body);
  if (!clean) {
    return json({ error: "bad shape" }, 400);
  }

  await env.MODEL_RANK_KV.put(KV_KEY, JSON.stringify(clean));
  return json({ ok: true });
}

// Keep only the expected fields / types so KV never stores arbitrary junk.
function sanitize(board) {
  if (!board || typeof board !== "object" || !Array.isArray(board.models)) {
    return null;
  }
  const clamp01 = (n) => (typeof n === "number" && isFinite(n) ? Math.min(1, Math.max(0, n)) : 0);
  const str = (s) => (typeof s === "string" ? s : "");

  const models = board.models.map((m) => ({
    id: str(m.id) || "m_" + Math.random().toString(36).slice(2, 9),
    name: str(m.name),
    logo: str(m.logo),
    x: clamp01(m.x),
    y: clamp01(m.y),
    tags: Array.isArray(m.tags) ? m.tags.map(str).filter(Boolean).slice(0, 30) : [],
    comments: Array.isArray(m.comments)
      ? m.comments.map((c) => ({
          id: str(c.id) || "c_" + Math.random().toString(36).slice(2, 9),
          text: str(c.text),
          createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
          updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
        }))
      : [],
  }));

  return {
    productionLineY: clamp01(board.productionLineY),
    models,
  };
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
