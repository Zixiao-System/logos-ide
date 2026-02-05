# 哀珐尼尔引擎 (Aefanyl Engine) 重构计划

  > 将 logos-lang (Rust) 重构为 Go 语言实现的新一代代码分析引擎

  ## 概述

  ### 项目背景

  当前 `logos-lang/` 目录包含用 Rust 编写的语言分析后端，包括：
  - `logos-core` - 核心处理逻辑
  - `logos-daemon` - LSP 服务器实现
  - `logos-parser` - 基于 tree-sitter 的多语言解析器
  - `logos-semantic` - 类型检查与语义分析
  - `logos-index` - 符号索引
  - `logos-refactor` - 重构工具

  ### 重构目标

  将上述 Rust 实现迁移至 Go 语言，并更名为 **哀珐尼尔引擎 (Aefanyl Engine)**。

  ### 为什么选择 Go

  | 方面 | Rust (现状) | Go (目标) |
  |------|-------------|-----------|
  | 编译速度 | 较慢 | 快速 |
  | 二进制体积 | 较小 | 适中 |
  | 内存安全 | 编译期保证 | GC 管理 |
  | 并发模型 | async/await | goroutine (更简洁) |
  | 学习曲线 | 陡峭 | 平缓 |
  | 生态成熟度 | 成长中 | 成熟 |
  | 跨平台编译 | 需要配置 | 原生支持 |

  ## 架构设计

  ### 新目录结构

  aefanyl/                          # 替代 logos-lang/
  ├── cmd/
  │   └── aefanyl-daemon/           # 主入口
  │       └── main.go
  ├── internal/
  │   ├── core/                     # 核心处理
  │   ├── daemon/                   # LSP 服务器
  │   ├── parser/                   # 解析器
  │   │   └── languages/            # 各语言支持
  │   ├── semantic/                 # 语义分析
  │   ├── index/                    # 符号索引
  │   └── refactor/                 # 重构工具
  ├── pkg/                          # 公共包
  │   ├── lsp/
  │   └── ast/
  ├── go.mod
  └── Makefile

  ### 核心依赖

  - `go-tree-sitter` - 多语言解析
  - `glsp` - LSP 服务器框架
  - `jsonrpc2` - JSON-RPC 通信
  - `badger` - 索引存储
  - `zap` - 日志

  ## 迁移计划

  ### 第一阶段：基础架构 (2-3 周)
  - 项目初始化、Go 模块设置
  - LSP 服务器骨架 (initialize/shutdown)
  - Electron 集成适配

  ### 第二阶段：解析器迁移 (3-4 周)
  - tree-sitter 集成
  - 迁移语言语法：Python, Go, TS, Java, Rust, C++
  - 基础诊断

  ### 第三阶段：语义分析 (4-5 周)
  - 符号表与作用域
  - 类型推断与检查
  - 引用分析

  ### 第四阶段：高级功能 (3-4 周)
  - 符号索引持久化
  - 重构工具
  - 性能优化

  ### 第五阶段：完整迁移 (2-3 周)
  - 功能对等测试
  - 移除 logos-lang/
  - 发布

  ## 构建命令

  ```bash
  cd aefanyl
  go mod download
  go test ./...
  go build -o bin/aefanyl-daemon ./cmd/aefanyl-daemon

  # 交叉编译
  GOOS=windows GOARCH=amd64 go build -o bin/aefanyl-daemon.exe ./cmd/aefanyl-daemon
  GOOS=darwin GOARCH=arm64 go build -o bin/aefanyl-daemon-darwin-arm64 ./cmd/aefanyl-daemon

  风险与缓解
  ┌───────────────────────────┬───────────────────────┐
  │           风险            │       缓解措施        │
  ├───────────────────────────┼───────────────────────┤
  │ tree-sitter Go 绑定不完整 │ 使用 CGO 或 WASM 方案 │
  ├───────────────────────────┼───────────────────────┤
  │ 性能不及 Rust             │ goroutine 并发优化    │
  ├───────────────────────────┼───────────────────────┤
  │ 迁移期间功能中断          │ 双引擎共存，渐进迁移  │
  └───────────────────────────┴───────────────────────┘


  时间线
  ┌──────┬──────────┬────────────────┐
  │ 阶段 │   周期   │     里程碑     │
  ├──────┼──────────┼────────────────┤
  │ 一   │ 1-3 周   │ LSP 骨架运行   │
  ├──────┼──────────┼────────────────┤
  │ 二   │ 4-7 周   │ 多语言解析完成 │
  ├──────┼──────────┼────────────────┤
  │ 三   │ 8-12 周  │ 语义分析可用   │
  ├──────┼──────────┼────────────────┤
  │ 四   │ 13-16 周 │ 高级功能完成   │
  ├──────┼──────────┼────────────────┤
  │ 五   │ 17-19 周 │ 完成迁移       │
  └──────┴──────────┴────────────────┘
  总计：约 4-5 个月

  下一步

  1. 创建 aefanyl/ 并初始化 Go 模块
  2. 实现最小 LSP 服务器
  3. 集成 go-tree-sitter
  4. 更新 CI 添加 Go 检查
  5. 编写功能对比测试