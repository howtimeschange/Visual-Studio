# 对话生图画布引擎 Phase 4 — 交接文档

## 项目地址

```
/Users/xingyicheng/image-translator-web
```

不是 git 仓库，不能用 git status/diff 获取上下文，直接以源码为准。

## 项目概述

这是一个部署在 Cloudflare Pages 上的"品牌视觉工作台"，前端是原生 HTML/CSS/JS 单页应用，后端是 Pages Functions。当前有 4 条工作流：

1. 图片批量翻译
2. **对话生图** ← 正在重构为 Lovart 画布模式
3. 批量换装
4. 风格迁移（新增）

## 当前重构状态

对话生图正在从"聊天对话式"全面重构为 **Lovart 画布模式**（无限画布 + AI 生图卡片 + 图片→生图连线 + AI 对话侧边栏 + 底部工具栏）。

**Phase 1-3 已完成，Phase 4 待实施。**

### 已完成的 Phase

#### Phase 1: 后端直连生图 API ✅

**新文件**: `functions/api/generate-direct.ts`（~170 行）

```
POST /api/generate-direct
{
  sessionId, modelId, prompt,
  referenceImages: [{ assetId, role }],
  aspectRatio: "1:1" | "4:3" | "3:4" | "16:9" | "9:16" | "1:4" | "1:8",
  useDesignAgent: boolean,
  clientKeys
}
→ { sessionId, resultDataUrl }
```

核心设计：参考图**直接传给图像模型**（`callImageModel`），不经过 Design Agent 文字化。解决了旧版"参考图主体丢失"的根因。

复用了 `_shared.ts` 的 `callImageModel` / `callTextModel` / `resolveKeys` / `resolveImageModelOptions`，以及 `v2-store.ts` 的 `ensureSession` / `getAssetDataUrl`。

#### Phase 2: HTML 画布骨架 ✅

`public/index.html` 中 `#view-generate` section 已完整重写为画布布局（~110 行），包含：

- `header.canvas-header` — 标题 + AI 面板开关 + 新画布按钮
- `#g-canvas-container` + `#g-canvas` — 无限画布（viewport transform 层）
- `#g-canvas-empty` — 空状态提示
- `#g-connectors` — SVG 连接线层
- `#g-ai-sidebar` — 右侧可收起的 AI 对话面板
- `#g-gen-panel` — 浮动生图参数面板（prompt + 模型 + 比例 + 参考图 + agent 开关 + 生成按钮）
- `#g-toolbar` — 底部工具栏（选择/图片/文字/AI生图）
- `#g-zoom` — 左下角缩放控制器
- `#g-context-menu` — 右键菜单（用此图生成/下载/删除）
- `#g-file-input` — 隐藏的文件上传 input

关键 DOM id 清单（app.js 需要用到的）：

| id | 用途 |
|---|---|
| `#g-canvas-container` | 画布外层容器 |
| `#g-canvas` | 画布 viewport（transform 层） |
| `#g-canvas-empty` | 空状态 |
| `#g-connectors` | SVG 连线 |
| `#g-ai-sidebar` | AI 侧边栏 |
| `#g-ai-toggle` | AI 面板开关按钮 |
| `#g-ai-close` | AI 侧边栏关闭按钮 |
| `#g-ai-messages` | AI 消息列表容器 |
| `#g-input` | AI 侧边栏输入框（保留的旧 id） |
| `#g-send` | AI 侧边栏发送按钮（保留的旧 id） |
| `#g-gen-panel` | 浮动生图面板 |
| `#g-gen-prompt` | 生图 prompt textarea |
| `#g-gen-ref-list` | 生图面板参考图列表 |
| `#g-gen-ref-upload` | 生图面板上传参考图按钮 |
| `#g-gen-ref-input` | 生图面板上传 file input |
| `#g-model` | 模型选择（保留的旧 id，现在在 gen-panel 内） |
| `#g-gen-ratio` | 比例选择 |
| `#g-agent` | Design Agent 开关（保留的旧 id） |
| `#g-gen-run` | 生成按钮 |
| `#g-gen-progress` | 生成进度 |
| `#g-toolbar` | 底部工具栏 |
| `#g-file-input` | 主图片上传 input |
| `#g-zoom-out` / `#g-zoom-in` / `#g-zoom-value` | 缩放控制 |
| `#g-context-menu` | 右键菜单 |
| `#g-new` | 新画布按钮（保留的旧 id） |

