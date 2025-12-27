/**
 * LSP 客户端
 * 管理单个语言服务器的生命周期和通信
 */

import { spawn } from 'child_process'
import * as rpc from 'vscode-jsonrpc/node'
import type { LSPServerConfig, LSPClientStatus, LSPClientInstance } from './types'
import { URI } from 'vscode-uri'

// LSP 方法名常量
const LSP_METHODS = {
  initialize: 'initialize',
  initialized: 'initialized',
  shutdown: 'shutdown',
  exit: 'exit',
  didOpen: 'textDocument/didOpen',
  didChange: 'textDocument/didChange',
  didClose: 'textDocument/didClose',
  completion: 'textDocument/completion',
  definition: 'textDocument/definition',
  references: 'textDocument/references',
  hover: 'textDocument/hover',
  rename: 'textDocument/rename',
  signatureHelp: 'textDocument/signatureHelp',
  publishDiagnostics: 'textDocument/publishDiagnostics'
}

// LSP 响应类型
interface InitializeResult {
  capabilities: Record<string, unknown>
}

interface CompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: string | { kind: string; value: string }
  insertText?: string
  insertTextFormat?: number
  sortText?: string
  filterText?: string
  preselect?: boolean
}

interface CompletionList {
  isIncomplete: boolean
  items: CompletionItem[]
}

interface Location {
  uri: string
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
}

interface Hover {
  contents: string | { kind: string; value: string } | Array<string | { language: string; value: string }>
  range?: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
}

interface WorkspaceEdit {
  changes?: Record<string, Array<{
    range: {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    newText: string
  }>>
}

interface SignatureHelp {
  signatures: Array<{
    label: string
    documentation?: string
    parameters?: Array<{ label: string | [number, number]; documentation?: string }>
    activeParameter?: number
  }>
  activeSignature?: number
  activeParameter?: number
}

interface Diagnostic {
  range: {
    start: { line: number; character: number }
    end: { line: number; character: number }
  }
  message: string
  severity?: number
  code?: string | number
  source?: string
}

interface PublishDiagnosticsParams {
  uri: string
  diagnostics: Diagnostic[]
}

type DiagnosticsHandler = (params: PublishDiagnosticsParams) => void

export class LSPClient {
  private config: LSPServerConfig
  private instance: LSPClientInstance
  private onStatusChange: ((status: LSPClientStatus, message?: string) => void) | null = null
  private onDiagnostics: DiagnosticsHandler | null = null

  constructor(config: LSPServerConfig, rootPath: string) {
    this.config = config
    this.instance = {
      languageId: config.languageId,
      process: null,
      connection: null,
      status: 'stopped',
      rootPath,
      openDocuments: new Set(),
      documentVersions: new Map()
    }
  }

  // ============ 生命周期管理 ============

  async start(): Promise<void> {
    if (this.instance.status === 'ready' || this.instance.status === 'starting') {
      return
    }

    this.setStatus('starting')

    try {
      // 启动子进程
      const childProcess = spawn(this.config.command, this.config.args, {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.instance.rootPath,
        env: {
          ...process.env,
          ...this.config.env
        }
      })

      this.instance.process = childProcess

      // 监听进程退出
      childProcess.on('exit', (code, signal) => {
        console.log(`[${this.config.languageId}] LSP process exited: code=${code}, signal=${signal}`)
        this.setStatus('stopped')
        this.cleanup()
      })

      childProcess.on('error', (err) => {
        console.error(`[${this.config.languageId}] LSP process error:`, err)
        this.setStatus('error', err.message)
      })

      // 监听 stderr 输出
      childProcess.stderr?.on('data', (data: Buffer) => {
        console.log(`[${this.config.languageId}] LSP stderr:`, data.toString())
      })

      // 创建 JSON-RPC 连接
      const connection = rpc.createMessageConnection(
        new rpc.StreamMessageReader(childProcess.stdout!),
        new rpc.StreamMessageWriter(childProcess.stdin!)
      )

      this.instance.connection = connection

      // 监听连接错误
      connection.onError((error) => {
        console.error(`[${this.config.languageId}] LSP connection error:`, error)
        if (Array.isArray(error) && error[0]) {
          this.setStatus('error', error[0].message)
        }
      })

      connection.onClose(() => {
        console.log(`[${this.config.languageId}] LSP connection closed`)
        this.setStatus('stopped')
      })

      // 监听诊断通知
      connection.onNotification(LSP_METHODS.publishDiagnostics, (params: PublishDiagnosticsParams) => {
        if (this.onDiagnostics) {
          this.onDiagnostics(params)
        }
      })

      // 启动连接
      connection.listen()

      // 初始化握手
      await this.initialize()

      this.setStatus('ready')
    } catch (error) {
      const message = error instanceof Error ? error.message : String(error)
      console.error(`[${this.config.languageId}] Failed to start LSP:`, message)
      this.setStatus('error', message)
      this.cleanup()
      throw error
    }
  }

