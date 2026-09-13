# Design Harvester

私有网页设计资料库。按页面 URL 收藏，保存三尺寸截图、浏览器证据、不可覆盖的生成版本，以及 `DESIGN.md` / `IOS_design.md`。中文界面支持检索、整理、历史比较、文档复制和 ZIP 下载。

## 运行

需要 Node.js 24、pnpm 10.30.3、Docker Compose。仅在私网或可信身份网关后运行，无应用账号体系。

```sh
cp .env.example .env
# 设置 POSTGRES_PASSWORD 为随机字母数字密码，APP_ORIGIN 为访问地址
pnpm install --frozen-lockfile
docker compose up -d --build
```

默认访问 http://localhost:3000 。更换域名或端口时同步修改 `APP_ORIGIN`，写操作验证完整 Origin。公网入口须由外部身份网关保护；不要直接绑定公网。

## 会员模型与授权

Google 于 2026-06-18 停止 Gemini CLI 的个人免费及 Google AI Pro/Ultra 通道，个人会员已迁移到 Antigravity CLI。系统默认使用固定版本 Antigravity CLI 1.2.2；Google AI Credits 使用关闭，不设置 API key，也不自动切换付费 API。

```sh
docker compose run --rm -it worker pnpm --filter @harvester/core exec tsx src/agy-login.ts
```

选择 AI Pro 个人账号完成浏览器授权。凭证仅在专用 auth 卷内，网页只读取脱敏状态。Mac 授权成功不代表 NAS 授权可迁移，NAS 应独立登录并验证重启续期。登录失效或额度不足时暂停并保留已完成阶段，在详情恢复。

若已有合适的 Gemini 企业 OAuth 项目，可显式设置 `MODEL_PROVIDER=gemini-cli`、`GOOGLE_CLOUD_PROJECT` 并运行 `src/login.ts`；这不是个人会员的备用通道，系统不自动启用。

官方说明：[会员迁移](https://developers.googleblog.com/an-important-update-transitioning-gemini-cli-to-antigravity-cli/)、[CLI 权限](https://antigravity.google/docs/cli/permissions/)。

## Mac 开发

```sh
pnpm install --frozen-lockfile
pnpm --filter @harvester/core exec playwright install chromium
pnpm db:migrate
pnpm dev
# 单独终端：受控出口
pnpm --filter @harvester/core exec tsx src/proxy.ts
# 单独终端：只用于本地开发；生产使用隔离浏览器容器
ALLOW_LOCAL_BROWSER=true pnpm worker
```

数据库默认 `postgresql://harvester:harvester@127.0.0.1:5432/harvester`，可用 `DATABASE_URL` 覆盖。本地 Antigravity 二进制放在 `.tools/agy`，或用 `AGY_BIN` 指定专用固定版本。授权目录默认 `.auth/antigravity`。如需联网代理，为 worker 和登录命令设置 `HTTPS_PROXY`。不要使用开发者日常账号配置目录作为模型工作目录。

## 数据与恢复

- 设计条目：规范化页面 URL、用户名称/标签/备注。
- 采集快照：来源、三尺寸 PNG/WebP、可定位证据。
- 生成版本：分析、文档、质检及版本元数据。
- 执行任务：阶段、检查点、暂停/取消/错误和重试。

重复 URL 新建快照；重新生成复用旧快照。质量至少 85、无关键错误、文件完整且官方校验通过才更新默认版本。70–84 最多修订一次；不合格产物仍可查看下载，不替换旧合格版本。

文件按 `条目ID/snapshots/快照ID` 与 `条目ID/versions/版本ID` 组织，manifest 记录 SHA-256。数据库负责索引，Markdown/JSON/PNG 可独立使用。删除先请求停止关联任务，再由后台清理。

```sh
./scripts/backup.sh /absolute/path/to/new-backup
# 以下明确替换当前部署的数据；先核对目标部署与备份
./scripts/restore.sh /absolute/path/to/backup --replace
```

备份同时包含 PostgreSQL 与资产目录，不含 OAuth 凭证。恢复到新机器后重新授权。备份期间暂停写服务，恢复先验证归档与资产校验和。

## 架构与限制

Next.js / React / Tailwind + PostgreSQL / Drizzle + pg-boss 后台队列。事务 outbox 保证任务落库与入队一致性。浏览器只有受控公网出口，不挂载数据库凭证、模型授权或资产目录；实际连接目标进行 DNS/IP 检查，WebSocket 与 Service Worker 阻断。

每页最多 30000px，懒加载滚动和页面稳定等待有上限；证据记录限制。无法消除关键遮挡时保存诊断，不绕过登录、订阅或验证码。模型解释与浏览器实测数值分开，最终 token 由代码渲染。Google DESIGN.md alpha 使用官方 `@google/design.md` 0.4.0 校验器锁定，不随上游静默升级。

本地浏览器开发模式没有容器级网络隔离，仅用于受控测试；NAS 架构、内存、实际网络、OAuth 重启复用须在目标机器验收。

## 验证

```sh
pnpm typecheck
pnpm test
# 使用独立 harvester_test 数据库，或设置 TEST_DATABASE_URL
pnpm test:integration
pnpm build
pnpm --filter @harvester/core exec tsx src/ui-check.ts
```

单元测试覆盖 URL/IP/Origin 边界、官方渲染校验和质量门槛；数据库集成测试使用受控模型验证检查点、有限修订、默认版本保护、整理保留、取消与删除。受控模型测试不等于真实模型质量验收。实际截图位于被 Git 忽略的 `artifacts/verification/`。

## 懒猫 LC-02

执行 `python3 scripts/build-lpk.py` 生成内嵌 amd64 镜像的 LPK V2 安装包。安装、会员登录、持久目录和备份说明见 [懒猫部署说明](docs/LAZYCAT.md)。

## 切换 AI 服务

在「设置 → AI 连接」选择 Gemini 或 DeepSeek 并保存；选择 DeepSeek 时模型默认 `deepseek-flash`，可修改模型名称。设置对新任务和重新生成生效，已创建任务及重试保持原模型。DeepSeek 是主动选择的计费 API，不作为 Gemini 的自动备用。

在设置页填写 DeepSeek API 密钥并保存，留空保留已有值，新值替换旧值；保存后输入框清空，接口不返回密钥。密钥保存在服务端 PostgreSQL 的独立配置记录中，数据库备份包含密钥，需按凭证保护。后台优先使用此密钥，再读取 `DEEPSEEK_API_KEY` / `DEEPSEEK_API_KEY_FILE`；本地开发仍可使用根目录 `deepseek_api`。已有数据库先运行 `pnpm db:migrate`，然后重启更新后的 web 和 worker。

Docker worker 可通过 `DEEPSEEK_API_KEY` 环境变量传入密钥，或将文件放入其专用授权卷 `/auth/deepseek_api`。懒猫 worker 使用同一文件路径。`deepseek_api` 已排除 Git 与 Docker 构建上下文。已有 0.1.0 LPK 不会随源码修改自动更新，部署新版需重新构建安装包。
