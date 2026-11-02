# 画布交互与图片规格发布记录

用户于本地走查通过后明确授权线上发布，以及建立关联服务协查会话。

## 范围与验证

- Agent 左侧 / 无限画布右侧；标签左对齐画布、依次向右追加；保存失败禁止切换，关闭标签不删除项目。
- 统一模型浮层及 `GPT image 2.5 快速 / GPT image 2.5 精细`；GPT 像素选择、自定义尺寸与质量。
- 文件拖入反馈、即时缩略图、最多两个并行上传、即时聊天记录和阶段计时；保留失败草稿与原任务回查。
- 子任务传递真实尺寸与上游质量/型号回执；生成质量偏好与视觉质检分离。规格不符仍保留原图，不自动重发。
- 当前源码全量 Node 352/352，Functions build、Queue dry-run、前端语法和 whitespace 检查通过；变更文件密钥特征扫描无命中。
- 已实际查看桌面和 390×844；验证模型键盘选择、菜单选中态、来回切换的独立草稿及 3 张原参考图、标签标题和关闭行为。文件选择及 DOM 文件拖放演练见联调记录；不将其宣称为已覆盖 Finder 跨窗口原生拖动。

本地证据 `/tmp/vs-pixel-20261102/` 中 `vs-release-tests.log`、`release-pages-build.log`、`release-queue-build.log`、`model-menu-desktop.png`、`model-menu-mobile.png`、`tabs-left-desktop.png`。三款真实生图与账务证据见[联调记录](agent-upload-and-size-validation-2026-11-02.md)。

## 发布顺序与基线

先 ModelJetty 最小账号服务配套，再 VS Queue，最后 Pages 指纹资源。VS 无新增 schema migration；ModelJetty 兼容新增原始响应分块表 `account_image_raw_chunks`，保留旧记录。两端均无新密钥配置，不变更 Codex 授权方式、sub2api 或计费价格。

- VS 发布前 main / origin/main：`8de7171c4dd793f0538b3df10bac31cf7fb0d004`。
- Pages 发布前 production：`2a720ad1-6837-477e-a802-cdda36287386`。
- Queue 发布前版本：`c2bdefa3-bbb8-44cd-ba8f-b9e694834951`。
- ModelJetty 协查会话：`01a19c14-7754-7ac2-b1b8-9107a4758e28`；独立审核最小镜像、在途任务、回滚和原结果读回，保留其他 dirty 工作。

## 发布与线上验收

发布已完成，正式站点 [image.crawshrimp.com](https://image.crawshrimp.com)。

| 组件 | 已发布版本 | 验收 |
| --- | --- | --- |
| ModelJetty accounts | `visual-studio-image-20261102-v2`，镜像 `sha256:255fe92936b5371ad0d8e00425a3dd0b8c9372619865638d37a7d7a625d13d4a` | 独立候选19项零skip；真实HTTPS目录v2和5个原任务四种读取哈希一致，零新增付费推理 |
| VS Queue | `458fc334-d97a-4fe1-91cc-3bdbb2fee7b3`，源码 `1ca72d8` | deployments 回读100%，三路 producer/consumer 与定时恢复已发布 |
| VS Pages 最终版本 | `4fa9b4b7-fc5c-4d03-b2ae-9d9dde13528a`，源码 `7e86fe6d4ff3ab80e4924aaa98767cde991b496f` | production/main 元数据及正式域名资源逐字节匹配 |

核心功能提交 `1ca72d8b98ee0774a936c5c241b65ad65c1d9728`，初次 Pages deployment `7208a346-45cc-4bc2-9d82-8898327efda8`。线上走查发现 Chrome 仍复用旧 SVG sprite：新增发送箭头未显示，但 DOM 样式正常、服务端 SVG 含新 symbol。补丁 `7e86fe6` 为静态和动态图标引用加版本，重新跑全量352/352后仅更新 Pages；同一 Chrome 页面刷新后箭头恢复。Queue 源码没有因此变化，不重复发布 worker。

正式域名最终资源回读：

- `/_runtime/app-ZFCU62TG.js` SHA256 `211bba18eee7dcd5fd0da7d8de2cc79b4baec58bc5f24ee215130e06c24bac9f`。
- `/_runtime/styles-4QXTTYDJ.css` SHA256 `d7c5956e105f24b3b9bb6c9464b4a7592d470baa70b0e085637390c1056d912e`。
- `/css/workspace-layout.css` SHA256 `835e6d75d3bfac113501ac2336b6a39b5998c9f2703599f9775a45e9b0bcdcf0`。
- `/icons.svg?v=20261102-workspace` SHA256 `e956fdf36587958f2f8c2b5a113a774c715d84f3340402dfd7a51274af4ce510`。

以上均与实际发布临时产物一致，见 `/tmp/vs-pixel-20261102/public-final-release.json`、`pages-final-release.txt`、`queue-after-release.txt` 和发布日志。GitHub main 已回读为功能及图标补丁源码；本记录后续单独提交，不需要重发运行代码。

登录后的正式画布已实际查看：原2张作品与对话可读，左侧Agent和左对齐标签生效；模型浮层完整显示三款模型；GPT4K方形显示实际2880×2880，实验提示正常；自定义4097宽度显示校验错误、禁用应用并给出建议值，取消后恢复尺寸；验证后还原原有Nano Banana 2 / 1:1 / 4K偏好。没有发送生成请求，旧失败记录保留且未重试。`production-workspace-final.png`、`production-size-invalid.png` 保存于本地证据目录；本次检查未见 ReferenceError、SyntaxError 或 TypeError。

ModelJetty 的完整最小发布、备份、容器身份、19项检查、生产回读及回滚记录在关联仓库 `docs/verification/visual-studio-image-release-2026-11-02/README.md`。其源码身份为原不可变生产镜像加7文件补丁和manifest，未将大量dirty源码整体提交或推送。仅账号服务切换，New API、sub2api、Bot API/worker和PostgreSQL镜像及StartedAt均保持不变。旧图片任务不追补delivery，新任务才写交付审计；本次没有证明Codex精确4K/high质量遵从已恢复。

## 回滚

Queue 可通过 `npx wrangler rollback c2bdefa3-bbb8-44cd-ba8f-b9e694834951 --config wrangler.queue.toml` 回滚。Pages 可在 Cloudflare 部署管理页回滚至上述发布前 production deployment；不要把首次上线但缺图标缓存修正的7208版本作为首选。ModelJetty 独立镜像回滚使用配套记录中的原3份Compose，仅重建账号服务，不恢复整库、不删分块表。回滚不能删除在途任务、作业收据或已生成原图，未知调用仍只回查。
