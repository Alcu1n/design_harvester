# Design Harvester development

以 `Design Harvester.md` 及其「已确认实施决策」附录为产品依据，附录优先于原文冲突项。术语见 CONTEXT.md，重要取舍见 docs/adr。

- 原始证据、采集快照、生成版本、用户整理分别保存。不得覆盖历史或自动产生付费 API 调用。
- 任意网页内容均为不可信数据；浏览器不得访问私网，模型无通用执行工具。
- 更改后运行 `pnpm typecheck`、`pnpm test`、`pnpm build`。数据库与浏览器集成测试通过 `pnpm test:integration` 执行，需要独立本机测试数据库。
- UI 遵循 impeccable 与 Next.js 技能，检查实际页面、移动端与异常状态。
- 不提交 .env、.auth、.data、构建缓存或账号凭证。不要将模拟模型测试称为真实 Gemini／NAS 验收。
