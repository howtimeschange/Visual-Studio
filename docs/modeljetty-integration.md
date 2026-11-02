# ModelJetty 接入与开通

2026-11-02。Visual Studio Pages、Queue、正式 D1 迁移和 ModelJetty 配合接口已发布，正式站为 `https://image.crawshrimp.com`。发布版本、真实线上回归与限制见 [生产发布记录](production-release-2026-11-02.md)。此前三模型本地链路证据保留在 [本地验收记录](modeljetty-local-acceptance-2026-11-01.md)，与生产结果分开记录。

## 已实现

- 设置中选择 `1xm` / `modeljetty`，两家服务商的 Key 分开解析；保留原 1xm 模型与异步任务链路。
- ModelJetty 的 Agent 规划、参考图分析和 Design Agent 提示词整理默认使用 `gemini-3.8-flash-medium`，通过 `MODELJETTY_AGENT_MODEL` 配置；与生图模型分离。底层使用 Chat Completions，已登录时走托管账户算力，BYOK 则使用独立 ModelJetty Key。普通 OCR、翻译及风格分析视觉默认也使用 `gemini-3.8-flash-medium`，可用 `MODELJETTY_VISION_MODEL` 调整；若未配置 Agent 专用变量，会兼容显式设置的视觉模型。
- 文本请求使用单次 `X-Request-Id`，不自动重试付费 POST。Agent 的上游错误、空响应和无效 JSON 明确报错；参考图分析失败立即停止，不继续追加规划或生图。ModelJetty Agent 默认单次 deadline 为 210 秒，1xm 保持原 90 秒，`VS_TEXT_REQUEST_TIMEOUT_MS` 可调整。
- ModelJetty 图片适配保持 `POST /images/tasks` + `GET /images/tasks/:id` 的异步契约，模型别名可配置。配合端已提供生产适配；缺少能力开关或当前模型映射时返回 503，不调用同步生图作为替代，也不先执行设计 Agent 产生费用。托管账号的生图权限在规划前读取正式模型目录确认。
- OIDC Authorization Code + PKCE S256，显式 `prompt=consent` 获取并校验 refresh token；服务端单次 state、浏览器 HttpOnly state cookie、nonce、RS256/JWKS、issuer/audience/expiry/subject 校验。只使用配置的 ModelJetty 固定端点，不接收浏览器提供的服务商地址。
- `/api/auth/modeljetty/start` 跳转授权，`/api/auth/modeljetty/callback` 绑定身份并签发本地 HttpOnly session。
- 身份按 `(issuer, sub)` 唯一绑定。不会按相同邮箱自动合并账号。已登录 Visual Studio 时发起授权表示关联当前账号，回调必须仍为同一账号；未登录则登录已绑定账号或创建独立本地身份。
- ModelJetty access/refresh token 加密保存到 D1，不进入浏览器 localStorage、API 响应或 Queue 消息。生产使用 Pages/Queue 共享的专用 `MODELJETTY_CREDENTIAL_KEK`，为 state 与令牌区分加密用途；新任务凭据也使用该共享密钥。兼容已有共享作业/账户密钥的读取，保持旧账户配置和旧密钥不变。
- 提交队列作业时固定服务商和凭据快照。托管作业只封存连接标记，执行时从该作业所属用户的连接读取/刷新短期 access token。凭据失效后报错，不切换到别人的 Key 或默认服务商。
- Refresh token 轮换用 D1 CAS 锁；锁竞争返回 409。交换超时、进程中断或结果不明后要求重新授权，不重发可能已消费的 refresh token。
- `/api/account/modeljetty` 登录后读取 `/account/me` 和 `/account/allowance`，展示 ModelJetty 返回的 CNY 可用钱包余额；不把 API token 的“无限额度”误称为用户余额。余额读取失败不显示估算值。
- Visual Studio 退出只结束本地登录，保留用户明确建立的账号关联；再次使用需要登录。可单独撤销当前应用的 ModelJetty 授权，保留身份归属供重新关联；不会注销账号的其他客户端。

## 生产能力与部署约束

只读核对 `https://modeljetty.com/oidc/.well-known/openid-configuration`，确认 issuer 为 `https://modeljetty.com/oidc`，支持 `/auth`、`/token`、`/jwks`、PKCE S256 与 `models:invoke`。

ModelJetty 配合端已基于实际生产镜像发布最小账户服务补丁，登记专用 `visual-studio` public Web client，采用 PKCE S256，无 client secret，精确 callback 为 `https://image.crawshrimp.com/api/auth/modeljetty/callback`。提供账户、钱包、模型目录、托管推理、持久化异步图片任务及当前应用撤销能力；保留其他客户端授权。

三个生图模型为 `gemini-3.1-flash-image`、`gpt-image-2.5-flare`、`gpt-image-2.5-sunburst`，前端分别显示 Nano Banana 2、GPT Image 快速和 GPT Image 精细。模型可用性以当前账号及 Key 的正式目录为准；未开放的模型显示原因并禁用，不借用测试权限推断普通用户权限。

后续变更需继续保持以下契约：

