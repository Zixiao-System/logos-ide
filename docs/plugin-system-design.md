# Logos IDE 插件系统设计文档

## 1. 概述

本文档描述 Logos IDE 插件系统的设计方案，旨在提供一个类似 VS Code 的可扩展架构，允许第三方开发者为 IDE 添加新功能。

## 2. 设计目标

- **安全性**: 插件运行在沙箱环境中，防止恶意代码影响系统
- **稳定性**: 插件崩溃不会影响主程序运行
- **易用性**: 提供简洁的 API 和完善的文档
- **性能**: 支持懒加载，按需激活插件
- **兼容性**: 参考 VS Code 扩展 API 设计，降低学习成本

## 3. 架构设计

### 3.1 整体架构

```
┌─────────────────────────────────────────────────────────────┐
│                      Logos IDE Main Process                  │
├──────────────────────┬──────────────────────────────────────┤
│   Extension Host     │              Core Services            │
│   (独立进程)         │   ┌──────────┐  ┌──────────────────┐ │
│  ┌─────────────────┐ │   │ File     │  │ Editor           │ │
│  │ Extension API   │ │   │ Service  │  │ Service          │ │
│  │ Sandbox         │◄├──►├──────────┤  ├──────────────────┤ │
│  │ Extension A     │ │   │ Terminal │  │ Git              │ │
│  │ Extension B     │ │   │ Service  │  │ Service          │ │
│  │ Extension C     │ │   └──────────┘  └──────────────────┘ │
│  └─────────────────┘ │                                      │
└──────────────────────┴──────────────────────────────────────┘
                              │
                              ▼
                    ┌─────────────────┐
                    │  Renderer       │
                    │  Process        │
                    │  (Vue App)      │
                    └─────────────────┘
```

### 3.2 核心组件

#### 3.2.1 Extension Host (扩展宿主)

- 独立的 Node.js 子进程
- 运行所有插件代码
- 与主进程通过 IPC 通信
- 崩溃后可自动重启

#### 3.2.2 Extension API

提供给插件使用的 API 接口：

```typescript
// logos.d.ts - 插件 API 类型定义
declare namespace logos {
  // 窗口相关
  namespace window {
    function showInformationMessage(message: string): Promise<void>
    function showErrorMessage(message: string): Promise<void>
    function showInputBox(options: InputBoxOptions): Promise<string | undefined>
    function createOutputChannel(name: string): OutputChannel
    function createTerminal(options: TerminalOptions): Terminal
  }

  // 编辑器相关
  namespace editor {
    const activeTextEditor: TextEditor | undefined
    function openTextDocument(uri: string): Promise<TextDocument>
    function showTextDocument(document: TextDocument): Promise<TextEditor>
  }

  // 工作区相关
  namespace workspace {
    const workspaceFolders: WorkspaceFolder[] | undefined
    const rootPath: string | undefined
    function getConfiguration(section: string): WorkspaceConfiguration
    function findFiles(include: string, exclude?: string): Promise<string[]>
  }

  // 命令相关
  namespace commands {
    function registerCommand(command: string, callback: (...args: any[]) => any): Disposable
    function executeCommand<T>(command: string, ...args: any[]): Promise<T>
  }

  // 语言相关
  namespace languages {
    function registerCompletionItemProvider(
      selector: DocumentSelector,
      provider: CompletionItemProvider
    ): Disposable
    function registerHoverProvider(
      selector: DocumentSelector,
      provider: HoverProvider
    ): Disposable
    function registerDefinitionProvider(
      selector: DocumentSelector,
      provider: DefinitionProvider
    ): Disposable
  }
}
```

#### 3.2.3 Extension Manifest (插件清单)

每个插件需要包含 `package.json` 文件：

```json
{
  "name": "my-extension",
  "displayName": "My Extension",
  "version": "1.0.0",
  "description": "A sample extension",
  "publisher": "my-publisher",
  "engines": {
    "logos": "^1.0.0"
  },
  "categories": ["Programming Languages", "Linters"],
  "activationEvents": [
    "onLanguage:javascript",
    "onCommand:myExtension.sayHello"
  ],
  "main": "./dist/extension.js",
  "contributes": {
    "commands": [
      {
        "command": "myExtension.sayHello",
        "title": "Say Hello"
      }
    ],
    "menus": {
      "editor/context": [
        {
          "command": "myExtension.sayHello",
          "group": "navigation"
        }
      ]
    },
    "configuration": {
      "title": "My Extension",
      "properties": {
        "myExtension.enableFeature": {
          "type": "boolean",
          "default": true,
          "description": "Enable the feature"
        }
      }
    }
  }
}
```

### 3.3 插件生命周期

