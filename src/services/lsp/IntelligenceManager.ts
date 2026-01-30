/**
 * 代码智能管理器
 * 负责管理 Monaco Editor 的代码智能功能
 *
 * 智能模式:
 * - Smart Mode: 使用自定义 IPC + Rust Daemon，并与 LSP 协作提供补充诊断
 */

import * as monaco from 'monaco-editor'
import { CompletionProvider } from './providers/CompletionProvider'
import { DefinitionProvider } from './providers/DefinitionProvider'
import { ReferenceProvider } from './providers/ReferenceProvider'
import { HoverProvider } from './providers/HoverProvider'
import { SignatureHelpProvider } from './providers/SignatureHelpProvider'
import { RenameProvider } from './providers/RenameProvider'
import { InlayHintsProvider } from './providers/InlayHintsProvider'
import { RefactorCodeActionProvider } from './providers/RefactorCodeActionProvider'
import { DiagnosticsManager } from './DiagnosticsManager'
import { getLSPClientService } from './LSPClientService'
import { daemonService } from '@/services/language/DaemonLanguageService'
import { isDaemonLanguage, isNativeLanguage } from '@/services/language/utils'
import type { LanguageServerStatus } from '@/types/intelligence'

/** 智能模式 */
export type IntelligenceMode = 'basic' | 'smart'

/** Tier 1 语言 (TypeScript/JavaScript) - Smart 模式使用 IPC */
const TIER1_LANGUAGES = [
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
]

/** Daemon 语言 - Smart 模式使用 Rust Daemon */
const DAEMON_LANGUAGES = [
  'python',
  'go',
  'rust',
  'c',
  'cpp',
  'java',
]

/** 文件扩展名到语言 ID 的映射 */
const EXT_TO_LANGUAGE: Record<string, string> = {
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.mts': 'typescript',
  '.cts': 'typescript',
  '.py': 'python',
  '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.hh': 'cpp',
  '.java': 'java',
}

export class IntelligenceManager {
  private static refactorCommandsRegistered = false

  private disposables: monaco.IDisposable[] = []
  private diagnosticsManager: DiagnosticsManager
  private projectRoot: string | null = null
  private fileVersions: Map<string, number> = new Map()
  private statusListenerCleanup: (() => void) | null = null
  private daemonInitialized = false

  /** 当前模式 */
  private currentMode: IntelligenceMode = 'smart'

  /** 模式变更回调 */
  private modeChangeCallbacks: Array<(mode: IntelligenceMode) => void> = []
  private lspDiagnosticsCleanup: (() => void) | null = null

  constructor() {
    this.diagnosticsManager = new DiagnosticsManager()
    this.registerRefactorCommandsOnce()
  }

