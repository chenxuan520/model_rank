"use strict";

// ---------- State ----------
let store = { activeId: "", boards: [] };
let board = {
  id: "",
  name: "默认榜",
  productionLineY: 0.6,
  productionLineLabel: "生产级别线",
  productionLineColor: "#ff5b6a",
  lines: [],
  models: [],
};
let editing = false;
let selectedId = null; // panel-focused model
let selectedIds = new Set(); // multi-select for group drag
let modelClipboard = []; // in-memory copies for Ctrl/Cmd+C/V
let saveTimer = null;
const MAX_UNDO_STEPS = 60;
let undoHistory = [];
let undoCursor = -1;
let isUndoing = false;

const DEFAULT_PROD_COLOR = "#ff5b6a";
const LINE_COLOR_PRESETS = ["#8caaff", "#34d399", "#f59e0b", "#a78bfa", "#22d3ee", "#ec4899", "#f97316"];

// ---------- DOM ----------
const boardInner = document.getElementById("boardInner");
const prodLine = document.getElementById("prodLine");
const panel = document.getElementById("panel");
const saveStatus = document.getElementById("saveStatus");

// ---------- Utilities ----------
function uid(prefix) {
  return prefix + Math.random().toString(36).slice(2, 9);
}

function clamp01(n) {
  return Math.min(1, Math.max(0, n));
}

function normalizeMonth(s) {
  if (typeof s !== "string") return "";
  const m = s.trim().match(/^(\d{4})-(0[1-9]|1[0-2])$/);
  return m ? m[1] + "-" + m[2] : "";
}

