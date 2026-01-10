/**
 * LSP 客户端服务
 * 在渲染进程中管理与 LSP 服务器的通信
 * 这是 Basic Mode 的前端组件
 */

import * as monaco from 'monaco-editor'

// LSP 位置类型
interface LSPPosition {
  line: number
  character: number
}

interface LSPRange {
  start: LSPPosition
  end: LSPPosition
}

interface LSPLocation {
  uri: string
  range: LSPRange
}

// LSP 补全项
interface LSPCompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: string | { kind: string; value: string }
  insertText?: string
  insertTextFormat?: number
  textEdit?: {
    range: LSPRange
    newText: string
  }
  additionalTextEdits?: Array<{ range: LSPRange; newText: string }>
  sortText?: string
  filterText?: string
  preselect?: boolean
}

// LSP 诊断
interface LSPDiagnostic {
  range: LSPRange
  message: string
  severity?: number
  code?: number | string
  source?: string
  relatedInformation?: Array<{
    location: LSPLocation
    message: string
  }>
}

// LSP 悬停结果
interface LSPHover {
  contents: string | { kind: string; value: string } | Array<string | { kind: string; value: string }>
  range?: LSPRange
}

// LSP 签名帮助
interface LSPSignatureHelp {
  signatures: Array<{
    label: string
    documentation?: string | { kind: string; value: string }
    parameters?: Array<{
      label: string | [number, number]
      documentation?: string | { kind: string; value: string }
    }>
  }>
  activeSignature?: number
  activeParameter?: number
}

// 文档同步状态
interface DocumentState {
  version: number
  languageId: string
}

export class LSPClientService {
  private openDocuments: Map<string, DocumentState> = new Map()
  private startedServers: Set<string> = new Set()
  private failedServers: Set<string> = new Set() // 启动失败的服务器
  private diagnosticsListeners: Array<(uri: string, diagnostics: LSPDiagnostic[]) => void> = []

  constructor() {
    this.setupEventListeners()
  }

  /**
   * 检查服务器是否可用
   */
  private async isServerAvailable(languageId: string): Promise<boolean> {
    // 如果已知启动失败，直接返回 false
    if (this.failedServers.has(languageId)) {
      return false
    }
    const status = await window.electronAPI.lsp.getStatus(languageId)
    return status === 'running'
  }

  /**
   * 设置事件监听器
   */
  private setupEventListeners(): void {
    // 监听诊断消息
    window.electronAPI.lsp.onDiagnostics((data) => {
      const params = data.params as { uri: string; diagnostics: LSPDiagnostic[] }
      const { uri, diagnostics } = params
      this.diagnosticsListeners.forEach(listener => listener(uri, diagnostics))
    })

    // 监听状态变化
    window.electronAPI.lsp.onStatus((data: { languageId: string; status: string; message?: string }) => {
      console.log(`[LSP Client] ${data.languageId}: ${data.status}`, data.message || '')
    })
  }

  /**
   * 确保语言服务器已启动
   */
  async ensureServerStarted(languageId: string): Promise<boolean> {
    if (this.startedServers.has(languageId)) {
      return true
    }

    // 如果已知失败，不再尝试
    if (this.failedServers.has(languageId)) {
      return false
    }

    const success = await window.electronAPI.lsp.start(languageId)
    if (success) {
      this.startedServers.add(languageId)
    } else {
      this.failedServers.add(languageId)
      console.warn(`[LSP Client] Server not available for ${languageId}`)
    }
    return success
  }

  /**
   * 打开文档
   */
  async openDocument(uri: string, content: string, languageId: string): Promise<void> {
    // 确保服务器已启动
    const started = await this.ensureServerStarted(languageId)

    const version = 1
    this.openDocuments.set(uri, { version, languageId })

    // 只有服务器运行时才发送通知
    if (started) {
      await window.electronAPI.lsp.notify(languageId, 'textDocument/didOpen', {
        textDocument: {
          uri: `file://${uri}`,
          languageId,
          version,
          text: content,
        },
      })
    }
  }

  /**
   * 更新文档
   */
  async updateDocument(uri: string, content: string): Promise<void> {
    const state = this.openDocuments.get(uri)
    if (!state) return

    state.version++

    // 只有服务器运行时才发送通知
    if (await this.isServerAvailable(state.languageId)) {
      await window.electronAPI.lsp.notify(state.languageId, 'textDocument/didChange', {
        textDocument: {
          uri: `file://${uri}`,
          version: state.version,
        },
        contentChanges: [{ text: content }],
      })
    }
  }

