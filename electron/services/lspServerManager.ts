/**
 * LSP 服务器管理器
 * 负责在主进程中启动和管理各种语言的 LSP 服务器
 * 这是 Basic Mode 的核心组件，使用标准 LSP 协议
 */

import { spawn, ChildProcess } from 'child_process'
import { ipcMain, BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import * as os from 'os'

// LSP 服务器配置
interface LSPServerConfig {
  languageId: string
  displayName: string
  command: string
  args: string[]
  extensions: string[]
  // 可选: 环境变量
  env?: Record<string, string>
  // 可选: 初始化选项
  initializationOptions?: Record<string, unknown>
}

// LSP 服务器状态
interface LSPServerState {
  config: LSPServerConfig
  process: ChildProcess | null
  status: 'stopped' | 'starting' | 'running' | 'error'
  error?: string
  capabilities?: ServerCapabilities
}

// 服务器能力 (简化版)
interface ServerCapabilities {
  completionProvider?: boolean
  hoverProvider?: boolean
  definitionProvider?: boolean
  referencesProvider?: boolean
  renameProvider?: boolean
  signatureHelpProvider?: boolean
  documentFormattingProvider?: boolean
}

// 预定义的 LSP 服务器配置
const LSP_SERVER_CONFIGS: LSPServerConfig[] = [
  {
    languageId: 'typescript',
    displayName: 'TypeScript',
    command: 'typescript-language-server',
    args: ['--stdio'],
    extensions: ['.ts', '.tsx', '.js', '.jsx', '.mjs', '.cjs'],
    initializationOptions: {
      preferences: {
        includeInlayParameterNameHints: 'all',
        includeInlayPropertyDeclarationTypeHints: true,
        includeInlayVariableTypeHints: true,
      }
    }
  },
  {
    languageId: 'python',
    displayName: 'Python (Pyright)',
    command: 'pyright-langserver',
    args: ['--stdio'],
    extensions: ['.py', '.pyw'],
  },
  {
    languageId: 'go',
    displayName: 'Go (gopls)',
    command: 'gopls',
    args: ['serve'],
    extensions: ['.go'],
  },
  {
    languageId: 'rust',
    displayName: 'Rust (rust-analyzer)',
    command: 'rust-analyzer',
    args: [],
    extensions: ['.rs'],
  },
  {
    languageId: 'c',
    displayName: 'C/C++ (clangd)',
    command: 'clangd',
    args: ['--background-index'],
    extensions: ['.c', '.h', '.cpp', '.cc', '.cxx', '.hpp', '.hxx', '.hh'],
  },
  {
    languageId: 'java',
    displayName: 'Java (jdtls)',
    command: 'jdtls',
    args: [],
    extensions: ['.java'],
  },
]

export class LSPServerManager {
  private servers: Map<string, LSPServerState> = new Map()
  private mainWindow: BrowserWindow | null = null
  private projectRoot: string | null = null

  // JSON-RPC 请求 ID 计数器
  private requestId = 0
  // 等待响应的请求
  private pendingRequests: Map<number, {
    resolve: (value: unknown) => void
    reject: (error: Error) => void
    timeout: NodeJS.Timeout
  }> = new Map()

  constructor() {
    this.initializeServerConfigs()
  }

  /**
   * 初始化服务器配置
   */
  private initializeServerConfigs(): void {
    for (const config of LSP_SERVER_CONFIGS) {
      this.servers.set(config.languageId, {
        config,
        process: null,
        status: 'stopped',
      })
    }
  }

  /**
   * 设置主窗口引用
   */
  setMainWindow(window: BrowserWindow): void {
    this.mainWindow = window
  }

  /**
   * 设置项目根目录
   */
  setProjectRoot(rootPath: string): void {
    this.projectRoot = rootPath
  }

  /**
   * 启动指定语言的 LSP 服务器
   */
  async startServer(languageId: string): Promise<boolean> {
    const state = this.servers.get(languageId)
    if (!state) {
      console.error(`[LSP] Unknown language: ${languageId}`)
      return false
    }

    if (state.status === 'running') {
      return true
    }

    state.status = 'starting'
    this.notifyStatusChange(languageId, 'starting')

    try {
      // 检查命令是否存在
      const commandPath = await this.findCommand(state.config.command)
      if (!commandPath) {
        throw new Error(`LSP server not found: ${state.config.command}`)
      }

      // 启动进程
      const env = {
        ...process.env,
        ...state.config.env,
      }

      state.process = spawn(commandPath, state.config.args, {
        env,
        cwd: this.projectRoot || undefined,
        stdio: ['pipe', 'pipe', 'pipe'],
      })

      // 设置事件处理
      this.setupProcessHandlers(languageId, state)

      // 发送初始化请求
      await this.initializeServer(languageId, state)

      state.status = 'running'
      this.notifyStatusChange(languageId, 'running')
      console.log(`[LSP] Server started: ${state.config.displayName}`)
      return true

    } catch (error) {
      state.status = 'error'
      state.error = error instanceof Error ? error.message : String(error)
      this.notifyStatusChange(languageId, 'error', state.error)
      console.error(`[LSP] Failed to start server for ${languageId}:`, error)
      return false
    }
  }

  /**
   * 停止指定语言的 LSP 服务器
   */
  async stopServer(languageId: string): Promise<void> {
    const state = this.servers.get(languageId)
    if (!state || !state.process) return

    try {
      // 发送 shutdown 请求
      await this.sendRequest(languageId, 'shutdown', null, 5000)
      // 发送 exit 通知
      this.sendNotification(languageId, 'exit', null)
    } catch {
      // 忽略错误，强制终止
    }

    // 等待一小段时间后强制终止
    setTimeout(() => {
      if (state.process && !state.process.killed) {
        state.process.kill('SIGKILL')
      }
    }, 1000)

    state.process = null
    state.status = 'stopped'
    this.notifyStatusChange(languageId, 'stopped')
  }

  /**
   * 停止所有服务器
   */
  async stopAll(): Promise<void> {
    const promises = Array.from(this.servers.keys()).map(id => this.stopServer(id))
    await Promise.all(promises)
  }

  /**
   * 获取服务器状态
   */
  getServerStatus(languageId: string): string {
    const state = this.servers.get(languageId)
    return state?.status || 'unknown'
  }

  /**
   * 获取支持指定文件的语言 ID
   */
  getLanguageIdForFile(filePath: string): string | null {
    const ext = path.extname(filePath).toLowerCase()
    for (const [languageId, state] of this.servers) {
      if (state.config.extensions.includes(ext)) {
        return languageId
      }
    }
    return null
  }

  /**
   * 发送 LSP 请求
   */
  async sendRequest(
    languageId: string,
    method: string,
    params: unknown,
    timeoutMs = 30000
  ): Promise<unknown> {
    const state = this.servers.get(languageId)
    if (!state?.process?.stdin) {
      throw new Error(`Server not running: ${languageId}`)
    }

    const id = ++this.requestId
    const message = {
      jsonrpc: '2.0',
      id,
      method,
      params,
    }

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timeout })

      const content = JSON.stringify(message)
      const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`
      state.process!.stdin!.write(header + content)
    })
  }

  /**
   * 发送 LSP 通知
   */
  sendNotification(languageId: string, method: string, params: unknown): void {
    const state = this.servers.get(languageId)
    if (!state?.process?.stdin) return

    const message = {
      jsonrpc: '2.0',
      method,
      params,
    }

    const content = JSON.stringify(message)
    const header = `Content-Length: ${Buffer.byteLength(content)}\r\n\r\n`
    state.process.stdin.write(header + content)
  }

  /**
   * 设置进程事件处理
   */
  private setupProcessHandlers(languageId: string, state: LSPServerState): void {
    const proc = state.process!
    let buffer = ''

    proc.stdout!.on('data', (data: Buffer) => {
      buffer += data.toString()
      this.processMessages(languageId, buffer, (remaining) => {
        buffer = remaining
      })
    })

    proc.stderr!.on('data', (data: Buffer) => {
      console.error(`[LSP ${languageId}] stderr:`, data.toString())
    })

    proc.on('exit', (code, signal) => {
      console.log(`[LSP ${languageId}] Process exited: code=${code}, signal=${signal}`)
      state.status = 'stopped'
      state.process = null
      this.notifyStatusChange(languageId, 'stopped')
    })

    proc.on('error', (error) => {
      console.error(`[LSP ${languageId}] Process error:`, error)
      state.status = 'error'
      state.error = error.message
      this.notifyStatusChange(languageId, 'error', error.message)
    })
  }

  /**
   * 处理接收到的消息
   */
  private processMessages(
    languageId: string,
    buffer: string,
    setRemaining: (remaining: string) => void
  ): void {
    const headerEnd = buffer.indexOf('\r\n\r\n')
    if (headerEnd === -1) {
      setRemaining(buffer)
      return
    }

    const header = buffer.substring(0, headerEnd)
    const match = header.match(/Content-Length:\s*(\d+)/i)
    if (!match) {
      setRemaining(buffer.substring(headerEnd + 4))
      return
    }

    const contentLength = parseInt(match[1], 10)
    const contentStart = headerEnd + 4
    const contentEnd = contentStart + contentLength

    if (buffer.length < contentEnd) {
      setRemaining(buffer)
      return
    }

    const content = buffer.substring(contentStart, contentEnd)
    const remaining = buffer.substring(contentEnd)

    try {
      const message = JSON.parse(content)
      this.handleMessage(languageId, message)
    } catch (error) {
      console.error(`[LSP ${languageId}] Failed to parse message:`, error)
    }

    // 继续处理剩余消息
    if (remaining) {
      this.processMessages(languageId, remaining, setRemaining)
    } else {
      setRemaining('')
    }
  }

  /**
   * 处理单条消息
   */
  private handleMessage(languageId: string, message: {
    id?: number
    method?: string
    result?: unknown
    error?: { code: number; message: string }
    params?: unknown
  }): void {
    // 响应消息
    if (message.id !== undefined && !message.method) {
      const pending = this.pendingRequests.get(message.id)
      if (pending) {
        clearTimeout(pending.timeout)
        this.pendingRequests.delete(message.id)

        if (message.error) {
          pending.reject(new Error(message.error.message))
        } else {
          pending.resolve(message.result)
        }
      }
      return
    }

    // 通知消息
    if (message.method) {
      this.handleNotification(languageId, message.method, message.params)
    }
  }

  /**
   * 处理通知消息
   */
  private handleNotification(languageId: string, method: string, params: unknown): void {
    switch (method) {
      case 'textDocument/publishDiagnostics':
        this.mainWindow?.webContents.send('lsp:diagnostics', { languageId, params })
        break
      case 'window/logMessage':
      case 'window/showMessage':
        console.log(`[LSP ${languageId}]`, params)
        break
      case '$/progress':
        this.mainWindow?.webContents.send('lsp:progress', { languageId, params })
        break
      default:
        // 其他通知转发给渲染进程
        this.mainWindow?.webContents.send('lsp:notification', { languageId, method, params })
    }
  }

  /**
   * 初始化服务器
   */
  private async initializeServer(languageId: string, state: LSPServerState): Promise<void> {
    const initParams = {
      processId: process.pid,
      rootUri: this.projectRoot ? `file://${this.projectRoot}` : null,
      rootPath: this.projectRoot,
      capabilities: {
        textDocument: {
          synchronization: {
            willSave: true,
            willSaveWaitUntil: true,
            didSave: true,
          },
          completion: {
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              deprecatedSupport: true,
              preselectSupport: true,
              insertReplaceSupport: true,
              resolveSupport: {
                properties: ['documentation', 'detail', 'additionalTextEdits'],
              },
            },
            contextSupport: true,
          },
          hover: {
            contentFormat: ['markdown', 'plaintext'],
          },
          signatureHelp: {
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext'],
              parameterInformation: {
                labelOffsetSupport: true,
              },
            },
            contextSupport: true,
          },
          definition: {
            linkSupport: true,
          },
          references: {},
          documentHighlight: {},
          documentSymbol: {
            hierarchicalDocumentSymbolSupport: true,
          },
          codeAction: {
            codeActionLiteralSupport: {
              codeActionKind: {
                valueSet: [
                  'quickfix',
                  'refactor',
                  'refactor.extract',
                  'refactor.inline',
                  'refactor.rewrite',
                  'source',
                  'source.organizeImports',
                ],
              },
            },
            isPreferredSupport: true,
            resolveSupport: {
              properties: ['edit'],
            },
          },
          rename: {
            prepareSupport: true,
          },
          publishDiagnostics: {
            relatedInformation: true,
            tagSupport: {
              valueSet: [1, 2],
            },
          },
          inlayHint: {
            resolveSupport: {
              properties: ['tooltip', 'textEdits', 'label.tooltip', 'label.command'],
            },
          },
        },
        workspace: {
          workspaceFolders: true,
          didChangeConfiguration: {
            dynamicRegistration: true,
          },
          symbol: {
            symbolKind: {
              valueSet: Array.from({ length: 26 }, (_, i) => i + 1),
            },
          },
          executeCommand: {
            dynamicRegistration: true,
          },
        },
      },
      initializationOptions: state.config.initializationOptions,
    }

    const result = await this.sendRequest(languageId, 'initialize', initParams) as {
      capabilities?: ServerCapabilities
    }

    // 保存服务器能力
    state.capabilities = result?.capabilities

    // 发送 initialized 通知
    this.sendNotification(languageId, 'initialized', {})
  }

  /**
   * 查找命令路径
   */
  private async findCommand(command: string): Promise<string | null> {
    // 首先检查是否是绝对路径
    if (path.isAbsolute(command) && fs.existsSync(command)) {
      return command
    }

    // 检查 node_modules/.bin
    const localBin = path.join(process.cwd(), 'node_modules', '.bin', command)
    if (fs.existsSync(localBin)) {
      return localBin
    }

    // 检查 PATH
    const pathDirs = (process.env.PATH || '').split(path.delimiter)
    for (const dir of pathDirs) {
      const fullPath = path.join(dir, command)
      if (fs.existsSync(fullPath)) {
        return fullPath
      }
      // Windows: 检查 .exe, .cmd, .bat
      if (os.platform() === 'win32') {
        for (const ext of ['.exe', '.cmd', '.bat']) {
          const extPath = fullPath + ext
          if (fs.existsSync(extPath)) {
            return extPath
          }
        }
      }
    }

    return null
  }

  /**
   * 通知状态变化
   */
  private notifyStatusChange(languageId: string, status: string, message?: string): void {
    this.mainWindow?.webContents.send('lsp:status', {
      languageId,
      status,
      message,
    })
  }
}

