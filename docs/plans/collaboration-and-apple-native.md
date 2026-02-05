# Logos 协作与 Apple 原生集成规划

  本文档规划 Logos 的实时协作功能以及 Apple 生态原生集成方案。

  ---

  ## 一、实时协作系统 (Logos Live)

  ### 1.1 概述

  实现类似 VS Code Live Share 的实时结对编程功能，但采用自定义的 Protobuf + UDP 协议以获得更低延迟和更好的性能。

  ### 1.2 协议设计

  #### 传输层

  | 层级 | 技术选型 | 说明 |
  |------|---------|------|
  | 传输层 | UDP + QUIC | 低延迟，支持多路复用，内建加密 |
  | 序列化 | Protocol Buffers 3 | 高效二进制编码，跨平台兼容 |
  | 可靠性 | 自定义 ACK 机制 | 关键操作（文件保存）需确认，光标移动可丢失 |

  #### 消息类型

  ```protobuf
  syntax = "proto3";

  package logos.live;

  // 会话管理
  message SessionCreate {
    string session_id = 1;
    string host_id = 2;
    string project_path = 3;
    repeated string invited_users = 4;
  }

  message SessionJoin {
    string session_id = 1;
    string user_id = 2;
    string display_name = 3;
    bytes public_key = 4;  // E2E 加密
  }

  // 文档同步 (CRDT-based)
  message DocumentOp {
    string file_path = 1;
    uint64 lamport_timestamp = 2;
    string user_id = 3;
    oneof operation {
      InsertOp insert = 4;
      DeleteOp delete = 5;
      RetainOp retain = 6;
    }
  }

  message InsertOp {
    uint64 position = 1;
    string content = 2;
  }

  message DeleteOp {
    uint64 position = 1;
    uint64 length = 2;
  }

  message RetainOp {
    uint64 length = 1;
  }

  // 光标与选区 (可丢失，高频)
  message CursorUpdate {
    string user_id = 1;
    string file_path = 2;
    Position position = 3;
    repeated Selection selections = 4;
  }

  message Position {
    uint32 line = 1;
    uint32 column = 2;
  }

  message Selection {
    Position start = 1;
    Position end = 2;
  }

  // 终端共享
  message TerminalOutput {
    string terminal_id = 1;
    bytes data = 2;
    uint64 sequence = 3;
  }

  message TerminalInput {
    string terminal_id = 1;
    bytes data = 2;
    string user_id = 3;  // 权限控制
  }

  // 语音通话 (可选)
  message VoiceFrame {
    string user_id = 1;
    bytes opus_data = 2;  // Opus 编码
    uint64 timestamp = 3;
  }

  同步策略

  ┌─────────────────────────────────────────────────────────────┐
  │                      Logos Live 架构                         │
  ├─────────────────────────────────────────────────────────────┤
  │                                                             │
  │  ┌─────────┐     QUIC/UDP      ┌─────────┐                 │
  │  │ Client A│◄──────────────────►│ Client B│                 │
  │  └────┬────┘                    └────┬────┘                 │
  │       │                              │                       │
  │       │         ┌─────────┐          │                       │
  │       └────────►│  Relay  │◄─────────┘                       │
  │                 │ Server  │                                  │
  │                 └────┬────┘                                  │
  │                      │                                       │
  │              ┌───────┴───────┐                              │
  │              │  NAT 穿透服务  │                              │
  │              │  (STUN/TURN)  │                              │
  │              └───────────────┘                              │
  │                                                             │
  │  同步模式:                                                   │
  │  • P2P 直连 (同一局域网或 NAT 穿透成功)                       │
  │  • Relay 中继 (NAT 穿透失败时回退)                           │
  │                                                             │
  │  CRDT 算法: Yjs / Automerge 风格的操作转换                   │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘

  1.3 功能特性
  ┌──────────┬─────────────────────────────────────┬────────┐
  │   特性   │                描述                 │ 优先级 │
  ├──────────┼─────────────────────────────────────┼────────┤
  │ 实时编辑 │ 多人同时编辑同一文件，CRDT 冲突解决 │ P0     │
  ├──────────┼─────────────────────────────────────┼────────┤
  │ 光标可见 │ 显示协作者的光标位置和选区          │ P0     │
  ├──────────┼─────────────────────────────────────┼────────┤
  │ 跟随模式 │ 跟随其他用户的视角                  │ P1     │
  ├──────────┼─────────────────────────────────────┼────────┤
  │ 终端共享 │ 共享终端会话，支持只读/可写权限     │ P1     │
  ├──────────┼─────────────────────────────────────┼────────┤
  │ 语音通话 │ 内置语音聊天 (Opus 编码)            │ P2     │
  ├──────────┼─────────────────────────────────────┼────────┤
  │ 文件权限 │ 细粒度的文件/目录访问控制           │ P1     │
  ├──────────┼─────────────────────────────────────┼────────┤
  │ 离线支持 │ 断线重连，操作队列本地缓存          │ P2     │
  └──────────┴─────────────────────────────────────┴────────┘
  1.4 实现路径

  Phase 1: 核心协议
  - Protobuf schema 定义
  - QUIC 传输层封装 (基于 quinn-rs)
  - 基础会话管理

  Phase 2: 文档同步
  - CRDT 实现 (考虑集成 yrs - Yjs Rust 实现)
  - Monaco Editor 绑定
  - 光标同步

  Phase 3: 扩展功能
  - 终端共享
  - NAT 穿透 (STUN/TURN)
  - 语音通话

  ---
  二、macOS 原生守护进程 (Logos Helper)

  2.1 概述

  创建 Swift 编写的 macOS 原生守护进程，提供 VS Code / Zed 无法实现的系统级集成功能。作为可选功能包，仅 macOS
  可用，首次启动时提示下载。

  2.2 架构

  ┌─────────────────────────────────────────────────────────────┐
  │                    Logos Helper 架构                         │
  ├─────────────────────────────────────────────────────────────┤
  │                                                             │
  │  ┌─────────────────┐          ┌─────────────────┐          │
  │  │   Logos.app     │◄────────►│  LogosHelper    │          │
  │  │   (Electron)    │   IPC    │  (Swift Daemon) │          │
  │  └─────────────────┘          └────────┬────────┘          │
  │                                        │                    │
  │                     ┌──────────────────┼──────────────────┐ │
  │                     │                  │                  │ │
  │              ┌──────▼──────┐   ┌───────▼───────┐   ┌──────▼──────┐
  │              │   Widgets   │   │  System Toast │   │ App Intents │
  │              │ (WidgetKit) │   │ (UserNotifi.) │   │  (Siri/快捷) │
  │              └─────────────┘   └───────────────┘   └─────────────┘
  │                                                             │
  │  IPC 方式:                                                   │
  │  • Unix Domain Socket (主要)                                 │
  │  • XPC Services (沙盒环境)                                   │
  │  • Distributed Notifications (简单状态同步)                  │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘

  2.3 功能模块

  2.3.1 桌面小组件 (WidgetKit)
  ┌──────────┬──────────────┬────────────────────────────────────┐
  │  小组件  │     尺寸     │                功能                │
  ├──────────┼──────────────┼────────────────────────────────────┤
  │ 项目状态 │ Small/Medium │ 当前项目名、Git 分支、未提交更改数 │
  ├──────────┼──────────────┼────────────────────────────────────┤
  │ 快速操作 │ Medium       │ 一键打开最近项目 / 新建文件        │
  ├──────────┼──────────────┼────────────────────────────────────┤
  │ 构建状态 │ Small        │ 最近一次构建/测试状态              │
  ├──────────┼──────────────┼────────────────────────────────────┤
  │ Git 活动 │ Large        │ 提交热力图、最近提交列表           │
  ├──────────┼──────────────┼────────────────────────────────────┤
  │ 待办事项 │ Medium/Large │ 项目中的 TODO/FIXME 统计           │
  └──────────┴──────────────┴────────────────────────────────────┘
  // 示例: 项目状态小组件
  struct ProjectStatusWidget: Widget {
      let kind: String = "ProjectStatusWidget"

      var body: some WidgetConfiguration {
          StaticConfiguration(kind: kind, provider: ProjectStatusProvider()) { entry in
              ProjectStatusView(entry: entry)
          }
          .configurationDisplayName("项目状态")
          .description("显示当前项目的 Git 状态")
          .supportedFamilies([.systemSmall, .systemMedium])
      }
  }

  struct ProjectStatusEntry: TimelineEntry {
      let date: Date
      let projectName: String
      let branchName: String
      let uncommittedChanges: Int
      let lastCommitMessage: String
  }

  2.3.2 系统级 Toast 通知 (UserNotifications)
  ┌───────────────┬───────────────┬───────────────────────────────┐
  │     事件      │   通知类型    │             交互              │
  ├───────────────┼───────────────┼───────────────────────────────┤
  │ 构建完成      │ Alert         │ 点击跳转到构建输出            │
  ├───────────────┼───────────────┼───────────────────────────────┤
  │ 测试结果      │ Alert + Sound │ 显示通过/失败数，点击查看详情 │
  ├───────────────┼───────────────┼───────────────────────────────┤
  │ Git Push/Pull │ Banner        │ 显示提交数量                  │
  ├───────────────┼───────────────┼───────────────────────────────┤
  │ 协作邀请      │ Alert         │ 接受/拒绝按钮                 │
  ├───────────────┼───────────────┼───────────────────────────────┤
  │ 长任务完成    │ Alert         │ 如 npm install、cargo build   │
  └───────────────┴───────────────┴───────────────────────────────┘
  // 示例: 丰富通知
  func sendBuildNotification(success: Bool, duration: TimeInterval, errors: [String]) {
      let content = UNMutableNotificationContent()
      content.title = success ? "✅ 构建成功" : "❌ 构建失败"
      content.body = "耗时 \(String(format: "%.1f", duration))s"
      content.sound = success ? .default : .defaultCritical
      content.categoryIdentifier = "BUILD_RESULT"

      // 添加操作按钮
      content.userInfo = ["projectPath": currentProject.path]

      if !success {
          content.body += "\n\(errors.count) 个错误"
          // 附加错误详情
          if let attachment = createErrorAttachment(errors) {
              content.attachments = [attachment]
          }
      }

      // 支持 Live Activity (iOS 16+/macOS 14+ Dynamic Island 风格)
      // 用于长时间运行的任务进度
  }

  2.3.3 App Intents (Siri & 快捷指令)
  ┌─────────────┬──────────────────────────┬────────────────────┐
  │   Intent    │         触发方式         │        功能        │
  ├─────────────┼──────────────────────────┼────────────────────┤
  │ OpenProject │ "用 Logos 打开 [项目名]" │ 打开指定项目       │
  ├─────────────┼──────────────────────────┼────────────────────┤
  │ RunBuild    │ "构建 [项目名]"          │ 执行构建命令       │
  ├─────────────┼──────────────────────────┼────────────────────┤
  │ GitStatus   │ "查看 Git 状态"          │ 返回当前分支和更改 │
  ├─────────────┼──────────────────────────┼────────────────────┤
  │ CreateFile  │ "在 Logos 新建文件"      │ 创建并打开新文件   │
  ├─────────────┼──────────────────────────┼────────────────────┤
  │ SearchCode  │ "在代码中搜索 [关键词]"  │ 全局代码搜索       │
  └─────────────┴──────────────────────────┴────────────────────┘
  // 示例: App Intent
  struct OpenProjectIntent: AppIntent {
      static var title: LocalizedStringResource = "打开项目"
      static var description = IntentDescription("用 Logos 打开一个项目")

      @Parameter(title: "项目名称")
      var projectName: String

      static var parameterSummary: some ParameterSummary {
          Summary("打开 \(\.$projectName)")
      }

      func perform() async throws -> some IntentResult {
          let projects = try await LogosHelper.shared.listRecentProjects()
          guard let project = projects.first(where: { $0.name == projectName }) else {
              throw IntentError.projectNotFound
          }

          try await LogosHelper.shared.openProject(at: project.path)
          return .result()
      }
  }

  // 注册为 App Shortcut (无需用户配置即可使用)
  struct LogosShortcuts: AppShortcutsProvider {
      static var appShortcuts: [AppShortcut] {
          AppShortcut(
              intent: OpenProjectIntent(),
              phrases: [
                  "用 \(.applicationName) 打开 \(\.$projectName)",
                  "在 \(.applicationName) 中打开 \(\.$projectName)"
              ],
              shortTitle: "打开项目",
              systemImageName: "folder"
          )
      }
  }

  2.3.4 其他系统集成
  ┌────────────────┬──────────────────────┬───────────────────────────────┐
  │      功能      │         API          │             说明              │
  ├────────────────┼──────────────────────┼───────────────────────────────┤
  │ 菜单栏图标     │ NSStatusItem         │ 快速访问、状态显示            │
  ├────────────────┼──────────────────────┼───────────────────────────────┤
  │ 触控栏         │ NSTouchBar           │ 自定义按钮 (旧款 MacBook Pro) │
  ├────────────────┼──────────────────────┼───────────────────────────────┤
  │ Focus 模式集成 │ FocusFilter          │ "编程"模式下自动启用专注功能  │
  ├────────────────┼──────────────────────┼───────────────────────────────┤
  │ Handoff        │ NSUserActivity       │ Mac 间无缝切换                │
  ├────────────────┼──────────────────────┼───────────────────────────────┤
  │ 控制中心磁贴   │ ControlCenter Widget │ 快速切换项目                  │
  └────────────────┴──────────────────────┴───────────────────────────────┘
  2.4 分发方式

  ┌─────────────────────────────────────────────────────────────┐
  │                   功能包分发流程                              │
  ├─────────────────────────────────────────────────────────────┤
  │                                                             │
  │  1. 首次启动检测                                             │
  │     ┌──────────────────────────────────────────────┐        │
  │     │  检测到 macOS 系统                            │        │
  │     │  是否下载 Apple 原生集成功能包？               │        │
  │     │                                              │        │
  │     │  功能包括:                                    │        │
  │     │  • 桌面小组件                                 │        │
  │     │  • 系统通知增强                               │        │
  │     │  • Siri 与快捷指令支持                        │        │
  │     │                                              │        │
  │     │  大小: ~15MB                                  │        │
  │     │                                              │        │
  │     │  [下载并安装]  [稍后提醒]  [不再询问]          │        │
  │     └──────────────────────────────────────────────┘        │
  │                                                             │
  │  2. 安装位置                                                 │
  │     ~/Library/Application Support/Logos/LogosHelper.app     │
  │                                                             │
  │  3. 自动更新                                                 │
  │     随 Logos 主程序更新时检查并更新 Helper                    │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘

  2.5 Swift Package 结构

  logos-apple/
  ├── Package.swift
  ├── Sources/
  │   ├── LogosHelper/           # 守护进程主程序
  │   │   ├── main.swift
  │   │   ├── IPCServer.swift    # Unix Socket / XPC
  │   │   └── Services/
  │   │       ├── WidgetService.swift
  │   │       ├── NotificationService.swift
  │   │       └── IntentsService.swift
  │   │
  │   ├── LogosWidgets/          # WidgetKit Extension
  │   │   ├── LogosWidgets.swift
  │   │   ├── ProjectStatusWidget.swift
  │   │   ├── GitActivityWidget.swift
  │   │   └── QuickActionsWidget.swift
  │   │
  │   ├── LogosIntents/          # App Intents
  │   │   ├── OpenProjectIntent.swift
  │   │   ├── RunBuildIntent.swift
  │   │   └── LogosShortcuts.swift
  │   │
  │   └── LogosShared/           # 共享代码
  │       ├── Models/
  │       ├── IPC/
  │       └── Extensions/
  │
  ├── LogosHelper.entitlements
  └── README.md

  ---
  三、跨设备原生客户端 (Logos Remote)

  3.1 概述

  开发 SwiftUI 原生 App，支持从 iPhone、iPad、其他 Mac 以及 Apple Vision Pro 远程连接到任意运行中的 Logos 实例。

  3.2 支持平台
  ┌─────────────────────┬───────────────┬──────────────────────────────────┐
  │        平台         │   最低版本    │             特殊适配             │
  ├─────────────────────┼───────────────┼──────────────────────────────────┤
  │ iPhone              │ iOS 17+       │ 紧凑布局、手势操作               │
  ├─────────────────────┼───────────────┼──────────────────────────────────┤
  │ iPad                │ iPadOS 17+    │ 多窗口、键盘快捷键、Apple Pencil │
  ├─────────────────────┼───────────────┼──────────────────────────────────┤
  │ Mac (Catalyst/原生) │ macOS 14+     │ 原生菜单、多窗口                 │
  ├─────────────────────┼───────────────┼──────────────────────────────────┤
  │ Apple Vision Pro    │ visionOS 1.0+ │ 空间布局、眼动追踪、手势         │
  └─────────────────────┴───────────────┴──────────────────────────────────┘
  3.3 架构设计

  ┌─────────────────────────────────────────────────────────────┐
  │                  Logos Remote 架构                           │
  ├─────────────────────────────────────────────────────────────┤
  │                                                             │
  │  ┌─────────────┐                      ┌─────────────┐       │
  │  │ Logos Remote│                      │ Logos       │       │
  │  │ (SwiftUI)   │◄────────────────────►│ (Electron)  │       │
  │  └──────┬──────┘     Protobuf/QUIC    └──────┬──────┘       │
  │         │                                    │               │
  │         │                                    │               │
  │  ┌──────┴──────────────────────┐    ┌───────┴───────┐       │
  │  │       Rendering Layer       │    │  Remote API   │       │
  │  ├─────────────────────────────┤    │   Service     │       │
  │  │ • 增量文本渲染 (非全屏镜像)   │    │               │       │
  │  │ • 语法高亮本地计算           │    │ • 文件操作     │       │
  │  │ • 手势 → 编辑命令映射        │    │ • 编辑命令     │       │
  │  │ • 本地 Monaco 主题解析       │    │ • 终端 I/O    │       │
  │  └─────────────────────────────┘    │ • Git 操作     │       │
  │                                     │ • 构建/运行    │       │
  │  特点:                               └───────────────┘       │
  │  • 不是屏幕镜像，是原生 UI 渲染                               │
  │  • 低带宽，仅传输文本和状态                                   │
  │  • 支持离线查看 (只读缓存)                                    │
  │                                                             │
  └─────────────────────────────────────────────────────────────┘

  3.4 核心功能

  3.4.1 连接管理
  ┌──────────┬────────────────────────────────────────────┐
  │   功能   │                    描述                    │
  ├──────────┼────────────────────────────────────────────┤
  │ 发现服务 │ Bonjour/mDNS 自动发现局域网内的 Logos 实例 │
  ├──────────┼────────────────────────────────────────────┤
  │ 远程连接 │ 通过 IP/域名 + 配对码连接公网实例          │
  ├──────────┼────────────────────────────────────────────┤
  │ 安全认证 │ 设备配对 + E2E 加密                        │
  ├──────────┼────────────────────────────────────────────┤
  │ 多实例   │ 同时连接多个 Logos 实例                    │
  └──────────┴────────────────────────────────────────────┘
  // 连接发现
  class LogosDiscovery: ObservableObject {
      @Published var availableHosts: [LogosHost] = []

      private let browser = NWBrowser(for: .bonjour(type: "_logos._tcp", domain: nil), using: .tcp)

      func startDiscovery() {
          browser.browseResultsChangedHandler = { results, _ in
              self.availableHosts = results.compactMap { LogosHost(from: $0) }
          }
          browser.start(queue: .main)
      }
  }

  3.4.2 编辑器功能
  ┌──────────┬────────┬──────┬─────┬───────────────┐
  │   功能   │ iPhone │ iPad │ Mac │  Vision Pro   │
  ├──────────┼────────┼──────┼─────┼───────────────┤
  │ 语法高亮 │ ✅     │ ✅   │ ✅  │ ✅            │
  ├──────────┼────────┼──────┼─────┼───────────────┤
  │ 代码补全 │ ✅     │ ✅   │ ✅  │ ✅            │
  ├──────────┼────────┼──────┼─────┼───────────────┤
  │ 多光标   │ -      │ ✅   │ ✅  │ ✅            │
  ├──────────┼────────┼──────┼─────┼───────────────┤
  │ 分屏编辑 │ -      │ ✅   │ ✅  │ ✅ (空间窗口) │
  ├──────────┼────────┼──────┼─────┼───────────────┤
  │ 手势导航 │ ✅     │ ✅   │ -   │ ✅ (眼动)     │
  ├──────────┼────────┼──────┼─────┼───────────────┤
  │ 外接键盘 │ ✅     │ ✅   │ ✅  │ ✅            │
  └──────────┴────────┴──────┴─────┴───────────────┘
  3.4.3 平台特化

  iPhone:
  struct iPhoneEditorView: View {
      @State private var showFileTree = false

      var body: some View {
          ZStack {
              CodeEditorView()

              // 底部快捷工具栏
              VStack {
                  Spacer()
                  QuickActionBar(actions: [
                      .tab, .brackets, .save, .undo, .redo
                  ])
              }
          }
          .sheet(isPresented: $showFileTree) {
              FileTreeView()
          }
          .gesture(
              DragGesture()
                  .onEnded { value in
                      if value.translation.width > 100 {
                          showFileTree = true
                      }
                  }
          )
      }
  }

  iPad:
  struct iPadEditorView: View {
      var body: some View {
          NavigationSplitView {
              FileTreeView()
          } detail: {
              TabEditorView()
          }
          .toolbar {
              ToolbarItemGroup(placement: .keyboard) {
                  // 键盘上方快捷键
                  Button(action: save) { Image(systemName: "square.and.arrow.down") }
                  Button(action: format) { Image(systemName: "text.alignleft") }
                  Spacer()
                  Button(action: toggleTerminal) { Image(systemName: "terminal") }
              }
          }
      }
  }

  Vision Pro:
  struct VisionProEditorView: View {
      @Environment(\.openWindow) var openWindow

      var body: some View {
          HStack(spacing: 50) {
              // 主编辑窗口
              CodeEditorVolume()
                  .frame(width: 1200, height: 800)

              // 浮动终端
              TerminalVolume()
                  .frame(width: 600, height: 400)
          }
          .ornament(attachmentAnchor: .scene(.bottom)) {
              // 底部控制面板
              ControlPanel()
          }
      }
  }

  // 空间手势
  extension VisionProEditorView {
      var spatialGestures: some Gesture {
          SpatialTapGesture()
              .onEnded { value in
                  // 眼动 + 捏合 = 点击
                  handleTap(at: value.location3D)
              }
      }
  }

  3.5 技术细节

  通信协议

  复用 Logos Live 的 Protobuf 定义，扩展以下消息类型:

  // 远程客户端特有消息
  message RemoteConnect {
    string device_id = 1;
    string device_name = 2;
    DeviceType device_type = 3;
    bytes public_key = 4;
  }

  enum DeviceType {
    IPHONE = 0;
    IPAD = 1;
    MAC = 2;
    VISION_PRO = 3;
  }

  message FileTreeSync {
    repeated FileNode nodes = 1;
    string root_path = 2;
  }

  message FileNode {
    string name = 1;
    string path = 2;
    bool is_directory = 3;
    repeated FileNode children = 4;
  }

  message RemoteCommand {
    oneof command {
      BuildCommand build = 1;
      GitCommand git = 2;
      TerminalCommand terminal = 3;
    }
  }

  离线支持

  class OfflineCache {
      // 缓存最近打开的文件 (只读)
      func cacheFile(_ file: RemoteFile) async {
          let cacheDir = FileManager.default.urls(for: .cachesDirectory, in: .userDomainMask)[0]
              .appendingPathComponent("LogosRemote/\(connection.hostId)")

          try? FileManager.default.createDirectory(at: cacheDir, withIntermediateDirectories: true)

          let filePath = cacheDir.appendingPathComponent(file.relativePath)
          try? file.content.write(to: filePath, atomically: true, encoding: .utf8)
      }

      // 离线时显示缓存的文件
      func getCachedFiles(for hostId: String) -> [CachedFile] {
          // ...
      }
  }

  3.6 项目结构

  logos-remote/
  ├── LogosRemote.xcodeproj
  ├── Shared/                        # 跨平台共享代码
  │   ├── Models/
  │   │   ├── Connection.swift
  │   │   ├── RemoteFile.swift
  │   │   └── EditorState.swift
  │   ├── Services/
  │   │   ├── ConnectionManager.swift
  │   │   ├── ProtobufService.swift
  │   │   └── SyntaxHighlighter.swift
  │   ├── Views/
  │   │   ├── CodeEditorView.swift
  │   │   ├── FileTreeView.swift
  │   │   └── TerminalView.swift
  │   └── Utilities/
  │
  ├── iOS/                           # iPhone 特化
  │   ├── iPhoneApp.swift
  │   └── Views/
  │
  ├── iPadOS/                        # iPad 特化
  │   ├── iPadApp.swift
  │   └── Views/
  │
  ├── macOS/                         # Mac 特化
  │   ├── MacApp.swift
  │   └── Views/
  │
  ├── visionOS/                      # Vision Pro 特化
  │   ├── VisionApp.swift
  │   ├── Volumes/
  │   └── Ornaments/
  │
  ├── Packages/
  │   └── LogosProtocol/            # 共享的 Protobuf 定义
  │
  └── README.md

  ---
  四、实现优先级与里程碑

  Phase 1: 基础设施 (Q1)

  - Protobuf schema 设计与代码生成
  - QUIC 传输层 (Rust: quinn, Swift: Network.framework)
  - 基础 IPC 通道 (Electron ↔ Swift Helper)

  Phase 2: 协作核心 (Q2)

  - CRDT 文档同步
  - 光标/选区同步
  - 会话管理 UI

  Phase 3: macOS 集成 (Q2-Q3)

  - LogosHelper 守护进程
  - WidgetKit 小组件
  - UserNotifications 增强通知
  - App Intents 集成

  Phase 4: 远程客户端 (Q3-Q4)

  - iOS/iPadOS 客户端
  - macOS 客户端
  - visionOS 客户端

  Phase 5: 完善与优化 (Q4+)

  - 语音通话
  - 高级权限控制
  - 性能优化
  - App Store 上架

  ---
  五、技术风险与缓解
  ┌─────────────────────┬───────────────────────┬──────────────────────────┐
  │        风险         │         影响          │         缓解措施         │
  ├─────────────────────┼───────────────────────┼──────────────────────────┤
  │ NAT 穿透复杂性      │ 部分用户无法 P2P 连接 │ 提供中继服务器作为后备   │
  ├─────────────────────┼───────────────────────┼──────────────────────────┤
  │ CRDT 实现复杂度     │ 并发冲突导致数据丢失  │ 使用成熟的 Yjs/Automerge │
  ├─────────────────────┼───────────────────────┼──────────────────────────┤
  │ Apple 审核风险      │ App Store 拒绝上架    │ 遵循 HIG，准备详细说明   │
  ├─────────────────────┼───────────────────────┼──────────────────────────┤
  │ 跨平台协议兼容      │ Rust ↔ Swift          │ 使用 Protobuf 保证兼容   │
  │                     │ 通信问题              │                          │
  ├─────────────────────┼───────────────────────┼──────────────────────────┤
  │ Vision Pro 用户量小 │ 投入产出比低          │ 最低优先级，作为技术展示 │
  └─────────────────────┴───────────────────────┴──────────────────────────┘
  ---
  六、参考资料

  - https://docs.microsoft.com/en-us/visualstudio/liveshare/
  - https://crdt.tech/
  - https://docs.yjs.dev/
  - https://www.rfc-editor.org/rfc/rfc9000.html
  - https://developer.apple.com/documentation/widgetkit
  - https://developer.apple.com/documentation/appintents
  - https://developer.apple.com/visionos/