#### Phase 3: CSS 画布样式 ✅

`public/styles.css` 中旧的 `/* CHAT (Generate View) */` 区域已完整替换为画布样式（~370 行），包含：

- `.canvas-container` / `.canvas-viewport` / `.canvas-empty` — 画布基础
- `.canvas-el` / `.canvas-el.selected` / `.canvas-el-image` / `.canvas-el-text` / `.canvas-el-shape` / `.canvas-el-generator` — 元素样式
- `.resize-handle` — 拖拽调整大小手柄
- `.canvas-el-actions` — 选中元素的操作按钮
- `.gen-panel` — 浮动生图参数面板
- `.ai-sidebar` — AI 侧边栏
- `.msg` / `.msg-bubble` / `.msg-images` — AI 消息样式（精简版保留）
- `.canvas-toolbar` / `.toolbar-btn` — 底部工具栏
- `.zoom-controls` — 缩放控制器
- `.canvas-context-menu` — 右键菜单

### 待完成的 Phase

#### Phase 4: JS 画布引擎（~1500 行）— 这是你要做的

需要重写 `public/app.js` 中所有 generate 相关代码。以下是详细设计。

##### 4a. state.generate 重构

当前 app.js 中的 `state.generate` 需要替换为：

```js
state.generate = {
  // 画布
  scale: 1,
  panX: 0,
  panY: 0,
  elements: [],        // CanvasElement[]
  selectedIds: [],
  activeTool: 'select', // 'select' | 'image' | 'text' | 'ai-gen'
  isDragging: false,
  isPanning: false,
  dragStartX: 0,
  dragStartY: 0,
  dragElementStartX: 0,
  dragElementStartY: 0,

  // AI 侧边栏
  showAiPanel: false,
  aiMessages: [],      // [{ id, role, content, imageDataUrl? }]
  aiRunning: false,

  // 生图面板
  genTargetId: '',     // 当前编辑的 generator 元素 id
  genPrompt: '',
  genModel: 'nano-banana-2',
  genRatio: '1:1',
  genUseAgent: false,
  genRefs: [],         // [{ assetId, dataUrl, role }]
  genRunning: false,

  // 运行时
  model: 'nano-banana-2',
}
```

CanvasElement 结构：
```js
{
  id: string,
  type: 'image' | 'text' | 'shape' | 'image-generator' | 'connector',
  x: number,
  y: number,
  width: number,    // default 300
  height: number,   // default 300
  content: string,  // dataUrl for image, text content for text
  // generator 特有
  referenceImageId: string | null,
  generatingPrompt: string,
  // connector 特有
  connectorFrom: string,
  connectorTo: string,
  // shape 特有
  shapeType: 'square' | 'circle',
  color: string,
}
```

##### 4b. dom 映射更新

需要替换掉旧的 generate 相关 dom 映射（gChatScroll、gChatEmpty、gRefDz、gRefInput、gRefList、gRefPins），改为：

```js
// 保留的
gModel: $('#g-model'),
gNew: $('#g-new'),
gInput: $('#g-input'),
gSend: $('#g-send'),
gAgent: $('#g-agent'),
// 新增的
gCanvasContainer: $('#g-canvas-container'),
gCanvas: $('#g-canvas'),
gCanvasEmpty: $('#g-canvas-empty'),
gConnectors: $('#g-connectors'),
gAiSidebar: $('#g-ai-sidebar'),
gAiToggle: $('#g-ai-toggle'),
gAiClose: $('#g-ai-close'),
gAiMessages: $('#g-ai-messages'),
gGenPanel: $('#g-gen-panel'),
gGenPrompt: $('#g-gen-prompt'),
gGenRefList: $('#g-gen-ref-list'),
gGenRefUpload: $('#g-gen-ref-upload'),
gGenRefInput: $('#g-gen-ref-input'),
gGenRatio: $('#g-gen-ratio'),
gGenRun: $('#g-gen-run'),
gGenProgress: $('#g-gen-progress'),
gToolbar: $('#g-toolbar'),
gFileInput: $('#g-file-input'),
gZoomOut: $('#g-zoom-out'),
gZoomIn: $('#g-zoom-in'),
gZoomValue: $('#g-zoom-value'),
gContextMenu: $('#g-context-menu'),
```