  async stop(): Promise<void> {
    if (this.instance.status === 'stopped') {
      return
    }

    try {
      if (this.instance.connection) {
        // 发送 shutdown 请求
        await this.instance.connection.sendRequest(LSP_METHODS.shutdown)
        // 发送 exit 通知
        this.instance.connection.sendNotification(LSP_METHODS.exit)
      }
    } catch (error) {
      console.error(`[${this.config.languageId}] Error during shutdown:`, error)
    } finally {
      this.cleanup()
      this.setStatus('stopped')
    }
  }

  private cleanup(): void {
    if (this.instance.connection) {
      this.instance.connection.dispose()
      this.instance.connection = null
    }
    if (this.instance.process) {
      this.instance.process.kill()
      this.instance.process = null
    }
    this.instance.openDocuments.clear()
    this.instance.documentVersions.clear()
  }

  private async initialize(): Promise<InitializeResult> {
    if (!this.instance.connection) {
      throw new Error('Connection not established')
    }

    const initParams = {
      processId: process.pid,
      rootUri: URI.file(this.instance.rootPath).toString(),
      rootPath: this.instance.rootPath,
      capabilities: {
        textDocument: {
          synchronization: {
            dynamicRegistration: false,
            willSave: false,
            willSaveWaitUntil: false,
            didSave: true
          },
          completion: {
            dynamicRegistration: false,
            completionItem: {
              snippetSupport: true,
              commitCharactersSupport: true,
              documentationFormat: ['markdown', 'plaintext'],
              deprecatedSupport: true,
              preselectSupport: true
            },
            contextSupport: true
          },
          hover: {
            dynamicRegistration: false,
            contentFormat: ['markdown', 'plaintext']
          },
          signatureHelp: {
            dynamicRegistration: false,
            signatureInformation: {
              documentationFormat: ['markdown', 'plaintext']
            }
          },
          definition: { dynamicRegistration: false },
          references: { dynamicRegistration: false },
          rename: { dynamicRegistration: false, prepareSupport: true },
          publishDiagnostics: { relatedInformation: true }
        },
        workspace: { workspaceFolders: true }
      },
      initializationOptions: this.config.initializationOptions,
      workspaceFolders: [
        {
          uri: URI.file(this.instance.rootPath).toString(),
          name: this.instance.rootPath.split('/').pop() || 'workspace'
        }
      ]
    }

    const result = await this.instance.connection.sendRequest(LSP_METHODS.initialize, initParams) as InitializeResult

    // 发送 initialized 通知
    this.instance.connection.sendNotification(LSP_METHODS.initialized, {})

    return result
  }

  // ============ 文档同步 ============

  didOpen(filePath: string, content: string): void {
    if (!this.instance.connection || this.instance.status !== 'ready') return

    const uri = URI.file(filePath).toString()
    if (this.instance.openDocuments.has(uri)) return

    this.instance.openDocuments.add(uri)
    this.instance.documentVersions.set(uri, 1)

    this.instance.connection.sendNotification(LSP_METHODS.didOpen, {
      textDocument: {
        uri,
        languageId: this.config.languageId,
        version: 1,
        text: content
      }
    })
  }

  didChange(filePath: string, content: string): void {
    if (!this.instance.connection || this.instance.status !== 'ready') return

    const uri = URI.file(filePath).toString()
    const currentVersion = this.instance.documentVersions.get(uri) || 0
    const newVersion = currentVersion + 1
    this.instance.documentVersions.set(uri, newVersion)

    // 如果文档未打开，先打开
    if (!this.instance.openDocuments.has(uri)) {
      this.didOpen(filePath, content)
      return
    }

    this.instance.connection.sendNotification(LSP_METHODS.didChange, {
      textDocument: { uri, version: newVersion },
      contentChanges: [{ text: content }] // 全量更新
    })
  }

  didClose(filePath: string): void {
    if (!this.instance.connection || this.instance.status !== 'ready') return

    const uri = URI.file(filePath).toString()
    if (!this.instance.openDocuments.has(uri)) return

    this.instance.openDocuments.delete(uri)
    this.instance.documentVersions.delete(uri)

    this.instance.connection.sendNotification(LSP_METHODS.didClose, {
      textDocument: { uri }
    })
  }

