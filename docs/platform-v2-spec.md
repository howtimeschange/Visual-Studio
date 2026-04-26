# Visual Studio Canonical Spec

> 状态：当前仓库唯一有效的规格文档。  
> 本文档同时覆盖“当前实现”与“下一阶段演进边界”，替代此前拆开的 `refactor-spec.md` 与旧版目标 spec。

## 1. 文档定位

本文档是当前仓库的唯一 canonical spec，用来回答 4 件事：

1. 这个项目现在是什么
2. 当前代码已经实现到哪一层
3. 哪些行为必须保持兼容
4. 如果继续做 V2，下一步应该沿什么方向扩展

约束：

- README 只保留高层说明，详细约束以本文为准
- 文档与源码冲突时，以源码为准，再回写本文
- 仓库内不再维护第二份“历史说明书”或“未来 spec”

## 2. 项目一句话

Visual Studio 是一个面向电商与品牌视觉团队的云端视觉工作台，当前提供：

1. 图片批量翻译
2. 对话生图
3. 批量换装

它运行在 Cloudflare Pages 上，前端是原生 JS SPA，后端是 Pages Functions。当前版本已经完成了 V2 foundation 的原地升级：

- 前端默认走 `assets + jobs + conversations + events + results`
- 引入了 `session / asset / job / job item / conversation / turn / event / sealed credential`
- 保留旧同步接口作为兼容层

但它还不是最终形态的独立多 Worker 平台：

- 还没有 D1
- 还没有 Queue consumer
- 还没有 Workflow
- 还没有 Durable Object event hub

## 3. 当前实现状态

### 3.1 已经完成的部分

- 三条业务工作流完整可用
- 前端素材上传已经切到 `assetId`
- 翻译与换装页面默认提交 V2 batch job
- 对话生图默认提交 `conversation + generate-turn`
- 前端会把 `sessionId / jobId / conversationId / assetId` 落到本地 runtime storage
- 页面刷新后会尝试恢复：
  - 已上传素材
  - 进行中的翻译任务
  - 进行中的换装任务
  - 最近的生图会话和 turn
- 服务端有 V2 runner、事件发布和可选 R2 资产持久化

### 3.2 仍未完成的部分

- 没有 D1 持久化 job / turn / event 元数据
- 没有 Queue 削峰和真正的后台 durable consumer
- 没有 Workflow 化的长任务编排
- 没有 DO / WebSocket 级实时事件分发
- 默认 store 仍是内存 map；不配 R2 时不具备跨进程持久性

### 3.3 当前运行形态

当前仓库应被理解为：

- 一个已经切到 V2 交互模型的 Pages 单仓
- 不是旧版同步 demo
- 也不是最终独立平台
- 而是 “V2 in-place foundation”

## 4. 用户可见能力

### 4.1 图片批量翻译

必须保持的行为：

- 多图上传
- 多目标语言矩阵执行
- 模型切换
- `保留品牌 / SKU` 开关
- 并发控制
- 自动重试
- 单格重试
- 结果预览与下载
- OCR 摘要反馈

当前实现说明：

- UI 默认调用 `POST /api/jobs/translate-batch`
- 每个矩阵格子对应一个 `translate_cell` job item
- 页面通过 `GET /api/jobs/:jobId` 和 `GET /api/jobs/:jobId/items` 轮询同步状态
- 单格重试通过 `POST /api/jobs/:jobId/items/:itemId/retry`
- 结果图通过 `/api/results/:assetId` 拉取

保底兼容：

- `POST /api/translate` 仍保留，可直接执行单张翻译

### 4.2 对话生图

必须保持的行为：

- 多轮对话
- 参考图角色：
  - `character`
  - `subject`
  - `style`
  - `scene`
  - `other`
- 基于上一轮结果继续生成
- Design Agent 开关
- 设计步骤 / live brief / 状态反馈
- 本轮失败后可重试
- 结果预览与下载

当前实现说明：

- UI 默认调用 `POST /api/jobs/generate-turn`
- 每次请求会写入一个 `conversation turn`
- 前端通过 `GET /api/conversations/:id/turns` 恢复历史
- 当前 turn 通过 `GET /api/events/turns/:turnId` 获取事件
- 事件接口返回 `text/event-stream`，但当前浏览器实现是反复 fetch 的 SSE-compatible 轮询，不是单条长驻 `EventSource`

