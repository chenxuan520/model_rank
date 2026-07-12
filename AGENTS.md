# AGENTS.md — model_rank

给在本仓库工作的 AI agent 的规则。**动手前先读本文件 + [HANDOFF.md](./HANDOFF.md)**（HANDOFF 讲现状/坐标/待办，本文件讲规矩）。

## 项目一句话

个人主观大模型测评榜。纯前端（原生 HTML/CSS/JS）+ Cloudflare Pages Functions + KV。默认只读，输密码进编辑态。

## 提交身份（硬性，勿踩）

- 仓库是 **public**。提交前务必确认 local 身份：
  ```bash
  git config user.name   # 必须是 chenxuan
  git config user.email  # 必须是 1607772321@qq.com
  ```
- **不要用全局身份**（那是工作邮箱），否则工作邮箱进公开历史。
- commit message 用**英文**，沿用仓库已有风格（先 `git log --oneline -n 10` 看历史，别自己发明格式）。
- **不要自作主张 `git commit` / `git push`**，除非用户在当前任务里明确要求。

## 改动纪律

- 只写解决当前需求的最少代码；不做用户没要求的“顺手优化/重构/加灵活性”。
- 外科手术式改动：只碰必须碰的；只清理**因自己改动**产生的死代码，不动本来就存在的无关代码。
- 每一行改动都要能追溯到用户当前需求。

## 工程约定（本仓库特有）

- **无框架**：前端全是原生 JS，别引入 npm 前端依赖 / 构建步骤 / 框架。
- **数据只走 KV**：不要把榜单数据写进仓库文件。数据结构见 HANDOFF §5，改结构时**前端 `load()` 和后端 `sanitize()`/`defaultBoard()` 三处要同步**并保持向后兼容。
- **坐标是 0~1 相对值**：渲染 `top=(1-y)*高`，`y` 越大越靠上=越强。别改成像素绝对值。
- **图标本地托管**在 `public/icons/`，不依赖运行时 CDN。加图标时选方形 `-icon` 变体（wordmark 会被压扁）；改 `BRAND_MAP`（自动识别）和 `ICON_OPTIONS`（下拉框）两处。
- **密码/secret 不进仓库**：本地在 `.dev.vars`（已 gitignore），线上在 Cloudflare secret。

## 本地运行 & 验证

```bash
npm install
npx wrangler pages dev --port 8788 --ip 127.0.0.1   # 密码 123456
```
- 改 `.dev.vars` 或 `functions/` 后需**重启 dev server**；本地 KV 是内存态，重启即清空回落到 `defaultBoard()`。
- **验证只用 Chrome DevTools MCP**（不要 headless chrome / puppeteer / playwright / 截图脚本）。
- 前端改完“代码对但页面不对”，第一嫌疑是缓存：reload 用 `navigate_page { type:"reload", ignoreCache:true }`，别用 `fetch('x.js?probe=')` 自证。

## 部署（Direct Upload，不自动触发）

```bash
npx wrangler pages deploy public --project-name=model-rank --commit-dirty=true
```
- GitHub push **不会**自动部署。部署前确认功能完整，别把半成品推上线。
- 线上密码：`npx wrangler pages secret put EDIT_PASSWORD --project-name=model-rank`

## Edit 工具注意

`Read 目标段 -> Edit` 要连续，中间不要插任何其它工具调用，否则报 `File has not been read yet`。失败后先重新 Read 再改。

## 沟通

- 全程中文。
- 想不清/有歧义先问，别闷头猜着实现。
