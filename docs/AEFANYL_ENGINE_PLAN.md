# 哀珐尼尔引擎 (Aefanyl Engine) 重构计划

> 将 logos-lang (Rust) 重构为 Go 语言实现的新一代代码分析引擎，采用三级智能架构

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

将上述 Rust 实现迁移至 Go 语言，并更名为 **哀珐尼尔引擎 (Aefanyl Engine)**，同时引入三级智能分层架构。

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

## 三级智能架构 (L1 / L2 / L3)

引擎采用分层递进的三级架构，每一级在前一级基础上叠加能力。用户可根据硬件条件和项目规模选择合适的级别。

```
┌─────────────────────────────────────────────────────────┐
│  L3  CoreML + ANE 智能 Tab 补全                         │
│      ┌─────────────────────────────────────────────┐    │
│      │  L2  LSP + 内置 PSI 级分析器 + 补全器       │    │
│      │      ┌─────────────────────────────────┐    │    │
│      │      │  L1  纯 LSP 代理层              │    │    │
│      │      └─────────────────────────────────┘    │    │
│      └─────────────────────────────────────────────┘    │
└─────────────────────────────────────────────────────────┘
```

### L1 — 纯 LSP (基础模式)

> 零自研分析，作为标准 LSP 客户端-服务器代理层

**定位**：轻量启动，适合所有项目。等同于当前 Basic Mode，但统一归入 Aefanyl 架构管理。

**功能**：
- 管理外部 LSP 服务器生命周期（启动、重连、关闭）
- 将 Monaco Editor 请求路由到对应语言的 LSP 服务器
- 聚合多 LSP 服务器的诊断结果
- 提供统一的 LSP 能力协商（capabilities negotiation）
- 支持的 LSP 特性：补全、跳转定义、悬停提示、签名帮助、引用查找、重命名、格式化、代码操作

**支持的语言服务器**：
| 语言 | LSP 服务器 |
|------|-----------|
| TypeScript / JavaScript | typescript-language-server |
| Python | pylsp / pyright |
| Go | gopls |
| Rust | rust-analyzer |
| C / C++ | clangd |
| Java | jdtls |

**架构**：
```
Monaco Editor ←→ Aefanyl L1 Proxy ←→ LSP Server (外部进程)
                      │
                      ├── 服务器生命周期管理
                      ├── 请求路由与多路复用
                      └── 诊断结果聚合
```

### L2 — LSP + 内置 PSI 级分析器 + 补全器 (高级模式)

> 在 L1 基础上叠加自研的深度语义分析，达到 JetBrains PSI (Program Structure Interface) 级别

**定位**：对标 JetBrains IDE 的核心分析能力。在 LSP 提供基础能力的同时，Aefanyl 内置分析器提供更深层次的理解。

**核心组件**：

#### PSI 级分析器 (Analyzer)
- **增量 AST 管理**：基于 tree-sitter 构建增量更新的语法树，每次编辑仅重解析变更区域
- **语义模型**：构建完整的程序语义模型，包括：
  - 符号表 (Symbol Table) — 全局/局部符号、作用域链
  - 类型系统 (Type System) — 类型推断、类型检查、泛型实例化
  - 引用图 (Reference Graph) — 符号引用关系、定义-使用链
  - 控制流图 (CFG) — 分支、循环、异常路径分析
  - 数据流分析 (DFA) — 变量活跃性、常量传播、空值追踪
- **跨文件分析**：项目级符号索引，支持跨模块类型传播
- **调用层次**：完整的调用链分析（caller / callee），支持虚调用解析
- **影响分析**：修改某符号后，精确识别受影响的代码区域

#### 智能补全器 (Completer)
- **上下文感知补全**：基于当前作用域、类型信息、导入关系提供精确补全
- **智能排序**：结合使用频率、类型匹配度、上下文相关性排序候选项
- **代码片段生成**：根据函数签名自动生成参数占位符和文档模板
- **自动导入**：补全时自动添加缺失的 import 语句
- **后缀补全 (Postfix Completion)**：`.if` → `if expr {}`, `.for` → `for _, v := range expr {}` 等
- **实时模板 (Live Template)**：上下文敏感的代码模板展开

