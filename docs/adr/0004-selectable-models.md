# 0004：可选择的 AI 服务与任务模型固定

2026-09-13，按用户授权增加 DeepSeek API；其默认模型为 `deepseek-flash`。Gemini 会员通道继续保留。只有主动选择 DeepSeek 的新任务使用计费 API，任何失败都不会跨服务自动回退。

设置保存在 PostgreSQL `app_settings`，不依赖 web/worker 环境变量同步或重启。创建任务时把服务、模型与协议版本固定到生成版本 metadata；重试／恢复沿用原模型。切换后需要重新生成才能让已有条目使用新模型。

按后续用户要求，设置页允许填写并保存 DeepSeek 密钥。密钥和模型配置在同一数据库事务中保存，但密钥单独存于 `app_settings` 的 `deepseek-credential` 记录，不进入模型配置返回值、版本 metadata、资产或日志。GET 只查询是否存在；PATCH 不返回密钥。输入留空保留已有值，保存后前端清空输入。沿用私网／可信身份网关部署与同源写入校验。数据库备份包含凭证，应按凭证保护；首版使用数据库现有访问控制，没有额外应用层加密。

后台优先使用网页保存的密钥，然后读取环境变量 `DEEPSEEK_API_KEY` 或 `DEEPSEEK_API_KEY_FILE`，本机开发最终回退至项目根目录 `deepseek_api`。Git 与 Docker 上下文均排除此文件。

请求使用官方 Chat Completions、图片内联和 JSON mode；图片转为有界 WebP，请求上限 48 MiB，响应上限 8 MiB，超时 180 秒。业务结果仍通过原有 Zod schema 和确定性渲染。401/403 等待认证，402 等待额度并要求手动恢复，429 按有效 Retry-After 恢复或等待手动操作。不转发供应商错误正文，防止密钥或请求材料出现在日志与页面。

依据：[首次调用](https://api-docs.deepseek.com/)、[图片输入](https://api-docs.deepseek.com/guides/vision/)、[JSON 输出](https://api-docs.deepseek.com/guides/json_mode/)。
