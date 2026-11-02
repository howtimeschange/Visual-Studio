# Agent 设置、参考图与生图耗时跟进

本地改造始于 2026-11-01，延续至 11-02；未提交、推送或部署。既有未提交改动保持。

## 默认模型与交互

- 设置弹窗改为左侧分类、右侧配置、底部保存。ModelJetty 与 1xm 分别保存默认 Agent 模型，可同步到账号；公开回读为 `apiKeys.preferences`，不把模型偏好当成密钥。
- `/api/account/modeljetty/models` 使用已关联身份读取 ModelJetty `/account/model-catalog`，字段白名单、鉴权及 `no-store`。目录是完整平台列表，不是账号的 `/account/models` 子集。
- 实际目录 22 项：DeepSeek 2、Google 11、OpenAI 9；按厂商分组、快捷筛选、文本搜索及手动刷新。当前测试账号可用 Gemini 3.8 Flash Medium 与三个图像模型；Agent 只允许文本/多模态模型。未开通的型号展示中文原因，不扩大账号权限。
- 选定模型保存后用于下一轮。GPT 文本模型使用 Responses 多模态输入；Gemini/DeepSeek 使用 Chat。非默认模型与 Responses 路径已覆盖自动测试；受联调账号权限限制，真实 Agent 验收使用 Medium。
- 工作模式控件整体移除，统一自动创作；旧会话的 `plan` 设置恢复为 `auto`，保留历史消息、设计能力和原运行记录。用户自然语言要求暂不出图仍可得到方案。
- 图像模型、比例与分辨率常驻输入区；设计能力在 Agent 设置中。输入框发送后恢复 38px，参考图采用横向紧凑卡片。
- 已生成图片的结果区与画布工具条均有“加入参考图”，复用原资产并去重。输入框附近常驻“添加选中图”；加入、重复和移除均有反馈。
- Agent 回复支持已转义的 Markdown：标题、强调、列表、表格、引用与代码；禁止执行原始 HTML 和危险链接，不自动加载远程 Markdown 图片。
- 活动运行只显示一条原加载动画，保留展开/收起执行记录。新 favicon 与当前视觉风格一致。

## 生图性能证据

规划看图与设计合并为一次多模态请求，旧两阶段调用保持兼容。新真实仅分析用例约 43 秒、一次请求；旧两次请求约 39 秒，样本不足以宣称实际规划更快。图片轮询将 job 和 items 合并为一个 GET，服务商仍 running 时不再闪回“排队”。

唯一诊断图为 `job_8e605ce8-66f7-4c39-8f5d-1fb3af45a422`，provider task `205f97a8-44f5-4213-8eb0-d6e1b68b58dc`。1K/1:1 参考图生成成功，实际 1024×1024 JPEG，资产 `asset_350a608c-ad2c-4569-82f1-79cb24a42ce2`。

| 阶段 | 实测 |
| --- | ---: |
| 本地排队 | 43 ms |
| 出站至 HTTP 200 响应头 | 15.159 s |
| 响应头至完整 body，2,365,821 bytes | 52.806 s |
| 解码 | 64.9 ms |
| 加密及持久化 | 66.8 ms |
| VS 受理至结果持久化 | 70.673 s |

精确计费 ID 对应网关 HTTP 计时为 13.444 秒。该次主要延迟在网关完成后的本地 SSH 回传，不能把 52.8 秒归为模型推理。旧图受理至完成 172.542 秒，缺少分段记录，不能套用新图归因。

ModelJetty 配合侧已在无活跃/未知任务时保持同一 loopback 端口重建 SSH 压缩隧道，并载入数据库明确列投影，减少任务查询读取的多 MB 原始响应。未修改全局 VPN 或公网暴露。

同一 2,398,417 bytes 静态文件、同一 SHA256：旧隧道两次 17.237/15.609 秒，切换后 7.584 秒。这只证明当前传输探针改善，不能将 JS 文件收益当成真实图片提速比例。

## GPT 参考图报错