##### 4c. 需要重写的函数

**删除**（旧聊天模式的）：
- `bindGenerate()` — 完全重写
- `renderGenerate()` — 完全重写
- `renderGenerateRefs()` — 删除
- `renderGeneratePins()` — 删除
- `renderGenerateChat()` — 删除
- `sendGenerateMessage()` — 删除
- `executeGenerateMessage()` — 删除
- `watchGenerateTurn()` — 删除
- `restoreGenerateConversation()` — 删除
- `applyGenerateStreamEvent()` — 删除
- `applyGenerateRuntimeEvent()` — 删除
- `getLatestTurnEventCursor()` — 删除
- `getLatestCompletedAssistantTurnId()` — 删除
- `formatGenerateSuccessText()` — 删除
- `buildGenerateMessageRefs()` — 删除
- `buildGenerateMessagesFromTurns()` — 删除
- `buildGenerateHistory()` — 删除
- `getLatestAssistantImagePart()` — 删除
- `scrollGenerateChat()` — 删除
- `syncGenerateSelectedRefs()` — 删除
- `getActiveGenerateRefs()` — 删除
- `createChatMessage()` — 删除
- `createThinkingBlock()` — 删除
- `normalizeAgentTrace()` — 删除
- `createPendingAgentTrace()` — 删除

**新增**：

画布引擎（~600 行）：
- `bindCanvas()` — 初始化所有画布事件（mousedown/move/up/wheel/keydown/contextmenu）
- `renderCanvas()` — 把 elements 渲染到 `#g-canvas` 的 DOM 中
- `renderCanvasElement(el)` — 单元素创建
- `renderConnectors()` — SVG 连线渲染
- `handleCanvasMouseDown(e)` — 选择/拖拽开始/平移开始
- `handleCanvasMouseMove(e)` — 拖拽/平移
- `handleCanvasMouseUp(e)` — 结束
- `handleCanvasWheel(e)` — 缩放（以鼠标为中心）
- `handleCanvasKeyDown(e)` — Delete 删除选中
- `showContextMenu(e, elementId)` — 右键菜单
- `hideContextMenu()` — 隐藏
- `addImageToCanvas(dataUrl, name, x?, y?)` — 添加图片元素
- `addTextToCanvas(x?, y?)` — 添加文字元素
- `addGeneratorToCanvas(x?, y?, refImageId?)` — 添加生图占位
- `connectFlow(sourceElementId)` — 从图片创建连线 + 生图卡片
- `deleteElement(id)` — 删除元素（含连线清理）
- `updateCanvasTransform()` — 更新 viewport transform

工具栏（~50 行）：
- `bindToolbar()` — 工具按钮事件
- `setCanvasTool(tool)` — 切换工具

缩放（~30 行）：
- `bindZoom()` — +/- 按钮
- `updateZoomDisplay()` — 更新百分比显示

生图面板（~200 行）：
- `showGenPanel(elementId)` — 定位并显示浮动面板
- `hideGenPanel()` — 隐藏
- `bindGenPanel()` — 面板内事件（prompt 输入、模型选择、比例、参考图上传、生成）
- `renderGenPanelRefs()` — 渲染面板内参考图列表
- `executeCanvasGenerate()` — 调 `POST /api/generate-direct`，结果替换 generator 元素为 image 元素

AI 侧边栏（~150 行）：
- `bindAiSidebar()` — 开关、发送
- `renderAiMessages()` — 渲染消息列表
- `sendCanvasAiMessage()` — 调 `/api/generate-direct`，结果图自动放到画布

