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

重复 URL 新建快照；重新生成复用旧快照。自 0.1.5 起，只要生成非空 DESIGN.md 即完成任务并更新默认版本；继续尝试生成 iOS 文档、中文介绍及质量评分。官方规范校验已移除，内容问题与分数仅供参考，不再触发失败或低分重写。历史版本保留。

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

单元测试覆盖 URL/IP/Origin 边界、证据保真渲染和评分计算；数据库集成测试使用受控模型验证文档完成判定、独立评分、降级评分、检查点、历史保留、人工状态竞态、取消与删除。受控模型测试不等于真实模型质量验收。实际截图位于被 Git 忽略的 `artifacts/verification/`。

## 懒猫 LC-02

执行 `python3 scripts/build-lpk.py` 生成内嵌 amd64 镜像的 LPK V2 安装包。安装、会员登录、持久目录和备份说明见 [懒猫部署说明](docs/LAZYCAT.md)。

### 打包与实机排障经验

2026-09-13，`0.1.2` 已在 lai（LC-02，x86_64，LZCOS 1.6.2，Compose 2.32.4）安装验证。后续发布沿用包 ID `local.alcuin.design-harvester` 和持久目录，更新 `package.yml` 的版本号；不能只以本机构建成功作为交付验收。

| 本次问题 | 后续必须保留的处理 |
| --- | --- |
| `invalid platform: linux/arm64` | `unsupported_platforms` 声明客户端平台，不是 Docker CPU 架构；架构在镜像构建和 OCI 校验中处理。构建前运行 `node scripts/validate-lpk-package.mjs`。 |
| `invalid bind: …:ro` | 懒猫 `binds` 不接受 Docker 的 `:ro` 后缀；只读属性放入 Compose override，并在设备上确认 web 的 `/data/library` 为 `RW=false`。 |
| 首次初始化时后台连接数据库失败 | PostgreSQL 健康检查使用 `pg_isready -h 127.0.0.1`，避免临时 Unix socket 提前报告就绪；worker 设置正确的 HOME。 |
| 业务容器健康、平台入口仍未就绪 | 保留容器探针和启动依赖，入口以实际设置 API 检查就绪；不要为通过平台检测而取消浏览器网络隔离。 |
| CLI 打包后个别镜像层截断 | 固定 CLI 2.0.9 的兼容加载器仍需保留；同时校验压缩摘要、解压摘要和层大小。升级 CLI 后重新验证，不能直接删除修复。 |

`!override` 用于整体替换浏览器的网络和挂载列表，不能改成追加。当前 web 只读挂载依赖实机路径 `/lzcsys/data/appvar/local.alcuin.design-harvester/library`；这是平台内部布局依赖，换设备或升级系统时必须复核。不要把它当成通用、稳定的部署接口。

每次重新打包后检查最终包元数据、OCI 镜像与 override，再验证实机安装、六个容器健康、设置 API、实际网络／挂载和公共网页三尺寸采集。本次采集成功后按预期进入 `WAITING_AUTH`；不代表真实 AI 生成或外部客户端页面已验收。密钥、OAuth 授权、收藏数据和构建缓存不得进入安装包或 Git。

排障先读设备包管理器日志和应用启动日志；`lzc-cli box list` 显示 READY 不代表开发者工具 SSH 已授权。具体错误、修复和验收记录见 [懒猫部署说明](docs/LAZYCAT.md)。

### 0.1.3 运行镜像瘦身

worker 使用独立的生产依赖目录和必要源码，出口代理只包含 tsx、ipaddr.js、zod 与代理源码；前端继续使用 Next.js standalone。保留 Chromium headless shell、Antigravity 和显式 Gemini CLI 通道，五镜像仍全部内嵌，不把安装包体积转移成首次安装下载量。

详情页回归检查：启动网页后，执行 `node scripts/verify-detail-ui.mjs <详情页 URL>`。选择已有完整文档且 Design DNA 足够长的条目；脚本只读取资产，检查桌面等高／渐隐、缩放事件、下载错误恢复和移动端文件准备／取消／重试，不修改收藏或触发模型调用。移动端系统分享接口为模拟，不能替代客户端实机验收。

