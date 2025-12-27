/**
 * LSP 客户端管理器
 * 管理多个语言服务器的生命周期
 */

import { BrowserWindow } from 'electron'
import * as path from 'path'
import * as fs from 'fs'
import { LSPClient, extractHoverContent } from './LSPClient'
import { getLSPServerConfig } from './configs'
import {
  LANGUAGE_MAP,
  EXTENSION_TO_LANGUAGE,
  type LSPServerStatusEvent,
  type LanguageTier
} from './types'
import { URI } from 'vscode-uri'

// 导入本地类型
interface Position {
  line: number
  column: number
}

interface Range {
  start: Position
  end: Position
}

interface CompletionItem {
  label: string
  kind: number
  detail?: string
  documentation?: string | { value: string; isTrusted?: boolean }
  insertText: string
  insertTextRules?: number
  sortText?: string
  filterText?: string
  preselect?: boolean
}

interface CompletionResult {
  suggestions: CompletionItem[]
  incomplete?: boolean
}

// LSP 返回的补全列表类型
interface LSPCompletionList {
  isIncomplete: boolean
  items: Array<{
    label: string
    kind?: number
    detail?: string
    documentation?: string | { kind: string; value: string }
    insertText?: string
    insertTextFormat?: number
    sortText?: string
    filterText?: string
    preselect?: boolean
  }>
}

interface DefinitionLocation {
  uri: string
  range: Range
}

interface ReferenceLocation {
  uri: string
  range: Range
  isDefinition?: boolean
}

interface HoverInfo {
  contents: Array<{ value: string; language?: string }>
  range?: Range
}

interface Diagnostic {
  range: Range
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
  code?: string | number
  source?: string
}

interface PublishDiagnosticsParams {
  uri: string
  diagnostics: Array<{
    range: {
      start: { line: number; character: number }
      end: { line: number; character: number }
    }
    message: string
    severity?: number
    code?: string | number
    source?: string
  }>
}

export class LSPClientManager {
  private clients: Map<string, LSPClient> = new Map()
  private mainWindow: (() => BrowserWindow | null) | null = null
  private diagnosticsCache: Map<string, Diagnostic[]> = new Map()

  setMainWindow(getMainWindow: () => BrowserWindow | null): void {
    this.mainWindow = getMainWindow
  }

  // ============ 项目管理 ============

  async openProject(rootPath: string): Promise<void> {

    // 扫描项目，确定需要启动哪些 LSP
    const languagesNeeded = await this.detectProjectLanguages(rootPath)

    // 启动需要的 LSP 服务器
    for (const languageId of languagesNeeded) {
      const info = LANGUAGE_MAP[languageId]
      if (info?.tier === 'lsp' && info.lspServerId) {
        await this.startServer(info.lspServerId, rootPath)
      }
    }
  }

  async closeProject(): Promise<void> {
    await this.stopAllServers()
    this.diagnosticsCache.clear()
  }

  private async detectProjectLanguages(rootPath: string): Promise<Set<string>> {
    const languages = new Set<string>()
    const ignoreDirs = ['node_modules', '.git', 'dist', 'build', 'target', '__pycache__', '.venv', 'venv']

    const scan = (dir: string, depth = 0) => {
      if (depth > 3) return // 限制扫描深度

      try {
        const entries = fs.readdirSync(dir, { withFileTypes: true })
        for (const entry of entries) {
          if (entry.isDirectory()) {
            if (!ignoreDirs.includes(entry.name) && !entry.name.startsWith('.')) {
              scan(path.join(dir, entry.name), depth + 1)
            }
          } else if (entry.isFile()) {
            const ext = path.extname(entry.name)
            const langId = EXTENSION_TO_LANGUAGE[ext]
            if (langId) {
              languages.add(langId)
            }
          }
        }
      } catch {
        // 忽略读取错误
      }
    }

    scan(rootPath)
    return languages
  }

  // ============ 服务器管理 ============

