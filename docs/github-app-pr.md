## GitHub App PR 一键创建 - 配置说明

说明：当前实现为“本地私钥模式”，需要本地提供 GitHub App 私钥文件路径。
该模式适合本地/团队内使用，不适合公开分发（私钥不能内置）。

### 前置条件
- 已创建 GitHub App
- 已下载私钥 PEM 文件
- App 已安装到目标仓库

### GitHub App 权限建议
Repository permissions:
- Pull requests: Read & write
- Contents: Read
- Metadata: Read

### 安装 App
1. 打开 GitHub App 页面
2. 点击 "Install App"
3. 选择账号/组织
4. 选择 "Only select repositories"
5. 勾选目标仓库并完成安装

### Logos 中配置
打开 `设置 → DevOps / CI/CD`，填写：
- GitHub App ID: 你的 App ID
- GitHub App 私钥路径: 本地 PEM 文件路径

示例：
- App ID: `2713552`
- 私钥路径: `/Users/logos/Downloads/logos-ide.2026-01-23.private-key.pem`

### 使用方式
1. 打开 `源代码管理` 面板
2. 点击工具栏里的 `一键创建 PR` 按钮
3. Logos 会自动生成 PR 标题/描述并创建 PR

### 常见问题
- 报错 “Unable to resolve GitHub repo info”：确保 `origin` remote 指向 GitHub 仓库。
- 报错 “GitHub App API error: 404/403”：确认 App 已安装该仓库，且权限正确。
- 报错 “私钥路径无效”：确保路径正确且可读。

### 后续计划（需服务端）
若要开箱即用/Marketplace 分发，需要服务端 token broker：
- 客户端请求服务端
- 服务端用私钥签 JWT → 换 installation token
- 客户端使用短期 token 调用 GitHub API
