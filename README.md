# Visual Studio · 品牌视觉工作台

Visual Studio 是一个部署在 Cloudflare Pages 上的品牌视觉工作台，当前包含 4 条主工作流：

1. **图片批量翻译** — 多图 x 多语言矩阵批量执行
2. **对话生图（画布模式）** — 无限画布 + AI 生图卡片 + 参考图连线 + AI 对话侧边栏
3. **批量换装** — 多模特 x 多服装矩阵换装
4. **风格迁移** — 提取视觉风格并应用到新主体

前端是原生 HTML/CSS/JavaScript 单页应用，后端是 Cloudflare Pages Functions。

## 当前进度

### 图片批量翻译 ✅

- 多图上传，按 `图片 x 目标语言` 矩阵批量执行
- 支持多目标语言、并发控制、自动重试、单格重试
- 可选"保留品牌 / SKU"
- 有 `Vision Key` 时走 OCR 规划 + OCR review + 重绘
- 支持结果预览、单项下载、全部下载
- 任务状态和已上传素材可在页面刷新后恢复

### 对话生图 — 画布模式 ✅ (Phase 1-4 已完成)

从聊天式交互全面重构为 **Lovart 画布模式**。四个阶段已全部完成：

| Phase | 内容 | 状态 |
|-------|------|------|
| Phase 1 | 后端直连生图 API (`POST /api/generate-direct`) | ✅ |
| Phase 2 | HTML 画布骨架（无限画布 + 工具栏 + 浮动面板 + AI 侧边栏） | ✅ |
| Phase 3 | CSS 画布样式（~370 行） | ✅ |
| Phase 4 | JS 画布引擎（~1500 行新代码） | ✅ |

**画布功能清单：**

- 无限画布，支持平移（空格+拖拽 / 中键拖拽）和缩放（滚轮 / +/- 按钮）
- 底部工具栏：选择 / 上传图片 / 添加文字 / AI 生图，点击直接触发动作
- 拖拽文件到画布直接添加图片元素
- 图片元素可拖拽移动、右键菜单（用此图生成 / 下载 / 删除）
- AI 生图卡片：虚线占位 → 选中弹出浮动参数面板（prompt / 模型 / 比例 / 参考图 / Agent 开关）→ 生成后替换为结果图
- 参考图连线流：选中图片 → "用此图生成" → 自动创建 SVG 连线 + 生图卡片
- AI 对话侧边栏：可展开收起，支持模型选择、比例选择、上传参考图、发送消息后结果自动放到画布
- 画布元素通过 localStorage 持久化，切换 tab 或刷新页面后恢复
- API 路径：`POST /api/generate-direct` → `callImageModel()` → relay

**模型支持：**

| 前端 modelId | 上游模型 |
|---|---|
| `nano-banana-2` | `gemini-3.1-flash-image-preview` |
| `nano-banana-pro` | `gemini-3-pro-image-preview` |
| `gpt-image-2` | `gpt-image-2` |

### 批量换装 ✅

- 多模特图 x 多服装图矩阵执行
- 服装角色：`full_outfit` / `dress` / `top` / `bottom` / `outerwear` / `accessory`
- 自动组合 look
- 支持并发控制、自动重试、单格重试
- 支持结果预览、单项下载、全部下载

### 风格迁移 ✅

- 上传源图 → 提取视觉风格（色板、标签、摘要）
- 上传主体参考图 → 基于提取的风格生成新图
- 支持历史记录

## 架构

```text
Browser SPA (public/app.js — 原生 JS 状态机)
  ├─ localStorage: keys / prefs / runtime (含画布元素)
  ├─ POST /api/assets/upload
  ├─ POST /api/generate-direct          ← 画布生图（Phase 1 新增）
  ├─ POST /api/jobs/translate-batch
  ├─ POST /api/jobs/outfit-batch
  ├─ POST /api/jobs/generate-turn       ← 旧对话生图（已弃用）
  ├─ POST /api/style-transfer
  ├─ GET  /api/jobs/:jobId
  ├─ GET  /api/jobs/:jobId/items
  ├─ GET  /api/conversations/:id/turns
  ├─ GET  /api/events/turns/:turnId
  └─ GET  /api/results/:assetId
         │
         ▼
Cloudflare Pages Functions
  ├─ functions/_shared.ts          — callImageModel / callTextModel / resolveKeys
  ├─ functions/_lib/v2-store.ts    — session / asset / job / turn 存储
  ├─ functions/_lib/v2-events.ts   — SSE 事件流
  ├─ functions/_lib/v2-runner.ts   — 批量任务执行器
  └─ functions/api/*               — 各接口实现
         │
         ├─ in-memory store (默认)
         ├─ optional R2 for asset/result blobs
         └─ 1xm.ai relay (OpenAI-compatible)
```

## 仓库结构

```text
public/
  index.html          — 单页 HTML（4 个 tab view）
  app.js              — 前端状态机（~3800 行）
  styles.css          — 全部样式

functions/
  _shared.ts          — 模型调用、密钥解析、公共工具
  _lib/
    v2-store.ts       — V2 存储抽象
    v2-events.ts      — V2 事件流
    v2-runner.ts      — V2 批量执行器
  api/
    generate-direct.ts — 画布直连生图 API
    generate.ts        — 旧对话生图 API（兼容保留）
    translate.ts       — 图片翻译
    outfit-swap.ts     — 换装
    style-transfer.ts  — 风格迁移
    assets/            — 素材上传/查询
    conversations/     — 对话管理
    events/            — SSE 事件查询
    jobs/              — 任务管理
    results/           — 结果查询

packages/
  contracts/v2.ts     — V2 类型定义
  core/               — 通用工具（crypto / hash / id / outfit-looks）

docs/
  platform-v2-spec.md      — V2 平台规格文档
  canvas-phase4-handoff.md — 画布重构交接文档
```

## 本地开发

```bash
npm install
npm run dev
# → http://127.0.0.1:8788/
```

## 部署

```bash
npm run deploy
# → wrangler pages deploy public --project-name=image-translator
```

## 配置与密钥

### 浏览器端 BYOK

设置弹窗支持：

- `Vision / Design Agent Key`
- `Nano Banana 2 Key`
- `Nano Banana Pro Key`
- `GPT Image 2 Key`

这些 key 只保存在当前浏览器的 `localStorage` 中。

### 服务端可选 secrets

```bash
wrangler pages secret put VISION_API_KEY     --project-name=image-translator
wrangler pages secret put BANANA2_API_KEY    --project-name=image-translator
wrangler pages secret put BANANA_PRO_API_KEY --project-name=image-translator
wrangler pages secret put GPT_IMAGE_API_KEY  --project-name=image-translator
wrangler pages secret put CREDENTIAL_KEK     --project-name=image-translator
wrangler pages secret put RELAY_BASE_URL     --project-name=image-translator
wrangler pages secret put GPT_IMAGE_GROUP    --project-name=image-translator
```

### 可选 R2 绑定

`wrangler.toml` 中预留：`VS_INPUTS_BUCKET` / `VS_RESULTS_BUCKET` / `VS_TEMP_BUCKET`。未配置时回退到内存存储。

## 当前边界

- 没有账号系统、团队协作、计费系统
- 没有 D1 / Queue consumer / Workflow / Durable Object 落地
- `public/app.js` 仍是单文件前端状态机，未拆成组件化架构
- 不配置 R2 时，V2 资产和结果不具备跨进程持久性