  async startServer(serverId: string, rootPath: string): Promise<void> {
    if (this.clients.has(serverId)) {
      return
    }

    const config = getLSPServerConfig(serverId, rootPath)
    if (!config) {
      console.warn(`[LSPClientManager] Unknown server: ${serverId}`)
      return
    }

    // 检查二进制文件是否存在
    if (!fs.existsSync(config.command)) {
      console.warn(`[LSPClientManager] Binary not found: ${config.command}`)
      this.notifyStatus({
        languageId: config.languageId,
        status: 'error',
        message: `LSP server not found: ${config.command}`
      })
      return
    }

    const client = new LSPClient(config, rootPath)

    // 设置状态变化回调
    client.setOnStatusChange((status, message) => {
      this.notifyStatus({
        languageId: config.languageId,
        status,
        message
      })
    })

    // 设置诊断回调
    client.setOnDiagnostics((params) => {
      this.handleDiagnostics(params)
    })

    this.clients.set(serverId, client)

    try {
      await client.start()
      console.log(`[LSPClientManager] Started ${serverId}`)
    } catch (error) {
      console.error(`[LSPClientManager] Failed to start ${serverId}:`, error)
      this.clients.delete(serverId)
    }
  }

  async stopServer(serverId: string): Promise<void> {
    const client = this.clients.get(serverId)
    if (client) {
      await client.stop()
      this.clients.delete(serverId)
    }
  }

  async stopAllServers(): Promise<void> {
    const stopPromises = Array.from(this.clients.values()).map(client => client.stop())
    await Promise.all(stopPromises)
    this.clients.clear()
  }

  // ============ 文档同步 ============

  syncFile(filePath: string, content: string): void {
    const client = this.getClientForFile(filePath)
    if (client) {
      client.didChange(filePath, content)
    }
  }

  openFile(filePath: string, content: string): void {
    const client = this.getClientForFile(filePath)
    if (client) {
      client.didOpen(filePath, content)
    }
  }

  closeFile(filePath: string): void {
    const client = this.getClientForFile(filePath)
    if (client) {
      client.didClose(filePath)
    }
  }

  // ============ LSP 功能 ============

  async getCompletions(filePath: string, position: Position): Promise<CompletionResult> {
    const client = this.getClientForFile(filePath)
    if (!client) {
      return { suggestions: [] }
    }

    const result = await client.completion(filePath, position.line - 1, position.column - 1)
    if (!result) {
      return { suggestions: [] }
    }

    const items = Array.isArray(result) ? result : (result as LSPCompletionList).items
    const isIncomplete = !Array.isArray(result) && (result as LSPCompletionList).isIncomplete

    const suggestions: CompletionItem[] = items.map((item: LSPCompletionList['items'][0]) => ({
      label: item.label,
      kind: item.kind || 1,
      detail: item.detail,
      documentation: item.documentation
        ? typeof item.documentation === 'string'
          ? item.documentation
          : { value: (item.documentation as { value: string }).value, isTrusted: true }
        : undefined,
      insertText: item.insertText || item.label,
      insertTextRules: item.insertTextFormat === 2 ? 4 : 0, // Snippet = 2 -> InsertAsSnippet = 4
      sortText: item.sortText,
      filterText: item.filterText,
      preselect: item.preselect
    }))

    return {
      suggestions,
      incomplete: isIncomplete
    }
  }

  async getDefinitions(filePath: string, position: Position): Promise<DefinitionLocation[]> {
    const client = this.getClientForFile(filePath)
    if (!client) {
      return []
    }

    const result = await client.definition(filePath, position.line - 1, position.column - 1)
    if (!result) {
      return []
    }

    const locations = Array.isArray(result) ? result : [result]
    return locations.map(loc => ({
      uri: URI.parse(loc.uri).fsPath,
      range: this.convertRange(loc.range)
    }))
  }

  async getReferences(filePath: string, position: Position, includeDeclaration = true): Promise<ReferenceLocation[]> {
    const client = this.getClientForFile(filePath)
    if (!client) {
      return []
    }

    const result = await client.references(filePath, position.line - 1, position.column - 1, includeDeclaration)
    if (!result) {
      return []
    }

    return result.map(loc => ({
      uri: URI.parse(loc.uri).fsPath,
      range: this.convertRange(loc.range)
    }))
  }