```
┌─────────────┐     ┌─────────────┐     ┌─────────────┐
│   Install   │────►│   Inactive  │────►│   Active    │
└─────────────┘     └─────────────┘     └─────────────┘
                           │                   │
                           │                   │
                           ▼                   ▼
                    ┌─────────────┐     ┌─────────────┐
                    │  Uninstall  │     │  Deactivate │
                    └─────────────┘     └─────────────┘
```

1. **Install**: 插件安装到本地
2. **Inactive**: 插件已安装但未激活
3. **Active**: 插件被激活，`activate()` 函数被调用
4. **Deactivate**: 插件停用，`deactivate()` 函数被调用
5. **Uninstall**: 插件被卸载

### 3.4 激活事件 (Activation Events)

插件可以声明以下激活事件：

| 事件 | 说明 |
|------|------|
| `onLanguage:<languageId>` | 打开指定语言的文件时激活 |
| `onCommand:<commandId>` | 执行指定命令时激活 |
| `workspaceContains:<glob>` | 工作区包含匹配文件时激活 |
| `onFileSystem:<scheme>` | 访问指定协议文件时激活 |
| `onView:<viewId>` | 展开指定视图时激活 |
| `onStartupFinished` | IDE 启动完成后激活 |
| `*` | 立即激活 (不推荐) |

## 4. 实现计划

### 4.1 Phase 1: 基础架构

- [ ] 实现 Extension Host 进程
- [ ] 实现主进程与 Extension Host 的 IPC 通信
- [ ] 实现插件加载器
- [ ] 实现基本的 API 框架

### 4.2 Phase 2: 核心 API

- [ ] 实现 `logos.window` API
- [ ] 实现 `logos.editor` API
- [ ] 实现 `logos.workspace` API
- [ ] 实现 `logos.commands` API

### 4.3 Phase 3: 语言支持 API

- [ ] 实现 `logos.languages` API
- [ ] 实现 LSP 集成接口
- [ ] 实现语法高亮扩展点

### 4.4 Phase 4: UI 扩展

- [ ] 实现侧边栏视图扩展
- [ ] 实现状态栏扩展
- [ ] 实现菜单扩展
- [ ] 实现 Webview API

### 4.5 Phase 5: 插件市场

- [ ] 设计插件市场 API
- [ ] 实现插件搜索和安装
- [ ] 实现插件更新机制
- [ ] 实现插件评分和评论

## 5. 安全考虑

### 5.1 沙箱机制

- 插件运行在独立进程中，与主进程隔离
- 使用 Node.js 的 `vm` 模块创建安全沙箱
- 限制文件系统访问范围
- 限制网络访问权限

### 5.2 权限系统

插件需要声明所需权限：

```json
{
  "permissions": [
    "filesystem:read",
    "filesystem:write",
    "network:fetch",
    "terminal:create"
  ]
}
```

### 5.3 代码签名

- 官方市场的插件需要代码签名
- 用户可以选择只安装已签名的插件
- 支持企业内部签名证书

## 6. 示例插件

```typescript
// extension.ts
import * as logos from 'logos'

export function activate(context: logos.ExtensionContext) {
  console.log('My extension is now active!')

  // 注册命令
  const disposable = logos.commands.registerCommand('myExtension.sayHello', () => {
    logos.window.showInformationMessage('Hello from My Extension!')
  })

  context.subscriptions.push(disposable)

  // 创建输出通道
  const outputChannel = logos.window.createOutputChannel('My Extension')
  outputChannel.appendLine('Extension activated')

  // 注册补全提供者
  const completionProvider = logos.languages.registerCompletionItemProvider(
    { language: 'javascript' },
    {
      provideCompletionItems(document, position) {
        return [
          {
            label: 'mySnippet',
            kind: logos.CompletionItemKind.Snippet,
            insertText: 'console.log($1);'
          }
        ]
      }
    }
  )

  context.subscriptions.push(completionProvider)
}

export function deactivate() {
  console.log('My extension is now deactivated')
}
```

## 7. 目录结构

```
logos-ide/
├── src/
│   ├── extension-host/           # 扩展宿主相关代码
│   │   ├── index.ts              # 宿主进程入口
│   │   ├── api/                  # 扩展 API 实现
│   │   │   ├── window.ts
│   │   │   ├── editor.ts
│   │   │   ├── workspace.ts
│   │   │   ├── commands.ts
│   │   │   └── languages.ts
│   │   ├── loader.ts             # 插件加载器
│   │   └── sandbox.ts            # 沙箱实现
│   ├── services/
│   │   └── extensionService.ts   # 主进程扩展服务
│   └── stores/
│       └── extensions.ts         # 扩展状态管理
├── extensions/                   # 内置扩展目录
│   └── ...
└── types/
    └── logos.d.ts                # 扩展 API 类型定义
```

## 8. 参考资料

- [VS Code Extension API](https://code.visualstudio.com/api)
- [VS Code Extension Guidelines](https://code.visualstudio.com/api/references/extension-guidelines)
- [Electron Security](https://www.electronjs.org/docs/latest/tutorial/security)
