# 验证记录 · 2026-09-13

## 已完成

- Mac：Google AI Pro 个人 OAuth，Antigravity CLI 1.2.2 的图片识别和 Zod 正文校验；固定模型 gemini-3.8-flash-medium。
- 真实公共网页 https://example.com/：三尺寸完整 PNG、WebP、浏览器证据；DESIGN.md 经 Google 0.4.0 官方校验；IOS_design.md；自动质检 98 分，无 error，发布为默认合格版本。
- 历史中保留了被质检拦截的版本（背景色/对比度推断问题），以及执行过一次修订仍未合格的版本，没有覆盖历史。
- 单元测试：URL/IP/IPv6/Origin、CLI 错误分类、Zod 与 iOS 章节约束、官方规范、发布门槛、实际 HTTP/CONNECT 私网阻断。
- 独立数据库集成测试：阶段恢复、有限修订、默认版本保护、人工整理保留、取消与删除；持有任务锁时资产不被删除，删除中的条目不能新增任务。
- 浏览器 fixture：三断点字号、CSS 字体声明、画布背景、懒加载内容、完整长页面 PNG 高度、分块高度限制；标准拒绝按钮、无语义登录遮挡、越权候选阻断。
- CLI 工具级权限验证：命令执行和任务目录外读取均返回实际工具权限错误；外部标记文件未创建。
- UI：桌面与手机实际截图；详情、整理保存、文档复制（含 YAML frontmatter）、无页面运行时错误/横向溢出；ZIP 校验通过，含两份文档及证据。
- Docker Compose：Mac 上 Linux 容器的独立三尺寸公网采集、无授权暂停、私网/元数据出口 403；重建 worker 后 OAuth 缓存复用成功。
- 备份恢复：PostgreSQL 与资产卷备份；删除本次测试部署的卷后新建空白环境，恢复数据库与资产，所有 manifest SHA-256 校验通过，条目与截图可读取。恢复重建数据库以兼容 pg-boss 分区约束。
- `pnpm typecheck`、`pnpm test`、`pnpm test:integration`、`pnpm build` 与 Docker 构建。代码 diff whitespace 检查通过；原指导文档开头的 Markdown 双空格硬换行原样保留。

## 使用位置

当前 Mac 开发资料库：http://localhost:3000 。独立 Docker 验证部署使用 http://localhost:3100 ，两者使用独立数据库与资产目录。Docker 验证部署中的示例处于等待恢复状态，Mac 资料库包含完整合格版本及历史。

截图与 ZIP 在 `artifacts/verification/`，运行数据、凭证、二进制均被 Git 忽略。Docker 在当前 Mac 使用 `http://host.docker.internal:7890` 联网代理；其他机器按其实际网络设置 `GEMINI_HTTPS_PROXY`。镜像已安装系统 CA 证书，未跳过 TLS 验证。

## 尚未验证

NAS 型号、CPU 架构、内存、实际出口与代理、授权续期及 NAS 重启恢复。Mac Docker 成功不等于 NAS 部署完成。

真实网站目前验证 example.com；fixture 覆盖响应式、懒加载和弹窗，但不代表所有网站的复杂覆盖层都能自动处理。页面高度/等待时间有上限，登录与验证码站点停止并保留诊断。质检分数是模型评估，不能替代人工设计评审；原生示例未在 Xcode/实体 iPhone 编译运行。