  private registerRefactorCommandsOnce(): void {
    if (IntelligenceManager.refactorCommandsRegistered) return
    IntelligenceManager.refactorCommandsRegistered = true

    const applyTextEdits = (uri: string, edits: Array<{ range: unknown; newText: string }>) => {
      const model = monaco.editor.getModel(monaco.Uri.file(uri))
      if (!model) return

      const monacoEdits = edits
        .map((e) => {
          const r = this.toMonacoRange(e.range)
          if (!r) return null
          return { range: r, text: e.newText }
        })
        .filter((e): e is { range: monaco.Range; text: string } => Boolean(e))
        // 倒序应用，避免 range 位移导致错位
        .sort((a, b) => {
          if (a.range.startLineNumber !== b.range.startLineNumber) return b.range.startLineNumber - a.range.startLineNumber
          return b.range.startColumn - a.range.startColumn
        })

      if (monacoEdits.length > 0) {
        model.pushEditOperations([], monacoEdits, () => null)
      }
    }

    const getActiveModelAndRange = (maybeUri?: monaco.Uri, maybeRange?: monaco.Range) => {
      const model = maybeUri ? monaco.editor.getModel(maybeUri) : null
      if (!model) return null
      const range = maybeRange ?? model.getFullModelRange()
      return { model, range }
    }

    monaco.editor.registerCommand('refactor.extractVariable', async (_accessor, uri: monaco.Uri, range: monaco.Range) => {
      if (!daemonService.isInitialized()) return
      const active = getActiveModelAndRange(uri, range)
      if (!active) return

      const variableName = window.prompt('变量名', 'newVariable')
      if (!variableName) return

      const filePath = active.model.uri.fsPath
      const result = await daemonService.extractVariable(
        filePath,
        active.range.startLineNumber - 1,
        active.range.startColumn - 1,
        active.range.endLineNumber - 1,
        active.range.endColumn - 1,
        variableName
      ) as { success?: boolean; edits?: Array<{ range: unknown; newText: string }>; error?: string }

      if (!result?.success || !result.edits) {
        if (result?.error) console.error('[Refactor] extractVariable failed:', result.error)
        return
      }

      applyTextEdits(filePath, result.edits)
    })

    monaco.editor.registerCommand('refactor.extractMethod', async (_accessor, uri: monaco.Uri, range: monaco.Range) => {
      if (!daemonService.isInitialized()) return
      const active = getActiveModelAndRange(uri, range)
      if (!active) return

      const methodName = window.prompt('方法名', 'newMethod')
      if (!methodName) return

      const filePath = active.model.uri.fsPath
      const result = await daemonService.extractMethod(
        filePath,
        active.range.startLineNumber - 1,
        active.range.startColumn - 1,
        active.range.endLineNumber - 1,
        active.range.endColumn - 1,
        methodName
      ) as { success?: boolean; edits?: Array<{ range: unknown; newText: string }>; error?: string }

      if (!result?.success || !result.edits) {
        if (result?.error) console.error('[Refactor] extractMethod failed:', result.error)
        return
      }

      applyTextEdits(filePath, result.edits)
    })

    monaco.editor.registerCommand('refactor.extractConstant', async (_accessor, uri: monaco.Uri, range: monaco.Range) => {
      // 暂时复用 extractVariable（由后端根据命名/语义决定是否生成 const）
      if (!daemonService.isInitialized()) return
      const active = getActiveModelAndRange(uri, range)
      if (!active) return

      const name = window.prompt('常量名', 'NEW_CONST')
      if (!name) return

      const filePath = active.model.uri.fsPath
      const result = await daemonService.extractVariable(
        filePath,
        active.range.startLineNumber - 1,
        active.range.startColumn - 1,
        active.range.endLineNumber - 1,
        active.range.endColumn - 1,
        name
      ) as { success?: boolean; edits?: Array<{ range: unknown; newText: string }>; error?: string }

      if (!result?.success || !result.edits) {
        if (result?.error) console.error('[Refactor] extractConstant failed:', result.error)
        return
      }

      applyTextEdits(filePath, result.edits)
    })

    monaco.editor.registerCommand('refactor.safeDelete', async (_accessor, uri: monaco.Uri, range: monaco.Range) => {
      if (!daemonService.isInitialized()) return
      const active = getActiveModelAndRange(uri, range)
      if (!active) return

      const filePath = active.model.uri.fsPath
      const analysis = await daemonService.canSafeDelete(
        filePath,
        active.range.startLineNumber - 1,
        active.range.startColumn - 1,
        active.range.endLineNumber - 1,
        active.range.endColumn - 1
      ) as { canDelete?: boolean; warnings?: string[]; error?: string }

      if (!analysis?.canDelete) {
        console.warn('[Refactor] safeDelete not allowed:', analysis?.error || analysis?.warnings?.join('\n') || 'unknown')
        return
      }

      const ok = window.confirm('确认安全删除？（将修改当前文件）')
      if (!ok) return

      const result = await daemonService.safeDelete(
        filePath,
        active.range.startLineNumber - 1,
        active.range.startColumn - 1,
        active.range.endLineNumber - 1,
        active.range.endColumn - 1
      ) as { success?: boolean; edits?: Array<{ range: unknown; newText: string }>; error?: string }

      if (!result?.success || !result.edits) {
        if (result?.error) console.error('[Refactor] safeDelete failed:', result.error)
        return
      }

      applyTextEdits(filePath, result.edits)
    })
  }