  /**
   * 关闭文档
   */
  async closeDocument(uri: string): Promise<void> {
    const state = this.openDocuments.get(uri)
    if (!state) return

    // 只有服务器运行时才发送通知
    if (await this.isServerAvailable(state.languageId)) {
      await window.electronAPI.lsp.notify(state.languageId, 'textDocument/didClose', {
        textDocument: {
          uri: `file://${uri}`,
        },
      })
    }

    this.openDocuments.delete(uri)
  }

  /**
   * 保存文档
   */
  async saveDocument(uri: string): Promise<void> {
    const state = this.openDocuments.get(uri)
    if (!state) return

    // 只有服务器运行时才发送通知
    if (await this.isServerAvailable(state.languageId)) {
      await window.electronAPI.lsp.notify(state.languageId, 'textDocument/didSave', {
        textDocument: {
          uri: `file://${uri}`,
        },
      })
    }
  }

  /**
   * 获取补全
   */
  async getCompletions(
    uri: string,
    position: monaco.Position,
    context?: monaco.languages.CompletionContext
  ): Promise<monaco.languages.CompletionList | null> {
    const state = this.openDocuments.get(uri)
    if (!state) return null

    // 检查服务器状态
    if (!await this.isServerAvailable(state.languageId)) {
      return null
    }

    try {
      const result = await window.electronAPI.lsp.request(
        state.languageId,
        'textDocument/completion',
        {
          textDocument: { uri: `file://${uri}` },
          position: this.toPosition(position),
          context: context ? {
            triggerKind: context.triggerKind,
            triggerCharacter: context.triggerCharacter,
          } : undefined,
        }
      ) as { items?: LSPCompletionItem[] } | LSPCompletionItem[] | null

      if (!result) return null

      const items = Array.isArray(result) ? result : (result.items || [])

      return {
        suggestions: items.map(item => this.convertCompletionItem(item, position)),
        incomplete: !Array.isArray(result) && result.items ? true : false,
      }
    } catch (error) {
      console.error('[LSP Client] Completion error:', error)
      return null
    }
  }

  /**
   * 获取悬停信息
   */
  async getHover(uri: string, position: monaco.Position): Promise<monaco.languages.Hover | null> {
    const state = this.openDocuments.get(uri)
    if (!state) return null

    if (!await this.isServerAvailable(state.languageId)) {
      return null
    }

    try {
      const result = await window.electronAPI.lsp.request(
        state.languageId,
        'textDocument/hover',
        {
          textDocument: { uri: `file://${uri}` },
          position: this.toPosition(position),
        }
      ) as LSPHover | null

      if (!result) return null

      return {
        contents: this.convertHoverContents(result.contents),
        range: result.range ? this.toRange(result.range) : undefined,
      }
    } catch (error) {
      console.error('[LSP Client] Hover error:', error)
      return null
    }
  }

  /**
   * 获取定义
   */
  async getDefinition(uri: string, position: monaco.Position): Promise<monaco.languages.Definition | null> {
    const state = this.openDocuments.get(uri)
    if (!state) return null

    if (!await this.isServerAvailable(state.languageId)) {
      return null
    }

    try {
      const result = await window.electronAPI.lsp.request(
        state.languageId,
        'textDocument/definition',
        {
          textDocument: { uri: `file://${uri}` },
          position: this.toPosition(position),
        }
      ) as LSPLocation | LSPLocation[] | null

      if (!result) return null

      const locations = Array.isArray(result) ? result : [result]
      return locations.map(loc => ({
        uri: monaco.Uri.parse(loc.uri),
        range: this.toRange(loc.range),
      }))
    } catch (error) {
      console.error('[LSP Client] Definition error:', error)
      return null
    }
  }

  /**
   * 获取引用
   */
  async getReferences(
    uri: string,
    position: monaco.Position,
    includeDeclaration = true
  ): Promise<monaco.languages.Location[] | null> {
    const state = this.openDocuments.get(uri)
    if (!state) return null

    if (!await this.isServerAvailable(state.languageId)) {
      return null
    }

    try {
      const result = await window.electronAPI.lsp.request(
        state.languageId,
        'textDocument/references',
        {
          textDocument: { uri: `file://${uri}` },
          position: this.toPosition(position),
          context: { includeDeclaration },
        }
      ) as LSPLocation[] | null

      if (!result) return null

      return result.map(loc => ({
        uri: monaco.Uri.parse(loc.uri),
        range: this.toRange(loc.range),
      }))
    } catch (error) {
      console.error('[LSP Client] References error:', error)
      return null
    }
  }

