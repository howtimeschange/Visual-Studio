# Visual Studio · 品牌视觉工作台

Visual Studio 是一个面向电商视觉设计、品牌素材本地化和广告素材运营的 Cloudflare Pages 应用。它把多图批处理、无限画布、AI 生图和项目管理整合在一个原生 HTML/CSS/JavaScript 单页工作台里。

仓库地址：<https://github.com/howtimeschange/Visual-Studio>

## 当前能力

- **首页**：OpenLovart 风格的中心对话入口，支持从一句设计需求进入画布；展示已有功能入口和最近画布项目。
- **画布**：无限画布、AI 生图卡片、参考图连线、AI 助手侧边栏、深浅色主题、画布项目自动保存。
- **项目管理**：列出已保存画布项目，支持新建、刷新、打开项目，画布路由使用 `/lovart/canvas?id=...`。
- **账号与共享**：支持邮箱密码注册/登录、HttpOnly session、项目 owner / viewer / editor 权限、邀请链接、共享项目列表和基础用量统计。
- **管理后台**：`/admin` 提供管理员用户列表、最近登录、在线推断、用量聚合、任务明细和 API 成本字段展示。
- **图片批量翻译**：多图 x 多语言矩阵批量执行，支持并发、自动重试、结果预览和下载。
- **批量换装**：多模特 x 多服装矩阵生成，支持服装角色分类、组合 look、重试和批量下载。
- **风格迁移**：上传风格源图提取视觉 DNA，再对新主体生成同风格图片。

## 主要页面

| 路径 | 页面 |
| --- | --- |
| `/` 或 `/lovart` | 首页 |
| `/lovart/canvas` | 画布 |
| `/lovart/projects` | 项目管理 |
| `/admin` | 管理员后台 |
| `/?view=translate` | 图片批量翻译 |
| `/?view=outfit` | 批量换装 |
| `/?view=style` | 风格迁移 |

## 画布功能

- 左侧工具栏：选择、移动、上传图片、文字、画笔、AI 生图。
- 图片元素支持移动、缩放、删除、下载，以及“用此图生成”。
- 生图卡片支持模型、画幅比例、分辨率 `1k / 2k / 4k`、参考图和 Agent 开关。
- AI 助手会读取当前画布上下文，判断是只做分析建议，还是生成图片并添加回画布。
- 首次进入画布默认展开 AI 助手。
- 画布项目通过 `/api/canvas/projects` 系列接口保存；localStorage 作为快速缓存和恢复兜底。
- 登录后，新建项目、素材、任务和对话会绑定到当前 user；匿名 session 下已有资源会在登录/注册时自动归属到账号。
- 项目可共享给 viewer 或 editor。viewer 只能查看，editor 可保存画布内容，owner 可邀请、修改和移除成员。

## 模型支持

| 前端 modelId | 上游模型 |
| --- | --- |
| `nano-banana-2` | `gemini-3.1-flash-image-preview` |
| `nano-banana-pro` | `gemini-3-pro-image-preview` |
| `gpt-image-2` | `gpt-image-2` |

`gpt-image-2` 使用 1xm.ai 的 OpenAI-compatible Images API：纯文本生图走 `/v1/images/generations`，带参考图或编辑走 `/v1/images/edits` multipart；不要走 chat completions。

## 架构

```text
Browser SPA (public/index.html + public/app.js)
  ├─ localStorage: keys / prefs / runtime / cached results
  ├─ GET/POST /api/canvas/projects
  ├─ POST    /api/auth/login|register|logout
  ├─ GET     /api/auth/me
  ├─ GET     /api/admin/overview|users|usage|jobs
  ├─ GET/POST /api/canvas/projects/:id/members
  ├─ POST    /api/canvas/agent
  ├─ POST    /api/generate-direct
  ├─ POST    /api/assets/upload
  ├─ POST    /api/jobs/translate-batch
  ├─ POST    /api/jobs/outfit-batch
  ├─ POST    /api/style-transfer
  └─ GET     /api/results/:assetId
         │
         ▼
Cloudflare Pages Functions
  ├─ functions/_shared.ts          — 模型调用、密钥解析、公共响应工具
  ├─ functions/_lib/v2-store.ts    — session / asset / job / turn / canvas project 存储
  ├─ functions/_lib/auth.ts        — 注册登录、HttpOnly session、密码校验
  ├─ functions/_lib/permissions.ts — 项目 owner / viewer / editor 校验
  ├─ functions/_lib/v2-events.ts   — 事件流
  ├─ functions/_lib/v2-runner.ts   — 批量任务执行器
  ├─ functions/_lib/v2-queue.ts    — Queue 调度抽象
  └─ functions/api/*               — HTTP API
         │
         ├─ D1 metadata store, with in-memory fallback
         ├─ optional R2 for asset/result blobs
         ├─ optional Queue consumer for durable jobs
         └─ 1xm.ai relay (OpenAI-compatible)
```