#### 安全重构 (Safe Refactoring)
- 重命名（跨文件、跨模块）
- 提取方法 / 变量 / 接口
- 内联变量 / 方法
- 移动符号（跨文件、自动更新引用）
- 变更签名（参数增删、类型修改、自动适配调用点）

**架构**：
```
Monaco Editor ←→ Aefanyl L2
                      │
                      ├── L1 LSP Proxy (基础能力)
                      │
                      ├── PSI Analyzer (自研)
                      │   ├── tree-sitter 增量解析
                      │   ├── 符号表 + 类型系统
                      │   ├── 引用图 + 调用层次
                      │   └── 数据流分析
                      │
                      ├── Smart Completer (自研)
                      │   ├── 上下文感知排序
                      │   ├── 后缀补全 + 实时模板
                      │   └── 自动导入
                      │
                      └── Refactoring Engine (自研)
                          ├── 安全重命名
                          ├── 提取 / 内联
                          └── 变更签名
```

**与 LSP 的协调策略**：
- 补全：L2 补全器生成候选列表，与 LSP 补全结果合并去重，L2 结果优先排序
- 诊断：L2 分析器产出的诊断与 LSP 诊断合并，按严重级别排序
- 跳转定义：优先使用 L2 引用图（更精确），LSP 结果作为 fallback
- 重构：完全由 L2 引擎处理，不依赖 LSP

### L3 — CoreML + ANE 智能 Tab 补全 (AI 模式)

> 在 L2 基础上叠加本地机器学习推理，实现类 GitHub Copilot 的智能补全体验

**定位**：利用 Apple Silicon 的 Neural Engine (ANE) 进行本地推理，实现低延迟、离线可用、隐私安全的 AI 代码补全。

**核心能力**：

#### 智能 Tab 补全
- **多行补全**：预测接下来 1-10 行代码，用户按 Tab 接受
- **Ghost Text 预览**：补全建议以灰色文本 (ghost text) 显示在光标后方
- **部分接受**：支持逐词接受 (Ctrl+→) 或逐行接受 (Ctrl+↓)
- **上下文窗口**：分析当前文件 + 已打开的相关文件（最近编辑优先）

#### 模型架构
- **基础模型**：基于 Transformer decoder 的代码生成模型（~150M 参数，适合 ANE 推理）
- **模型格式**：CoreML `.mlpackage`，针对 ANE 优化（int8/float16 量化）
- **推理后端**：
  - macOS (Apple Silicon)：CoreML + ANE — 主要推理路径，利用 Neural Engine 硬件加速
  - macOS (Intel) / Linux / Windows：ONNX Runtime (CPU) — 回退方案，精度不变但延迟较高
- **模型更新**：支持后台增量下载模型更新

#### 技术实现

```
用户输入 → 触发条件判断 → 上下文构建 → 模型推理 → 后处理 → Ghost Text 渲染

触发条件：
  ├── 输入停顿 >300ms
  ├── 换行后
  ├── 输入特定 token (=, {, (, :, 等)
  └── 手动触发 (快捷键)

上下文构建：
  ├── 前缀：光标前 ~2048 tokens
  ├── 后缀：光标后 ~512 tokens
  ├── 相关文件：打开的 tab 中类型相关文件 ~1024 tokens
  └── L2 语义信息：当前作用域变量、类型约束

推理流程：
  ├── Tokenizer (BPE, 本地) → token IDs
  ├── CoreML 推理 (ANE) → logits
  ├── Sampling (temperature=0.2, top-p=0.95)
  └── 解码 + 语法校验 (tree-sitter 增量解析验证)
```

#### CoreML + ANE 集成 (macOS)

