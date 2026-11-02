# 图片拖入、发送反馈与三模型尺寸联调

2026-11-02，本地候选通过后，用户已授权发布 VS 与必要关联服务。发布版本、依赖顺序及线上验收以[发布记录](release-workspace-2026-11-02.md)为准。Visual Studio 初始工作区干净；ModelJetty 工作区有大量既有改动，配套发布仅纳入相关最小差异。以下联调证据保留请求能力与实际交付的区别，不能据此宣称 Codex 精确 4K 已修复。

## 原因与改动

原发送链路先创建画布，再逐张上传参考图，最后才插入聊天消息；选图也等待整批文件读取完成才显示。现在：

- 文件拖入 Agent 面板和画布分别显示放置提示；非文件拖动不受影响，阻止文件落在页面外导致浏览器导航。
- 参考图立即用本地预览显示，后台最多并行 2 张读取/上传；发送复用正在进行的上传，既有资产不重复上传。上传百分比来自真实 XHR 事件，100% 后仍等服务端保存回执才显示就绪。
- 发送同步插入用户消息和状态记录，随后才等待项目/素材/受理；保留单次执行锁。上传失败保留草稿，可明确重试素材上传；模型提交结果未知仍只按稳定 run ID 回查。
- 展示准备、规划、生成、检查四段，以及当前阶段文字和真实已等待时间；30 秒后追加慢任务提示。图已保存后提示可立即查看和下载，保留展开执行记录。
- 草稿包含原始 File 时保存到账号/画布隔离的 IndexedDB，刷新可恢复；发送准备阶段不会误称服务端已接管。中文输入法 Enter 不触发误发送。
- ModelJetty 的参考图上限与当前适配器对齐为 4 张；切换服务后不会静默丢弃已有草稿图片。

按 stageshow 的 upload / ai-chat / loading 示例打磨“拖入→缩略图→上传→消息→执行阶段→结果”的因果关系、紧凑布局、颜色与减弱动画；继续使用本项目 DOM/CSS，没有引入 React 演示组件或伪进度。

## 原画布真实耗时

只读打开用户画布的原执行记录，没有重发：

| 轮次 | 全程 | 规划 | 首图保存时间 | 独立检查 | 结果传输 |
| --- | ---: | ---: | ---: | ---: | ---: |
| 第一轮 | 73 秒 | 18 秒 | 第 58 秒 | 14.0 秒 | 1.3 秒 |
| 第二轮 | 90 秒 | 14 秒 | 第 72 秒 | 16.6 秒 | 1.7 秒 |

这些记录不含发送前的上传计时，也不能把首图前剩余耗时全部归为推理。新界面记录浏览器准备与剩余上传耗时，服务端记录规划/首图/传输/检查。

## GPT 尺寸报错的核实

`image_size_unsupported` 来自 ModelJetty `imageTaskRequest` 对 `capability.size.values` 的固定枚举校验。工作台沿用自定义像素计算，适配层只接受推荐的三个像素尺寸和 auto，合同不一致。

