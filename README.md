# model_rank

个人主观的大模型测评榜。默认只读；输入密码后进入编辑态，可以增删/拖动模型方块、拖动「生产级别线」、打标签、写带时间线的评论。

- 前端：原生 HTML/CSS/JS（`public/`）
- 后端：Cloudflare Pages Functions（`functions/api/`）
- 存储：Cloudflare KV（单 key `board`，整份 JSON）
- 鉴权：密码存 Cloudflare secret，登录后发 HttpOnly cookie；密码和数据都不进仓库

## 榜单规则

- 纵轴 = 评价高低，方块拖得越高越强。
- 横轴 = 自由摆放，仅避免重叠，无额外含义。
- 一条可拖动的「生产级别线」：线以上=可上生产，线以下=还不够格。

## 本地开发

```bash
npm install
# 本地密码写在 .dev.vars（已 gitignore）：EDIT_PASSWORD="dev-password"
npx wrangler pages dev
```

打开终端提示的本地地址即可。本地会用内存模拟 KV。

## 部署（Cloudflare，Direct Upload）

```bash
# 1. 登录（浏览器授权一次）
npx wrangler login

# 2. 建 KV namespace，把返回的 id 填进 wrangler.jsonc 的 kv_namespaces[0].id
npx wrangler kv namespace create MODEL_RANK_KV

# 3. 部署（首次会自动创建 Pages 项目）
npx wrangler pages deploy

# 4. 设置线上编辑密码
npx wrangler pages secret put EDIT_PASSWORD
```

> 说明：本项目走 wrangler Direct Upload 部署，GitHub 仓库仅用于代码托管。
> 若想改成 push 自动部署，可在 Cloudflare Dashboard 里把 Pages 项目连接到该 GitHub 仓库（一次性操作，代码无需改动）。
