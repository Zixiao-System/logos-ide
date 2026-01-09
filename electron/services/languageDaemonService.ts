/**
 * 语言守护进程服务
 * 在 Electron 主进程中通过 stdio + JSON-RPC 与 Rust 守护进程通信
 */

import { spawn, ChildProcess } from 'child_process'
import { EventEmitter } from 'events'
import { BrowserWindow, app } from 'electron'
import * as path from 'path'
import * as os from 'os'

/** JSON-RPC 请求 */
interface JsonRpcRequest {
  jsonrpc: '2.0'
  id: number
  method: string
  params?: unknown
}

/** JSON-RPC 通知 */
interface JsonRpcNotification {
  jsonrpc: '2.0'
  method: string
  params?: unknown
}

/** 待处理请求 */
interface PendingRequest {
  resolve: (value: unknown) => void
  reject: (error: Error) => void
  timeout: NodeJS.Timeout
}

/** 语言守护进程服务类 */
export class LanguageDaemonService extends EventEmitter {
  private process: ChildProcess | null = null
  private nextRequestId = 1
  private pendingRequests: Map<number, PendingRequest> = new Map()
  private buffer = ''
  private expectedLength = 0
  private restartAttempts = 0
  private maxRestartAttempts = 5
  private getMainWindow: () => BrowserWindow | null
  private isShuttingDown = false
  private openDocuments: Map<string, { content: string; languageId: string; version: number }> = new Map()

  constructor(getMainWindow: () => BrowserWindow | null) {
    super()
    this.getMainWindow = getMainWindow
  }

  /** 启动守护进程 */
  async start(): Promise<void> {
    if (this.process) {
      console.log('[logos-daemon] Already running')
      return
    }

    this.isShuttingDown = false
    const binaryPath = this.getDaemonPath()

    console.log('[logos-daemon] Starting daemon:', binaryPath)

    try {
      this.process = spawn(binaryPath, [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        env: { ...process.env, RUST_LOG: 'info' }
      })

      this.process.stdout?.on('data', (data: Buffer) => this.handleData(data))
      this.process.stderr?.on('data', (data: Buffer) => {
        console.error('[logos-daemon stderr]', data.toString())
      })
      this.process.on('exit', (code: number | null) => this.handleExit(code))
      this.process.on('error', (error: Error) => this.handleError(error))

      // 发送 initialize 请求
      const initResult = await this.sendRequest('initialize', {
        processId: process.pid,
        rootPath: null,
        capabilities: {}
      })

      console.log('[logos-daemon] Initialized:', initResult)

      // 发送 initialized 通知
      this.sendNotification('initialized', {})

      this.restartAttempts = 0
      this.emit('started')

      // 恢复已打开的文档
      await this.restoreDocuments()

    } catch (error) {
      console.error('[logos-daemon] Failed to start:', error)
      throw error
    }
  }

  /** 获取守护进程二进制路径 */
  private getDaemonPath(): string {
    const platform = os.platform()
    const ext = platform === 'win32' ? '.exe' : ''
    const binaryName = `logos-daemon${ext}`

    if (app.isPackaged) {
      // 生产环境: 从 resources 目录加载
      return path.join(process.resourcesPath, 'bin', binaryName)
    } else {
      // 开发环境: 从 target 目录加载
      // __dirname 在构建后指向 dist-electron/，所以需要回到项目根目录
      return path.join(__dirname, '../logos-lang/target/release', binaryName)
    }
  }

  /** 处理从守护进程接收的数据 */
  private handleData(data: Buffer): void {
    this.buffer += data.toString()

    while (true) {
      if (this.expectedLength === 0) {
        const headerEnd = this.buffer.indexOf('\r\n\r\n')
        if (headerEnd === -1) return

        const header = this.buffer.slice(0, headerEnd)
        const match = header.match(/Content-Length: (\d+)/)
        if (!match) {
          this.buffer = this.buffer.slice(headerEnd + 4)
          continue
        }

        this.expectedLength = parseInt(match[1], 10)
        this.buffer = this.buffer.slice(headerEnd + 4)
      }

      if (this.buffer.length < this.expectedLength) return

      const message = this.buffer.slice(0, this.expectedLength)
      this.buffer = this.buffer.slice(this.expectedLength)
      this.expectedLength = 0

      this.handleMessage(message)
    }
  }

