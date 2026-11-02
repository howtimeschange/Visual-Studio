# 稳定性与功能体验修复验收 · 2026-11-02

本轮沿用 don't-stop 检查点和此前 UI 走查，修复当前列出的稳定性、登录、草稿、规格、质检及创作体验问题。所有改动在本地；没有提交、推送或部署，没有修改线上数据库。原始用户画布 `canvas_e751d713-c27e-4ee9-9c5e-96726a3f8a10` 保留。

## 修复与证据

| 问题 | 完成行为 | 验证 |
| --- | --- | --- |
| 页面关闭打断 Agent | Agent 成为 D1 + Queue 父任务；规划、图片子任务和质检均由服务端推进。浏览器只观察，重新打开按运行 ID 恢复。 | 两图 Sunburst 任务在 planning 阶段关闭标签页；随后服务端自动完成 2/2，重新打开可见两张作品及完整记录。 |
| 未知结果与重复请求 | 规划/质检意图先于单次请求持久化；图片子任务和作品 ID 确定；提交响应丢失只 GET 回查。未知规划暂停，恢复不重发；停止只跳过后续任务。 | 定向覆盖重复投递、未知规划、停止、质检中断和账号失效；真实账务回查无重复受理或计费。 |
| 旧画布快照覆盖后台作品 | 保存携带 knownElementIds；只删除浏览器曾看到的元素，按稳定行 ID 更新，保留后台新作品与独立质检。保存期间冻结目标项目与账号。 | 定向并发保存测试；真实 D1 多账号编辑及 owner 回读；QA 四图重新保存后质检完整。 |
| 账号失效仍持续加载 | 托管凭证执行时读取可续期账号连接；鉴权失败暂停父任务并展示恢复提示；仅允许安全继续原任务。 | 缺凭证父任务暂停、无规划调用；不明规划禁止恢复重发。 |
| ModelJetty 余额 HTTP400 | 配合端定位为 dashboard access token 到期但丢失 refresh cookie。已持久化会话并串行刷新；VS OIDC 仍使用现有刷新租约。 | 真实 15 分钟到期后，三个并行余额读取只触发一次 refresh，cookie 轮换，无密码重登，余额不变。VS 最终余额 GET 200。 |
| 登录返回首页 | 使用发起登录时的 returnTo；保留已有安全跳转校验。 | 从 QA 画布进入账号、断开授权、重新登录后返回同一画布。 |
| 无断开授权入口 | 当前账号 + 当前客户端范围撤销；过期访问令牌通过可信 discovery 的 revocation_endpoint 撤销。保留身份归属，防止重新关联产生孤立用户。 | UI 真实断开/重新关联；配合端当前客户端、跨账号隔离、并发刷新与撤销竞态回归通过。 |
| 大 JSON 结果传输 | ModelJetty 创建和查询协商 result_format=url；只接受服务同源的 /images/tasks/.../result，禁止跟随签名结果重定向，不转发 Bearer；R2 保存后由 VS 鉴权图片接口读取。 | 真实四图结果传输 28–83ms；配合端原图 SHA256 一致，撤销后签名 URL 失效；旧 Base64 保持兼容。 |
| 选定清晰度被当成已交付尺寸 | 独立检查真实尺寸、最低长边和比例，展示实际像素；低于门槛/比例不符明确提示，不自动放大或重新付费。 | 512px/1K 不达标、未知尺寸、比例及正常交付测试；真实图分别为 1024 或 1254px。1K 表示最低长边检查，不能当作精确 1024×1024 承诺。 |
| 无独立画面检查 | 每张结果保存后单独调用视觉模型检查主体、提示词、文字和明显瑕疵；失败/不确定记录 unknown 或 needs_review，不自动重做。 | 四张作品均有独立检查记录与请求 ID；中断质检不会自动重发。机器检查仍需人工复核。 |
| 未发送参考图刷新消失 | 输入文字和参考图存入 IndexedDB，按账号/画布隔离，保留真实 MIME 和参考角色。 | 实际输入文字、加入 JPEG、刷新后两者恢复；修复新画布获得 ID 后未切换草稿空间的遗漏。 |
| 结果破图、排布和文件格式 | 结果图片改用鉴权二进制接口；新轮次排在已有作品外并避让相交元素；实际 MIME 随结果传递，HTTP JPEG 下载按响应类型命名。 | DOM 可见破图为 0；四张画布图像均有真实 naturalWidth；排布和 JPEG 下载测试通过。QA 旧重叠位置已整理。 |
| 前端职责和触控 | 新增 canvas-agent-client.js、canvas-drafts.js、共享 image-delivery.js；独立表示层展示恢复、规格与质检。细指针保持紧凑，粗指针关键控件至少 44px。 | 页面实操、客户端跨账号过期读隔离、序列化和现有 UI 回归；主 app.js 仍保留其他工作流，未进行无关的大规模重写。 |