  /**
   * 获取签名帮助
   */
  async getSignatureHelp(
    uri: string,
    position: monaco.Position,
    context?: monaco.languages.SignatureHelpContext
  ): Promise<monaco.languages.SignatureHelpResult | null> {
    const state = this.openDocuments.get(uri)
    if (!state) return null

    if (!await this.isServerAvailable(state.languageId)) {
      return null
    }

    try {
      const result = await window.electronAPI.lsp.request(
        state.languageId,
        'textDocument/signatureHelp',
        {
          textDocument: { uri: `file://${uri}` },
          position: this.toPosition(position),
          context: context ? {
            triggerKind: context.triggerKind,
            triggerCharacter: context.triggerCharacter,
            isRetrigger: context.isRetrigger,
          } : undefined,
        }
      ) as LSPSignatureHelp | null

      if (!result || !result.signatures.length) return null

      return {
        value: {
          signatures: result.signatures.map(sig => ({
            label: sig.label,
            documentation: sig.documentation
              ? typeof sig.documentation === 'string'
                ? sig.documentation
                : { value: sig.documentation.value }
              : undefined,
            parameters: sig.parameters?.map(param => ({
              label: param.label,
              documentation: param.documentation
                ? typeof param.documentation === 'string'
                  ? param.documentation
                  : { value: param.documentation.value }
                : undefined,
            })) || [],
          })),
          activeSignature: result.activeSignature ?? 0,
          activeParameter: result.activeParameter ?? 0,
        },
        dispose: () => {},
      }
    } catch (error) {
      console.error('[LSP Client] Signature help error:', error)
      return null
    }
  }

  /**
   * 准备重命名
   */
  async prepareRename(uri: string, position: monaco.Position): Promise<monaco.languages.RenameLocation | null> {
    const state = this.openDocuments.get(uri)
    if (!state) return null

    if (!await this.isServerAvailable(state.languageId)) {
      return null
    }

    try {
      const result = await window.electronAPI.lsp.request(
        state.languageId,
        'textDocument/prepareRename',
        {
          textDocument: { uri: `file://${uri}` },
          position: this.toPosition(position),
        }
      ) as { range: LSPRange; placeholder: string } | LSPRange | null

      if (!result) return null

      if ('placeholder' in result) {
        return {
          range: this.toRange(result.range),
          text: result.placeholder,
        }
      } else {
        return {
          range: this.toRange(result),
          text: '',
        }
      }
    } catch (error) {
      console.error('[LSP Client] Prepare rename error:', error)
      return null
    }
  }

  /**
   * 执行重命名
   */
  async rename(
    uri: string,
    position: monaco.Position,
    newName: string
  ): Promise<monaco.languages.WorkspaceEdit | null> {
    const state = this.openDocuments.get(uri)
    if (!state) return null

    if (!await this.isServerAvailable(state.languageId)) {
      return null
    }

    try {
      const result = await window.electronAPI.lsp.request(
        state.languageId,
        'textDocument/rename',
        {
          textDocument: { uri: `file://${uri}` },
          position: this.toPosition(position),
          newName,
        }
      ) as { changes?: Record<string, Array<{ range: LSPRange; newText: string }>> } | null

      if (!result || !result.changes) return null

      const edits: monaco.languages.IWorkspaceTextEdit[] = []
      for (const [fileUri, changes] of Object.entries(result.changes)) {
        for (const change of changes) {
          edits.push({
            resource: monaco.Uri.parse(fileUri),
            textEdit: {
              range: this.toRange(change.range),
              text: change.newText,
            },
            versionId: undefined,
          })
        }
      }

      return { edits }
    } catch (error) {
      console.error('[LSP Client] Rename error:', error)
      return null
    }
  }

  /**
   * 添加诊断监听器
   */
  onDiagnostics(listener: (uri: string, diagnostics: LSPDiagnostic[]) => void): () => void {
    this.diagnosticsListeners.push(listener)
    return () => {
      const index = this.diagnosticsListeners.indexOf(listener)
      if (index >= 0) {
        this.diagnosticsListeners.splice(index, 1)
      }
    }
  }

  /**
   * 转换 LSP 诊断到 Monaco 诊断
   */
  convertDiagnostics(diagnostics: LSPDiagnostic[]): monaco.editor.IMarkerData[] {
    return diagnostics.map(diag => ({
      startLineNumber: diag.range.start.line + 1,
      startColumn: diag.range.start.character + 1,
      endLineNumber: diag.range.end.line + 1,
      endColumn: diag.range.end.character + 1,
      message: diag.message,
      severity: this.convertSeverity(diag.severity),
      code: diag.code?.toString(),
      source: diag.source,
    }))
  }