  /** 处理 JSON-RPC 消息 */
  private handleMessage(message: string): void {
    try {
      const json = JSON.parse(message)

      if ('id' in json && json.id !== null && json.id !== undefined) {
        // 响应
        const pending = this.pendingRequests.get(json.id)
        if (pending) {
          clearTimeout(pending.timeout)
          this.pendingRequests.delete(json.id)
          if (json.error) {
            pending.reject(new Error(json.error.message))
          } else {
            pending.resolve(json.result)
          }
        }
      } else if ('method' in json) {
        // 通知
        this.handleNotification(json as JsonRpcNotification)
      }
    } catch (error) {
      console.error('[logos-daemon] Failed to parse message:', error)
    }
  }

  /** 处理来自守护进程的通知 */
  private handleNotification(notification: JsonRpcNotification): void {
    const mainWindow = this.getMainWindow()

    switch (notification.method) {
      case 'textDocument/publishDiagnostics':
        if (mainWindow) {
          mainWindow.webContents.send('daemon:diagnostics', notification.params)
        }
        this.emit('diagnostics', notification.params)
        break
      case 'window/logMessage':
        console.log('[logos-daemon log]', notification.params)
        break
      default:
        console.log('[logos-daemon notification]', notification.method, notification.params)
    }
  }

  /** 处理进程退出 */
  private handleExit(code: number | null): void {
    console.log(`[logos-daemon] Process exited with code ${code}`)
    this.process = null

    // 拒绝所有待处理请求
    for (const [id, pending] of this.pendingRequests) {
      clearTimeout(pending.timeout)
      pending.reject(new Error('Daemon process exited'))
      this.pendingRequests.delete(id)
    }

    // 如果不是正在关闭，尝试重启
    if (!this.isShuttingDown && this.restartAttempts < this.maxRestartAttempts) {
      const delay = Math.min(1000 * Math.pow(2, this.restartAttempts), 30000)
      this.restartAttempts++
      console.log(`[logos-daemon] Restarting in ${delay}ms (attempt ${this.restartAttempts})`)
      setTimeout(() => this.start().catch(console.error), delay)
    } else if (!this.isShuttingDown) {
      this.emit('failed')
    }
  }

  /** 处理进程错误 */
  private handleError(error: Error): void {
    console.error('[logos-daemon] Process error:', error)
    this.emit('error', error)
  }

