# 风格迁移批量化计划

## 目标

参考批量翻译和批量换装，把风格迁移从单次生成扩展为可排队、可恢复、可重试的批量任务。

## 执行步骤

1. 后端先补红灯测试：提交 `style_transfer_batch` 时创建 job 和 item，运行队列后生成 result asset，并纳入认证保护。
2. 后端实现：导出可复用的风格迁移生成函数，新增 `style_transfer_batch` job submit/run/retry，以及对应 Pages API。
3. 前端先补任务管理/运行态测试：job task 工具支持 `style`，runtime 能保存和恢复风格迁移任务。
4. 前端实现：风格迁移页复用现有参考图作为批量主体列表，提交 `/api/jobs/style-transfer-batch`，接入任务卡、下载、轮询和历史结果。
5. 验证：跑新增/相关单测、`node --check public/app.js`，最后只提交本需求相关改动。