function formatReleased(ym) {
  const m = normalizeMonth(ym).match(/^(\d{4})-(\d{2})$/);
  if (!m) return "";
  return m[1] + "年" + Number(m[2]) + "月";
}

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function normalizeHexColor(c, fallback) {
  if (typeof c !== "string") return fallback;
  const s = c.trim();
  if (/^#[0-9a-fA-F]{6}$/.test(s)) return s.toLowerCase();
  if (/^#[0-9a-fA-F]{3}$/.test(s)) {
    return ("#" + s[1] + s[1] + s[2] + s[2] + s[3] + s[3]).toLowerCase();
  }
  return fallback;
}

function hexToRgba(hex, a) {
  const h = normalizeHexColor(hex, "#ffffff").slice(1);
  const n = parseInt(h, 16);
  const r = (n >> 16) & 255;
  const g = (n >> 8) & 255;
  const b = n & 255;
  return `rgba(${r}, ${g}, ${b}, ${a})`;
}

function nextLineColor() {
  const used = new Set((board.lines || []).map((l) => normalizeHexColor(l.color, "").toLowerCase()));
  return LINE_COLOR_PRESETS.find((c) => !used.has(c)) || LINE_COLOR_PRESETS[(board.lines || []).length % LINE_COLOR_PRESETS.length];
}

function applyLineColor(el, label, color, solidLabel) {
  el.style.borderTopColor = color;
  el.style.boxShadow = `0 0 14px ${hexToRgba(color, 0.45)}`;
  if (!label) return;
  if (solidLabel) {
    label.style.background = `linear-gradient(135deg, ${hexToRgba(color, 0.92)}, ${color})`;
    label.style.borderColor = "transparent";
    label.style.color = "#fff";
    label.style.boxShadow = `0 3px 12px ${hexToRgba(color, 0.45)}`;
  } else {
    label.style.background = hexToRgba(color, 0.2);
    label.style.borderColor = hexToRgba(color, 0.6);
    label.style.color = "#fff";
    label.style.boxShadow = "none";
  }
}

function makeLineColorInput(color, onChange) {
  const input = document.createElement("input");
  input.type = "color";
  input.className = "line-color";
  input.value = normalizeHexColor(color, "#8caaff");
  input.title = "线条颜色";
  input.addEventListener("pointerdown", (ev) => ev.stopPropagation());
  input.addEventListener("click", (ev) => ev.stopPropagation());
  input.addEventListener("input", () => onChange(input.value));
  return input;
}

// Keep color swatch + text span inside the chip; never wipe via textContent.
function setLineLabelText(labelEl, text) {
  let textEl = labelEl.querySelector(".line-label-text");
  if (!textEl) {
    const keep = [...labelEl.querySelectorAll(".line-color")];
    labelEl.textContent = "";
    keep.forEach((el) => labelEl.appendChild(el));
    textEl = document.createElement("span");
    textEl.className = "line-label-text";
    labelEl.appendChild(textEl);
  }
  if (!textEl.querySelector(".line-label-input")) {
    textEl.textContent = text;
  }
  return textEl;
}

function syncLineColorInput(labelEl, color, onChange) {
  labelEl.querySelectorAll(".line-color").forEach((el) => el.remove());
  if (!editing) return;
  labelEl.prepend(makeLineColorInput(color, onChange));
}

function getModel(id) {
  return board.models.find((m) => m.id === id);
}

function latestComment(m) {
  if (!m.comments || !m.comments.length) return null;
  return [...m.comments].sort((a, b) => b.createdAt - a.createdAt)[0];
}

// Unique tags across the whole board (for reuse suggestions).
function allBoardTags() {
  const set = new Set();
  for (const m of board.models) {
    for (const t of m.tags || []) {
      if (t) set.add(t);
    }
  }
  return [...set].sort((a, b) => a.localeCompare(b, "zh"));
}

// ---------- Brand icons ----------
// Auto-detect a vendor logo from the model name. Icons are bundled locally in
// /icons (colored brand SVGs). Falls back to a colored letter avatar so every
// model always shows something on the left.
const ICON_BASE = "icons/";

// keyword (lowercased, matched as substring) -> local icon file (no extension)
// Keep more-specific tokens above short ones to reduce false hits.
const BRAND_MAP = [
  // OpenAI
  ["chatgpt", "openai-icon"],
  ["openai", "openai-icon"],
  ["codex", "openai-icon"],
  ["gpt", "openai-icon"],
  ["o1", "openai-icon"],
  ["o3", "openai-icon"],
  ["o4", "openai-icon"],
  // Anthropic / Claude
  ["anthropic", "anthropic-icon"],
  ["claude", "claude-icon"],
  ["sonnet", "claude-icon"],
  ["opus", "claude-icon"],
  ["haiku", "claude-icon"],
  ["mythos", "claude-icon"],
  ["fable", "claude-icon"],
  // Google
  ["gemini", "gemini-star"],
  ["gemma", "gemini-star"],
  ["palm", "gemini-star"],
  ["google", "gemini-star"],
  // Meta
  ["llama", "meta-icon"],
  ["meta", "meta-icon"],
  // DeepSeek
  ["deepseek", "deepseek-icon"],
  // xAI
  ["grok", "grok-icon"],
  ["xai", "grok-icon"],
  // Alibaba Qwen
  ["qwen", "qwen-icon"],
  ["qwq", "qwen-icon"],
  ["tongyi", "qwen-icon"],
  ["通义", "qwen-icon"],
  ["千问", "qwen-icon"],
  // Moonshot Kimi
  ["moonshot", "kimi"],
  ["kimi", "kimi"],
  ["月之暗面", "kimi"],
  // MiniMax / Hailuo
  ["minimax", "minimax"],
  ["mini-max", "minimax"],
  ["hailuo", "minimax"],
  ["海螺", "minimax"],
  // Xiaomi MiMo
  ["xiaomimimo", "mimo"],
  ["xiaomi", "mimo"],
  ["小米", "mimo"],
  ["mimo", "mimo"],
  // ByteDance Doubao / Seed
  ["seedance", "doubao"],
  ["seedream", "doubao"],
  ["seededit", "doubao"],
  ["skylark", "doubao"],
  ["doubao", "doubao"],
  ["豆包", "doubao"],
  ["seed", "doubao"],
  // Zhipu / Z.ai / GLM
  ["chatglm", "glm"],
  ["zhipu", "glm"],
  ["智谱", "glm"],
  ["z.ai", "glm"],
  ["zai", "glm"],
  ["glm", "glm"],
  // Cursor
  ["cursor", "cursor"],
];

// brand -> accent color for the letter-avatar fallback
const FALLBACK_COLORS = ["#6d8bff", "#34d399", "#f59e0b", "#ec4899", "#22d3ee", "#a78bfa", "#f2555a"];

// Built-in icons offered in the panel dropdown (slug -> display label).
const ICON_OPTIONS = [
  ["openai-icon", "OpenAI / GPT"],
  ["claude-icon", "Claude"],
  ["anthropic-icon", "Anthropic"],
  ["gemini-star", "Gemini / Google"],
  ["meta-icon", "Llama / Meta"],
  ["deepseek-icon", "DeepSeek"],
  ["grok-icon", "Grok / xAI"],
  ["qwen-icon", "Qwen 通义千问"],
  ["kimi", "Kimi 月之暗面"],
  ["minimax", "MiniMax / 海螺"],
  ["mimo", "MiMo / 小米"],
  ["doubao", "豆包 / Seed"],
  ["glm", "GLM / 智谱 / Z.ai"],
  ["cursor", "Cursor"],
];

function brandSlug(name) {
  const n = (name || "").toLowerCase();
  for (const [kw, slug] of BRAND_MAP) {
    if (n.includes(kw)) return slug;
  }
  return null;
}

function letterAvatar(name) {
  const ch = (name || "?").trim().charAt(0).toUpperCase() || "?";
  let h = 0;
  for (let i = 0; i < (name || "").length; i++) h = (h * 31 + name.charCodeAt(i)) | 0;
  const color = FALLBACK_COLORS[Math.abs(h) % FALLBACK_COLORS.length];
  const svg =
    `<svg xmlns="http://www.w3.org/2000/svg" width="28" height="28" viewBox="0 0 28 28">` +
    `<rect width="28" height="28" rx="7" fill="${color}"/>` +
    `<text x="14" y="19" font-size="15" font-family="Inter,Arial,sans-serif" font-weight="700" ` +
    `fill="#0b0c10" text-anchor="middle">${ch}</text></svg>`;
  return "data:image/svg+xml;utf8," + encodeURIComponent(svg);
}

// Resolve the best icon URL for a model. `logo` on the model overrides
// auto-detection: it can be a full URL, or a bare iconify "logos" slug.
function iconUrl(m) {
  if (m.logo) {
    if (/^https?:\/\//.test(m.logo) || m.logo.startsWith("data:")) return m.logo;
    return ICON_BASE + m.logo + ".svg";
  }
  const slug = brandSlug(m.name);
  return slug ? ICON_BASE + slug + ".svg" : letterAvatar(m.name);
}

// Build an <img> icon element that falls back to a letter avatar on load error.
function makeIcon(m, cls) {
  const img = document.createElement("img");
  img.className = cls;
  img.src = iconUrl(m);
  img.alt = "";
  img.loading = "lazy";
  img.addEventListener("error", () => {
    img.onerror = null;
    img.src = letterAvatar(m.name);
  });
  return img;
}

// ---------- Load ----------
function emptyBoard(name) {
  return {
    id: uid("b_"),
    name: (name || "新榜单").trim() || "新榜单",
    productionLineY: 0.6,
    productionLineLabel: "生产级别线",
    productionLineColor: DEFAULT_PROD_COLOR,
    lines: [],
    models: [],
  };
}

function normalizeClientStore(data) {
  if (data && Array.isArray(data.boards) && data.boards.length) {
    return {
      activeId: data.activeId,
      boards: data.boards,
    };
  }
  // legacy single-board payload
  if (data && Array.isArray(data.models)) {
    const one = {
      id: data.id || "b_default",
      name: data.name || "默认榜",
      productionLineY: data.productionLineY,
      productionLineLabel: data.productionLineLabel,
      productionLineColor: data.productionLineColor,
      lines: data.lines,
      models: data.models,
    };
    return { activeId: one.id, boards: [one] };
  }
  const one = emptyBoard("默认榜");
  return { activeId: one.id, boards: [one] };
}

function hydrateStoreAndBoardFromCurrentState() {
  if (!Array.isArray(store.boards) || !store.boards.length) {
    const one = emptyBoard("默认榜");
    store = { activeId: one.id, boards: [one] };
  }
  if (!store.activeId || !store.boards.some((b) => b.id === store.activeId)) {
    store.activeId = store.boards[0].id;
  }
  for (const b of store.boards) hydrateBoard(b);
  board = activeBoard();
}

function hydrateBoard(b) {
  if (typeof b.productionLineLabel !== "string") b.productionLineLabel = "生产级别线";
  b.productionLineColor = normalizeHexColor(b.productionLineColor, DEFAULT_PROD_COLOR);
  if (!Array.isArray(b.lines)) b.lines = [];
  b.lines.forEach((ln, i) => {
    ln.color = normalizeHexColor(ln.color, LINE_COLOR_PRESETS[i % LINE_COLOR_PRESETS.length]);
  });
  if (!Array.isArray(b.models)) b.models = [];
  for (const m of b.models) {
    m.released = normalizeMonth(m.released);
    m.hideName = !!m.hideName;
  }
  if (typeof b.name !== "string" || !b.name.trim()) b.name = "未命名榜单";
  if (!b.id) b.id = uid("b_");
}

function activeBoard() {
  return store.boards.find((b) => b.id === store.activeId) || store.boards[0] || null;
}

function setActiveBoard(id, { persist } = { persist: false }) {
  if (!store.boards.some((b) => b.id === id)) return;
  store.activeId = id;
  board = activeBoard();
  selectedId = null;
  clearSelection();
  closePanel();
  hydrateBoard(board);
  syncBoardSelect();
  render();
  if (persist && editing) scheduleSave();
}

function syncBoardSelect() {
  const select = document.getElementById("boardSelect");
  if (!select) return;
  select.innerHTML = "";
  for (const b of store.boards) {
    const opt = document.createElement("option");
    opt.value = b.id;
    opt.textContent = b.name || "未命名榜单";
    select.appendChild(opt);
  }
  select.value = store.activeId;
  const delBtn = document.getElementById("deleteBoardBtn");
  if (delBtn) delBtn.disabled = store.boards.length <= 1;
}

async function load() {
  const res = await fetch("/api/data");
  const data = await res.json();
  store = normalizeClientStore(data);
  hydrateStoreAndBoardFromCurrentState();
  syncBoardSelect();
  render();
  await restoreSession();
  initUndoHistory();
}

function initUndoHistory() {
  undoHistory = [buildUndoSnapshot()];
  undoCursor = 0;
}

// If the HttpOnly auth cookie is still valid, re-enter edit mode without retyping password.
async function restoreSession() {
  try {
    const res = await fetch("/api/auth", { credentials: "same-origin" });
    if (res.ok) setEditing(true);
  } catch {
    // stay read-only
  }
}

function buildUndoSnapshot(targetStore = store) {
  const raw = JSON.stringify(targetStore);
  return { raw, state: JSON.parse(raw) };
}

function pushUndoHistory() {
  if (!editing) return;
  if (isUndoing) return;
  const next = buildUndoSnapshot();
  const current = undoHistory[undoCursor];

  if (current && current.raw === next.raw) return;

  if (undoCursor < undoHistory.length - 1) {
    undoHistory = undoHistory.slice(0, undoCursor + 1);
  }

  undoHistory.push(next);
  if (undoHistory.length > MAX_UNDO_STEPS) {
    undoHistory.shift();
  }
  undoCursor = undoHistory.length - 1;
}

function applyUndoState(snapshot) {
  if (!snapshot) return;
  isUndoing = true;
  try {
    store = JSON.parse(JSON.stringify(snapshot.state));
    hydrateStoreAndBoardFromCurrentState();
    const previousPanelModel = !panel.hidden && selectedId ? selectedId : "";
    const hadPanel = !panel.hidden;

    selectedId = null;
    clearSelection();
    closePanel();
    syncBoardSelect();
    render();
    if (hadPanel && previousPanelModel && getModel(previousPanelModel)) {
      openPanel(previousPanelModel);
    }
  } finally {
    isUndoing = false;
  }
}

function undoLastAction() {
  if (!editing || isUndoing) return false;
  if (undoCursor <= 0) return false;
  undoCursor -= 1;
  applyUndoState(undoHistory[undoCursor]);
  saveStatus.textContent = "已撤销";
  return true;
}

// ---------- Save (debounced) ----------
function scheduleSave() {
  if (!editing) return;
  pushUndoHistory();
  saveStatus.textContent = "…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}

async function save() {
  try {
    const res = await fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(store),
    });
    if (res.status === 401) {
      saveStatus.textContent = "登录失效";
      setEditing(false);
      return;
    }
    if (!res.ok) throw new Error("save failed");
    saveStatus.textContent = "已保存";
  } catch {
    saveStatus.textContent = "保存失败";
  }
}

// ---------- Render ----------
function render() {
  renderBlocks();
  renderLine();
  renderCustomLines();
}

function renderBlocks() {
  // remove existing blocks (keep axis labels + line)
  boardInner.querySelectorAll(".block").forEach((el) => el.remove());
  hideBlockTip();

  for (const m of board.models) {
    const el = document.createElement("div");
    el.className = "block";
    el.dataset.id = m.id;
    el.style.left = m.x * 100 + "%";
    el.style.top = (1 - m.y) * 100 + "%";
    applyTier(el, m);

    const head = document.createElement("div");
    head.className = "block-head";
    head.appendChild(makeIcon(m, "block-icon"));
    const name = document.createElement("span");
    name.className = "block-name";
    name.textContent = m.name || "(未命名)";
    head.appendChild(name);
    el.appendChild(head);
    if (m.hideName) {
      el.classList.add("icon-only");
      el.title = m.name || "(未命名)";
    }

    if (m.tags && m.tags.length) {
      const tagWrap = document.createElement("div");
      tagWrap.className = "block-tags";
      for (const t of m.tags.slice(0, 4)) {
        const tag = document.createElement("span");
        tag.className = "block-tag";
        tag.textContent = t;
        tagWrap.appendChild(tag);
      }
      el.appendChild(tagWrap);
    }

    el.addEventListener("pointerdown", onBlockPointerDown);
    el.addEventListener("pointerenter", () => {
      if (drag || marquee) return;
      const c = latestComment(m);
      if (c) showBlockTip(el, c.text);
    });
    el.addEventListener("pointerleave", hideBlockTip);
    boardInner.appendChild(el);
  }
  syncSelectionClass();
}

// ---------- Block hover tip (latest comment) ----------
const blockTip = document.getElementById("blockTip");

function showBlockTip(anchor, text) {
  const v = (text || "").trim();
  if (!v) {
    hideBlockTip();
    return;
  }
  blockTip.textContent = v;
  blockTip.hidden = false;

  const rect = anchor.getBoundingClientRect();
  const tipW = blockTip.offsetWidth;
  const tipH = blockTip.offsetHeight;
  let left = rect.left + rect.width / 2 - tipW / 2;
  let top = rect.top - tipH - 10;
  // flip below if near top of viewport
  if (top < 8) top = rect.bottom + 10;
  left = Math.max(8, Math.min(left, window.innerWidth - tipW - 8));
  blockTip.style.left = left + "px";
  blockTip.style.top = top + "px";
}

function hideBlockTip() {
  blockTip.hidden = true;
}

// Color a block by whether it sits above (production-grade) or below the line.
function applyTier(el, m) {
  const prod = m.y >= board.productionLineY;
  el.classList.toggle("tier-prod", prod);
  el.classList.toggle("tier-sub", !prod);
}

// Re-evaluate every block's tier (used while dragging the line or a block).
function refreshTiers() {
  boardInner.querySelectorAll(".block").forEach((el) => {
    const m = getModel(el.dataset.id);
    if (m) applyTier(el, m);
  });
}

function renderLine() {
  prodLine.style.top = (1 - board.productionLineY) * 100 + "%";
  const label = prodLine.querySelector(".prod-line-label");
  setLineLabelText(label, board.productionLineLabel || "生产级别线");
  label.classList.toggle("editable", editing);
  label.title = editing ? "点击编辑文字；左侧改颜色" : "";

  const color = normalizeHexColor(board.productionLineColor, DEFAULT_PROD_COLOR);
  board.productionLineColor = color;
  applyLineColor(prodLine, label, color, true);
  syncLineColorInput(label, color, (v) => {
    board.productionLineColor = v;
    applyLineColor(prodLine, label, v, true);
    scheduleSave();
  });
}

// Click a line label → replace with an input (more discoverable than contentEditable).
function startLabelEdit(labelEl, getValue, setValue) {
  if (labelEl.querySelector(".line-label-input")) return;
  const textEl = setLineLabelText(labelEl, getValue());
  const input = document.createElement("input");
  input.type = "text";
  input.className = "line-label-input";
  input.value = getValue();
  textEl.textContent = "";
  textEl.appendChild(input);
  labelEl.classList.add("editing-label");
  input.focus();
  input.select();

  let done = false;
  const finish = (commit) => {
    if (done) return;
    done = true;
    if (commit) {
      const v = input.value.trim();
      if (v) setValue(v);
    }
    labelEl.classList.remove("editing-label");
    setLineLabelText(labelEl, getValue());
  };
  input.addEventListener("keydown", (ev) => {
    if (ev.key === "Enter") { ev.preventDefault(); finish(true); }
    if (ev.key === "Escape") { ev.preventDefault(); finish(false); }
  });
  input.addEventListener("blur", () => finish(true));
}

// Render the custom labeled baseline lines (below the main production line).
function renderCustomLines() {
  boardInner.querySelectorAll(".custom-line").forEach((el) => el.remove());
  for (const ln of board.lines) {
    const el = document.createElement("div");
    el.className = "prod-line custom-line";
    el.dataset.id = ln.id;
    el.style.top = (1 - ln.y) * 100 + "%";

    const color = normalizeHexColor(ln.color, nextLineColor());
    ln.color = color;

    const label = document.createElement("span");
    label.className = "line-label custom-line-label";
    setLineLabelText(label, ln.label || "基准线");
    label.classList.toggle("editable", editing);
    if (editing) {
      label.title = "点击编辑文字；左侧改颜色";
      label.addEventListener("click", (ev) => {
        if (ev.target.closest(".line-color")) return;
        ev.stopPropagation();
        startLabelEdit(
          label,
          () => ln.label || "基准线",
          (v) => {
            ln.label = v;
            scheduleSave();
          }
        );
      });
    }
    el.appendChild(label);
    applyLineColor(el, label, color, false);
    syncLineColorInput(label, color, (v) => {
      ln.color = v;
      applyLineColor(el, label, v, false);
      scheduleSave();
    });

    if (editing) {
      const del = document.createElement("span");
      del.className = "line-del";
      del.textContent = "×";
      del.title = "删除这条线";
      del.addEventListener("click", (ev) => {
        ev.stopPropagation();
        board.lines = board.lines.filter((x) => x.id !== ln.id);
        renderCustomLines();
        scheduleSave();
      });
      el.appendChild(del);
    }

    el.addEventListener("pointerdown", (ev) => {
      startLineDrag(
        ev,
        () => ln.y,
        (y) => {
          ln.y = y;
          el.style.top = (1 - y) * 100 + "%";
        }
      );
    });
    boardInner.appendChild(el);
  }
}

// ---------- Selection + marquee + block drag ----------
let drag = null;
let marquee = null;

function syncSelectionClass() {
  boardInner.querySelectorAll(".block").forEach((el) => {
    el.classList.toggle("selected", selectedIds.has(el.dataset.id));
  });
}

function clearSelection() {
  if (selectedIds.size === 0) return;
  selectedIds.clear();
  syncSelectionClass();
}

function setSelection(ids) {
  selectedIds = new Set(ids);
  syncSelectionClass();
}

function isTypingTarget(el) {
  if (!el || el === document.body) return false;
  const tag = (el.tagName || "").toUpperCase();
  if (tag === "INPUT" || tag === "TEXTAREA" || tag === "SELECT") return true;
  if (el.isContentEditable) return true;
  return false;
}

function idsForClipboard() {
  if (selectedIds.size) return [...selectedIds];
  if (selectedId) return [selectedId];
  return [];
}

function snapshotModel(m) {
  return {
    name: m.name || "",
    logo: m.logo || "",
    released: normalizeMonth(m.released),
    hideName: !!m.hideName,
    x: typeof m.x === "number" ? m.x : 0.5,
    y: typeof m.y === "number" ? m.y : 0.5,
    tags: Array.isArray(m.tags) ? m.tags.map(String) : [],
    comments: Array.isArray(m.comments)
      ? m.comments.map((c) => ({
          text: String(c.text || ""),
          createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
          updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
        }))
      : [],
  };
}

function materializeModel(snap, index) {
  const ox = 0.05 + index * 0.02;
  const oy = 0.05;
  return {
    id: uid("m_"),
    name: snap.name || "新模型",
    logo: snap.logo || "",
    released: normalizeMonth(snap.released),
    hideName: !!snap.hideName,
    x: clamp01((typeof snap.x === "number" ? snap.x : 0.5) + ox),
    y: clamp01((typeof snap.y === "number" ? snap.y : 0.5) + oy),
    tags: Array.isArray(snap.tags) ? [...snap.tags] : [],
    comments: Array.isArray(snap.comments)
      ? snap.comments.map((c) => ({
          id: uid("c_"),
          text: String(c.text || ""),
          createdAt: typeof c.createdAt === "number" ? c.createdAt : Date.now(),
          updatedAt: typeof c.updatedAt === "number" ? c.updatedAt : Date.now(),
        }))
      : [],
  };
}

function copySelectedModels() {
  const ids = idsForClipboard();
  const snaps = ids.map((id) => getModel(id)).filter(Boolean).map(snapshotModel);
  if (!snaps.length) return false;
  modelClipboard = snaps;
  saveStatus.textContent = snaps.length > 1 ? `已复制 ${snaps.length} 个` : "已复制";
  return true;
}

function pasteModels() {
  if (!modelClipboard.length) return false;
  const created = modelClipboard.map((snap, i) => materializeModel(snap, i));
  board.models.push(...created);
  setSelection(created.map((m) => m.id));
  renderBlocks();
  openPanel(created[created.length - 1].id);
  scheduleSave();
  saveStatus.textContent = created.length > 1 ? `已粘贴 ${created.length} 个` : "已粘贴";
  return true;
}

function clientToBoard(clientX, clientY, rect) {
  return {
    x: (clientX - rect.left) / rect.width,
    y: 1 - (clientY - rect.top) / rect.height,
  };
}

function applyModelPos(id, x, y) {
  const m = getModel(id);
  const el = boardInner.querySelector(`.block[data-id="${CSS.escape(id)}"]`);
  if (!m) return;
  m.x = x;
  m.y = y;
  if (el) {
    el.style.left = x * 100 + "%";
    el.style.top = (1 - y) * 100 + "%";
    applyTier(el, m);
  }
}

function onBlockPointerDown(e) {
  hideBlockTip();
  const id = e.currentTarget.dataset.id;
  if (!editing) {
    openPanel(id);
    return;
  }
  e.preventDefault();
  e.stopPropagation(); // don't start a marquee underneath

  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  if (additive) {
    if (selectedIds.has(id)) selectedIds.delete(id);
    else selectedIds.add(id);
    syncSelectionClass();
  } else if (!selectedIds.has(id)) {
    setSelection([id]);
  }

  if (!selectedIds.has(id)) {
    // shift-deselected this block: no drag
    return;
  }

  const el = e.currentTarget;
  const m = getModel(id);
  const rect = boardInner.getBoundingClientRect();
  const pt = clientToBoard(e.clientX, e.clientY, rect);
  const ids = [...selectedIds];
  const origins = {};
  for (const sid of ids) {
    const sm = getModel(sid);
    if (sm) origins[sid] = { x: sm.x, y: sm.y };
  }

  drag = {
    primaryId: id,
    ids,
    origins,
    rect,
    moved: false,
    additive,
    startX: e.clientX,
    startY: e.clientY,
    offX: pt.x - (m ? m.x : pt.x),
    offY: pt.y - (m ? m.y : pt.y),
  };
  el.setPointerCapture(e.pointerId);
  for (const sid of ids) {
    boardInner.querySelector(`.block[data-id="${CSS.escape(sid)}"]`)?.classList.add("dragging");
  }
  el.addEventListener("pointermove", onBlockPointerMove);
  el.addEventListener("pointerup", onBlockPointerUp);
}

function onBlockPointerMove(e) {
  if (!drag) return;
  if (!drag.moved) {
    if (Math.abs(e.clientX - drag.startX) <= 3 && Math.abs(e.clientY - drag.startY) <= 3) {
      return;
    }
    drag.moved = true;
  }

  const pt = clientToBoard(e.clientX, e.clientY, drag.rect);
  const primary = drag.origins[drag.primaryId];
  if (!primary) return;

  let dx = pt.x - drag.offX - primary.x;
  let dy = pt.y - drag.offY - primary.y;

  // keep the whole group inside 0~1
  let minX = Infinity;
  let maxX = -Infinity;
  let minY = Infinity;
  let maxY = -Infinity;
  for (const sid of drag.ids) {
    const o = drag.origins[sid];
    if (!o) continue;
    minX = Math.min(minX, o.x + dx);
    maxX = Math.max(maxX, o.x + dx);
    minY = Math.min(minY, o.y + dy);
    maxY = Math.max(maxY, o.y + dy);
  }
  if (minX < 0) dx -= minX;
  if (maxX > 1) dx -= maxX - 1;
  if (minY < 0) dy -= minY;
  if (maxY > 1) dy -= maxY - 1;

  for (const sid of drag.ids) {
    const o = drag.origins[sid];
    if (!o) continue;
    applyModelPos(sid, clamp01(o.x + dx), clamp01(o.y + dy));
  }
}

function onBlockPointerUp(e) {
  if (!drag) return;
  const { ids, primaryId, moved, additive } = drag;
  for (const sid of ids) {
    boardInner.querySelector(`.block[data-id="${CSS.escape(sid)}"]`)?.classList.remove("dragging");
  }
  const el = e.currentTarget;
  el.removeEventListener("pointermove", onBlockPointerMove);
  el.removeEventListener("pointerup", onBlockPointerUp);
  drag = null;
  if (moved) {
    scheduleSave();
  } else if (!additive) {
    openPanel(primaryId);
  }
}

function onBoardMarqueeDown(e) {
  if (!editing) return;
  if (e.target.closest(".block, .prod-line, .line-label, .line-del, .line-color, .line-label-input")) return;
  if (e.button != null && e.button !== 0) return;

  e.preventDefault();
  hideBlockTip();

  const rect = boardInner.getBoundingClientRect();
  const additive = e.shiftKey || e.metaKey || e.ctrlKey;
  const box = document.createElement("div");
  box.className = "marquee";
  boardInner.appendChild(box);

  marquee = {
    startX: e.clientX - rect.left,
    startY: e.clientY - rect.top,
    rect,
    el: box,
    additive,
    base: additive ? new Set(selectedIds) : new Set(),
    moved: false,
    startClientX: e.clientX,
    startClientY: e.clientY,
  };
  if (!additive) clearSelection();

  boardInner.setPointerCapture(e.pointerId);
  boardInner.addEventListener("pointermove", onBoardMarqueeMove);
  boardInner.addEventListener("pointerup", onBoardMarqueeUp);
}

function hitMarquee(left, top, w, h) {
  const next = new Set(marquee.base);
  const br = marquee.rect;
  boardInner.querySelectorAll(".block").forEach((el) => {
    const r = el.getBoundingClientRect();
    const bl = r.left - br.left;
    const bt = r.top - br.top;
    const brt = r.right - br.left;
    const bb = r.bottom - br.top;
    const hit = !(brt < left || bl > left + w || bb < top || bt > top + h);
    if (hit) next.add(el.dataset.id);
  });
  selectedIds = next;
  syncSelectionClass();
}

function onBoardMarqueeMove(e) {
  if (!marquee) return;
  if (!marquee.moved) {
    if (Math.abs(e.clientX - marquee.startClientX) > 3 || Math.abs(e.clientY - marquee.startClientY) > 3) {
      marquee.moved = true;
    }
  }
  const x1 = e.clientX - marquee.rect.left;
  const y1 = e.clientY - marquee.rect.top;
  const left = Math.min(marquee.startX, x1);
  const top = Math.min(marquee.startY, y1);
  const w = Math.abs(x1 - marquee.startX);
  const h = Math.abs(y1 - marquee.startY);
  marquee.el.style.left = left + "px";
  marquee.el.style.top = top + "px";
  marquee.el.style.width = w + "px";
  marquee.el.style.height = h + "px";
  if (marquee.moved) hitMarquee(left, top, w, h);
}

function onBoardMarqueeUp() {
  if (!marquee) return;
  marquee.el.remove();
  boardInner.removeEventListener("pointermove", onBoardMarqueeMove);
  boardInner.removeEventListener("pointerup", onBoardMarqueeUp);
  // empty click (no drag): clear selection already done for non-additive
  marquee = null;
}

boardInner.addEventListener("pointerdown", onBoardMarqueeDown);

// ---------- Line drag (shared by production line + custom lines) ----------
// getY/setY read and write the line's y; onMove runs after each update.
function startLineDrag(e, getY, setY, onMove) {
  if (!editing) return;
  // don't start a drag when interacting with the label / its input / delete btn
  if (e.target.closest(".line-label, .line-del, .line-label-input, .line-color")) return;
  e.preventDefault();
  const rect = boardInner.getBoundingClientRect();
  const move = (ev) => {
    const y = clamp01(1 - (ev.clientY - rect.top) / rect.height);
    setY(y);
    if (onMove) onMove(y);
  };
  const up = () => {
    window.removeEventListener("pointermove", move);
    window.removeEventListener("pointerup", up);
    scheduleSave();
  };
  window.addEventListener("pointermove", move);
  window.addEventListener("pointerup", up);
}

// production line
prodLine.addEventListener("pointerdown", (e) => {
  startLineDrag(
    e,
    () => board.productionLineY,
    (y) => {
      board.productionLineY = y;
      prodLine.style.top = (1 - y) * 100 + "%";
    },
    () => refreshTiers() // blocks may cross the line as it moves
  );
});

// production line label: click to edit
const prodLabel = prodLine.querySelector(".prod-line-label");
prodLabel.addEventListener("click", (ev) => {
  if (!editing) return;
  if (ev.target.closest(".line-color")) return;
  ev.stopPropagation();
  startLabelEdit(
    prodLabel,
    () => board.productionLineLabel || "生产级别线",
    (v) => {
      board.productionLineLabel = v;
      scheduleSave();
    }
  );
});

// ---------- Panel ----------
function openPanel(id) {
  selectedId = id;
  const m = getModel(id);
  if (!m) return;

  document.getElementById("panelName").textContent = m.name || "(未命名)";
  const nameInput = document.getElementById("panelNameInput");
  nameInput.value = m.name || "";
  syncLogoControls(m);
  syncReleased(m);
  document.getElementById("panelHideName").checked = !!m.hideName;
  updatePanelIcon(m);

  renderTags(m);
  renderComments(m);
  panel.hidden = false;
}

// YYYY-MM release month: month picker in edit mode, plain text otherwise.
function syncReleased(m) {
  m.released = normalizeMonth(m.released);
  const input = document.getElementById("panelReleased");
  const view = document.getElementById("panelReleasedView");
  input.value = m.released;
  if (editing) {
    view.hidden = true;
  } else {
    view.hidden = false;
    view.textContent = m.released ? formatReleased(m.released) : "未设置";
    view.classList.toggle("is-empty", !m.released);
  }
}

// Set the icon dropdown + custom-URL field to reflect the model's current logo.
function syncLogoControls(m) {
  const select = document.getElementById("panelLogoSelect");
  const input = document.getElementById("panelLogoInput");
  const logo = m.logo || "";
  const isBuiltin = ICON_OPTIONS.some(([slug]) => slug === logo);
  if (logo === "") {
    select.value = "";
    input.hidden = true;
    input.value = "";
  } else if (isBuiltin) {
    select.value = logo;
    input.hidden = true;
    input.value = "";
  } else {
    // custom URL (or any unrecognized value)
    select.value = "__custom__";
    input.hidden = false;
    input.value = logo;
  }
}

// Refresh the panel header icon for a model (with letter-avatar fallback).
function updatePanelIcon(m) {
  const icon = document.getElementById("panelIcon");
  icon.onerror = () => {
    icon.onerror = null;
    icon.src = letterAvatar(m.name);
  };
  icon.src = iconUrl(m);
}

function closePanel() {
  panel.hidden = true;
  selectedId = null;
}

function renderTags(m) {
  const wrap = document.getElementById("panelTags");
  wrap.innerHTML = "";
  for (const tag of m.tags) {
    const el = document.createElement("span");
    el.className = "tag";
    el.textContent = tag;
    if (editing) {
      const x = document.createElement("span");
      x.className = "tag-remove";
      x.textContent = "×";
      x.addEventListener("click", () => {
        m.tags = m.tags.filter((t) => t !== tag);
        renderTags(m);
        renderBlocks();
        scheduleSave();
      });
      el.appendChild(x);
    }
    wrap.appendChild(el);
  }
  renderTagSuggestions(m);
}

// Show other models' tags as one-click reuse chips (edit mode only).
function renderTagSuggestions(m) {
  const box = document.getElementById("tagSuggestions");
  if (!editing) {
    box.hidden = true;
    box.innerHTML = "";
    return;
  }
  const owned = new Set(m.tags || []);
  const others = allBoardTags().filter((t) => !owned.has(t));
  box.innerHTML = "";
  if (others.length === 0) {
    box.hidden = true;
    return;
  }
  box.hidden = false;
  const label = document.createElement("span");
  label.className = "tag-suggestions-label";
  label.textContent = "复用：";
  box.appendChild(label);
  for (const t of others) {
    const chip = document.createElement("button");
    chip.type = "button";
    chip.className = "tag-suggest";
    chip.textContent = t;
    chip.title = "添加标签「" + t + "」";
    chip.addEventListener("click", () => {
      if (!m.tags.includes(t)) {
        m.tags.push(t);
        renderTags(m);
        renderBlocks();
        scheduleSave();
      }
    });
    box.appendChild(chip);
  }
}

function renderComments(m) {
  const list = document.getElementById("commentList");
  list.innerHTML = "";
  // newest first
  const sorted = [...m.comments].sort((a, b) => b.createdAt - a.createdAt);
  if (sorted.length === 0) {
    const empty = document.createElement("li");
    empty.className = "comment-empty";
    empty.textContent = "还没有评论。";
    list.appendChild(empty);
  }
  for (const c of sorted) {
    const li = document.createElement("li");
    li.className = "comment-item";

    const text = document.createElement("div");
    text.className = "comment-text";
    text.textContent = c.text;
    li.appendChild(text);

    const meta = document.createElement("div");
    meta.className = "comment-meta";
    const time = document.createElement("span");
    const edited = c.updatedAt && c.updatedAt !== c.createdAt;
    time.textContent = fmtTime(c.createdAt) + (edited ? "（编辑于 " + fmtTime(c.updatedAt) + "）" : "");
    meta.appendChild(time);

    if (editing) {
      const editBtn = document.createElement("span");
      editBtn.className = "comment-edit-btn";
      editBtn.textContent = "编辑";
      editBtn.addEventListener("click", () => startEditComment(m, c, li));
      meta.appendChild(editBtn);

      const delBtn = document.createElement("span");
      delBtn.className = "comment-del-btn";
      delBtn.textContent = "删除";
      delBtn.addEventListener("click", () => {
        const preview = (c.text || "").trim().slice(0, 20);
        const tip = preview ? "「" + preview + (c.text.trim().length > 20 ? "…" : "") + "」" : "这条评论";
        if (!confirm("确认删除评论" + tip + "？")) return;
        m.comments = m.comments.filter((x) => x.id !== c.id);
        renderComments(m);
        scheduleSave();
      });
      meta.appendChild(delBtn);
    }
    li.appendChild(meta);
    list.appendChild(li);
  }
}

function startEditComment(m, c, li) {
  li.innerHTML = "";
  const ta = document.createElement("textarea");
  ta.className = "comment-textarea";
  ta.value = c.text;
  li.appendChild(ta);

  const bar = document.createElement("div");
  bar.className = "comment-meta";
  const saveBtn = document.createElement("span");
  saveBtn.className = "comment-edit-btn";
  saveBtn.textContent = "保存";
  saveBtn.addEventListener("click", () => {
    const v = ta.value.trim();
    if (v) {
      c.text = v;
      c.updatedAt = Date.now();
      scheduleSave();
    }
    renderComments(m);
  });
  const cancelBtn = document.createElement("span");
  cancelBtn.className = "comment-edit-btn";
  cancelBtn.style.color = "var(--text-dim)";
  cancelBtn.textContent = "取消";
  cancelBtn.addEventListener("click", () => renderComments(m));
  bar.appendChild(saveBtn);
  bar.appendChild(cancelBtn);
  li.appendChild(bar);
  ta.focus();
}

// tag add
document.getElementById("tagInput").addEventListener("keydown", (e) => {
  if (e.key !== "Enter") return;
  const m = getModel(selectedId);
  if (!m) return;
  const v = e.target.value.trim();
  if (v && !m.tags.includes(v)) {
    m.tags.push(v);
    renderTags(m);
    renderBlocks();
    scheduleSave();
  }
  e.target.value = "";
});

// comment add
function addCommentFromInput() {
  const m = getModel(selectedId);
  if (!m) return;
  const input = document.getElementById("commentInput");
  const v = input.value.trim();
  if (!v) return;
  const now = Date.now();
  m.comments.push({ id: uid("c_"), text: v, createdAt: now, updatedAt: now });
  input.value = "";
  renderComments(m);
  scheduleSave();
}

document.getElementById("commentAddBtn").addEventListener("click", addCommentFromInput);
document.getElementById("commentInput").addEventListener("keydown", (e) => {
  if (e.key !== "Enter" || e.shiftKey || e.isComposing) return;
  e.preventDefault();
  addCommentFromInput();
});

document.getElementById("panelReleased").addEventListener("change", (e) => {
  const m = getModel(selectedId);
  if (!m) return;
  m.released = normalizeMonth(e.target.value);
  scheduleSave();
});

document.getElementById("panelHideName").addEventListener("change", (e) => {
  const m = getModel(selectedId);
  if (!m) return;
  m.hideName = !!e.target.checked;
  renderBlocks();
  scheduleSave();
});

// rename model
document.getElementById("panelNameInput").addEventListener("input", (e) => {
  const m = getModel(selectedId);
  if (!m) return;
  m.name = e.target.value;
  document.getElementById("panelName").textContent = m.name || "(未命名)";
  updatePanelIcon(m); // name may change the auto-detected icon
  renderBlocks();
  scheduleSave();
});

// icon dropdown: "" = auto, a slug = built-in, __custom__ = show URL field
document.getElementById("panelLogoSelect").addEventListener("change", (e) => {
  const m = getModel(selectedId);
  if (!m) return;
  const input = document.getElementById("panelLogoInput");
  const val = e.target.value;
  if (val === "__custom__") {
    input.hidden = false;
    m.logo = input.value.trim();
    input.focus();
  } else {
    input.hidden = true;
    m.logo = val; // "" (auto) or a built-in slug
  }
  updatePanelIcon(m);
  renderBlocks();
  scheduleSave();
});

// custom image URL (only visible when "自定义" is chosen)
document.getElementById("panelLogoInput").addEventListener("input", (e) => {
  const m = getModel(selectedId);
  if (!m) return;
  m.logo = e.target.value.trim();
  updatePanelIcon(m);
  renderBlocks();
  scheduleSave();
});

// delete model
document.getElementById("deleteModelBtn").addEventListener("click", () => {
  const m = getModel(selectedId);
  if (!m) return;
  if (!confirm("确认删除模型「" + (m.name || "未命名") + "」？")) return;
  board.models = board.models.filter((x) => x.id !== selectedId);
  selectedIds.delete(selectedId);
  closePanel();
  renderBlocks();
  scheduleSave();
});

document.getElementById("panelClose").addEventListener("click", closePanel);

// Click outside the side panel to close it (blocks are excluded: they switch/open panel).
document.addEventListener("pointerdown", (e) => {
  if (panel.hidden) return;
  if (panel.contains(e.target)) return;
  if (e.target.closest(".block")) return;
  if (e.target.closest("#loginModal")) return;
  closePanel();
});

// ---------- Add model ----------
document.getElementById("addBtn").addEventListener("click", () => {
  const now = Date.now();
  const m = {
    id: uid("m_"),
    name: "新模型",
    logo: "",
    released: "",
    hideName: false,
    x: 0.5,
    y: 0.5,
    tags: [],
    comments: [],
  };
  board.models.push(m);
  renderBlocks();
  openPanel(m.id);
  scheduleSave();
});

// ---------- Boards (multi-list) ----------
document.getElementById("boardSelect").addEventListener("change", (e) => {
  setActiveBoard(e.target.value, { persist: editing });
});

document.getElementById("addBoardBtn").addEventListener("click", () => {
  if (!editing) return;
  const name = prompt("新榜单名称", "新榜单");
  if (name === null) return;
  const b = emptyBoard(name);
  store.boards.push(b);
  setActiveBoard(b.id, { persist: true });
  saveStatus.textContent = "已新建榜单";
});

document.getElementById("renameBoardBtn").addEventListener("click", () => {
  if (!editing || !board) return;
  const name = prompt("榜单名称", board.name || "未命名榜单");
  if (name === null) return;
  const v = name.trim();
  if (!v) return;
  board.name = v;
  syncBoardSelect();
  scheduleSave();
});

document.getElementById("deleteBoardBtn").addEventListener("click", () => {
  if (!editing || !board) return;
  if (store.boards.length <= 1) {
    alert("至少保留一个榜单");
    return;
  }
  if (!confirm("确认删除榜单「" + (board.name || "未命名") + "」？其中的模型也会一起删掉。")) return;
  const doomed = board.id;
  store.boards = store.boards.filter((b) => b.id !== doomed);
  const next = store.boards[0];
  setActiveBoard(next.id, { persist: true });
});

// ---------- Add baseline line ----------
document.getElementById("addLineBtn").addEventListener("click", () => {
  const ln = { id: uid("l_"), y: 0.4, label: "新基准线", color: nextLineColor() };
  board.lines.push(ln);
  renderCustomLines();
  scheduleSave();
});

// ---------- Edit mode toggle ----------
function setEditing(on) {
  editing = on;
  document.body.classList.toggle("editing", on);
  document.querySelectorAll(".edit-only").forEach((el) => (el.hidden = !on));
  document.getElementById("loginBtn").hidden = on;
  saveStatus.textContent = "";
  if (!on) clearSelection();
  renderLine();        // toggle production-line label editability
  renderCustomLines(); // toggle custom-line labels + delete buttons
  if (selectedId) openPanel(selectedId); // refresh panel edit controls
}

// ---------- Login ----------
const loginModal = document.getElementById("loginModal");
const passwordInput = document.getElementById("passwordInput");
const passwordToggle = document.getElementById("passwordToggle");
const loginSubmit = document.getElementById("loginSubmit");
const loginCancel = document.getElementById("loginCancel");
const loginError = document.getElementById("loginError");
let loginBusy = false;

function resetPasswordVisibility() {
  passwordInput.type = "password";
  passwordToggle.classList.remove("is-shown");
  passwordToggle.setAttribute("aria-label", "显示密码");
  passwordToggle.title = "显示密码";
}

function openLoginModal() {
  loginModal.hidden = false;
  loginError.hidden = true;
  loginError.classList.remove("shake");
  passwordInput.value = "";
  resetPasswordVisibility();
  loginSubmit.disabled = false;
  loginCancel.disabled = false;
  loginSubmit.textContent = "进入";
  loginBusy = false;
  passwordInput.focus();
}

function closeLoginModal() {
  if (loginBusy) return;
  loginModal.hidden = true;
}

passwordToggle.addEventListener("click", () => {
  const show = passwordInput.type === "password";
  passwordInput.type = show ? "text" : "password";
  passwordToggle.classList.toggle("is-shown", show);
  passwordToggle.setAttribute("aria-label", show ? "隐藏密码" : "显示密码");
  passwordToggle.title = show ? "隐藏密码" : "显示密码";
  passwordInput.focus();
});

document.getElementById("loginBtn").addEventListener("click", openLoginModal);
loginCancel.addEventListener("click", closeLoginModal);
loginSubmit.addEventListener("click", doLogin);
passwordInput.addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

// Click the dimmed backdrop to dismiss the login modal
loginModal.addEventListener("pointerdown", (e) => {
  if (e.target === loginModal) closeLoginModal();
});

// Esc / copy / paste shortcuts (edit mode)
document.addEventListener("keydown", (e) => {
  if (e.key === "Escape") {
    if (!loginModal.hidden) {
      closeLoginModal();
      return;
    }
    if (!panel.hidden) {
      closePanel();
      return;
    }
    clearSelection();
    return;
  }

  if (!editing) return;
  if (isTypingTarget(e.target)) return;
  const mod = e.metaKey || e.ctrlKey;
  if (!mod) return;

  const key = e.key.toLowerCase();
  if (key === "z" && !e.shiftKey) {
    e.preventDefault();
    if (!undoLastAction()) {
      saveStatus.textContent = "暂无可撤销的更改";
    }
  } else if (key === "c") {
    if (copySelectedModels()) e.preventDefault();
  } else if (key === "v") {
    if (pasteModels()) e.preventDefault();
  }
});

async function doLogin() {
  if (loginBusy) return;
  const pw = passwordInput.value;
  if (!pw) {
    loginError.textContent = "请输入密码";
    loginError.hidden = false;
    loginError.classList.remove("shake");
    void loginError.offsetWidth;
    loginError.classList.add("shake");
    passwordInput.focus();
    return;
  }
  loginBusy = true;
  loginSubmit.disabled = true;
  loginCancel.disabled = true;
  loginSubmit.textContent = "登录中…";
  loginError.hidden = true;
  try {
    const res = await fetch("/api/login", {
      method: "POST",
      headers: { "Content-Type": "application/json" },
      credentials: "same-origin",
      body: JSON.stringify({ password: pw }),
    });
    if (res.ok) {
      loginModal.hidden = true;
      setEditing(true);
    } else {
      loginError.textContent = "密码错误，请重试";
      loginError.hidden = false;
      loginError.classList.remove("shake");
      void loginError.offsetWidth;
      loginError.classList.add("shake");
      passwordInput.select();
    }
  } catch {
    loginError.textContent = "网络异常，请重试";
    loginError.hidden = false;
  } finally {
    loginBusy = false;
    loginSubmit.disabled = false;
    loginCancel.disabled = false;
    loginSubmit.textContent = "进入";
  }
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST", credentials: "same-origin" });
  setEditing(false);
});

// ---------- Init ----------
// Populate the icon dropdown with built-in options (between "auto" and "custom").
(function populateIconOptions() {
  const select = document.getElementById("panelLogoSelect");
  const customOpt = select.querySelector('option[value="__custom__"]');
  for (const [slug, label] of ICON_OPTIONS) {
    const opt = document.createElement("option");
    opt.value = slug;
    opt.textContent = label;
    select.insertBefore(opt, customOpt);
  }
})();

// Keep the side panel below the sticky topbar, robust to header height changes.
function syncTopbarHeight() {
  const h = document.querySelector(".topbar").offsetHeight;
  document.documentElement.style.setProperty("--topbar-h", h + "px");
}
window.addEventListener("resize", syncTopbarHeight);
syncTopbarHeight();

load();
