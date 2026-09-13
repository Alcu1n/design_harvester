# 优先使用独立 Gemini CLI 会员通道

首版使用 Google AI Pro 账号的 Gemini CLI OAuth 通道，固定 CLI 0.59.0，并隔离授权目录、扩展、上下文和模型工具。CLI 返回的 JSON 是传输封装，业务正文仍需 schema 校验。认证或额度问题暂停任务，绝不自动切换付费 API。相较 SDK，这需要自行处理进程、限额和授权续期，但符合已确认的费用边界。

Stagehand 暂不作为运行依赖：其标准 Gemini 接入使用独立 API key。复杂弹窗由 CLI 从允许候选中建议动作，Playwright 校验后执行；不授予通用代理权限。

## 2026-09-13 上游通道变更

以上原计划被 Google 官方 2026-05-19 公告修正：自 2026-06-18 起 Gemini CLI 不再服务个人 AI Pro/Ultra 用户。默认 provider 改为 Antigravity CLI 1.2.2，保留企业 Gemini adapter 但不自动切换。Mac 个人 OAuth 与图片识别已验证；NAS 授权尚未验证。

CLI `--json-schema` 在该版本实测会重复拼接正文，故应用传入明确 schema 并使用 Zod 校验正文，不能以 CLI SUCCESS 判断业务成功。`strict` 实测拒绝任务读取；采用 request-review 配合明确禁止写入、命令、网络、MCP 的权限，并仅开放当次任务读取。缓存授权、上下文目录和项目配置独立于用户日常环境。付费 credits 明确关闭。
