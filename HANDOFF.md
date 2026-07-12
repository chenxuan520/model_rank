# HANDOFF — model_rank 交接文档

> 给接手的 agent：这份文档描述当前真实状态、架构、以及**尚未完成的需求**。请先读完再动手。

## 0. 一句话现状

个人主观大模型测评榜。默认只读，输密码进编辑态可增删/拖动模型、拖动多条基准线、打标签、写评论。已上线 Cloudflare Pages。**本次会话有一批改动已提交并推送到 git，但尚未部署到线上**（见 §3）。

## 1. 关键坐标

- **GitHub**: https://github.com/chenxuan520/model_rank （public）
- **线上地址**: https://model-rank-7ge.pages.dev/
- **Cloudflare 账号**: chenxuan（wrangler 已登录，`npx wrangler whoami` 可查）
- **Cloudflare Pages 项目名**: `model-rank`
- **KV namespace id**: `901de0bc18c74706b06b6c8e0a934c64`（已写死在 `wrangler.jsonc`）
- **编辑密码**: `123456`
  - 线上：存在 Cloudflare secret `EDIT_PASSWORD`
  - 本地：写在 `.dev.vars`（已 gitignore，不进仓库）

## 2. 提交身份（重要，勿用工作邮箱）

本仓库已设 local git 身份，提交前务必确认：
```
git config user.name   # chenxuan
git config user.email  # 1607772321@qq.com
```
仓库是 public，全局身份是工作邮箱，**不要用全局身份提交**，否则工作邮箱会进公开历史。

## 3. 部署状态（务必留意）

- 线上当前跑的是 commit `867c026`（极光背景 + 段位配色 + 品牌图标），**不含**本次会话的「hero 大标题 / 多基准线 / 图标下拉框」。
- 本次会话的改动已 commit + push 到 git，但**没有 `wrangler pages deploy`**。原因：多基准线/评论等功能仍有未完成项（见 §6），不适合直接上线。
- 想部署时执行（Direct Upload，GitHub 不自动触发部署）：
  ```bash
  npx wrangler pages deploy public --project-name=model-rank --commit-dirty=true
  ```

## 4. 本地开发 / 验证

```bash
npm install
npx wrangler pages dev --port 8788 --ip 127.0.0.1
# 打开 http://127.0.0.1:8788/ ，编辑密码 123456
```
- 本地用内存模拟 KV，**重启 dev server 会清空本地数据**，回落到 `functions/api/data.js` 里的 `defaultBoard()`。
- 改了 `.dev.vars` 必须重启 dev server 才生效。
- **验证只能用 Chrome DevTools MCP**（项目规范），reload 记得 `ignoreCache` 绕缓存，否则 `.js/.css` 会被 http server 缓存导致“代码对但页面不对”。

## 5. 架构 & 代码地图

```
public/
  index.html   # 结构：topbar / hero / #boardInner(方块+线) / 侧栏 panel / 登录 modal
  app.js       # 全部前端逻辑（原生 JS，无框架）
  styles.css   # 暗色主题 + 极光背景 + hero + 线/方块/面板样式
  icons/*.svg  # 本地托管的品牌图标（见 §7）
functions/api/
  _auth.js     # HMAC 派生 token + cookie 校验
  login.js     # POST 校验密码 -> 发 HttpOnly cookie
  logout.js    # POST 清 cookie
  data.js      # GET 读(公开) / PUT 整份覆盖(需鉴权) + sanitize + defaultBoard
wrangler.jsonc # name / pages_build_output_dir=public / kv_namespaces
```

### 数据结构（KV 单 key `board`，整份 JSON）
```jsonc
{
  "productionLineY": 0.6,            // 生产线高度 0~1
  "productionLineLabel": "生产级别线", // 生产线文字（本次新增，可编辑）
  "lines": [                          // 自由基准线数组（本次新增）
    { "id": "l_xxx", "y": 0.45, "label": "第一梯队基准线" }
  ],
  "models": [
    { "id": "m_xxx", "name": "GPT-X", "logo": "",
      "x": 0.3, "y": 0.82, "tags": ["代码强"],
      "comments": [ { "id":"c1","text":"...","createdAt":0,"updatedAt":0 } ] }
  ]
}
```
- 坐标全部 **0~1 相对值**；渲染时 `top=(1-y)*高`。`y` 越大越靠上=越强。
- `logo` 字段：空=按名字自动识别；内置 slug（如 `deepseek-icon`）=指定内置图标；`http(s)://` 或 `data:` =自定义图片。
- **向后兼容**：`load()` 里对老数据补 `productionLineLabel` / `lines`；后端 `sanitize()` 也会补默认值。

