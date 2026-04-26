# Visual Studio · 品牌视觉工作台

Visual Studio 是一个面向电商视觉设计、品牌素材本地化和广告素材运营的 Cloudflare Pages 应用。它把多图批处理、无限画布、AI 生图和项目管理整合在一个原生 HTML/CSS/JavaScript 单页工作台里。

仓库地址：<https://github.com/howtimeschange/Visual-Studio>

## 当前能力

- **首页**：OpenLovart 风格的中心对话入口，支持从一句设计需求进入画布；展示已有功能入口和最近画布项目。
- **画布**：无限画布、AI 生图卡片、参考图连线、AI 助手侧边栏、深浅色主题、画布项目自动保存。
- **项目管理**：列出已保存画布项目，支持新建、刷新、打开项目，画布路由使用 `/lovart/canvas?id=...`。
- **图片批量翻译**：多图 x 多语言矩阵批量执行，支持并发、自动重试、结果预览和下载。
- **批量换装**：多模特 x 多服装矩阵生成，支持服装角色分类、组合 look、重试和批量下载。
- **风格迁移**：上传风格源图提取视觉 DNA，再对新主体生成同风格图片。

## 主要页面

| 路径 | 页面 |
| --- | --- |
| `/` 或 `/lovart` | 首页 |
| `/lovart/canvas` | 画布 |
| `/lovart/projects` | 项目管理 |
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

## 模型支持

| 前端 modelId | 上游模型 |
| --- | --- |
| `nano-banana-2` | `gemini-3.1-flash-image-preview` |
| `nano-banana-pro` | `gemini-3-pro-image-preview` |
| `gpt-image-2` | `gpt-image-2` |

## 架构

```text
Browser SPA (public/index.html + public/app.js)
  ├─ localStorage: keys / prefs / runtime / cached results
  ├─ GET/POST /api/canvas/projects
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
  ├─ functions/_lib/v2-events.ts   — 事件流
  ├─ functions/_lib/v2-runner.ts   — 批量任务执行器
  └─ functions/api/*               — HTTP API
         │
         ├─ in-memory store (默认)
         ├─ optional R2 for asset/result blobs
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
    v2-events.ts      — V2 事件流
    v2-runner.ts      — V2 批量执行器
  api/
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
npx wrangler pages functions build --outdir /tmp/image-translator-functions-check
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

这些 Key 只保存在当前浏览器的 `localStorage` 中。

### 服务端可选 secrets

```bash
wrangler pages secret put VISION_API_KEY     --project-name=image-translator
wrangler pages secret put BANANA2_API_KEY    --project-name=image-translator
wrangler pages secret put BANANA_PRO_API_KEY --project-name=image-translator
wrangler pages secret put GPT_IMAGE_API_KEY  --project-name=image-translator
wrangler pages secret put GPT_IMAGE_GROUP    --project-name=image-translator
wrangler pages secret put RELAY_BASE_URL     --project-name=image-translator
wrangler pages secret put CREDENTIAL_KEK     --project-name=image-translator
```

### 可选 R2 绑定

`wrangler.toml` 中预留：

- `VS_INPUTS_BUCKET`
- `VS_RESULTS_BUCKET`
- `VS_TEMP_BUCKET`

未配置 R2 时，资产、结果和项目数据回退到内存存储；适合本地验证，不适合作为生产持久化。

## 当前边界

- 没有账号系统、团队协作、计费系统。
- 没有 D1、Queue consumer、Workflow、Durable Object 落地。
- `public/app.js` 仍是单文件前端状态机，尚未组件化拆分。
- 不配置 R2 / 持久化数据库时，服务端内存数据不具备跨进程持久性。
