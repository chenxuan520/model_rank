import { isAuthed } from "./_auth.js";

const KV_KEY = "board";

function rid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}

// Empty board (user-requested default for "新建榜单").
function emptyBoard(name) {
  return {
    id: rid("b_"),
    name: name || "新榜单",
    productionLineY: 0.6,
    productionLineLabel: "生产级别线",
    productionLineColor: "#ff5b6a",
    lines: [],
    models: [],
  };
}

// Default store shown when KV is empty (one sample board for first visit).
function defaultStore() {
  const now = Date.now();
  const id = "b_default";
  return {
    activeId: id,
    boards: [
      {
        id,
        name: "默认榜",
        productionLineY: 0.6,
        productionLineLabel: "生产级别线",
        productionLineColor: "#ff5b6a",
        lines: [
          { id: "l_base", y: 0.45, label: "第一梯队基准线", color: "#8caaff" },
        ],
        models: [
          {
            id: "m_gpt",
            name: "GPT-X",
            logo: "",
            released: "",
            hideName: false,
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
            released: "",
            hideName: false,
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
            released: "",
            hideName: false,
            x: 0.4,
            y: 0.32,
            tags: ["便宜", "本地"],
            comments: [
              { id: "c1", text: "便宜能跑，但离生产线还差点。", createdAt: now, updatedAt: now },
            ],
          },
        ],
      },
    ],
  };
}

// GET /api/data  -> public read (full store; legacy single-board auto-wrapped)
export async function onRequestGet({ env }) {
  const raw = await env.MODEL_RANK_KV.get(KV_KEY);
  const data = raw ? JSON.parse(raw) : defaultStore();
  return json(normalizeStore(data) || defaultStore());
}

// PUT /api/data  -> authed write, replaces whole store
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

function clamp01(n) {
  return typeof n === "number" && isFinite(n) ? Math.min(1, Math.max(0, n)) : 0;
}
function str(s) {
  return typeof s === "string" ? s : "";
}
function color(c, fallback) {
  if (typeof c !== "string") return fallback;
  const s = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return ("#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  }
  return fallback;
}
function month(s) {
  if (typeof s !== "string") return "";
  const m = s.trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return m ? m[1] + "-" + m[2] : "";
}

function sanitizeBoard(board) {
  if (!board || typeof board !== "object" || !Array.isArray(board.models)) return null;

  const models = board.models.map((m) => ({
    id: str(m.id) || rid("m_"),
    name: str(m.name),
    logo: str(m.logo),
    released: month(m.released),
    hideName: !!m.hideName,
    x: clamp01(m.x),
    y: clamp01(m.y),
    tags: Array.isArray(m.tags) ? m.tags.map(str).filter(Boolean).slice(0, 30) : [],
    comments: Array.isArray(m.comments)
      ? m.comments.map((c) => ({
          id: str(c.id) || rid("c_"),
          text: str(c.text),
          createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
          updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
        }))
      : [],
  }));

  const lines = Array.isArray(board.lines)
    ? board.lines.slice(0, 30).map((l, i) => ({
        id: str(l.id) || rid("l_"),
        y: clamp01(l.y),
        label: str(l.label),
        color: color(l.color, ["#8caaff", "#34d399", "#f59e0b", "#a78bfa", "#22d3ee", "#ec4899"][i % 6]),
      }))
    : [];

  return {
    id: str(board.id) || rid("b_"),
    name: str(board.name).trim() || "未命名榜单",
    productionLineY: clamp01(board.productionLineY),
    productionLineLabel: str(board.productionLineLabel) || "生产级别线",
    productionLineColor: color(board.productionLineColor, "#ff5b6a"),
    lines,
    models,
  };
}

// Accept new store shape OR legacy single-board payload.
function normalizeStore(data) {
  if (!data || typeof data !== "object") return null;

  if (Array.isArray(data.boards)) {
    const boards = data.boards.map(sanitizeBoard).filter(Boolean).slice(0, 40);
    if (!boards.length) return null;
    let activeId = str(data.activeId);
    if (!boards.some((b) => b.id === activeId)) activeId = boards[0].id;
    return { activeId, boards };
  }

  // Legacy: top-level models array
  if (Array.isArray(data.models)) {
    const one = sanitizeBoard({ ...data, id: data.id || "b_default", name: data.name || "默认榜" });
    if (!one) return null;
    return { activeId: one.id, boards: [one] };
  }

  return null;
}

function sanitize(body) {
  return normalizeStore(body);
}

function json(obj, status = 200) {
  return new Response(JSON.stringify(obj), {
    status,
    headers: { "Content-Type": "application/json" },
  });
}
