# ModelJetty 本地真实联调验收

2026-11-01。用户授权修复审查发现、生成专用联调账号、本地联合登录并逐一实际调用三个图片模型。未提交、推送、生产部署或执行生产 schema 迁移。

## 验收结果

从 Visual Studio 账号页进入 ModelJetty 授权页，使用真实专用账号 `vs_e2e_1101`（`newapi:11`）密码登录；真实网关验证身份，OIDC Authorization Code + PKCE S256、RS256/JWKS、issuer/audience/nonce 校验后绑定本地账号。钱包首次读回约 ¥5.00，三次结算后读回 ¥4.2500016，实际累计消费 ¥0.750002。

Pages：<http://127.0.0.1:8797/>。验收画布：<http://127.0.0.1:8797/lovart/canvas?id=canvas_5f5be896-a1a8-4823-b196-3d9621ec438c>。

本地 ModelJetty issuer：`http://127.0.0.1:4392/oidc`；专用 client `visual-studio`，精确 callback `http://127.0.0.1:8797/api/auth/modeljetty/callback`。本地账户服务负责持久化异步受理，后台连接真实 ModelJetty 网关，非模拟图片。

| 模型 | 实际输出 | 真实结算 CNY | ModelJetty task ID |
| --- | --- | ---: | --- |
| `gemini-3.1-flash-image` / Nano Banana 2 | JPEG 1024×1024 | 0.2499958 | `d7440c57-ee9f-4bac-945a-b3103859a282` |
| `gpt-image-2.5-flare` | PNG 1254×1254 | 0.2000054 | `27c47871-2b35-4404-88d1-f38b19d7d389` |
| `gpt-image-2.5-sunburst` | PNG 1254×1254 | 0.3000008 | `37207368-f4d2-4095-90aa-4d3819856464` |

三个模型各创建一个上游任务，均 succeeded；Visual Studio 三个 job 均 completed，结果落在本地 R2。逐个通过受鉴权素材 API 下载读回，SHA256 与 ModelJetty 保存的原始结果完全一致。图片均完整解码；三个不同 billing request ID 对应三条 settled 账本和三条用量记录，无未知任务。

GPT 两个请求均为 `1024x1024/high`，实际返回 1254×1254；生成成功不代表严格遵从请求尺寸。三图验收当时的本地适配只接入 GPT 文生图与 Gemini 参考图路径；这不是 GPT 模型本身的编辑能力结论。该三图验收为 1:1 文生图，未额外测试参考图、其他比例、2K/4K 或文本 Agent；后续 Agent 追加验收见下节，GPT 编辑适配修复见 [后续跟进](agent-ui-performance-2026-11-01.md)。

## 真实故障修复与恢复

1. 首次回调暴露 Workers 不支持 `redirect: error`，改为 `manual` 并对非成功状态报错，不携带令牌跟随重定向。
2. 首个授权没有 refresh token：provider 要求 `prompt=consent` 才保留 `offline_access`。修复后重新完成真实授权并确认发放 refresh token。
3. Sunburst 原任务已受理，但轮询时旧令牌到期。补充画布持久化 job ID 和“继续读取结果”，保存加密连接标记，重新授权后恢复同一 task 的 GET 查询。为修复前已发起的验收卡片，通过正常受鉴权项目 API 补入其确切原 job ID；没有制造新图片任务、修改账本或伪造成功状态。
4. 运行中的 Worker 真实刷新验证：只使本地加密 token 缓存过期，再请求账户接口；access/refresh token 均由真实 `/oidc/token` 轮换，租约释放，余额读回成功。未修改 provider token claims 或绕过签名验证，未产生图片调用。

## 审查与回归

- 审查六项发现全部修复，见 [审查报告](review-2026-11-01.md)。
- 本地 D1 + HTTP：匿名项目列表、匿名付费 Agent 为 401；另一账号的项目列表为空，访问私有素材及将其送入生图均为 403。
- 全量 Node 测试 277/277，零 skip；Pages Functions build、Queue worker dry run、三份前端脚本语法和 `git diff --check` 通过。
- 保留 1xm 现有异步链路；前端按服务商展示真实模型目录，不将缺失的 Nano Banana Pro 静默替换成别的模型。

## 本机证据及启动状态

证据目录：`/tmp/visual-studio-modeljetty-e2e-20261101/`。

- `vs-jobs-readback.json`：三个 job/item/request/task/resultAsset ID。
- `modeljetty/live-readback.json`：真实钱包、完整图片尺寸/SHA256、billing request ID、settled 账本和用量。
- `stored-image-readback.json`：通过 Visual Studio 素材接口读回的三张图片校验。
- `live-refresh-readback.json`：真实 refresh token 发放与轮换。
- `security-http-readback.json`、`final-tests.log`、`final-functions.log`、`final-queue.log`：验证结果。
- 三张原图：`gemini-3.1-flash-image.jpg`、`gpt-image-2.5-flare.png`、`gpt-image-2.5-sunburst.png`；浏览器证据 `three-models-canvas.png` 与 `account-final.png`。