保底兼容：

- `POST /api/generate` 仍保留，返回 NDJSON 流

### 4.3 批量换装

必须保持的行为：

- 多模特图上传
- 多服装图上传
- 服装角色：
  - `full_outfit`
  - `dress`
  - `top`
  - `bottom`
  - `outerwear`
  - `accessory`
- 自动组合 look
- `模特 x look` 矩阵执行
- 自动重试
- 单格重试
- 结果预览与下载

当前实现说明：

- UI 默认调用 `POST /api/jobs/outfit-batch`
- 每个矩阵格子对应一个 `outfit_cell` job item
- 页面通过 `GET /api/jobs/:jobId` 和 `GET /api/jobs/:jobId/items` 同步状态
- 单格重试通过 `POST /api/jobs/:jobId/items/:itemId/retry`

保底兼容：

- `POST /api/outfit-swap` 仍保留，可直接执行单次换装

## 5. 当前运行架构

```text
Browser SPA
  ├─ localStorage(keys/prefs/runtime)
  ├─ upload -> /api/assets/upload
  ├─ translate -> /api/jobs/translate-batch
  ├─ outfit -> /api/jobs/outfit-batch
  ├─ generate -> /api/jobs/generate-turn
  ├─ restore -> /api/assets/:id?includeData=1
  ├─ job sync -> /api/jobs/:jobId + /api/jobs/:jobId/items
  ├─ turn restore -> /api/conversations/:id/turns
  ├─ event sync -> /api/events/jobs/:jobId or /api/events/turns/:turnId
  └─ result fetch -> /api/results/:assetId
         │
         ▼
Cloudflare Pages Functions
  ├─ _shared.ts      # key resolution, relay calling, image extraction
  ├─ v2-store.ts     # sessions/assets/jobs/turns/events/credentials
  ├─ v2-events.ts    # event append + wait
  ├─ v2-runner.ts    # submit + background execution
  └─ api/*
         │
         ├─ in-memory metadata store
         ├─ optional R2 blobs
         └─ 1xm.ai relay
```

## 6. 数据模型

当前 contract 定义在 [`packages/contracts/v2.ts`](../packages/contracts/v2.ts)。

### 6.1 Session

作用：

- 给一轮浏览器工作台运行分配稳定的 `sessionId`
- 关联 asset / job / conversation

当前状态：

- 元数据存在内存 store
- 前端会把 `sessionId` 存到 `img-translator:runtime:v2`

### 6.2 Asset

作用：

- 统一表示上传图、参考图、结果图

关键字段：

- `id`
- `sessionId`
- `kind`
- `mime`
- `filename`
- `r2Key`
- `sha256`

当前行为：

- `POST /api/assets/upload` 创建 asset
- 如果配置了 `VS_INPUTS_BUCKET / VS_RESULTS_BUCKET`，blob 写入 R2
- 否则 data URL 只存内存 map

### 6.3 Job

作用：

- 表示一个 batch 或 turn 级任务

当前 job type：

- `translate_batch`
- `outfit_batch`
- `generate_turn`

当前 job status：

- `queued`
- `running`
- `completed`
- `partial_failed`
- `failed`
- `cancelled`

### 6.4 Job Item

作用：

- 表示 job 下的单个执行单元

当前 item type：

- `translate_cell`
- `outfit_cell`
- `generate_turn_step`

当前 item status：

- `queued`
- `running`
- `completed`
- `failed`
- `cancelled`

### 6.5 Conversation / Turn

作用：

- 管理对话生图历史

当前字段重点：

- `conversation.id`
- `turn.id`
- `turn.userMessage`
- `turn.modelId`
- `turn.useDesignAgent`
- `turn.previousTurnId`
- `turn.requestJson`
- `turn.traceJson`
- `turn.resultAssetId`

### 6.6 Runtime Event

作用：

- 让前端恢复和推进 job / turn 状态

当前 scope：

- `job`
- `turn`
- `item`

当前 event type 包括：

- `status`
- `trace`
- `progress`
- `job_progress`
- `item_started`
- `item_completed`
- `item_failed`
- `job_completed`
- `live_brief`
- `result`
- `error`