  private toMonacoRange(range: unknown): monaco.Range | null {
    // 支持两种形状：
    // 1) { startLine, startColumn, endLine, endColumn } (0-based or 1-based)
    // 2) { start: { line, character }, end: { line, character } } (0-based)
    if (!range || typeof range !== 'object') return null

    const r = range as Record<string, unknown>

    // Shape 1
    if (
      typeof r.startLine === 'number' &&
      typeof r.startColumn === 'number' &&
      typeof r.endLine === 'number' &&
      typeof r.endColumn === 'number'
    ) {
      // 约定 daemon 为 0-based；如果传入疑似 1-based（startLine=1 且 startColumn=1 很常见），也能正常工作
      const sl = r.startLine as number
      const sc = r.startColumn as number
      const el = r.endLine as number
      const ec = r.endColumn as number

      const startLineNumber = sl <= 0 ? sl + 1 : sl
      const startColumn = sc <= 0 ? sc + 1 : sc
      const endLineNumber = el <= 0 ? el + 1 : el
      const endColumn = ec <= 0 ? ec + 1 : ec

      return new monaco.Range(startLineNumber, startColumn, endLineNumber, endColumn)
    }

    // Shape 2
    const start = r.start as Record<string, unknown> | undefined
    const end = r.end as Record<string, unknown> | undefined
    if (
      start &&
      end &&
      typeof start.line === 'number' &&
      typeof start.character === 'number' &&
      typeof end.line === 'number' &&
      typeof end.character === 'number'
    ) {
      return new monaco.Range(
        (start.line as number) + 1,
        (start.character as number) + 1,
        (end.line as number) + 1,
        (end.character as number) + 1
      )
    }

    return null
  }

  /**
   * 获取当前模式
   */
  getMode(): IntelligenceMode {
    return this.currentMode
  }

  /**
   * 设置模式
   */
  async setMode(mode: IntelligenceMode): Promise<void> {
    const targetMode: IntelligenceMode = mode === 'basic' ? 'smart' : mode
    if (targetMode === this.currentMode) return

    console.log(`[IntelligenceManager] Switching mode: ${this.currentMode} -> ${targetMode}`)

    // 清理当前模式的资源
    await this.cleanup()

    // 设置新模式
    this.currentMode = targetMode

    // 初始化新模式 (Smart Mode only)
    await this.initializeSmartMode()

    // 通知模式变更
    this.modeChangeCallbacks.forEach(cb => cb(targetMode))
  }

  /**
   * 监听模式变更
   */
  onModeChange(callback: (mode: IntelligenceMode) => void): () => void {
    this.modeChangeCallbacks.push(callback)
    return () => {
      const index = this.modeChangeCallbacks.indexOf(callback)
      if (index >= 0) {
        this.modeChangeCallbacks.splice(index, 1)
      }
    }
  }

  /**
   * 初始化代码智能服务 (默认使用 Smart 模式)
   */
  async initialize(): Promise<void> {
    await this.initializeSmartMode()
  }

  /**
   * 初始化 Smart 模式 (IPC + Daemon)
   */
  private async initializeSmartMode(): Promise<void> {
    console.log('[IntelligenceManager] Initializing Smart Mode (IPC + Daemon)')

    // 为 Tier 1 语言注册 IPC Provider
    for (const languageId of TIER1_LANGUAGES) {
      this.registerProvidersForLanguage(languageId, 'ipc')
    }

    // 监听服务器状态变化
    this.statusListenerCleanup = window.electronAPI.intelligence.onServerStatusChange(
      this.handleServerStatusChange.bind(this)
    )

    // 启用 LSP 协作诊断
    this.initializeLspCollaboration()

    // 初始化 Daemon 服务
    this.initializeDaemon().catch(error => {
      console.warn('[IntelligenceManager] Daemon initialization skipped:', error?.message || error)
    })

    console.log('[IntelligenceManager] Smart Mode initialized')
  }

  /**
   * Smart Mode 下启用 LSP 协作诊断（仅在 Smart 未提供诊断时作为补充）
   */
  private initializeLspCollaboration(): void {
    const lspClient = getLSPClientService()
    if (this.lspDiagnosticsCleanup) {
      this.lspDiagnosticsCleanup()
    }
    this.lspDiagnosticsCleanup = lspClient.onDiagnostics((uri, diagnostics) => {
      const models = monaco.editor.getModels()
      const filePath = uri.replace('file://', '')
      const model = models.find(m => m.uri.fsPath === filePath)
      if (!model) return

      const smartMarkers = monaco.editor.getModelMarkers({ resource: model.uri, owner: 'intelligence' })
      if (smartMarkers.length > 0) {
        return
      }
      const converted = lspClient.convertDiagnostics(diagnostics)
      monaco.editor.setModelMarkers(model, 'lsp', converted)
    })
  }