  /**
   * 销毁服务
   */
  async dispose(): Promise<void> {
    // 关闭所有打开的文档
    for (const uri of this.openDocuments.keys()) {
      await this.closeDocument(uri)
    }

    // 停止所有服务器
    await window.electronAPI.lsp.stopAll()

    this.startedServers.clear()
    this.diagnosticsListeners = []
  }

  // ============ 工具方法 ============

  private toPosition(pos: monaco.Position): LSPPosition {
    return {
      line: pos.lineNumber - 1,
      character: pos.column - 1,
    }
  }

  private toRange(range: LSPRange): monaco.IRange {
    return {
      startLineNumber: range.start.line + 1,
      startColumn: range.start.character + 1,
      endLineNumber: range.end.line + 1,
      endColumn: range.end.character + 1,
    }
  }

  private convertSeverity(severity?: number): monaco.MarkerSeverity {
    switch (severity) {
      case 1: return monaco.MarkerSeverity.Error
      case 2: return monaco.MarkerSeverity.Warning
      case 3: return monaco.MarkerSeverity.Info
      case 4: return monaco.MarkerSeverity.Hint
      default: return monaco.MarkerSeverity.Error
    }
  }

  private convertCompletionItem(
    item: LSPCompletionItem,
    _position: monaco.Position
  ): monaco.languages.CompletionItem {
    const result: monaco.languages.CompletionItem = {
      label: item.label,
      kind: this.convertCompletionKind(item.kind),
      detail: item.detail,
      documentation: item.documentation
        ? typeof item.documentation === 'string'
          ? item.documentation
          : { value: item.documentation.value }
        : undefined,
      insertText: item.insertText || item.label,
      insertTextRules: item.insertTextFormat === 2
        ? monaco.languages.CompletionItemInsertTextRule.InsertAsSnippet
        : undefined,
      sortText: item.sortText,
      filterText: item.filterText,
      preselect: item.preselect,
      range: item.textEdit
        ? this.toRange(item.textEdit.range)
        : undefined as unknown as monaco.IRange,
    }

    return result
  }

  private convertCompletionKind(kind?: number): monaco.languages.CompletionItemKind {
    // LSP CompletionItemKind 映射到 Monaco
    const kindMap: Record<number, monaco.languages.CompletionItemKind> = {
      1: monaco.languages.CompletionItemKind.Text,
      2: monaco.languages.CompletionItemKind.Method,
      3: monaco.languages.CompletionItemKind.Function,
      4: monaco.languages.CompletionItemKind.Constructor,
      5: monaco.languages.CompletionItemKind.Field,
      6: monaco.languages.CompletionItemKind.Variable,
      7: monaco.languages.CompletionItemKind.Class,
      8: monaco.languages.CompletionItemKind.Interface,
      9: monaco.languages.CompletionItemKind.Module,
      10: monaco.languages.CompletionItemKind.Property,
      11: monaco.languages.CompletionItemKind.Unit,
      12: monaco.languages.CompletionItemKind.Value,
      13: monaco.languages.CompletionItemKind.Enum,
      14: monaco.languages.CompletionItemKind.Keyword,
      15: monaco.languages.CompletionItemKind.Snippet,
      16: monaco.languages.CompletionItemKind.Color,
      17: monaco.languages.CompletionItemKind.File,
      18: monaco.languages.CompletionItemKind.Reference,
      19: monaco.languages.CompletionItemKind.Folder,
      20: monaco.languages.CompletionItemKind.EnumMember,
      21: monaco.languages.CompletionItemKind.Constant,
      22: monaco.languages.CompletionItemKind.Struct,
      23: monaco.languages.CompletionItemKind.Event,
      24: monaco.languages.CompletionItemKind.Operator,
      25: monaco.languages.CompletionItemKind.TypeParameter,
    }
    return kind ? (kindMap[kind] || monaco.languages.CompletionItemKind.Text) : monaco.languages.CompletionItemKind.Text
  }

  private convertHoverContents(
    contents: string | { kind: string; value: string } | Array<string | { kind: string; value: string }>
  ): monaco.IMarkdownString[] {
    const items = Array.isArray(contents) ? contents : [contents]
    return items.map(item => {
      if (typeof item === 'string') {
        return { value: item }
      }
      return { value: item.value }
    })
  }
}

// 单例实例
let instance: LSPClientService | null = null

export function getLSPClientService(): LSPClientService {
  if (!instance) {
    instance = new LSPClientService()
  }
  return instance
}

export function destroyLSPClientService(): void {
  if (instance) {
    instance.dispose()
    instance = null
  }
}
