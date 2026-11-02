# Design Agent harness

本地改造日期：2026-11-01；持久化改造：2026-11-02。当前实现以代码为准；本次没有部署线上。

## 从 OpenDesign 借鉴的内容

参考仓库：`/Users/xingyicheng/Documents/ChatGPT/opendesign`，仅作只读参考。

| 参考源 | 在 Visual Studio 中的落点 |
| --- | --- |
| `skills/ecommerce-image-workflow/SKILL.md`、`references/checklist.md` | 商品三图：主图、卖点图、生活场景图；要求真实参考，锁定产品身份，不编造规格、认证或卖点。 |
| `skills/od-next-media-inputs/SKILL.md` | 保留参考图角色、已受理任务回执及结果资产；结果未知时查询原任务，停止后续提交。 |
| `skills/brandkit/SKILL.md` 的品牌工作流、品牌规范目录 | 品牌海报的受众、语气、文字层级和品牌事实约束。只借鉴工作流，没有安装整套品牌工具。 |
| `specs/current/studio-chat-response-information-architecture.md` | 会话 → 运行 → 任务 → 作品；结果在前，完成后的执行记录折叠，错误和恢复提示保持可见。 |
| `chat-run-context.ts`、`chat-run-messages.ts`、`chat-run-lifecycle.ts`、`task-input-snapshot.ts` | 上下文快照、运行归属、生命周期和任务记录分离，领域逻辑与 DOM 分离。 |
| `apps/web/src/components/chat/AGENTS.md` | 独立的纯逻辑模块、展示模块和语义 CSS 变量边界。 |

OpenDesign 中的 `skills/imagegen/SKILL.md` 和 `skills/imagen/SKILL.md` 是目录入口，当前检出的文件没有完整执行实现。本次没有将它们宣称为已安装的模型服务，也没有引入 OpenDesign daemon、CLI、ACP 或其依赖。现有 ModelJetty / 1xm 异步生图队列继续负责模型调用。

## 模块边界

```text
public/app.js（冻结输入、账号/画布归属、上传和展示宿主）
  ├─ canvas-agent-client.js（只提交一次、按运行 ID 回查、轮询恢复）
  ├─ canvas-drafts.js（账号/画布隔离的 IndexedDB 草稿）
  ├─ design-agent-harness.js（兼容历史、白名单序列化、生成清单）
  └─ design-agent-view.js + design-agent.css（记录、规格与独立视觉质检）
        ↓ POST /api/canvas/agent-runs → 202 + jobId
functions/_lib/canvas-agent-runner.ts（D1 parent job + Queue）
  ├─ canvas/agent.ts（单次规划意图、冻结方案）
  ├─ design-agent-policy.ts / design-agent-skills.ts（创作约束、工作流）
  ├─ generate_batch 子任务（确定 ID、原回执查询、图片服务商异步任务）
  ├─ image-quality.ts（单次独立视觉检查，不自动重做）
  └─ v2-store.ts（确定作品 ID、只追加一次、并发保存保护）
        ↓ R2 作品 + D1 执行记录
GET /api/canvas/projects/:id/agent-runs（按项目权限恢复）
GET /api/results/:assetId?projectId=...（鉴权二进制图片）
```

每轮输入冻结画布、会话、账号、参考图、模型、画幅和分辨率。发送锁在第一个 `await` 前取得；运行期间禁止切换画布、会话及启动另一轮生成。只有明确上传或引用的图片会作为本轮图像输入，画布上的其他图片只提供元素上下文。

侧边栏统一使用自动创作，不再提供工作模式选择。旧会话保存的 `mode: plan` 会在恢复/序列化时迁移为 `auto`，下一轮发送也显式冻结为 `auto`；历史运行记录仍保留原模式和实际结果。用户仍可用自然语言要求分析或暂不生成，模型按需求返回方案。旧客户端的服务端仅规划策略继续保持独立约束。设计能力为“自动匹配”“商品三图”“品牌海报”“参考图延展”。自动匹配不会将单张主图需求悄悄扩成三张；手选商品三图且未指定张数时才采用三图默认值。主体、风格、构图三种参考角色随输入传递。一次最多 8 个图片任务，服务端生成确定的任务 ID，不依赖模型返回的 ID 唯一性。