### 前端关键函数（`public/app.js`）
- `render()` -> `renderBlocks()` / `renderLine()` / `renderCustomLines()`
- `startLineDrag(e, getY, setY, onMove)`：生产线和自定义线共用的拖拽逻辑
- `applyTier()/refreshTiers()`：按是否在生产线以上给方块上色（绿=可上生产）
- 图标：`BRAND_MAP`（名字关键词->图标）、`ICON_OPTIONS`（下拉框选项）、`iconUrl()`、`makeIcon()`、`letterAvatar()`（兜底彩色首字母）
- 面板图标下拉：`syncLogoControls()` + `#panelLogoSelect` change 事件 + `#panelLogoInput`(自定义URL)

## 6. 未完成 / 待办（用户明确提出，按优先级）

1. **删除「Microsoft / Phi」和「NVIDIA」两个内置图标**
   - 参考本次删 Mistral / Hugging Face 的做法：删 `public/icons/microsoft-icon.svg`、`public/icons/nvidia-mark.svg`；从 `app.js` 的 `BRAND_MAP` 和 `ICON_OPTIONS` 移除对应项（BRAND_MAP 里 `phi/copilot/nvidia/nemotron` 几行）。

2. **基准线改名难发现 → 改成「点击编辑」交互**
   - 现状：线的文字标签是内联 `contentEditable`，用户反馈“找不到怎么改名”。
   - 期望：显式的编辑入口（例如点标签弹出输入，或标签旁加“编辑”小按钮），不要纯靠内联可编辑。
   - 相关代码：`renderCustomLines()` 里的 `.custom-line-label`，以及生产线 `.prod-line-label` 的 `input` 事件。

3. **评论要能删除**
   - 现状：评论只能新增（`commentAddBtn`）和编辑（`startEditComment`），**没有删除**。
   - 期望：每条评论在编辑态显示删除按钮，删掉后 `scheduleSave()`。
   - 相关代码：`renderComments()`（在 meta 行里，编辑态除了“编辑”再加“删除”）。

> 说明：以上 3 项本次会话**未做**。第 1 项最简单，2/3 项涉及交互。

## 7. 当前内置图标清单（`public/icons/`）

openai-icon, claude-icon, anthropic-icon, gemini-star, meta-icon, deepseek-icon,
grok-icon, qwen-icon, kimi, doubao, glm, microsoft-icon(待删), nvidia-mark(待删), cursor

- 图标来源：Iconify `logos`/`simple-icons` 的方形变体，本地托管（不依赖运行时 CDN）。
- Kimi / 豆包 / GLM 无可靠彩色方形官方 logo，用品牌色+首字/缩写做的**原创方块**（非商标复制）。若拿到官方 SVG 可直接替换同名文件。
- 找新图标：`curl "https://api.iconify.design/logos/<slug>.svg"`（单条测；注意 zsh 下 for 循环里连着 head 管道可能报 curl not found，逐条 curl 即可）。优先选方形 `-icon` 变体，宽的 wordmark 在小方块里会被压扁。

## 8. 约定与坑

- 部署方式是 **Direct Upload**（`wrangler pages deploy`），GitHub push **不会**自动部署。想要 push 自动部署需去 Cloudflare Dashboard 把 Pages 项目连 GitHub（一次性，代码不用改）。
- `wrangler.jsonc` 里的 KV id 是资源标识不是密钥，进 public 仓库没问题。
- 面板会盖住 topbar 的问题已修（topbar sticky + `--topbar-h` 变量把 panel 顶下来）。
- 未登录 PUT `/api/data` 返回 401；GET 公开。