```
┌─────────────────────────────────────────────────┐
│  Aefanyl L3 (Go 进程)                           │
│                                                 │
│  ┌───────────┐    CGO     ┌─────────────────┐   │
│  │ Go 推理   │ ────────→  │ Swift/ObjC 桥   │   │
│  │ 调度器    │            │ CoreML API      │   │
│  └───────────┘            └────────┬────────┘   │
│                                    │            │
│                           ┌────────▼────────┐   │
│                           │  CoreML 框架    │   │
│                           │  (ANE 调度)     │   │
│                           └────────┬────────┘   │
│                                    │            │
└────────────────────────────────────│────────────┘
                                    │
                            ┌───────▼────────┐
                            │  Apple Neural  │
                            │  Engine (ANE)  │
                            │  ~16 TOPS      │
                            └────────────────┘
```

**性能目标**：
| 指标 | 目标 |
|------|------|
| 首 token 延迟 | <50ms (ANE) / <200ms (CPU fallback) |
| 完整补全延迟 (5行) | <150ms (ANE) / <600ms (CPU fallback) |
| 内存占用 | <300MB (量化模型) |
| 补全接受率 | >25% |

**隐私与离线**：
- 所有推理在本地完成，代码不离开用户设备
- 模型文件随应用分发或首次启动时下载
- 无需网络连接即可使用（离线优先）

## 智能模式映射

三级架构与编辑器现有模式的对应关系：

| 编辑器模式 | 引擎级别 | 激活条件 |
|-----------|---------|---------|
| Basic Mode | L1 | 默认 / 用户手动选择 |
| Smart Mode | L2 | 用户手动选择 / Auto Mode 对中小项目自动启用 |
| AI Mode (新增) | L3 | 用户手动启用 + 平台支持 CoreML 或 ONNX |
| Auto Mode | L1 或 L2 | 根据项目规模自动选择（>5000 文件 → L1） |

## 架构设计

### 新目录结构

```
aefanyl/                              # 替代 logos-lang/
├── cmd/
│   └── aefanyl-daemon/               # 主入口
│       └── main.go
├── internal/
│   ├── core/                         # 核心处理、配置、生命周期
│   ├── l1/                           # L1: LSP 代理层
│   │   ├── proxy.go                  # 请求路由与多路复用
│   │   ├── lifecycle.go              # LSP 服务器生命周期管理
│   │   └── aggregator.go            # 诊断结果聚合
│   ├── l2/                           # L2: PSI 级分析
│   │   ├── analyzer/                 # PSI 分析器
│   │   │   ├── symbols.go            # 符号表
│   │   │   ├── types.go              # 类型系统
│   │   │   ├── references.go         # 引用图
│   │   │   ├── dataflow.go           # 数据流分析
│   │   │   └── callgraph.go          # 调用层次
│   │   ├── completer/                # 智能补全器
│   │   │   ├── context.go            # 上下文分析
│   │   │   ├── ranking.go            # 候选排序
│   │   │   ├── postfix.go            # 后缀补全
│   │   │   └── autoimport.go         # 自动导入
│   │   └── refactor/                 # 安全重构
│   │       ├── rename.go
│   │       ├── extract.go
│   │       └── inline.go
│   ├── l3/                           # L3: AI 补全
│   │   ├── inference/                # 推理调度
│   │   │   ├── scheduler.go          # 推理请求调度
│   │   │   ├── coreml_darwin.go      # CoreML 集成 (macOS)
│   │   │   └── onnx_fallback.go      # ONNX Runtime 回退
│   │   ├── context/                  # 上下文构建
│   │   │   ├── window.go             # 上下文窗口管理
│   │   │   └── related.go            # 相关文件选择
│   │   ├── tokenizer/                # BPE 分词器
│   │   ├── postprocess/              # 后处理 + 语法校验
│   │   └── ghost/                    # Ghost Text 协议
│   ├── parser/                       # tree-sitter 集成
│   │   └── languages/                # 各语言语法
│   └── index/                        # 符号索引持久化
├── bridge/                           # 原生桥接
│   └── darwin/                       # macOS CoreML 桥接 (Swift/ObjC)
│       ├── coreml_bridge.h
│       ├── coreml_bridge.m
│       └── coreml_bridge.swift
├── models/                           # ML 模型存储
│   └── .gitkeep
├── pkg/                              # 公共包
│   ├── lsp/
│   └── ast/
├── go.mod
└── Makefile
```

