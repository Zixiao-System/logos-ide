/**
 * 代码智能管理器
 * 负责管理 Monaco Editor 的代码智能功能
 *
 * 支持两种模式:
 * - Basic Mode: 使用标准 LSP 服务器 (typescript-language-server, pyright 等)
 * - Smart Mode: 使用自定义 IPC + Rust Daemon 提供高级功能
 */

import * as monaco from 'monaco-editor'
import { CompletionProvider } from './providers/CompletionProvider'
import { DefinitionProvider } from './providers/DefinitionProvider'
import { ReferenceProvider } from './providers/ReferenceProvider'
import { HoverProvider } from './providers/HoverProvider'
import { SignatureHelpProvider } from './providers/SignatureHelpProvider'
import { RenameProvider } from './providers/RenameProvider'
import { InlayHintsProvider } from './providers/InlayHintsProvider'
import { registerLSPProviders } from './providers/LSPProviders'
import { DiagnosticsManager } from './DiagnosticsManager'
import { getLSPClientService, destroyLSPClientService } from './LSPClientService'
import { daemonService } from '@/services/language/DaemonLanguageService'
import { isDaemonLanguage, isNativeLanguage } from '@/services/language/utils'
import type { LanguageServerStatus } from '@/types/intelligence'

/** 智能模式 */
export type IntelligenceMode = 'basic' | 'smart'

/** 支持的语言 */
const ALL_LANGUAGES = [
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
  'python',
  'go',
  'rust',
  'c',
  'cpp',
  'java',
]

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
  private disposables: monaco.IDisposable[] = []
  private diagnosticsManager: DiagnosticsManager
  private projectRoot: string | null = null
  private fileVersions: Map<string, number> = new Map()
  private statusListenerCleanup: (() => void) | null = null
  private daemonInitialized = false

  /** 当前模式 */
  private currentMode: IntelligenceMode = 'basic'

  /** 模式变更回调 */
  private modeChangeCallbacks: Array<(mode: IntelligenceMode) => void> = []

  constructor() {
    this.diagnosticsManager = new DiagnosticsManager()
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
    if (mode === this.currentMode) return

    console.log(`[IntelligenceManager] Switching mode: ${this.currentMode} -> ${mode}`)

    // 清理当前模式的资源
    await this.cleanup()

    // 设置新模式
    this.currentMode = mode

    // 初始化新模式
    if (mode === 'basic') {
      await this.initializeBasicMode()
    } else {
      await this.initializeSmartMode()
    }

    // 通知模式变更
    this.modeChangeCallbacks.forEach(cb => cb(mode))
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
   * 初始化代码智能服务 (默认使用 Basic 模式)
   */
  async initialize(): Promise<void> {
    if (this.currentMode === 'basic') {
      await this.initializeBasicMode()
    } else {
      await this.initializeSmartMode()
    }
  }

  /**
   * 初始化 Basic 模式 (标准 LSP)
   */
  private async initializeBasicMode(): Promise<void> {
    console.log('[IntelligenceManager] Initializing Basic Mode (Standard LSP)')

    // 为所有语言注册 LSP Provider
    for (const languageId of ALL_LANGUAGES) {
      const providers = registerLSPProviders(languageId)
      this.disposables.push(...providers)
    }

    // 设置 LSP 诊断监听
    const lspClient = getLSPClientService()
    const cleanup = lspClient.onDiagnostics((uri, diagnostics) => {
      // 查找对应的 model
      const models = monaco.editor.getModels()
      const model = models.find(m => m.uri.fsPath === uri.replace('file://', ''))
      if (model) {
        const converted = lspClient.convertDiagnostics(diagnostics)
        monaco.editor.setModelMarkers(model, 'lsp', converted)
      }
    })
    this.disposables.push({ dispose: cleanup })

    console.log('[IntelligenceManager] Basic Mode initialized')
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

    // 初始化 Daemon 服务
    this.initializeDaemon().catch(error => {
      console.warn('[IntelligenceManager] Daemon initialization skipped:', error?.message || error)
    })

    console.log('[IntelligenceManager] Smart Mode initialized')
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

    if (this.currentMode === 'basic') {
      // Basic 模式: 设置 LSP 项目根目录
      await window.electronAPI.lsp.setProjectRoot(rootPath)
    } else {
      // Smart 模式: 使用现有的 intelligence IPC
      await window.electronAPI.intelligence.openProject(rootPath)
    }
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

    if (this.currentMode === 'basic') {
      // Basic 模式: 使用 LSP 客户端
      const lspClient = getLSPClientService()
      lspClient.updateDocument(filePath, content)
    } else {
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
    }
  }

  /**
   * 打开文件
   */
  openFile(filePath: string, content: string): void {
    if (!this.isSupported(filePath)) return

    if (this.currentMode === 'basic') {
      // Basic 模式: 使用 LSP 客户端
      const ext = filePath.substring(filePath.lastIndexOf('.'))
      const languageId = EXT_TO_LANGUAGE[ext] || 'plaintext'
      const lspClient = getLSPClientService()
      lspClient.openDocument(filePath, content, languageId)
    } else {
      // Smart 模式: 使用 Daemon
      if (this.isDaemonLanguage(filePath) && this.daemonInitialized) {
        const ext = filePath.substring(filePath.lastIndexOf('.'))
        const languageId = EXT_TO_LANGUAGE[ext] || 'plaintext'
        daemonService.openDocument(filePath, content, languageId)
      }
    }
  }

  /**
   * 关闭文件
   */
  closeFile(filePath: string): void {
    this.fileVersions.delete(filePath)

    if (this.currentMode === 'basic') {
      // Basic 模式: 使用 LSP 客户端
      const lspClient = getLSPClientService()
      lspClient.closeDocument(filePath)
    } else {
      // Smart 模式
      if (this.isDaemonLanguage(filePath)) {
        if (this.daemonInitialized) {
          daemonService.closeDocument(filePath)
        }
      } else {
        window.electronAPI.intelligence.closeFile(filePath)
      }
    }
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

    // 根据模式清理
    if (this.currentMode === 'basic') {
      destroyLSPClientService()
    } else {
      if (this.daemonInitialized) {
        daemonService.dispose()
        this.daemonInitialized = false
      }
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