### 6.7 Sealed Credential

作用：

- V2 job 在后台执行前，临时封存本次请求携带的 `clientKeys`

当前行为：

- runner 用 `CREDENTIAL_KEK` 做 AES-GCM 封存
- 未配置时回退到内置 local dev key
- 生产环境必须显式设置 `CREDENTIAL_KEK`

## 7. 浏览器端状态与持久化

当前前端状态主文件是 [`public/app.js`](../public/app.js)。

### 7.1 localStorage keys

- `img-translator:keys:v1`
- `img-translator:workbench:prefs:v1`
- `img-translator:prefs:v1`：旧版翻译偏好兼容
- `img-translator:runtime:v2`

### 7.2 runtime storage 当前保存的内容

- `sessionId`
- translate:
  - `jobId`
  - 上传图片对应的 `assetId`
- generate:
  - `conversationId`
  - `jobId`
  - 参考图对应的 `assetId`
- outfit:
  - `jobId`
  - 模特图与服装图对应的 `assetId`

### 7.3 刷新恢复逻辑

刷新后，前端会：

1. 从 runtime storage 读取 `sessionId / jobId / conversationId / assetId`
2. 调 `/api/assets/:id?includeData=1` 恢复素材预览
3. 调 `/api/jobs/:jobId` 与 `/items` 恢复翻译/换装任务状态
4. 调 `/api/conversations/:id/turns` 恢复对话生图历史
5. 如 turn 仍在运行，则继续监听 `/api/events/turns/:turnId`

## 8. API 面

### 8.1 当前前端主用的 V2 API

#### Assets

- `POST /api/assets/upload`
- `GET /api/assets/:id`

#### Jobs

- `POST /api/jobs/translate-batch`
- `POST /api/jobs/outfit-batch`
- `POST /api/jobs/generate-turn`
- `GET /api/jobs/:jobId`
- `GET /api/jobs/:jobId/items`
- `POST /api/jobs/:jobId/retry`
- `POST /api/jobs/:jobId/items/:itemId/retry`
- `POST /api/jobs/:jobId/cancel`

#### Conversations

- `POST /api/conversations`
- `GET /api/conversations/:id`
- `GET /api/conversations/:id/turns`

#### Events

- `GET /api/events/jobs/:jobId`
- `GET /api/events/turns/:turnId`

#### Results

- `GET /api/results/:assetId`

### 8.2 代表性请求体

#### `POST /api/jobs/translate-batch`

```json
{
  "sessionId": "sess_xxx",
  "assetIds": ["asset_a", "asset_b"],
  "targetLanguages": ["en", "ja"],
  "sourceLanguage": "auto",
  "modelId": "nano-banana-2",
  "preserveBrand": true,
  "concurrency": 2,
  "clientKeys": {
    "visionApiKey": "...",
    "banana2ApiKey": "..."
  }
}
```

#### `POST /api/jobs/outfit-batch`

```json
{
  "sessionId": "sess_xxx",
  "modelAssetIds": ["asset_model_1"],
  "garments": [
    { "assetId": "asset_top_1", "role": "top", "label": "top-1" },
    { "assetId": "asset_bottom_1", "role": "bottom", "label": "bottom-1" }
  ],
  "modelId": "nano-banana-pro",
  "instructions": "背景换成纯白影棚",
  "concurrency": 2,
  "clientKeys": {
    "bananaProApiKey": "...",
    "visionApiKey": "..."
  }
}
```

#### `POST /api/jobs/generate-turn`

```json
{
  "sessionId": "sess_xxx",
  "conversationId": "conv_xxx",
  "modelId": "gpt-image-2",
  "userMessage": "做一版夏季主视觉",
  "useDesignAgent": true,
  "previousTurnId": "turn_prev",
  "referenceAssets": [
    { "assetId": "asset_ref_1", "role": "subject", "label": "shoe" }
  ],
  "clientKeys": {
    "visionApiKey": "...",
    "gptImageApiKey": "..."
  }
}
```

### 8.3 兼容保留的 legacy API

这些接口仍在仓库里，主要用于兼容和底层执行复用：