已实时读取 [OpenAI 官方图片指南](https://developers.openai.com/api/docs/guides/image-generation#customize-image-output)：Flare / Sunburst 支持自定义 WIDTHxHEIGHT；两边为 16 的倍数、最长边 3840、比例不超过 3:1、总像素 655,360–8,294,400。高于 2560×1440 属于实验范围。固定枚举不是模型的完整能力。

ModelJetty 候选已改成边界校验，目录标明推荐值非穷尽列表，并补齐 xhigh/max。GPT 交互按画幅、具体像素预设、自定义宽高、独立质量选择；Nano Banana 2 保留 1K/2K/4K。4K 正方形在总像素上限下实际请求 2880×2880；16:9 为 3840×2160。结果校验按所选模型的实际请求规格处理，不把 GPT 的 3840px 误比为 4096px，也不把较小输出标为达到 4K。

旧的确定尺寸拒绝显示具体原因，不再伪装为未知生成结果；原任务没有重发。

## 实际联调结果

使用现有真实账号和上游权限；候选适配与任务状态放在隔离 schema，未切换线上服务。前六次各一次独立 POST；大图修复后追加一次独立回归。全部 7 个计费 ID 各有一条消费记录、一条 settled 账本，合计 119,863 quota / ¥1.7499998。恢复只读取原响应，零模型 POST、零新增扣费。

| 模型 | 请求 | 实际原图 | 结论 |
| --- | --- | --- | --- |
| Flare | 2048×1536 / high | 1448×1086 PNG | 比例正确，未达到请求像素 |
| Flare | 3840×2160 / high | 1672×941 PNG | 比例近似正确，未达到 4K |
| Sunburst | 2160×3840 / high | 941×1672 PNG | 比例近似正确，未达到 4K |
| Sunburst | 1536×864 / high | 1672×941 PNG | 自定义宽屏成功，非精确像素 |
| Nano Banana 2 | 4:3 / 2K | 2400×1792 JPEG | 达到 2K 最低长边，比例近似正确 |
| Nano Banana 2 | 3:4 / 4K，首次 | 上游 200 / 已结算，完整结果未保留 | 交付结果不可确认，未重发 |
| Nano Banana 2 | 3:4 / 4K，修复后独立回归 | 3584×4800 JPEG，8,122,294 B | 原响应恢复成功，完整解码和 SHA256 一致 |

当前 GPT 上游按比例输出，但本批约 157 万像素，不能声称原生 2K/4K 或精确尺寸验收通过。ModelJetty 出站记录确认 size/quality 原样传入 native `/v1/images/generations`。未通过插值放大掩盖原生输出差异。

## 大图持久化问题与恢复

联调期间两次大响应整包写入触发现有 256MB PostgreSQL 进程 OOM，导致短暂数据库恢复和依赖服务重启。日志定位到 `UPDATE account_image_tasks ... raw_response`；并非已证明模型失败。

候选修复：完整上游响应先按 256KiB 分块加密持久化，主记录只存受保护的清单和摘要；结果解码放入有期限和堆限制的 worker，生成结果使用独立的 32MiB / 24MP 上限，参考图默认 10MiB 限制保持。`recoverOutput` 仅对未知任务中已完整保存、HTTP 200 的原响应重新解码并保存结果，不提交模型请求。保留旧整包存储的读取兼容。

修复后从原任务 `c3c2c33e-1416-49d8-8c61-b5de5beb774f` 恢复 3584×4800 原图，SHA256 `53bc62069669d462eb41dcc5ef3860dda940e6c9c83a1d819682c611d39c565c`。容器内证据文件导出遇到目录权限问题，随后通过只读 SSH 下载原二进制并核对摘要，未增加模型调用。首次无完整 checkpoint 的任务 `6c3d0e37-7ff8-41ce-96b3-f6b47e296afd` 单独保留为 unknown/result_unavailable，不能算成功。主账号公共运行记录无 active/unknown，服务 /health 200。未改数据库配额、未手动重启服务或替换生产镜像。

## OpenDesign 布局与模型选择

- Agent 对话在左，无限画布在右；标签起点与右侧画布左边缘对齐，新项目依次向右追加，超出后横向滚动。
- 标签只持久化账号隔离的项目 ID/标题；草稿和参考图沿用 IndexedDB。切换前等项目创建和保存，保存失败留在原页；关闭标签不删除项目。已受理的服务端任务继续后台运行，目标项目恢复自身 watcher。
- 输入框合并为一个紧凑容器，添加、模型、画幅、设置、发送在同一工具栏。模型采用与其他入口一致的原生 Popover 容器及自定义选项；支持方向键、Home/End、Enter、Escape 和点击外部关闭，沿用目录禁用状态。
- 模型显示名为 `GPT image 2.5 快速` 和 `GPT image 2.5 精细`，实际请求 ID 不变。手机画幅摘要允许换行，保证型号完整可见。
- Chrome 已实查新建标签向右追加、标题更新、来回切换的独立草稿、原 3 张参考图保留、关闭标签；模型菜单键盘切换保留像素规格。

## Codex OAuth 与官方 API Key 调查

原 4 个 GPT 请求只读回查确认：原始上游响应的尺寸已与请求不同，且质量均返回 `low`；保存的原图尺寸与该响应一致。这排除了浏览器缩略图与 ModelJetty 解码为尺寸变化发生位置。原响应无实际 model 字段，不能宣称已核实执行型号。

[sub2api #3302](https://github.com/Wei-Shaw/sub2api/issues/3302) 报告了 OAuth/Codex 对明确 size/quality 的内部规范化。[PR #6941](https://github.com/Wei-Shaw/sub2api/pull/6941) 讨论改为 Codex 专用 Images 路径，但也明确表示上游仍可能规范化参数；不是精确 4K 的保证。

本轮实时核对 [sub2api 图片转发源码](https://github.com/Wei-Shaw/sub2api/blob/main/backend/internal/service/openai_images.go)：`AccountTypeAPIKey` 走原生 Images；`OAuth` 与 `SetupToken` 走另一条路径。更换 OAuth 登录/导入 token 的形式不等于改用原生 API。Native 能力声明还允许 OAuth，调度也存在回退，因此后续对照须限定官方 API Key 独立账号/分组并禁止回落到 OAuth。

线上只读 `BEGIN READ ONLY` 查询显示：OpenAI 1 个 active/oauth，Gemini 1 个 active/oauth，Antigravity 5 个 active/oauth；OpenAI 无 API Key 账号。本轮没有添加凭据、切换通道或新增计费调用，尚不能证明换 Key 后精确尺寸成功。

建议对照使用 OpenAI Platform 项目 API Key（或服务账号 Key），保持同一模型、提示词、size/quality，分别检查出站参数、上游回执、原图像素。[官方认证文档](https://developers.openai.com/api/reference/overview#authentication) 另外支持 Workload Identity 短期令牌，但未验证 sub2api 对它的管理支持。API 账单与 ChatGPT 订阅分开，见[官方账单说明](https://help.openai.com/en/articles/9039756-managing-billing-for-chatgpt-and-the-api-platform)；GPT Image 可能要求组织验证。高于 2560×1440 仍属于官方实验范围。

ModelJetty 候选把 `delivery` 作为生成成功以外的规格回执：请求/上游 model、size、quality、原图像素，字段白名单；缺少实际型号记为 unverified。VS 经子任务 summary 传递到 Agent 执行记录，显示质量降档和型号未核实。有效原图继续保存、可下载，不自动重发。生成质量偏好与独立视觉质检分开，避免 `high` 字符串误占质检结果导致漏检。

## 验证与证据

- Visual Studio 当前全量 Node 测试 352/352 通过；主/共享/workspace helper 与新增模块语法、Functions 构建、Queue dry-run、生产静态资源构建、diff whitespace 检查通过。
- ModelJetty 本轮图片相关回归 12/12、零 skip；包括真实隔离 PostgreSQL、URL/b64 回执一致、进程重建回执保留、原图不变，以及重复读取只有一个 provider POST 的 fixture。此 POST 是本地 stub，未调用付费模型。
- ModelJetty 真实本地 PostgreSQL fixture 回归：服务鉴权、重复投递、二进制结果、尺寸边界、原图解码、分块完整性，零 skip；fixture 无付费调用。
- Chrome：真实文件选择添加三张本地图片、就绪与草稿刷新；DOM DragEvent 演练目标高亮/松开及慢上传时即时消息；桌面与 390×844 布局。没有将 DOM 拖入演练声称为已验证操作系统 Finder 的跨窗口拖动。
- 演练的模型任务阶段用隔离本地 fixture，素材上传用本地真实 API；三模型尺寸和账务证据来自另行真实上游联调，两者分开。
- 本地证据目录 `/tmp/visual-studio-agent-interactions-20261102/`：`all-tests.log`、`modeljetty-focused.log`、`modeljetty-output-tests.log`、`functions-build.log`、`queue-build.log`、`real-size-qa.jsonl`、`recovered-output-qa.jsonl`、`final-size-billing-readback.json`、`final-health-and-receipt.json`、`nano-4k-original.jpg` 和 `ui-*.png`。
- 本轮增量证据 `/tmp/vs-pixel-20261102/`：`vs-full-tests.log`、`modeljetty-image-suite.log`、`pages-build.log`、`queue-dry-run.log`、`public-build.log`、`size-route-readback.json`、`sub2api-path-readback.json`、`sub2api-account-types.json`、`model-menu-desktop.png`、`tabs-left-desktop.png`、`model-menu-mobile.png`。