用户原失败任务 `job_fe828e94-a6c5-420f-9bd2-01aa1e9ecd74`，operation `item_6ed961d5-aa68-49e3-90d5-07022d36196c`，为本地 `image_reference_unsupported` 422。配合侧确认原 operation 在任务和请求表均为零行，发生在受理和付费派发之前，未重放该请求。

根因是 ModelJetty 本地目录将两 GPT 图像型号的 `referenceImages` 写成 false，适配只转发 `/images/generations`；不是模型不支持编辑。已移除 VS 对两模型“仅文生图”的标注及按技能拦截，配合侧补齐有图转 `/images/edits` multipart、无图保留 generations，继续使用原异步 create/query 合同。客户端仍传原 JSON `image[]`，支持 1–4 张 PNG/JPEG，单张最多 10MiB、合计 20MiB。

随后通过 QA 页面只点击一次发送，真实完成 Flare 参考图链路：

- run `32f6c107-944d-4d9a-871b-ad0fa0f06eaa`，实际 `mode:auto`、`reference-edit`，一次看图规划 29.719 秒。
- job `job_3eaea404-2fdc-4af3-b4cb-ec9b4b4fdc88`，operation `item_97b0d447-07b4-407a-a97b-a7c03f658c54`，provider task `b190175c-a616-405a-bbf8-cc6c5132413c`。
- 确认上游实际为 `/v1/images/edits`、1 张 JPEG 参考、`n:1`；HTTP 200，task succeeded、VS completed，资产 `asset_fd07152e-bf42-4483-a91e-3b78f9f5f147` 可读取并保存到画布。
- 输出 PNG 实际 1254×1254（请求 1024×1024），不能宣称尺寸严格遵从。已查看原图及画布：蓝色茶壶延续，背景改暖米色，增加茶杯、琥珀茶汤与热气，满足本次编辑诉求；没有进行独立语义质检或严格产品身份评测。
- 规划与图片两笔均 settled，合计 14,607 quota，按本地换算约 ¥0.2132622；没有重放原失败 operation，配合侧无新增模型 POST。
- 总运行 100.705 秒，图片本地链路约 68.632 秒。其中网关 HTTP 23.128 秒，响应头至完整 body 41.701 秒，回传瓶颈仍存在；静态探针改善不能当作实际图片延迟已解决。

Sunburst 同一编辑适配已通过 fixture/集成回归、目录能力真实读回，但本轮没有追加其付费参考图请求。此前两个 GPT 模型的文生图验收仍保留。

2026-11-02 的 UI 走查随后追加并完成了 Sunburst 真实参考图编辑与 Chrome 原图下载，整轮约 55 秒；详见 [UI 走查记录](ui-walkthrough-2026-11-02.md)。

## 验收与证据

代码回归 309/309、零 skip，Pages Functions 构建、主前端/共享前端语法检查通过。后续改动按影响补跑定向检查。

浏览器采用独立 QA 画布 `canvas_818c3dcc-8aa4-4c66-b88c-86722a4b086b`，不改写用户正在编辑的画布。已核对厂商分组、搜索/空态保留当前选择、保存与刷新后 Medium 保留、Markdown、画布引用去重、工作模式控件移除。当前截图视口为 1280×720；临时小屏 override 未改变该标签页实际尺寸，因此本轮不声称已完成新的 390px 浏览器验收。

证据目录 `/tmp/visual-studio-followups-20261101/`，包括 `full-tests.log`、`functions-build.log`、`catalog-live-readback.json`、`model-preferences-readback.json`、`image-diagnostic.json`、`flare-reference-manifest.json`、`flare-reference-success.json`、实际 PNG 与截图。ModelJetty 分阶段及探针对照见 `/tmp/visual-studio-modeljetty-e2e-20261101/modeljetty/diagnostic-timing.json`、`transfer-probes.jsonl`、`flare-edit-live-readback.json` 及对应项目的 `docs/verification/visual-studio-local-2026-11-01.md`。