入口绑定：
- `bindGenerate()` — 调 bindCanvas + bindToolbar + bindZoom + bindGenPanel + bindAiSidebar
- `renderGenerate()` — 调 renderCanvas + updateZoomDisplay

持久化：
- `saveRuntimeState()` 中 generate 部分改为存 elements（序列化 dataUrl 为 assetId 引用）
- `restoreRuntimeState()` 中 hydrate elements

##### 4d. 关键交互逻辑

**画布平移**：中键/空格+拖拽 → 修改 panX/panY → updateCanvasTransform()
**画布缩放**：滚轮/按钮 → 以鼠标为中心修改 scale → updateCanvasTransform()
**元素拖拽**：select 工具 + mousedown 在元素上 → 修改元素 x/y → renderCanvas()
**上传图片**：image 工具 + 点击画布/拖放文件 → readAsDataUrl → addImageToCanvas
**AI 生图**：ai-gen 工具 + 点击画布 → addGeneratorToCanvas → 选中后显示 gen panel → 填 prompt → 生成 → 结果替换
**连线流**：选中图片元素 → "用此图生成" → connectFlow() → 创建 connector + generator

##### 4e. 不要动的部分

- 其他三个 tab 的所有代码（translate/outfit/style）
- `init()` / `hydrateStoredState()` / `savePrefs()` 的结构（只改 generate 相关字段）
- `renderAll()` 中调 `renderGenerate()` 保留
- `normalizeView()` 中 'generate' 保留
- `populateModelSelects()` 中 dom.gModel 保留
- 所有全局工具函数（readImageFiles / postJson / getJson / wait / basename 等）
- 后端所有文件

##### 4f. 参考项目

OpenLovart 的画布实现在 `src/app/lovart/canvas/page.tsx`，用 React state 管理 elements + scale + pan。我们的实现是原生 JS DOM 操作，但逻辑结构类似：
- elements 数组 → renderCanvas() 渲染为绝对定位 DOM 节点
- mousedown/move/up 事件链 → 拖拽/平移
- wheel 事件 → 缩放
- 元素选中 → 显示 resize handles + action buttons

##### 4g. 模型支持

保留三个模型，通过 gen panel 的 `#g-model` 选择：
- `nano-banana-2` → relay `gemini-3.1-flash-image-preview`
- `nano-banana-pro` → relay `gemini-3-pro-image-preview`
- `gpt-image-2` → relay `gpt-image-2`

API 调用路径：`POST /api/generate-direct` → `callImageModel()` → relay

## 旧的 generate 代码位置

在 `public/app.js` 中，需要定位并替换的 generate 相关函数：

```
bindGenerate()       — 约 line 530-550 附近
renderGenerate()     — 约 line 940-960 附近
renderGenerateRefs() — 紧随其后
renderGenerateChat() — 紧随其后
sendGenerateMessage() — 约 line 1470-1530
executeGenerateMessage() — 约 line 1700
...后续所有 generate 相关函数
```

由于之前做了大量编辑，行号可能已偏移。用 `grep -n 'function bindGenerate\|function renderGenerate\|function sendGenerate\|function executeGenerate' public/app.js` 定位。

## 本地开发

```bash
cd /Users/xingyicheng/image-translator-web
npm run dev
# → http://127.0.0.1:8788/
```

## 验证清单

完成 Phase 4 后需验证：

1. `npm run dev` → `Compiled Worker successfully`
2. 点击"对话生图" → 看到画布界面（不是旧的聊天界面）
3. 底部工具栏可切换工具
4. 上传图片 → 图片出现在画布上，可拖拽移动
5. 点击 AI 生图工具 → 画布上创建虚线占位卡片
6. 选中卡片 → 浮动面板出现 → 输入 prompt → 选模型 → 生成 → 结果替换卡片
7. 选中图片 → "用此图生成" → 自动创建连线 + 生图卡片
8. 画布缩放（滚轮、+/- 按钮）正常
9. 画布平移（空格拖拽 / 中键拖拽）正常
10. AI 侧边栏可展开收起，可发消息
11. 切换其他 tab 再回来 → 画布不丢
12. 其他三个 tab 功能不受影响