  // ============ LSP 请求 ============

  async completion(filePath: string, line: number, character: number): Promise<CompletionList | CompletionItem[] | null> {
    if (!this.instance.connection || this.instance.status !== 'ready') return null

    const params = {
      textDocument: { uri: URI.file(filePath).toString() },
      position: { line, character }
    }

    try {
      return await this.instance.connection.sendRequest(LSP_METHODS.completion, params) as CompletionList | CompletionItem[] | null
    } catch (error) {
      console.error(`[${this.config.languageId}] Completion error:`, error)
      return null
    }
  }

  async definition(filePath: string, line: number, character: number): Promise<Location | Location[] | null> {
    if (!this.instance.connection || this.instance.status !== 'ready') return null

    const params = {
      textDocument: { uri: URI.file(filePath).toString() },
      position: { line, character }
    }

    try {
      return await this.instance.connection.sendRequest(LSP_METHODS.definition, params) as Location | Location[] | null
    } catch (error) {
      console.error(`[${this.config.languageId}] Definition error:`, error)
      return null
    }
  }

  async references(filePath: string, line: number, character: number, includeDeclaration = true): Promise<Location[] | null> {
    if (!this.instance.connection || this.instance.status !== 'ready') return null

    const params = {
      textDocument: { uri: URI.file(filePath).toString() },
      position: { line, character },
      context: { includeDeclaration }
    }

    try {
      return await this.instance.connection.sendRequest(LSP_METHODS.references, params) as Location[] | null
    } catch (error) {
      console.error(`[${this.config.languageId}] References error:`, error)
      return null
    }
  }

  async hover(filePath: string, line: number, character: number): Promise<Hover | null> {
    if (!this.instance.connection || this.instance.status !== 'ready') return null

    const params = {
      textDocument: { uri: URI.file(filePath).toString() },
      position: { line, character }
    }

    try {
      return await this.instance.connection.sendRequest(LSP_METHODS.hover, params) as Hover | null
    } catch (error) {
      console.error(`[${this.config.languageId}] Hover error:`, error)
      return null
    }
  }

  async rename(filePath: string, line: number, character: number, newName: string): Promise<WorkspaceEdit | null> {
    if (!this.instance.connection || this.instance.status !== 'ready') return null

    const params = {
      textDocument: { uri: URI.file(filePath).toString() },
      position: { line, character },
      newName
    }

    try {
      return await this.instance.connection.sendRequest(LSP_METHODS.rename, params) as WorkspaceEdit | null
    } catch (error) {
      console.error(`[${this.config.languageId}] Rename error:`, error)
      return null
    }
  }

  async signatureHelp(filePath: string, line: number, character: number): Promise<SignatureHelp | null> {
    if (!this.instance.connection || this.instance.status !== 'ready') return null

    const params = {
      textDocument: { uri: URI.file(filePath).toString() },
      position: { line, character }
    }

    try {
      return await this.instance.connection.sendRequest(LSP_METHODS.signatureHelp, params) as SignatureHelp | null
    } catch (error) {
      console.error(`[${this.config.languageId}] SignatureHelp error:`, error)
      return null
    }
  }

  // ============ 事件处理 ============

  setOnStatusChange(handler: (status: LSPClientStatus, message?: string) => void): void {
    this.onStatusChange = handler
  }

  setOnDiagnostics(handler: DiagnosticsHandler): void {
    this.onDiagnostics = handler
  }

  private setStatus(status: LSPClientStatus, message?: string): void {
    this.instance.status = status
    this.instance.errorMessage = message
    if (this.onStatusChange) {
      this.onStatusChange(status, message)
    }
  }

  // ============ 状态获取 ============

  getStatus(): LSPClientStatus {
    return this.instance.status
  }

  getLanguageId(): string {
    return this.config.languageId
  }

  isReady(): boolean {
    return this.instance.status === 'ready'
  }
}

// ============ 辅助函数 ============

/**
 * 提取 Hover 内容为字符串
 */
export function extractHoverContent(hover: {
  contents: string | { kind: string; value: string } | Array<string | { language: string; value: string }>
} | null): string | null {
  if (!hover) return null

  const contents = hover.contents

  if (typeof contents === 'string') {
    return contents
  }

  if (Array.isArray(contents)) {
    return contents.map(c => {
      if (typeof c === 'string') return c
      if ('value' in c) return c.value
      return ''
    }).join('\n\n')
  }

  if ('value' in contents) {
    return contents.value
  }

  return null
}