1. 在 OIDC provider 中登记专用 `visual-studio` Web client 和 Visual Studio 的精确 HTTPS callback：`https://<实际域名>/api/auth/modeljetty/callback`。保留 Authorization Code、PKCE S256，授予 `openid offline_access models:invoke`；建议机密客户端使用 `client_secret_basic`。本地公有 Web client 使用精确 loopback callback + PKCE；只在显式 `MODELJETTY_ALLOW_LOCAL_HTTP=true` 时允许 loopback HTTP。不要复用抓虾 native client 或放宽原客户端 redirect URI。
2. 将该 client 加入账户服务模型调用鉴权名单，让 `/account/me`、`/account/allowance`、`/account/inference/v1/...` 接受它。授权确认页面应显示 Visual Studio 名称。
3. 如需 ModelJetty 图片生成，先提供持久化异步图片任务适配：创建返回稳定 task ID，GET 查询只读取同一账号任务，完成态返回 `data[].url` / `data[].b64_json`，明确失败与未知状态，保证已受理后不需要重发创建请求。
4. BYOK gateway 和托管 `/account/inference/v1` 均需支持这个创建/查询契约；有参考图的模型应支持 JSON `image` data URL 数组、`size/quality` 参数。不能只新增 OIDC client 而省略推理代理能力和模型授权。
5. 用测试用户回归授权、刷新、撤销、钱包余额、真实模型生成、请求/计费记录、任务恢复及账号切换。遇到未知提交结果先查询原请求，不重发生图。

## Visual Studio 配置

先备份共享 D1，再应用 `0006_modeljetty_identity.sql` 和 `0007_canvas_agent_jobs.sql`，随后发布 Queue 和 Pages。两项增量迁移已在 2026-11-02 应用到生产。完整本地命令见 README。

| 配置 | 用途 |
| --- | --- |
| `VS_MODEL_PROVIDER` | 默认服务商，默认 `1xm`，不自动替换历史 1xm |
| `MODELJETTY_BASE_URL` | BYOK base，默认 `https://modeljetty.com/v1` |
| `MODELJETTY_API_KEY` | 可选服务端 BYOK Key，secret；不会使用 1xm Key 替代 |
| `MODELJETTY_VISION_MODEL` | 普通 OCR、翻译及风格分析视觉模型，默认 `gemini-3.8-flash-medium` |
| `MODELJETTY_AGENT_MODEL` | Agent 默认 `gemini-3.8-flash-medium`，用于规划、参考图分析及提示词整理；可选服务商已开通的 Chat Completions 模型 |
| `VS_TEXT_REQUEST_TIMEOUT_MS` | Agent 单次文本请求 deadline，默认 210000 ms |
| `MODELJETTY_ORIGIN` | 默认 `https://modeljetty.com`，生产只允许 HTTPS origin |
| `MODELJETTY_ALLOW_LOCAL_HTTP` | 仅本地显式设为 `true` 时允许 `127.0.0.1` / `localhost` HTTP，不允许其他 HTTP host |
| `MODELJETTY_CLIENT_ID` | ModelJetty 已登记的专用 Web client |
| `MODELJETTY_CLIENT_SECRET` | 若登记机密客户端，配置对应 secret |
| `MODELJETTY_CREDENTIAL_KEK` | Pages 与 Queue 共享的专用强随机 secret，保护联合登录状态、托管令牌和新队列凭据；不替换旧账户密钥 |
| `MODELJETTY_REDIRECT_URI` | 精确 callback，必须与当前站点 origin 一致 |
| `CREDENTIAL_KEK` | 旧 Pages 账号 API Key 的加密 secret，保留旧值；也是旧连接/state 的兼容读取值 |
| `VS_JOB_CREDENTIAL_KEK` | 旧 Pages/Queue 作业共享密钥，保留旧值；兼容已有作业和连接。新部署优先使用专用密钥 |
| `MODELJETTY_IMAGE_TASKS_ENABLED` | 默认关闭，仅在异步契约真实验收后设为 `true` |
| `MODELJETTY_IMAGE_MODEL_MAP` | JSON，将前端 modelId 映射为已验收的 ModelJetty 模型 ID |

当前生产配置（public Web client 不设置 client secret）：

```toml
VS_MODEL_PROVIDER = "1xm"
MODELJETTY_CLIENT_ID = "visual-studio"
MODELJETTY_ORIGIN = "https://modeljetty.com"
MODELJETTY_REDIRECT_URI = "https://image.crawshrimp.com/api/auth/modeljetty/callback"
MODELJETTY_IMAGE_TASKS_ENABLED = "true"
```

`MODELJETTY_CREDENTIAL_KEK` 等加密密钥和 API Key 用 Wrangler secret 配置，不能提交到仓库。Pages/Queue 的专用密钥必须一致。不配置 client 和加密 secret 时，登录入口保持禁用；BYOK 设置仍可使用。

## 验证

本地回归覆盖服务商隔离、视觉路由、异步创建/恢复契约、state 单次消费、PKCE、签名/claims、身份唯一关联、刷新并发及未知结果、队列凭据保密、实际余额单位。测试使用受控的服务商响应和签名 fixture。D1 迁移已在隔离本地数据库应用；本地浏览器已确认服务商选择、字段切换和未开通提示。

此前本地真实钱包余额、三模型图片及账本已读回，三次结算约 ¥0.75；Sunburst 在授权过期后恢复同一个任务，仅执行 GET。完整本地 ID、尺寸和限制见本地验收记录。生产结果另见生产发布记录。审查六项问题的修复见 `review-2026-11-01.md`。