// 单例实例
let instance: LSPServerManager | null = null

export function getLSPServerManager(): LSPServerManager {
  if (!instance) {
    instance = new LSPServerManager()
  }
  return instance
}

/**
 * 注册 LSP 相关的 IPC 处理器
 */
export function registerLSPHandlers(mainWindow: BrowserWindow | null): void {
  const manager = getLSPServerManager()
  if (mainWindow) {
    manager.setMainWindow(mainWindow)
  }

  // 启动服务器
  ipcMain.handle('lsp:start', async (_, languageId: string) => {
    return manager.startServer(languageId)
  })

  // 停止服务器
  ipcMain.handle('lsp:stop', async (_, languageId: string) => {
    await manager.stopServer(languageId)
  })

  // 停止所有服务器
  ipcMain.handle('lsp:stopAll', async () => {
    await manager.stopAll()
  })

  // 获取服务器状态
  ipcMain.handle('lsp:getStatus', (_, languageId: string) => {
    return manager.getServerStatus(languageId)
  })

  // 设置项目根目录
  ipcMain.handle('lsp:setProjectRoot', (_, rootPath: string) => {
    manager.setProjectRoot(rootPath)
  })

  // 发送请求
  ipcMain.handle('lsp:request', async (_, languageId: string, method: string, params: unknown) => {
    return manager.sendRequest(languageId, method, params)
  })

  // 发送通知
  ipcMain.handle('lsp:notify', (_, languageId: string, method: string, params: unknown) => {
    manager.sendNotification(languageId, method, params)
  })

  // 获取文件的语言 ID
  ipcMain.handle('lsp:getLanguageId', (_, filePath: string) => {
    return manager.getLanguageIdForFile(filePath)
  })
}