  /**
   * 异步初始化 Daemon 服务
   */
  private async initializeDaemon(): Promise<void> {
    try {
      await daemonService.initialize()
      this.daemonInitialized = true
      console.log('[IntelligenceManager] Daemon service initialized')

      // 为 Daemon 语言注册 Provider
      for (const languageId of DAEMON_LANGUAGES) {
        this.registerProvidersForLanguage(languageId, 'daemon')
      }
    } catch (error) {
      console.error('[IntelligenceManager] Daemon service initialization failed:', error)
      this.daemonInitialized = false
    }
  }

  /**
   * 打开项目
   */
  async openProject(rootPath: string): Promise<void> {
    this.projectRoot = rootPath

    // Smart 模式: 使用现有的 intelligence IPC
    await window.electronAPI.intelligence.openProject(rootPath)
    // LSP 协作：设置项目根目录
    await window.electronAPI.lsp.setProjectRoot(rootPath)
  }

  /**
   * 关闭项目
   */
  async closeProject(): Promise<void> {
    if (this.projectRoot) {
      if (this.currentMode === 'smart') {
        await window.electronAPI.intelligence.closeProject(this.projectRoot)
      }
      this.projectRoot = null
    }
  }

  /**
   * 为指定语言注册所有 Provider (Smart 模式)
   */
  private registerProvidersForLanguage(languageId: string, mode: 'ipc' | 'daemon'): void {
    // 补全 Provider
    this.disposables.push(
      monaco.languages.registerCompletionItemProvider(
        languageId,
        new CompletionProvider(mode)
      )
    )

    // 定义跳转 Provider
    this.disposables.push(
      monaco.languages.registerDefinitionProvider(
        languageId,
        new DefinitionProvider(mode)
      )
    )

    // 引用查找 Provider
    this.disposables.push(
      monaco.languages.registerReferenceProvider(
        languageId,
        new ReferenceProvider(mode)
      )
    )

    // 悬停提示 Provider
    this.disposables.push(
      monaco.languages.registerHoverProvider(
        languageId,
        new HoverProvider(mode)
      )
    )

    // 签名帮助 Provider (仅 IPC 模式支持)
    if (mode === 'ipc') {
      this.disposables.push(
        monaco.languages.registerSignatureHelpProvider(
          languageId,
          new SignatureHelpProvider()
        )
      )
    }

    // 重命名 Provider
    this.disposables.push(
      monaco.languages.registerRenameProvider(
        languageId,
        new RenameProvider(mode)
      )
    )

    // Code Action Provider for Refactoring (仅 Smart Mode 的 daemon 语言支持)
    if (mode === 'daemon') {
      this.disposables.push(
        monaco.languages.registerCodeActionProvider(
          languageId,
          new RefactorCodeActionProvider()
        )
      )
    }

    // 内联提示 Provider (仅 IPC 模式支持)
    if (mode === 'ipc') {
      this.disposables.push(
        monaco.languages.registerInlayHintsProvider(
          languageId,
          new InlayHintsProvider()
        )
      )
    }
  }

  /**
   * 同步文件内容到语言服务
   */
  syncFile(filePath: string, content: string): void {
    if (!this.isSupported(filePath)) return

    // Smart 模式: 使用原有逻辑
    if (this.isDaemonLanguage(filePath)) {
      if (this.daemonInitialized) {
        daemonService.updateDocument(filePath, content)
      }
    } else if (this.isNativeLanguage(filePath)) {
      const currentVersion = this.fileVersions.get(filePath) || 0
      const newVersion = currentVersion + 1
      this.fileVersions.set(filePath, newVersion)
      window.electronAPI.intelligence.syncFile(filePath, content, newVersion)
    }

    // LSP 协作：同步内容用于诊断补充
    const lspClient = getLSPClientService()
    void lspClient.updateDocument(filePath, content)
  }

  /**
   * 打开文件
   */
  openFile(filePath: string, content: string): void {
    if (!this.isSupported(filePath)) return

    // Smart 模式: 使用 Daemon
    if (this.isDaemonLanguage(filePath) && this.daemonInitialized) {
      const ext = filePath.substring(filePath.lastIndexOf('.'))
      const languageId = EXT_TO_LANGUAGE[ext] || 'plaintext'
      daemonService.openDocument(filePath, content, languageId)
    }

    // LSP 协作：打开文档以获取诊断
    const ext = filePath.substring(filePath.lastIndexOf('.'))
    const languageId = EXT_TO_LANGUAGE[ext] || 'plaintext'
    const lspClient = getLSPClientService()
    void lspClient.openDocument(filePath, content, languageId)
  }