## 状态与恢复

- 活动状态：准备上下文 → 理解与规划 → 生成作品。
- 终态：完成、等待输入、停止后续、失败、部分完成、结果待确认、运行中断。
- 图片受理后立即保存 `jobId`、画布元素 ID，再查询结果。只有可读取的结果资产完成保存后才标记任务完成。
- “停止后续”不撤销已经受理的请求，继续读取当前任务并跳过未提交图片。
- 读取失败或超时保留回执，不自动重发；失败的已知终态与结果未知分别展示。画布任务卡可以继续读取原任务。
- 服务端运行以 D1 job 为准；重新加载保持活动状态并读取服务端记录，历史浏览器运行才显示中断。规划意图和质检意图先于请求持久化；结果不明时暂停，不重发。
- 生成清单和执行记录包含实际尺寸、所选规格、独立视觉检查及其请求 ID。视觉检查失败/未知不会触发重新生成；它不能保证产品保真，仍需人工审核。API Key 和图片 base64 不进入运行清单。

新运行要求实际 Queue 或本地队列桥，不回退到浏览器/同步长请求。关闭页面后继续规划、生成余下作品和质检；浏览器仅观察。未发送文字与参考图按账号/画布存入 IndexedDB。画布保存携带 knownElementIds，只能删除此前已知元素，保护尚未看到的后台作品。队列凭证使用加密封装，父运行的有效窗口为两小时；托管账号执行时读取可续期的账号令牌。

## 验证

初轮 harness 自动回归：297/297 通过。覆盖服务端仅规划策略、参考门槛、重复发送、回执先于作品完成、停止后续、未知结果不重发、部分失败、权限过期、上下文变化、会话恢复、进度轮询不挤掉关键事件，以及 JPEG / WebP / PNG 参考图的真实 MIME 传递。后续模型目录、自动创作迁移和 UI 验收见 [本轮跟进记录](agent-ui-performance-2026-11-01.md)。

浏览器验收使用独立项目 `canvas_e751d713-c27e-4ee9-9c5e-96726a3f8a10`：缺少商品参考时直接澄清；ModelJetty Gemini 3.8 Flash 真实规划成功且未生图；参考图角色选择正常；刷新后工作模式、设计能力和运行记录恢复；390×844 下主要控件没有横向溢出，临时视口已恢复。

新 harness 另完成一次真实参考图生图：`reference-edit` + ModelJetty `gemini-3.1-flash-image`，任务 `job_e8d01260-6abb-4bc4-a470-76b0bb2be0f5`，结果资产 `asset_b2bcfc0a-141d-4f5c-a0cf-bd0e8cc3aed9`，1/1 成功，刷新后画布和记录仍可读取。请求参数为 1:1、1k，实际返回尺寸为 512×512；不将请求分辨率当成服务商已交付尺寸。清单页面读回和下载文件内容一致，仍明确标记语义质量待人工复核。

真实验收曾暴露 JPEG 被错误标成 PNG 的 `image_mime_mismatch`。已修复侧边栏和手动生图参考上传的 MIME 识别；失败任务记录保留，确认失败后才以重新上传的正确格式发起新任务。没有自动重发未知结果。

证据目录：`/tmp/visual-studio-agent-harness/`。本轮没有重跑此前三个图像模型的全部验收；此前三模型记录见 `docs/modeljetty-local-acceptance-2026-11-01.md`。

本轮服务端恢复、三模型、规格与质检验收见 `docs/stability-acceptance-2026-11-02.md`。早期验证段落仅记录历史状态。