### 核心依赖

- `go-tree-sitter` - 多语言增量解析
- `glsp` - LSP 服务器框架
- `jsonrpc2` - JSON-RPC 通信
- `badger` - 索引存储
- `zap` - 结构化日志
- `onnxruntime-go` - ONNX 推理 (L3 非 macOS 回退)

## 迁移计划

### 第一阶段：L1 基础架构
- 项目初始化、Go 模块设置
- LSP 代理层实现（服务器生命周期、请求路由、诊断聚合）
- Electron 集成适配（替换现有 Rust daemon 通信层）
- 对标现有 Basic Mode 功能对等

### 第二阶段：L2 解析器与符号系统
- tree-sitter 集成与增量解析
- 迁移语言语法：TypeScript, Python, Go, Java, Rust, C++
- 符号表构建、作用域解析
- 基础类型推断

### 第三阶段：L2 深度语义分析
- 完整类型系统（泛型、类型传播）
- 引用图与调用层次
- 数据流分析（活跃变量、空值追踪）
- 跨文件分析与项目级索引

### 第四阶段：L2 补全器与重构
- 上下文感知补全（排序、自动导入、后缀补全）
- 安全重构引擎（重命名、提取、内联、变更签名）
- L2 与 LSP 结果合并策略调优
- 性能优化（增量更新、缓存策略）

### 第五阶段：L3 本地 AI 补全
- CoreML 桥接层实现 (CGO + Swift/ObjC)
- BPE 分词器与上下文窗口管理
- 推理调度器（ANE 优先，CPU 回退）
- Ghost Text 渲染协议与 Monaco 集成
- ONNX Runtime 回退路径 (Linux/Windows)

### 第六阶段：完整迁移与发布
- 三级功能集成测试
- 移除 logos-lang/
- 模型打包与分发策略
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

# macOS CoreML 桥接编译 (需要 Xcode)
CGO_ENABLED=1 GOOS=darwin go build -tags coreml -o bin/aefanyl-daemon-darwin ./cmd/aefanyl-daemon
```

## 风险与缓解

| 风险 | 缓解措施 |
|------|---------|
| tree-sitter Go 绑定不完整 | 使用 CGO 或 WASM 方案 |
| 性能不及 Rust | goroutine 并发优化 |
| 迁移期间功能中断 | 双引擎共存，渐进迁移 |
| PSI 级分析复杂度高 | 分语言逐步支持，TS/Go 优先 |
| CoreML 仅限 macOS | ONNX Runtime 作为跨平台回退 |
| 模型体积影响安装包 | 首次启动异步下载，不打包进安装包 |
| ANE 推理精度损失 | int8 量化后验证补全质量，必要时用 float16 |

## 时间线

| 阶段 | 内容 | 里程碑 |
|------|------|--------|
| 一 | L1 基础架构 | LSP 代理层运行，替换 Basic Mode |
| 二 | L2 解析器与符号 | 多语言增量解析 + 符号表 |
| 三 | L2 深度语义 | 类型系统 + 引用图 + 数据流 |
| 四 | L2 补全器与重构 | PSI 级补全 + 安全重构可用 |
| 五 | L3 AI 补全 | CoreML/ANE Tab 补全上线 |
| 六 | 完整迁移 | 移除旧引擎，正式发布 |

## 下一步

1. 创建 `aefanyl/` 并初始化 Go 模块
2. 实现 L1 LSP 代理层（服务器管理 + 请求路由）
3. 集成 go-tree-sitter，搭建 L2 增量解析基础
4. 更新 CI 添加 Go 检查
5. 调研 CoreML Go 桥接方案，编写 L3 可行性 PoC
6. 编写功能对比测试（L1 vs 现有 Basic Mode）