  /** 发送 JSON-RPC 请求 */
  async sendRequest(method: string, params?: unknown, timeoutMs = 30000): Promise<unknown> {
    if (!this.process?.stdin) {
      throw new Error('Daemon not started')
    }

    const id = this.nextRequestId++
    const request: JsonRpcRequest = {
      jsonrpc: '2.0',
      id,
      method,
      params
    }

    const body = JSON.stringify(request)
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`

    return new Promise((resolve, reject) => {
      const timeout = setTimeout(() => {
        this.pendingRequests.delete(id)
        reject(new Error(`Request timeout: ${method}`))
      }, timeoutMs)

      this.pendingRequests.set(id, { resolve, reject, timeout })
      this.process?.stdin?.write(message)
    })
  }

  /** 发送 JSON-RPC 通知 */
  sendNotification(method: string, params?: unknown): void {
    if (!this.process?.stdin) return

    const notification: JsonRpcNotification = {
      jsonrpc: '2.0',
      method,
      params
    }

    const body = JSON.stringify(notification)
    const message = `Content-Length: ${Buffer.byteLength(body)}\r\n\r\n${body}`
    this.process.stdin.write(message)
  }

  /** 停止守护进程 */
  async stop(): Promise<void> {
    if (!this.process) return

    this.isShuttingDown = true

    try {
      await Promise.race([
        this.sendRequest('shutdown', null, 5000),
        new Promise((_, reject) => setTimeout(() => reject(new Error('Shutdown timeout')), 5000))
      ])
      this.sendNotification('exit', null)
    } catch {
      // 忽略错误，强制终止
    }

    // 等待一小段时间让进程正常退出
    await new Promise(resolve => setTimeout(resolve, 100))

    if (this.process) {
      this.process.kill()
      this.process = null
    }
  }

  /** 恢复已打开的文档 */
  private async restoreDocuments(): Promise<void> {
    for (const [uri, doc] of this.openDocuments) {
      try {
        await this.sendRequest('textDocument/didOpen', {
          textDocument: {
            uri,
            languageId: doc.languageId,
            version: doc.version,
            text: doc.content
          }
        })
      } catch (error) {
        console.error(`[logos-daemon] Failed to restore document ${uri}:`, error)
      }
    }
  }

  /** 检查守护进程是否运行中 */
  isRunning(): boolean {
    return this.process !== null
  }

  // ==================== 语言服务 API ====================

  /** 打开文档 */
  async openDocument(uri: string, content: string, languageId: string): Promise<void> {
    const version = 1
    this.openDocuments.set(uri, { content, languageId, version })

    if (!this.isRunning()) {
      await this.start()
    }

    this.sendNotification('textDocument/didOpen', {
      textDocument: { uri, languageId, version, text: content }
    })
  }

  /** 更新文档 */
  updateDocument(uri: string, content: string): void {
    const doc = this.openDocuments.get(uri)
    if (doc) {
      doc.content = content
      doc.version++
    }

    if (!this.isRunning()) return

    this.sendNotification('textDocument/didChange', {
      textDocument: { uri, version: doc?.version ?? 1 },
      contentChanges: [{ text: content }]
    })
  }

  /** 关闭文档 */
  closeDocument(uri: string): void {
    this.openDocuments.delete(uri)

    if (!this.isRunning()) return

    this.sendNotification('textDocument/didClose', {
      textDocument: { uri }
    })
  }

  /** 获取代码补全 */
  async getCompletions(uri: string, line: number, column: number): Promise<unknown> {
    if (!this.isRunning()) return { isIncomplete: false, items: [] }

    return this.sendRequest('textDocument/completion', {
      textDocument: { uri },
      position: { line, character: column }
    })
  }

  /** 获取定义位置 */
  async getDefinition(uri: string, line: number, column: number): Promise<unknown> {
    if (!this.isRunning()) return null

    return this.sendRequest('textDocument/definition', {
      textDocument: { uri },
      position: { line, character: column }
    })
  }

  /** 获取引用 */
  async getReferences(uri: string, line: number, column: number): Promise<unknown> {
    if (!this.isRunning()) return []

    return this.sendRequest('textDocument/references', {
      textDocument: { uri },
      position: { line, character: column }
    })
  }

  /** 获取悬停信息 */
  async getHover(uri: string, line: number, column: number): Promise<unknown> {
    if (!this.isRunning()) return null

    return this.sendRequest('textDocument/hover', {
      textDocument: { uri },
      position: { line, character: column }
    })
  }

  /** 获取文档符号 */
  async getDocumentSymbols(uri: string): Promise<unknown> {
    if (!this.isRunning()) return []

    return this.sendRequest('textDocument/documentSymbol', {
      textDocument: { uri }
    })
  }

  /** 搜索工作区符号 */
  async searchSymbols(query: string): Promise<unknown> {
    if (!this.isRunning()) return []

    return this.sendRequest('workspace/symbol', { query })
  }

  /** 准备重命名 */
  async prepareRename(uri: string, line: number, column: number): Promise<unknown> {
    if (!this.isRunning()) return null

    return this.sendRequest('textDocument/prepareRename', {
      textDocument: { uri },
      position: { line, character: column }
    })
  }

  /** 重命名符号 */
  async rename(uri: string, line: number, column: number, newName: string): Promise<unknown> {
    if (!this.isRunning()) return null

    return this.sendRequest('textDocument/rename', {
      textDocument: { uri },
      position: { line, character: column },
      newName
    })
  }

  /** 获取诊断 */
  async getDiagnostics(uri: string): Promise<unknown> {
    if (!this.isRunning()) return { kind: 'full', items: [] }

    return this.sendRequest('textDocument/diagnostic', {
      textDocument: { uri }
    })
  }

  // ==================== 重构 API ====================

  /** 获取重构动作 */
  async getRefactorActions(
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ): Promise<unknown> {
    if (!this.isRunning()) return []

    return this.sendRequest('logos/getRefactorActions', {
      textDocument: { uri },
      range: {
        start: { line: startLine, character: startCol },
        end: { line: endLine, character: endCol }
      }
    })
  }

  /** 提取为变量 */
  async extractVariable(
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    variableName: string
  ): Promise<unknown> {
    if (!this.isRunning()) return { success: false, error: 'Daemon not running' }

    return this.sendRequest('logos/extractVariable', {
      textDocument: { uri },
      range: {
        start: { line: startLine, character: startCol },
        end: { line: endLine, character: endCol }
      },
      variableName
    })
  }

  /** 提取为方法 */
  async extractMethod(
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    methodName: string
  ): Promise<unknown> {
    if (!this.isRunning()) return { success: false, error: 'Daemon not running' }

    return this.sendRequest('logos/extractMethod', {
      textDocument: { uri },
      range: {
        start: { line: startLine, character: startCol },
        end: { line: endLine, character: endCol }
      },
      methodName
    })
  }

  /** 检查是否可以安全删除 */
  async canSafeDelete(
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ): Promise<unknown> {
    if (!this.isRunning()) return { canDelete: false, error: 'Daemon not running' }

    return this.sendRequest('logos/canSafeDelete', {
      textDocument: { uri },
      range: {
        start: { line: startLine, character: startCol },
        end: { line: endLine, character: endCol }
      }
    })
  }

  /** 安全删除 */
  async safeDelete(
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ): Promise<unknown> {
    if (!this.isRunning()) return { success: false, error: 'Daemon not running' }

    return this.sendRequest('logos/safeDelete', {
      textDocument: { uri },
      range: {
        start: { line: startLine, character: startCol },
        end: { line: endLine, character: endCol }
      }
    })
  }

  // ==================== 分析 API ====================

  /** 获取 TODO 项 */
  async getTodoItems(uri: string): Promise<unknown> {
    if (!this.isRunning()) return []

    return this.sendRequest('logos/getTodoItems', {
      textDocument: { uri }
    })
  }

  /** 获取所有 TODO 项 */
  async getAllTodoItems(): Promise<unknown> {
    if (!this.isRunning()) return []

    return this.sendRequest('logos/getAllTodoItems', {})
  }

  /** 获取 TODO 统计 */
  async getTodoStats(): Promise<unknown> {
    if (!this.isRunning()) return { total: 0, byKind: {} }

    return this.sendRequest('logos/getTodoStats', {})
  }

  /** 获取未使用的符号 */
  async getUnusedSymbols(uri: string): Promise<unknown> {
    if (!this.isRunning()) return []

    return this.sendRequest('logos/getUnusedSymbols', {
      textDocument: { uri }
    })
  }
}

// 单例实例
let daemonService: LanguageDaemonService | null = null

/** 获取语言守护进程服务实例 */
export function getLanguageDaemonService(getMainWindow: () => BrowserWindow | null): LanguageDaemonService {
  if (!daemonService) {
    daemonService = new LanguageDaemonService(getMainWindow)
  }
  return daemonService
}

/** 清理语言守护进程 */
export async function cleanupLanguageDaemon(): Promise<void> {
  if (daemonService) {
    await daemonService.stop()
    daemonService = null
  }
}