  async getHover(filePath: string, position: Position): Promise<HoverInfo | null> {
    const client = this.getClientForFile(filePath)
    if (!client) {
      return null
    }

    const result = await client.hover(filePath, position.line - 1, position.column - 1)
    const content = extractHoverContent(result)
    if (!content) {
      return null
    }

    return {
      contents: [{ value: content, language: this.detectLanguage(filePath) }],
      range: result?.range ? this.convertRange(result.range) : undefined
    }
  }

  async rename(filePath: string, position: Position, newName: string): Promise<{ changes: Record<string, Array<{ range: Range; newText: string }>> } | null> {
    const client = this.getClientForFile(filePath)
    if (!client) {
      return null
    }

    const result = await client.rename(filePath, position.line - 1, position.column - 1, newName)
    if (!result?.changes) {
      return null
    }

    const changes: Record<string, Array<{ range: Range; newText: string }>> = {}
    for (const [uri, edits] of Object.entries(result.changes)) {
      const fsPath = URI.parse(uri).fsPath
      changes[fsPath] = edits.map(edit => ({
        range: this.convertRange(edit.range),
        newText: edit.newText
      }))
    }

    return { changes }
  }

  getDiagnostics(filePath: string): Diagnostic[] {
    return this.diagnosticsCache.get(filePath) || []
  }

  // ============ 辅助方法 ============

  private getClientForFile(filePath: string): LSPClient | null {
    const languageId = this.detectLanguage(filePath)
    const info = LANGUAGE_MAP[languageId]

    if (!info || info.tier !== 'lsp' || !info.lspServerId) {
      return null
    }

    return this.clients.get(info.lspServerId) || null
  }

  detectLanguage(filePath: string): string {
    const ext = path.extname(filePath)
    return EXTENSION_TO_LANGUAGE[ext] || 'plaintext'
  }

  getLanguageTier(filePath: string): LanguageTier {
    const languageId = this.detectLanguage(filePath)
    return LANGUAGE_MAP[languageId]?.tier || 'basic'
  }

  private convertRange(range: { start: { line: number; character: number }; end: { line: number; character: number } }): Range {
    return {
      start: { line: range.start.line + 1, column: range.start.character + 1 },
      end: { line: range.end.line + 1, column: range.end.character + 1 }
    }
  }

  private handleDiagnostics(params: PublishDiagnosticsParams): void {
    const filePath = URI.parse(params.uri).fsPath

    const diagnostics: Diagnostic[] = params.diagnostics.map(diag => ({
      range: this.convertRange(diag.range),
      message: diag.message,
      severity: this.convertSeverity(diag.severity || 1),
      code: diag.code ? String(diag.code) : undefined,
      source: diag.source
    }))

    this.diagnosticsCache.set(filePath, diagnostics)

    // 通知前端
    this.notifyDiagnostics(filePath, diagnostics)
  }

  private convertSeverity(severity: number): 'error' | 'warning' | 'info' | 'hint' {
    switch (severity) {
      case 1: return 'error'
      case 2: return 'warning'
      case 3: return 'info'
      case 4: return 'hint'
      default: return 'info'
    }
  }

  private notifyStatus(event: LSPServerStatusEvent): void {
    if (this.mainWindow) {
      const win = this.mainWindow()
      if (win) {
        win.webContents.send('lsp:serverStatus', event)
      }
    }
  }

  private notifyDiagnostics(filePath: string, diagnostics: Diagnostic[]): void {
    if (this.mainWindow) {
      const win = this.mainWindow()
      if (win) {
        win.webContents.send('lsp:diagnostics', { filePath, diagnostics })
      }
    }
  }

  // ============ 状态获取 ============

  getServerStatuses(): LSPServerStatusEvent[] {
    const statuses: LSPServerStatusEvent[] = []

    for (const [_serverId, client] of this.clients) {
      statuses.push({
        languageId: client.getLanguageId(),
        status: client.getStatus()
      })
    }

    return statuses
  }

  isServerReady(languageId: string): boolean {
    const info = LANGUAGE_MAP[languageId]
    if (!info?.lspServerId) return false

    const client = this.clients.get(info.lspServerId)
    return client?.isReady() || false
  }
}

// 导出单例
export const lspClientManager = new LSPClientManager()
