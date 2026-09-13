# 懒猫 LC-02 安装与维护

此移植包面向单用户私有使用，包 ID 为 `local.alcuin.design-harvester`。使用 LPK V2，业务镜像为 Linux amd64；不包含 Mac 的 `.env`、OAuth 凭证、数据库或收藏资产。

## 安装

1. 系统需为 LZCOS 1.6.0 或更新版本，运行环境需支持 Docker Compose 2.24.4+ 的 `!override` 标签。预留约 6 GB 内存预算和至少 10 GB 安装空间，收藏截图另计。
2. 在懒猫客户端选择本地安装 `release/design-harvester-0.1.4-amd64.lpk`。安装包声明联网与 Compose override 权限，入口由懒猫身份网关保护，仅管理员可见。
3. 首次启动自动创建数据库结构。界面可以打开后，在设置页查看认证状态；未认证时任务会暂停。
4. 使用 DeepSeek 时，在「设置 → AI 连接」选择 DeepSeek，填写 API 密钥并保存，默认模型 `deepseek-flash`。密钥存于设备数据库，备份数据库时也应保护其中的凭证。使用 Gemini 时，在开发者工具的 **worker 容器**终端中执行：

   ```sh
   cd /app
   pnpm --filter @harvester/core exec tsx src/agy-login.ts
   ```

   使用 Google AI Pro 个人账号完成浏览器授权。采用项目已验证的 Antigravity CLI 会员通道，禁止自动付费回退。授权保存到设备的独立 `/auth/antigravity`，重启后复用。勿把授权码写进配置文件或日志。
5. 回到应用设置确认认证可用，然后恢复暂停的任务。设备需要能够访问 Google 会员服务；本机的 `host.docker.internal:7890` 代理地址不会移植到 NAS。

未安装到真实设备前，不能把本机镜像或 Compose 验证视为 NAS 验收。

## 文件布局与备份

| 持久目录 | 用途 |
| --- | --- |
| `/lzcapp/var/postgres` | PostgreSQL 数据目录 |
| `/lzcapp/var/library` | 截图、证据、Markdown、manifest |
| `/lzcapp/var/auth` | 专用会员授权；仅 worker 使用 |

上述路径为懒猫应用命名空间内的路径，不是固定宿主路径。网页只读挂载 library；浏览器和出口代理不挂载这些目录。升级沿用同一包 ID 和持久目录。

备份前暂停应用任务，并在 worker 停止写入后，从 postgres 容器运行 `pg_dump -U harvester -d harvester -Fc` 保存数据库，同时备份 library。auth 可另行加密备份或恢复后重新登录。不要把正在写入的 postgres 文件目录直接作为一致性备份。迁移到另一台设备时使用逻辑数据库备份，数据库密码由设备按应用 ID 派生，不能复制旧的渲染配置。

项目原有 `scripts/backup.sh` / `restore.sh` 面向本机 Docker Compose；不能直接当成懒猫备份命令执行。

## 可重复打包

依赖：Docker（支持 amd64 构建）、Node.js / npx、Python 3.11+。

```sh
cd "/Users/alcuin/Coding/Design Harvester"
python3 scripts/build-lpk.py
```

脚本从 `docker/Dockerfile` 更新三个目标阶段的 Dockerfile，调用固定的官方 `@lazycatcloud/lzc-cli@2.0.9` 本地构建，再加入必需的 Compose override 文件并生成 SHA-256。镜像全部内嵌，无需上传注册表。

**只分发最终 `.lpk`。** CLI 输出的 `.raw.lpk` 为中间文件，缺少最终隔离配置，成功封装后自动删除。CLI 默认 YAML 序列化不支持保留 Compose 的 `!override` 标签，所以最后一步以 tar 流加入原始 YAML，保留所有 OCI 摘要。

## 隔离与平台适配

- web：平台默认网络 + 内部数据库网络。
- postgres：内部数据库网络。
- worker：数据库网络 + 内部采集网络 + 公网出口网络。
- browser：**仅内部采集网络**，通过 egress 代理访问公网。
- egress：内部采集网络 + 公网出口网络，校验并固定连接 IP。
- browser / egress 使用镜像内的入口程序，移除平台目录挂载，防止接触运行配置、数据库密码、授权或资产。
- `!override` 必须整体替换网络列表，不能退化成追加。旧版 Compose 应拒绝安装，不得删除标签绕过检查。

安装后应在设备的开发者工具中核对 browser 网络只包含 `harvester_capture`，该网络为 internal，且 browser / egress 没有资产或平台目录挂载。再运行一个真实公共 URL，确认三尺寸截图与认证恢复。

