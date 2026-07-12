"use strict";

// ---------- State ----------
let board = { productionLineY: 0.6, productionLineLabel: "生产级别线", lines: [], models: [] };
let editing = false;
let selectedId = null;
let saveTimer = null;

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

function fmtTime(ts) {
  const d = new Date(ts);
  const p = (n) => String(n).padStart(2, "0");
  return `${d.getFullYear()}-${p(d.getMonth() + 1)}-${p(d.getDate())} ${p(d.getHours())}:${p(d.getMinutes())}`;
}

function getModel(id) {
  return board.models.find((m) => m.id === id);
}

// ---------- Brand icons ----------
// Auto-detect a vendor logo from the model name. Icons are bundled locally in
// /icons (colored brand SVGs). Falls back to a colored letter avatar so every
// model always shows something on the left.
const ICON_BASE = "icons/";

// keyword (lowercased, matched as substring) -> local icon file (no extension)
const BRAND_MAP = [
  ["gpt", "openai-icon"],
  ["openai", "openai-icon"],
  ["o1", "openai-icon"],
  ["o3", "openai-icon"],
  ["chatgpt", "openai-icon"],
  ["claude", "claude-icon"],
  ["anthropic", "anthropic-icon"],
  ["gemini", "gemini-star"],
  ["palm", "gemini-star"],
  ["google", "gemini-star"],
  ["llama", "meta-icon"],
  ["meta", "meta-icon"],
  ["deepseek", "deepseek-icon"],
  ["grok", "grok-icon"],
  ["qwen", "qwen-icon"],
  ["通义", "qwen-icon"],
  ["千问", "qwen-icon"],
  ["kimi", "kimi"],
  ["moonshot", "kimi"],
  ["月之暗面", "kimi"],
  ["doubao", "doubao"],
  ["豆包", "doubao"],
  ["glm", "glm"],
  ["chatglm", "glm"],
  ["zhipu", "glm"],
  ["智谱", "glm"],
  ["phi", "microsoft-icon"],
  ["copilot", "microsoft-icon"],
  ["nvidia", "nvidia-mark"],
  ["nemotron", "nvidia-mark"],
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
  ["doubao", "豆包 Doubao"],
  ["glm", "GLM 智谱"],
  ["microsoft-icon", "Microsoft / Phi"],
  ["nvidia-mark", "NVIDIA"],
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
async function load() {
  const res = await fetch("/api/data");
  board = await res.json();
  // backward compat for boards saved before labeled lines existed
  if (typeof board.productionLineLabel !== "string") board.productionLineLabel = "生产级别线";
  if (!Array.isArray(board.lines)) board.lines = [];
  render();
}

// ---------- Save (debounced) ----------
function scheduleSave() {
  if (!editing) return;
  saveStatus.textContent = "…";
  clearTimeout(saveTimer);
  saveTimer = setTimeout(save, 600);
}

async function save() {
  try {
    const res = await fetch("/api/data", {
      method: "PUT",
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(board),
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
    boardInner.appendChild(el);
  }
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
  label.textContent = board.productionLineLabel || "生产级别线";
  label.contentEditable = editing ? "plaintext-only" : "false";
  label.classList.toggle("editable", editing);
}

// Render the custom labeled baseline lines (below the main production line).
function renderCustomLines() {
  boardInner.querySelectorAll(".custom-line").forEach((el) => el.remove());
  for (const ln of board.lines) {
    const el = document.createElement("div");
    el.className = "prod-line custom-line";
    el.dataset.id = ln.id;
    el.style.top = (1 - ln.y) * 100 + "%";

    const label = document.createElement("span");
    label.className = "line-label custom-line-label";
    label.textContent = ln.label || "基准线";
    label.contentEditable = editing ? "plaintext-only" : "false";
    label.classList.toggle("editable", editing);
    label.addEventListener("input", () => {
      ln.label = label.textContent.trim();
      scheduleSave();
    });
    label.addEventListener("keydown", (ev) => {
      if (ev.key === "Enter") { ev.preventDefault(); label.blur(); }
    });
    el.appendChild(label);

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

// ---------- Block drag + click ----------
let drag = null;

function onBlockPointerDown(e) {
  const id = e.currentTarget.dataset.id;
  if (!editing) {
    // read-only: treat as click to open panel
    openPanel(id);
    return;
  }
  e.preventDefault();
  const el = e.currentTarget;
  const rect = boardInner.getBoundingClientRect();
  drag = {
    id,
    el,
    rect,
    moved: false,
    startX: e.clientX,
    startY: e.clientY,
  };
  el.setPointerCapture(e.pointerId);
  el.classList.add("dragging");
  el.addEventListener("pointermove", onBlockPointerMove);
  el.addEventListener("pointerup", onBlockPointerUp);
}

function onBlockPointerMove(e) {
  if (!drag) return;
  if (Math.abs(e.clientX - drag.startX) > 3 || Math.abs(e.clientY - drag.startY) > 3) {
    drag.moved = true;
  }
  const x = clamp01((e.clientX - drag.rect.left) / drag.rect.width);
  const y = clamp01(1 - (e.clientY - drag.rect.top) / drag.rect.height);
  drag.el.style.left = x * 100 + "%";
  drag.el.style.top = (1 - y) * 100 + "%";
  const m = getModel(drag.id);
  if (m) {
    m.x = x;
    m.y = y;
    applyTier(drag.el, m); // recolor live as it crosses the line
  }
}

function onBlockPointerUp(e) {
  if (!drag) return;
  const { el, id, moved } = drag;
  el.classList.remove("dragging");
  el.removeEventListener("pointermove", onBlockPointerMove);
  el.removeEventListener("pointerup", onBlockPointerUp);
  drag = null;
  if (moved) {
    scheduleSave();
  } else {
    openPanel(id); // a tap without moving opens the panel
  }
}

// ---------- Line drag (shared by production line + custom lines) ----------
// getY/setY read and write the line's y; onMove runs after each update.
function startLineDrag(e, getY, setY, onMove) {
  if (!editing) return;
  // don't start a drag when interacting with the editable label / delete btn
  if (e.target.closest(".line-label, .line-del")) return;
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

// production line label is editable in place
const prodLabel = prodLine.querySelector(".prod-line-label");
prodLabel.addEventListener("input", () => {
  board.productionLineLabel = prodLabel.textContent.trim();
  scheduleSave();
});
prodLabel.addEventListener("keydown", (ev) => {
  if (ev.key === "Enter") { ev.preventDefault(); prodLabel.blur(); }
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
  updatePanelIcon(m);

  renderTags(m);
  renderComments(m);
  panel.hidden = false;
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
        scheduleSave();
      });
      el.appendChild(x);
    }
    wrap.appendChild(el);
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
    scheduleSave();
  }
  e.target.value = "";
});

// comment add
document.getElementById("commentAddBtn").addEventListener("click", () => {
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
  closePanel();
  renderBlocks();
  scheduleSave();
});

document.getElementById("panelClose").addEventListener("click", closePanel);

// ---------- Add model ----------
document.getElementById("addBtn").addEventListener("click", () => {
  const now = Date.now();
  const m = {
    id: uid("m_"),
    name: "新模型",
    logo: "",
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

// ---------- Add baseline line ----------
document.getElementById("addLineBtn").addEventListener("click", () => {
  const ln = { id: uid("l_"), y: 0.4, label: "新基准线" };
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
  renderLine();        // toggle production-line label editability
  renderCustomLines(); // toggle custom-line labels + delete buttons
  if (selectedId) openPanel(selectedId); // refresh panel edit controls
}

// ---------- Login ----------
const loginModal = document.getElementById("loginModal");
document.getElementById("loginBtn").addEventListener("click", () => {
  loginModal.hidden = false;
  document.getElementById("loginError").hidden = true;
  document.getElementById("passwordInput").value = "";
  document.getElementById("passwordInput").focus();
});
document.getElementById("loginCancel").addEventListener("click", () => {
  loginModal.hidden = true;
});
document.getElementById("loginSubmit").addEventListener("click", doLogin);
document.getElementById("passwordInput").addEventListener("keydown", (e) => {
  if (e.key === "Enter") doLogin();
});

async function doLogin() {
  const pw = document.getElementById("passwordInput").value;
  const res = await fetch("/api/login", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ password: pw }),
  });
  if (res.ok) {
    loginModal.hidden = true;
    setEditing(true);
  } else {
    document.getElementById("loginError").hidden = false;
  }
}

document.getElementById("logoutBtn").addEventListener("click", async () => {
  await fetch("/api/logout", { method: "POST" });
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
