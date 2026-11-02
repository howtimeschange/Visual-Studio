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

先 ModelJetty 最小账号服务配套，再 VS Queue，最后 Pages 指纹资源。没有 schema migration 或新密钥配置；不变更 Codex 授权方式、sub2api 或计费价格。

- VS 发布前 main / origin/main：`8de7171c4dd793f0538b3df10bac31cf7fb0d004`。
- Pages 发布前 production：`2a720ad1-6837-477e-a802-cdda36287386`。
- Queue 发布前版本：`c2bdefa3-bbb8-44cd-ba8f-b9e694834951`。
- ModelJetty 协查会话：`01a19c14-7754-7ac2-b1b8-9107a4758e28`；独立审核最小镜像、在途任务、回滚和原结果读回，保留其他 dirty 工作。

## 发布与线上验收

待执行后回填版本和线上验收证据，不以构建成功替代已上线。

## 回滚

Queue 可回到发布前 `c2bdefa3-bbb8-44cd-ba8f-b9e694834951` 版本；Pages 可在 Cloudflare 部署管理页回滚至上述 production deployment。发布日志保存于本地证据目录。ModelJetty 的独立镜像回滚由配套发布记录提供。回滚不能删除在途任务、作业收据或已生成原图，未知调用仍只回查。