- `POST /api/translate`
- `POST /api/generate`
- `POST /api/outfit-swap`

约束：

- 不再把它们写成前端主路径
- 新代码优先接 V2 API
- 它们的存在不代表项目仍停留在旧同步架构

## 9. 配置与模型

### 9.1 环境变量 / secrets

当前 `Env` 见 [`functions/_shared.ts`](../functions/_shared.ts)。

支持：

- `RELAY_BASE_URL`
- `VISION_API_KEY`
- `BANANA2_API_KEY`
- `BANANA_PRO_API_KEY`
- `GPT_IMAGE_API_KEY`
- `GPT_IMAGE_GROUP`
- `CREDENTIAL_KEK`
- `VS_INPUTS_BUCKET`
- `VS_RESULTS_BUCKET`
- `VS_TEMP_BUCKET`

### 9.2 Key 优先级

1. 浏览器传入的 `clientKeys`
2. Cloudflare Pages secrets

### 9.3 模型映射

| `modelId` | relay model |
|---|---|
| `nano-banana-2` | `gemini-3.1-flash-image-preview` |
| `nano-banana-pro` | `gemini-3-pro-image-preview` |
| `gpt-image-2` | `gpt-image-2` |

固定视觉模型：

- `gemini-3-flash-preview`

用途：

- OCR
- 参考图分析
- Design Agent

## 10. 源码 Source Of Truth

| 路径 | 当前职责 |
|---|---|
| `public/index.html` | 三个工作台的 DOM 骨架、设置弹窗、lightbox |
| `public/app.js` | 前端状态、上传、任务提交、恢复、事件消费、下载、重试 |
| `public/styles.css` | UI 样式 |
| `packages/contracts/v2.ts` | V2 contract |
| `packages/core/outfit-looks.ts` | look 规则的共享实现 |
| `packages/core/crypto.ts` | sealed credential 加解密 |
| `functions/_shared.ts` | relay 调用、模型映射、key 解析 |
| `functions/_lib/v2-store.ts` | V2 store |
| `functions/_lib/v2-events.ts` | 事件发布与等待 |
| `functions/_lib/v2-runner.ts` | V2 job 提交与后台执行 |
| `functions/api/assets/*` | asset API |
| `functions/api/jobs/*` | job API |
| `functions/api/conversations*` | conversation API |
| `functions/api/events/*` | event API |
| `functions/api/results/*` | result API |
| `functions/api/translate.ts` | legacy translate + runner底层执行 |
| `functions/api/generate.ts` | legacy generate + runner底层执行 |
| `functions/api/outfit-swap.ts` | legacy outfit + runner底层执行 |

## 11. 当前边界与非目标

### 11.1 当前边界

- 仍然部署在单个 Pages 仓库里
- 没有用户系统
- 没有团队协作
- 没有计费
- 没有数据库级持久化
- 没有跨进程 durable metadata store
- 前端仍是原生 JS 单文件状态机

### 11.2 当前技术债

- `public/app.js` 体积仍然偏大
- V2 API 已接入，但 legacy 执行函数仍在同仓共存
- 前后端的 look 规则目前是“共享实现 + 前端镜像逻辑”并存，未来应彻底收敛
- 事件层是 SSE-compatible 轮询，不是最终实时系统

## 12. 下一阶段推荐方向

如果继续做真正的 V2，而不是停留在 in-place foundation，顺序建议如下：

1. 把 metadata store 从内存切到 D1
2. 把 batch 执行从 `waitUntil` runner 切到 Queue consumer
3. 把 generate turn 的长流程切到 Workflow
4. 把事件分发从当前 SSE-compatible 轮询切到 Durable Object event hub
5. 在前端补统一任务中心
6. 再考虑把 `public/app.js` 拆成模块化或组件化前端

优先级说明：

- D1 / Queue / Workflow / DO 是基础能力升级
- React/Vue 重构不是当前第一优先级

## 13. 给后续 coding agent 的执行原则

- 不要再新增第二份 spec
- README 只做高层入口，详细约束统一回写本文
- 新功能优先接 V2 API，不要把旧同步接口重新变成主路径
- 修改文档时要明确区分：
  - 当前已经实现
  - 当前仍是兼容层
  - 下一阶段计划
