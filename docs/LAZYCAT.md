# 懒猫 LC-02 安装与维护

此移植包面向单用户私有使用，包 ID 为 `local.alcuin.design-harvester`。使用 LPK V2，业务镜像为 Linux amd64；不包含 Mac 的 `.env`、OAuth 凭证、数据库或收藏资产。

## 安装

1. 系统需为 LZCOS 1.6.0 或更新版本，运行环境需支持 Docker Compose 2.24.4+ 的 `!override` 标签。预留约 6 GB 内存预算和至少 10 GB 安装空间，收藏截图另计。
2. 在懒猫客户端选择本地安装 `release/design-harvester-0.1.0-amd64.lpk`。安装包声明联网与 Compose override 权限，入口由懒猫身份网关保护，仅管理员可见。
3. 首次启动自动创建数据库结构。界面可以打开后，在设置页查看认证状态；未认证时任务会暂停。
4. 在开发者工具的 **worker 容器**终端中执行：

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