## 仓库结构

```text
public/
  index.html          — 单页 HTML，包含首页、画布和批处理视图
  app.js              — 前端状态机和交互逻辑
  styles.css          — 全部主题和页面样式
  _redirects          — Cloudflare Pages SPA 路由回退

functions/
  _shared.ts          — 模型调用、密钥解析、公共工具
  _lib/
    v2-store.ts       — V2 存储抽象
    auth.ts           — 账号、session cookie、密码 hash
    permissions.ts    — 项目权限校验
    v2-events.ts      — V2 事件流
    v2-runner.ts      — V2 批量执行器
    v2-queue.ts       — Queue 调度
  api/
    auth/             — 注册、登录、退出、当前账号
    admin/            — 管理员概览、用户、用量和任务查询
    canvas/           — 项目管理与 Canvas AI Agent
    generate-direct.ts
    generate.ts
    translate.ts
    outfit-swap.ts
    style-transfer.ts
    assets/
    jobs/
    results/

packages/
  contracts/v2.ts     — V2 类型定义
  core/               — 通用工具

docs/
  openlovart-canvas-migration-plan.md
  platform-v2-spec.md
  canvas-phase4-handoff.md
```

## 本地开发

```bash
npm install
npm run dev
```

默认地址：

```text
http://127.0.0.1:8788/
```

如果端口被占用，Wrangler 会提示新的本地端口。

## 验证

```bash
node --check public/app.js
node --check public/js/shared.js
npx wrangler pages functions build --outdir /tmp/image-translator-functions-check
npx wrangler deploy --config wrangler.queue.toml --dry-run
git diff --check
```

## 部署

```bash
npm run deploy
```

脚本会执行：

```bash
wrangler pages deploy public --project-name=image-translator
```

## 配置与密钥

### 浏览器端 BYOK

设置弹窗支持：

- `Vision / Design Agent Key`
- `Nano Banana 2 Key`
- `Nano Banana Pro Key`
- `GPT Image 2 Key`

未登录时，这些 Key 只保存在当前浏览器的 `localStorage` 中。登录后可以在设置里将 API Keys 加密保存到账号；后端只向前端返回保存状态和尾号，不返回完整 Key。账号级 Key 使用 `CREDENTIAL_KEK` 加密后写入 D1。

### 服务端可选 secrets

```bash
wrangler pages secret put VISION_API_KEY     --project-name=image-translator
wrangler pages secret put BANANA2_API_KEY    --project-name=image-translator
wrangler pages secret put BANANA_PRO_API_KEY --project-name=image-translator
wrangler pages secret put GPT_IMAGE_API_KEY  --project-name=image-translator
wrangler pages secret put RELAY_BASE_URL     --project-name=image-translator
wrangler pages secret put CREDENTIAL_KEK     --project-name=image-translator
wrangler pages secret put ADMIN_EMAILS       --project-name=image-translator
```

`ADMIN_EMAILS` 支持逗号分隔的管理员邮箱；也可使用 `ADMIN_USER_IDS` 指定用户 id。未配置管理员白名单时，`/admin` 和 `/api/admin/*` 会返回 403。

本地调试后台时可以临时注入管理员白名单：

```bash
npm run dev -- --binding ADMIN_EMAILS=owner@example.com
```

### 可选 R2 绑定

`wrangler.toml` 中已配置：

- `VS_INPUTS_BUCKET`
- `VS_RESULTS_BUCKET`
- `VS_TEMP_BUCKET`

### D1 / Queue 持久化

项目包含 D1 migration：

```bash
wrangler d1 create visual-studio
wrangler d1 migrations apply visual-studio --local
wrangler d1 migrations apply visual-studio --remote
```

将创建得到的 `database_id` 写回 `wrangler.toml` 和 `wrangler.queue.toml`。批量任务默认仍使用 Pages `waitUntil` 本地执行；部署队列消费者后可切换为 Queue 执行：

```bash
npm run deploy:queue
```

然后将 `VS_QUEUE_EXECUTION_MODE` 设置为 `queue`。未配置 D1/R2 时，服务端会回退到内存存储；适合本地验证，不适合作为生产持久化。

## 当前边界

- 账号、项目归属、成员权限、邀请共享和用量统计已落地；实时多人协同编辑尚未落地。
- 计费扣款系统尚未落地；当前后台已保留 `input_tokens`、`output_tokens` 和 `api_cost_usd` 字段，实际成本需要上游返回或后续计价逻辑写入。
- Workflow、Durable Object 尚未落地；当前任务可靠性由 D1 + R2 + Queue consumer + 恢复端点承担。
- `public/app.js` 已开始拆分纯工具模块，页面状态机和大部分 DOM 逻辑仍在主文件内，后续可继续按视图拆分。
- 不配置 D1 / R2 时，服务端内存数据不具备跨进程持久性。