账号密码及真实 Key 只保存在 ModelJetty 项目 ignored 的 `work/secrets/visual-studio-e2e-20261101/account.json`；VS KEK 和联调 session 仅在证据目录的 0600 私有文件。不要将这些文件提交或复制进报告。

Pages 与 Queue worker 共用该目录 `vs-d1` 的本地持久化存储和同一 KEK。分别用目录内 `start-vs.py` / `start-queue.py` 启动，监听 8797 / 8798。进程保留运行供本地验收；ModelJetty 的服务、SSH tunnel 和 PostgreSQL 也保留运行。停止前先核对无 queued/running/unknown 任务，保留数据卷，勿重发未知付费请求。

ModelJetty 配合修改位于其账户服务 `src/image-tasks.mjs`、`src/service.mjs`、`bin/visual-studio-local.mjs` 和只读回查脚本；协作会话为“配合 Visual Studio 本地联合登录与三模型真实生图联调”（`01a1971e-2f2b-7432-b801-81a3d118dc30`）。配合端定向测试 25/25。

## 生产边界

本地 OIDC client、账户连接、队列适配和真实上游已通。生产域名专用 client、生产异步任务服务部署、D1 迁移及 Pages/Queue 发布尚未执行。生产 `MODELJETTY_IMAGE_TASKS_ENABLED` 仍默认关闭；不能将本地通过等同于线上开放。


## Agent / Gemini 3.8 Flash 追加验收

按后续用户要求，把 ModelJetty LLM 用于 Canvas AI Agent、Design Agent 提示词整理及 Agent 参考图分析，图片生成仍使用独立的图片模型。当前真实目录提供 `gemini-3.8-flash-low/medium/high/tiered`；默认选 `gemini-3.8-flash-medium`，可通过 `MODELJETTY_AGENT_MODEL` 配置。1xm Agent 模型保持 `gemini-3-flash-preview`，普通 OCR/翻译视觉配置独立保留。

浏览器完成两项业务验收：

- 仅做文字规划：返回蓝色茶壶的东方禅意、现代极简、原木生活方式三套主图方案，包含构图、背景和光线；没有生图。
- 上传原始茶壶 JPEG：通过真实模型提取结构化视觉简报，再返回对蓝色陶瓷、浅灰圆台、左侧窗光和右侧投影的分析及补光建议；没有生图。

界面回复旁标明实际 LLM，Agent 信息与图片模型选择器分离。两条成功回复和模型标签已通过受鉴权项目 API 读回，刷新后仍保留。截图 `agent-plan.png` / `agent-vision-success.png`，会话证据 `agent-session-readback.json`。

| 文本操作 ID | 用途 / 结果 | 已结算 CNY |
| --- | --- | ---: |
| `65caeaab-38a8-4460-a019-d6631f2ddf56` | 文字规划，浏览器收到完整方案 | 0.0088330 |
| `74f47b27-af14-42ed-9ea5-899a3fb08883` | 首次视觉简报，上游完成；本地旧 90 秒 deadline 提前结束 | 0.0114464 |
| `9330563b-cd59-4a0e-be0b-eef416c8923b` | 修正后新请求：视觉简报成功 | 0.0138262 |
| `a064b35c-21e4-42a0-ba02-dd0d8532af6d` | 修正后新请求：基于简报的分析成功 | 0.0078402 |

真实计费共四个文本请求，全部为 `gemini-3.8-flash-medium`，completed / settled；合计 ¥0.0419458。账户余量 ¥4.2080558，与请求前余额差额一致。图片任务始终为原三个，无新增图片费用。原视觉超时响应的正文在普通代理没有持久化，不能通过 GET 恢复；费用明确计入。本地曾在视觉超时后追加一次规划，但并发 429 拒绝，未受理、未计费。

此次修复了文本请求缺少 `X-Request-Id`、错误/空响应被当作模型规划、视觉超时后继续追加规划的问题。ModelJetty Agent 单次 deadline 改为 210 秒，覆盖账户代理 180 秒上限；1xm 保持原 90 秒。参考分析失败即停止，不自动重试 POST；请求 ID 可用于回查。修正后的完整带图分析 HTTP 为 55.9 秒。

专用 Key48 通过正常接口仅追加上述 medium 模型权限，保留三个图片模型、原额度、有效期和路由，不增加充值或修改生产全局权益。钱包读取期间曾返回 400；正常重新授权后，Visual Studio 账户 API 已恢复 HTTP 200 和真实 CNY 余额，见 `agent-wallet-readback.json`。该事实不被替换成零费用或估算余额。

最终证据：`modeljetty/agent-readback.json`（四个操作 ID、billing ID、tokens、账本、用量和并发状态）、`agent-session-readback.json`、`agent-wallet-readback.json`。新增回归覆盖独立 LLM 路由、owner token、请求身份、不自动重发、空回复拒绝和视觉 body 超时后不再规划。全量 **279/279**，Pages Functions build、Queue dry run、前端语法与 whitespace 检查通过。仍为本地变更，未提交、推送或生产发布。