  /**
   * 关闭文件
   */
  closeFile(filePath: string): void {
    this.fileVersions.delete(filePath)

    // Smart 模式
    if (this.isDaemonLanguage(filePath)) {
      if (this.daemonInitialized) {
        daemonService.closeDocument(filePath)
      }
    } else {
      window.electronAPI.intelligence.closeFile(filePath)
    }

    // LSP 协作
    const lspClient = getLSPClientService()
    void lspClient.closeDocument(filePath)
  }

  /**
   * 更新诊断信息
   */
  async updateDiagnostics(model: monaco.editor.ITextModel): Promise<void> {
    const filePath = model.uri.fsPath
    if (!this.isSupported(filePath)) return

    // Basic 模式的诊断通过 LSP 事件自动更新
    if (this.currentMode === 'basic') return

    // Smart 模式
    try {
      if (this.isDaemonLanguage(filePath)) {
        if (this.daemonInitialized) {
          const diagnostics = await daemonService.getDiagnostics(filePath)
          const converted = diagnostics.map(d => ({
            range: {
              start: { line: d.range.startLine, column: d.range.startColumn },
              end: { line: d.range.endLine, column: d.range.endColumn }
            },
            message: d.message,
            severity: d.severity
          }))
          this.diagnosticsManager.setDiagnostics(model, converted)
        }
      } else {
        const diagnostics = await window.electronAPI.intelligence.getDiagnostics(filePath)
        this.diagnosticsManager.setDiagnostics(model, diagnostics)
      }
    } catch (error) {
      console.error('Failed to update diagnostics:', error)
    }
  }

  /**
   * 检查文件是否支持代码智能
   */
  isSupported(filePath: string): boolean {
    const ext = filePath.substring(filePath.lastIndexOf('.'))
    return ext in EXT_TO_LANGUAGE
  }

  /**
   * 检查文件是否是 Daemon 语言
   */
  isDaemonLanguage(filePath: string): boolean {
    return isDaemonLanguage(filePath)
  }

  /**
   * 检查文件是否是原生语言 (TypeScript/JavaScript)
   */
  isNativeLanguage(filePath: string): boolean {
    return isNativeLanguage(filePath)
  }

  /**
   * 获取 Daemon 服务实例 (供 Provider 使用)
   */
  getDaemonService() {
    return this.daemonInitialized ? daemonService : null
  }

  /**
   * 获取文件的语言 ID
   */
  getLanguageId(filePath: string): string | null {
    const ext = filePath.substring(filePath.lastIndexOf('.'))
    return EXT_TO_LANGUAGE[ext] || null
  }

  /**
   * 处理服务器状态变化
   */
  private handleServerStatusChange(status: LanguageServerStatus): void {
    console.log(`Language server status: ${status.language} - ${status.status}`, status.message)
  }

  /**
   * 获取诊断管理器
   */
  getDiagnosticsManager(): DiagnosticsManager {
    return this.diagnosticsManager
  }

  /**
   * 清理资源
   */
  private async cleanup(): Promise<void> {
    // 清理所有 Provider
    this.disposables.forEach(d => d.dispose())
    this.disposables = []

    // 清理状态监听器
    if (this.statusListenerCleanup) {
      this.statusListenerCleanup()
      this.statusListenerCleanup = null
    }

    if (this.lspDiagnosticsCleanup) {
      this.lspDiagnosticsCleanup()
      this.lspDiagnosticsCleanup = null
    }
    if (this.daemonInitialized) {
      daemonService.dispose()
      this.daemonInitialized = false
    }
  }

  /**
   * 销毁管理器
   */
  dispose(): void {
    this.cleanup()
    this.diagnosticsManager.dispose()
    this.closeProject()
    this.modeChangeCallbacks = []
  }
}

// 单例实例
let instance: IntelligenceManager | null = null

/**
 * 获取 IntelligenceManager 单例
 */
export function getIntelligenceManager(): IntelligenceManager {
  if (!instance) {
    instance = new IntelligenceManager()
  }
  return instance
}

/**
 * 销毁 IntelligenceManager 单例
 */
export function destroyIntelligenceManager(): void {
  if (instance) {
    instance.dispose()
    instance = null
  }
}