官方依据：[LPK 构建](https://developer.lazycat.cloud/spec/build.html)、[Compose override](https://developer.lazycat.cloud/advanced-compose-override.html)、[部署密码派生](https://developer.lazycat.cloud/advanced-manifest-render.html)、[服务规范](https://developer.lazycat.cloud/spec/manifest.html)。Compose override 是平台过渡机制，商店上架需另行审核；此包用于私有本地安装。

## 本轮验证（2026-09-13）

- `pnpm verify` 通过：类型检查、9 项单元测试与 Next.js 生产构建；3 项专用集成测试在该命令中按设计跳过。
- `python3 scripts/verify-lpk-isolation.py` 通过真实 Docker Compose 合并测试。
- 使用原有本机 ARM 镜像、全新临时数据库／目录与本包的启动脚本和网络 override，五个服务全部健康；网页及设置 API 可访问。
- `https://example.com` 三尺寸采集成功，随后因空授权目录进入 `WAITING_AUTH`，已有截图保留。
- browser 实际只连接 internal 的采集网络，挂载列表为空；直接连接公网失败；web 无法访问 `/lzcapp/var/auth`，仍可访问只读 library。
- LC-02 实机安装、懒猫网关、平台生成的最终 Compose 与设备上的会员授权尚未验证：开发者工具要求为当前 CLI 添加设备信任公钥。

LPK 的 browser 镜像采用 Playwright 1.58.2 的 Chromium headless shell（Debian 12），沿用 `docker/browser.mjs`；仅安装当前无头采集所需的引擎和依赖。原 Docker Compose 使用的官方完整镜像保持原样。参见 [Playwright headless shell 安装](https://playwright.dev/docs/browsers#chromium-headless-shell)。

### 固定 CLI 的兼容修复

`lzc-cli 2.0.9` 的本地镜像打包器通过 `tar.t` 异步读取镜像层，未关闭默认的自动 resume；本轮检查实际发现部分层发生截断，压缩文件自身的摘要正确，但解压后摘要不匹配原始镜像。`scripts/lzc-tar-loader.mjs` 仅对该固定模块注入 `noResume: true`，由构建脚本临时加载，不修改全局 CLI 或 npm 缓存文件。重建脚本会逐层核验压缩 blob、descriptor 大小以及解压后的原始镜像摘要，任何不一致都会阻止发布最终 LPK。

最终包验证补充：五个 amd64 镜像均健康启动；精简后的 **amd64 Chromium** 在独立隔离环境中完成 example.com 桌面／平板／手机三尺寸截图，文件保存在 `artifacts/lazycat/`。整组 amd64 流水线在 Mac 模拟执行与镜像导出并行时遇到资源压力，因此停止了该次全链验证；不将该次尝试计为完整通过。此前原生 ARM 镜像的全链采集／等待认证验证通过。

最终 LPK 包含五个 Linux amd64 镜像、33 个唯一镜像层，压缩及解压摘要、层大小、包内 override 一致性均通过。文件约 643.57 MiB，完整 SHA-256 随包提供于 `.lpk.sha256`。

## 0.1.1 更新验证（2026-09-13）

包含 Gemini／DeepSeek 模型切换及网页保存 DeepSeek API 密钥。沿用原包 ID 和持久目录，首次启动自动迁移数据库。当前 amd64 前端生产构建、Compose 隔离合并检查、五镜像平台检查、32 个唯一层压缩／解压摘要及最终包内 override 校验通过。新 worker 镜像已启动检查，确认最新凭证保存逻辑存在，本机 `.env`、`.auth`、`.data`、`deepseek_api` 均未打入。

最终包 `release/design-harvester-0.1.1-amd64.lpk`，674703360 字节；SHA-256 `29f960fa053426e4ae29d14ecf70196f6ff60bb6b11367be0d82356001b4bd76`。本轮未进行 LC-02 实机安装或升级验收。

## 0.1.2 实机修正（2026-09-13）

在 lai（LZCOS 1.6.2、x86_64、Compose 2.32.4）取得安装日志：旧包先因 `invalid platform: linux/arm64` 拒绝，修正后又发现 `binds` 不接受 `:ro` 后缀。`unsupported_platforms` 表示客户端平台，不是 OCI 架构；已移除错误项并增加构建前校验。前端 library 只读属性移到 Compose override。

此私有包为保留只读挂载，override 的 source 使用本设备实际 `/lzcsys/data/appvar/local.alcuin.design-harvester/library` 路径，属于平台内部布局依赖；跨版本或其他设备使用前须核实。官方不保证 override 兼容性。

0.1.2 保留 0.1.1 的全部镜像，只修正包配置，未宣称完成镜像瘦身。平台已返回 Install succeeded；启动验证结果另记。

实机进一步修正首次启动：PostgreSQL 健康探针改用 TCP，避免初始化临时 Unix socket 提前报告就绪；worker 显式设置 HOME；平台入口使用设置 API 探针并强制依赖健康的 web，web 强制依赖健康的 worker。默认平台服务就绪检测无法覆盖自定义隔离网络，因此保留各业务容器自身探针，以实际 HTTP 检查替换入口探针。

最终重装 0.1.2 后 app、web、worker、postgres、browser、egress 六个容器全部 healthy，设置 API 返回 200；browser 仅连接 internal 的 capture 网络且无挂载，web 的 library 挂载确认 RW=false。最终 SHA-256：`7015b310acf7615c6b7cb9ae31faca16cd36abf61a4b2e8cece99f863061f4a8`。

实机公共站点验收：example.com 三尺寸完整 PNG 已保存（18580／18424／14908 字节），任务 `0b449490-de57-4d74-8402-4cf284edce80` 在 `ANALYZING_DESIGN` 阶段按预期进入 `WAITING_AUTH`。未将 Mac 密钥或授权复制到设备。当前浏览器自动打开设备 HTTPS 入口超时，因此未宣称外部客户端页面视觉验收；设备入口容器访问设置 API 成功。

## 0.1.3 布局、移动端下载与镜像瘦身

- 桌面详情页由截图决定行高；Design DNA 与截图上下边缘对齐，独立滚动，仅在下方还有内容时渐隐。手机保持顺序阅读。
- viewport 固定为 1，并拦截应用内双指手势、缩放滚轮和缩放快捷键；普通滚动与完整截图查看保留。浏览器自身菜单和操作系统的辅助缩放不受网页控制。
- 所有下载入口在页面内 fetch 附件，避免直接导航到附件响应。支持文件分享的手机在文件准备后，由再次点击保存触发系统面板，避免大 ZIP 等待导致用户手势授权过期；取消后可重试。其他环境使用带文件名的 Blob 下载。使用标准 Web Share 的能力检测，未将需要设备本地路径的懒猫原生接口用于 HTTP 地址。参考 [Web Share API](https://developer.mozilla.org/en-US/docs/Web/API/Navigator/share) 与 [懒猫客户端文件分享接口](https://developer.lazycat.cloud/advanced-frontend-app-dev.html)。
- worker 通过 pnpm deploy 只携带生产依赖及必要源码；egress 为独立最小依赖镜像。保留全部模型通道和浏览器引擎，不改变包 ID、持久路径与隔离网络。egress 的 override 入口同步改为镜像内的 Node 程序。

本机 `pnpm typecheck`、`pnpm test`（11 项）、`pnpm build`、独立数据库 `pnpm test:integration`（5 项）通过。页面实测截图与 DNA 均为 560px，首尾位置相同；393px 手机布局无水平溢出。真实 Markdown 下载及 13,652,088 字节 ZIP 的移动端准备流程通过，下载 500 错误保留原页面。系统分享调用为模拟；0.1.3 未进行懒猫手机或 NAS 升级验收，也未触发真实模型生成。

最终包为 `release/design-harvester-0.1.3-amd64.lpk`，567,418,880 字节（541.13 MiB），比 0.1.2 的 674,703,360 字节减少 102.31 MiB（15.90%）。SHA-256：`3e5401909d517dcd1a21eeec7834691e91a4fe9617f7fc1f4b53ba9d9854dc3a`。五个 Linux amd64 镜像全量内嵌，32 个唯一层的压缩摘要、解压摘要和层大小均由构建脚本校验；最终 override 与源码一致。

新镜像在全新临时数据库／资产目录中验证：worker 自动迁移并进入 ready，web 设置 API 返回 200；Gemini CLI 0.59.0 和 Antigravity 1.2.2 可执行；经独立出口代理完成 example.com 三尺寸截图（17,883／17,387／15,106 字节），私网目标返回 403。精简 worker 不含前端、测试目录、TypeScript 编译器或本机凭证；web 无 `.env` 或 `deepseek_api`。这些是本机 amd64 容器验证，未安装到 NAS。临时容器与测试数据已删除。

## 0.1.4 规范修复与中英文分离

文档改为英文结构化分析及英文 iOS 适配；中文展示单独翻译、审核和保存，绑定最终英文候选。网页数据仍是不可信证据，Gemini CLI、Antigravity 与 DeepSeek 统一服从可信阶段指令的语言要求。用户整理和历史完成版本不自动改写。

数据库增加可选 `versions.display_zh`、`versions.validation` 和 `tasks.repair_state`、`tasks.manual_status` 和 `tasks.control_revision`，启动迁移仅添加字段。旧失败任务手动恢复后先检查旧缓存，不重复采集；不合格旧文档保留在 `legacy/`。新候选和报告使用独立路径。只有规范、语言和翻译检查完成后才进入发布，原有 iOS 完整性与 85 分质量门槛保留。

最多五次额外内容修复与质检修订共用额度；5、15、30、60、120 秒的等待通过持久任务调度实现。恢复 FAILED／PARTIAL／CANCELED 可开启新额度；授权、额度、配置暂停和已有网络重试不增加额度。完全相同的候选及错误会提前停止。

新增四边颜色采集，旧快照按 CSS 函数与引号边界拆分 border-color，转换来源单独保存。正文 YAML 示例不再作为第二份 token 元数据输入校验。官方 0.4.0 不支持的部分 `color(display-p3 …)` 表达会明确报告，原始值保留，不伪造近似值；仍完成 iOS、中文介绍及审核，这类确定性问题不反复消耗模型调用。

交付仍沿用 0.1.3 的独立 web、精简 worker、轻量 egress 和 headless shell 镜像方案。本版本不自动安装 NAS，也不批量重做历史任务。受控模型测试只验证流程；真实模型英语自然度、截图所示 NAS 原始 lint 报告及懒猫手机端仍需设备可访问后验收。

本机验证：`pnpm typecheck`、`pnpm test`（17 项）、`pnpm test:integration`（独立临时数据库，17 项）和生产构建全部通过。真实官方校验器覆盖旧多值边框、四边颜色、复杂颜色、分数字号／字重、无效值与正文 YAML 示例。受控模型覆盖五次耗尽、无进展停止、翻译单独修复、英文语义审核、网络重试、授权／额度暂停、取消、跨执行恢复、旧缓存与默认版本保护、质检共用额度。

`node scripts/verify-content-ui.mjs` 的桌面 1440px／手机 393px 页面检查通过，已查看进度、失败与最终中文 DNA 截图；英文文档可读、中文卡片不泄露英文候选、整理字段保留、检查报告可定位，页面无横向溢出。该页面检查使用受控 API，系统分享与真实模型质量不在此次验证证据范围内。

补充流程：DESIGN.md 的规范／语言检查失败仅记录问题，不再阻断 IOS_design.md、中文介绍及后续审核。先保存完整生成结果和汇总报告，再进入自动修复或失败状态。授权、额度、取消和无法产生结构化输入的异常仍按实际原因暂停。

详情页增加“手动修改任务状态”：允许标记已完成或失败，保留原始错误、检查报告和历史事件。手动操作终止当前任务，控制版本号防止迟到的 worker 发布或覆盖人工状态。人工完成不改变文档校验和默认合格版本；恢复曾合格的人工标记任务会创建新版本。新增集成测试覆盖规范失败后的完整生成、人工状态与后台竞态、恢复时的版本保护。

手动状态接口另通过本地真实 HTTP 验证（独立测试数据库、显式 APP_ORIGIN）：READY／FAILED 成功持久化，非法状态被拒绝，版本质量与默认版本保持不变。桌面／手机页面完成两种手动标记操作，检查未通过提示仍在。

最终运行镜像在独立 Compose 环境启动成功：新增数据库字段存在、worker 输出 `Design worker ready`，设置与资料库 API 均返回 200。镜像中的 generation.ts、service.ts、pipeline.ts 与最终源码 SHA-256 一致。测试环境无历史任务、无授权数据，验证后清理专用容器与卷。

最终包 `release/design-harvester-0.1.4-amd64.lpk`：567,429,120 字节（541.14 MiB），比 0.1.3 增加 10,240 字节，沿用瘦身方案。SHA-256：`9b529369e6b558e22a24c3da49818faac629687898ff1ad82f6d3fc8ac8a3526`。五个 Linux amd64 镜像全量内嵌，32 个唯一层的压缩摘要、解压摘要和层大小全部通过构建脚本校验；最终 override 已校验。未自动安装 NAS，未调用真实模型或批量重做历史任务。