### 0.1.4 英文文档与中文展示

新生成的 `DESIGN.md` / `IOS_design.md` 以英文分析为唯一来源；Design DNA 和资料库卡片使用与该英文候选绑定的简体中文译文，个人名称、标签和备注不变。历史版本保持原样；已有失败任务点击恢复后按新规则检查并沿用截图、证据，已完成版本需手动重新生成。

官方 `@google/design.md@0.4.0` 校验、两份文档的语言检查、独立英语质量审核和中文翻译一致性审核共同把关。每次执行／手动恢复最多五次额外内容修复（质检修订也计入），等待 5/15/30/60/120 秒由任务调度完成。次数、候选及阶段跨重启保留；网络重试、登录和额度暂停不重置内容额度。相同候选与相同错误再次出现会提前停止。未通过的候选不能覆盖默认合格版本。

每个候选独立保存在版本的 `candidates/` 中，检查报告位于 `checks/`，旧文件在 `legacy/` 保留。`display-zh.json` 的 `sourceCandidate` 绑定最终英文分析。不可靠的 token 转换会在后续生成完成后报告原始字段；不会编造颜色、字号或删去观测值来通过检查。

界面受控回归：生产构建并启动本地网页后运行 `node scripts/verify-content-ui.mjs http://127.0.0.1:3104`。该脚本模拟 API 数据，不调用模型或改动数据库；覆盖桌面／手机修复进度、语言校验、翻译、失败报告和中英文展示分离。

规范／语言检查失败时，继续生成 `IOS_design.md`、中文介绍和审核结果，完整保存后才统一安排修复。详情页可手动标记任务为“已完成／失败”；人工标记会停止当前任务并留下记录，不修改文档检查结论或默认合格版本。

### 0.1.5 文档生成成功与独立评分

覆盖 0.1.4 的规范／评分完成门槛：删除官方校验器及依赖；生成 DESIGN.md 后，语言检查建议、低分、iOS／翻译／审核异常均不阻止完成。仍以英文生成两份文档，以中文展示忠实译文；错误译文不展示，并在检查建议中说明。取消和人工状态仍优先于后台发布。

模型评分采用证据准确性、视觉还原、设计抽象、响应式理解、iOS 适配五项等权平均。模型审核不可用时，确定性规则按已有证据引用与文档完整度给参考分：完整字段或已存在的证据引用最多获得各项 60 分，三个视口各计 20 分，未评估视觉还原为 0，因此规则参考总分最高 48。明确标注未做语义审核；无文档／分析的版本为 0 分。分数不决定完成状态，不编造高分。历史终止任务打开详情时补缺失评分，保存独立报告，不调用模型、不改写旧文档和审核文件。


### 0.1.6 图片分析与一次生成

本节覆盖前述历史版本的语言／翻译审核流程。正常任务只调用模型三次：英文分析与中文 DNA 同次生成、英文 iOS 适配、独立质量评分。取消逐句语言审核与翻译审核；不再显示大段检查建议或依据分数改写文档。技术性返回异常最多额外重试两次；登录与额度异常不切换模型。中文缺失时可单独补生成，已有、绑定当前英文候选的中文缓存自动恢复，不改动文档、评分或默认版本。

图片入口支持同一设计的 1–10 张 PNG/JPEG/WebP，可拖入、粘贴、排序和删除。每张最大 10 MiB、共 50 MiB、每张不超过 4000 万像素。上传只写独立 imports 暂存目录，worker 归档原图与预览后删除暂存；web 的 library 保持只读。图片任务直接分析图片，不访问浏览器，不生成虚构 DOM／CSS 实测证据；视觉推断和原生实现建议分别表述。单图的跨页面一致性评分为不适用，不计入总分。

Overview 参考官方章节语义，要求 80–140 个英文词描述视觉性格、层级与可复用规则；不复述网站业务、计数器或营销文案。继续保留官方八章顺序，但不启用官方格式校验。