## 真实三模型结果

同一专用 ModelJetty 账号，全部通过真实联合登录后的账号算力调用。隔离 QA 画布：`canvas_051f74cd-5b96-4206-974f-e1b5db80e010`。

| 模型 | 运行 ID | 图片 | 实际尺寸 | 整轮含规划和质检 | 结果文件传输 |
| --- | --- | --- | --- | --- | --- |
| GPT Image Sunburst | `9281337b-aa78-476e-b637-7f0db49eab48` | 2/2 | 均 1254×1254 PNG | 116.380s | 79ms / 77ms |
| Nano Banana 2 / gemini-3.1-flash-image | `3b41056d-ba92-4232-85d9-2f265b5cce6f` | 1/1 | 1024×1024 JPEG | 51.943s | 28ms |
| GPT Image Flare | `5f6d522b-1710-40d2-a021-92dae583b86b` | 1/1 | 1254×1254 PNG | 63.090s | 83ms |

四张均通过本次最低像素/比例检查和独立视觉检查。后两轮实际使用“生成结果 → 加入参考图 → 新模型编辑”的路径。整轮耗时包含新增质检，样本量小，不能据此声称所有生图整体加速。平台模型执行和上游回传仍是主要耗时。

ModelJetty 只读账务核对：三轮共 11 个已结算请求（3 规划、4 图片、4 质检），无重复受理、无重复计费，共 ¥1.0973944。首次两图仅有 1 次规划、2 次图片、2 次质检。最终 VS `/api/account/modeljetty` 返回 200 / CNY 1.212457。

## 回归与边界

- `node --test tests/*.test.mjs`：**328/328**，0 fail、0 skip。
- `node --check public/app.js`、`node --check public/js/shared.js`、`git diff --check`：通过。
- Cloudflare Pages Functions build：通过。
- Queue worker dry run：通过；没有部署。
- `0007_canvas_agent_jobs.sql`：仅应用到现有本地持久 D1。
- 真实本地多账号：未邀请读写 403；viewer 可读不可写；editor 可写、owner 可回读；移除成员后读取 403。未共享 ModelJetty 授权。
- ModelJetty 配合端隔离回归：34/34，含旧协议兼容、签名下载、续期和撤销隔离。

本轮付费验证范围为 1K / 1:1。2K、4K、其他比例没有新增付费样本；规格检查逻辑覆盖不达标场景。当前专用账号仅开通 Gemini 3.8 Flash Medium 作为 Agent；其他型号保持可见及禁用原因，没有扩大账号权限。管理员内部业务流和原生内置浏览器下载仍未验收；此前 Chrome 原图真实落盘证据继续有效，这两项不是本轮新发现的已确认产品故障。

## 证据位置

主侧：`/tmp/visual-studio-stability-20261102/`。

- `checkpoint.json`：断点、授权边界及禁止重发记录。
- `three-model-agent-readback.json`、`canvas-final-readback.json`：实际任务和四图持久化。
- `multi-account-readback.json`、`vs-auth-after-expiry-readback.json`：权限和余额回读。
- `all-tests-delivery.log`、`functions-delivery.log`、`queue-delivery.log`：最终回归和构建。
- `three-models-final.png`：真实四图画布截图。

配合端：`/tmp/visual-studio-modeljetty-e2e-20261101/modeljetty/` 中的 `image-upgrade-qa-20261102.json`、`agent-two-image-qa-20261102.json`、`dashboard-session-live-expiry-20261102.json`、`stability-protocol.json` 和 `stability-tests-20261102.tap`。凭证文件不属于报告，不复制或输出。
