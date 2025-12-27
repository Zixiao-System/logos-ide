/**
 * 代码智能管理器
 * 负责管理 Monaco Editor 的代码智能功能
 */

import * as monaco from 'monaco-editor'
import { CompletionProvider } from './providers/CompletionProvider'
import { DefinitionProvider } from './providers/DefinitionProvider'
import { ReferenceProvider } from './providers/ReferenceProvider'
import { HoverProvider } from './providers/HoverProvider'
import { SignatureHelpProvider } from './providers/SignatureHelpProvider'
import { RenameProvider } from './providers/RenameProvider'
import { InlayHintsProvider } from './providers/InlayHintsProvider'
import { DiagnosticsManager } from './DiagnosticsManager'
import type { LanguageServerStatus } from '@/types/intelligence'

/** 支持的 Tier 1 语言 (TypeScript Language Service) */
const TIER1_LANGUAGES = [
  'typescript',
  'javascript',
  'typescriptreact',
  'javascriptreact',
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
}

export class IntelligenceManager {
  private disposables: monaco.IDisposable[] = []
  private diagnosticsManager: DiagnosticsManager
  private projectRoot: string | null = null
  private fileVersions: Map<string, number> = new Map()
  private statusListenerCleanup: (() => void) | null = null

  constructor() {
    this.diagnosticsManager = new DiagnosticsManager()
  }

  /**
   * 初始化代码智能服务
   */
  async initialize(): Promise<void> {
    // 为 Tier 1 语言注册所有 Provider
    for (const languageId of TIER1_LANGUAGES) {
      this.registerProvidersForLanguage(languageId)
    }

    // 监听服务器状态变化
    this.statusListenerCleanup = window.electronAPI.intelligence.onServerStatusChange(
      this.handleServerStatusChange.bind(this)
    )
  }

  /**
   * 打开项目
   */
  async openProject(rootPath: string): Promise<void> {
    this.projectRoot = rootPath
    await window.electronAPI.intelligence.openProject(rootPath)
  }

  /**
   * 关闭项目
   */
  async closeProject(): Promise<void> {
    if (this.projectRoot) {
      await window.electronAPI.intelligence.closeProject(this.projectRoot)
      this.projectRoot = null
    }
  }

  /**
   * 为指定语言注册所有 Provider
   */
  private registerProvidersForLanguage(languageId: string): void {
    // 补全 Provider
    this.disposables.push(
      monaco.languages.registerCompletionItemProvider(
        languageId,
        new CompletionProvider()
      )
    )

    // 定义跳转 Provider
    this.disposables.push(
      monaco.languages.registerDefinitionProvider(
        languageId,
        new DefinitionProvider()
      )
    )

    // 引用查找 Provider
    this.disposables.push(
      monaco.languages.registerReferenceProvider(
        languageId,
        new ReferenceProvider()
      )
    )

    // 悬停提示 Provider
    this.disposables.push(
      monaco.languages.registerHoverProvider(
        languageId,
        new HoverProvider()
      )
    )

    // 签名帮助 Provider
    this.disposables.push(
      monaco.languages.registerSignatureHelpProvider(
        languageId,
        new SignatureHelpProvider()
      )
    )

    // 重命名 Provider
    this.disposables.push(
      monaco.languages.registerRenameProvider(
        languageId,
        new RenameProvider()
      )
    )

    // 内联提示 Provider
    this.disposables.push(
      monaco.languages.registerInlayHintsProvider(
        languageId,
        new InlayHintsProvider()
      )
    )
  }

  /**
   * 同步文件内容到语言服务
   */
  syncFile(filePath: string, content: string): void {
    // 检查是否是支持的语言
    if (!this.isSupported(filePath)) return

    // 更新版本号
    const currentVersion = this.fileVersions.get(filePath) || 0
    const newVersion = currentVersion + 1
    this.fileVersions.set(filePath, newVersion)

    // 同步到后端
    window.electronAPI.intelligence.syncFile(filePath, content, newVersion)
  }

  /**
   * 关闭文件
   */
  closeFile(filePath: string): void {
    this.fileVersions.delete(filePath)
    window.electronAPI.intelligence.closeFile(filePath)
  }

  /**
   * 更新诊断信息
   */
  async updateDiagnostics(model: monaco.editor.ITextModel): Promise<void> {
    const filePath = model.uri.fsPath
    if (!this.isSupported(filePath)) return

    try {
      const diagnostics = await window.electronAPI.intelligence.getDiagnostics(filePath)
      this.diagnosticsManager.setDiagnostics(model, diagnostics)
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
   * 销毁管理器
   */
  dispose(): void {
    // 清理所有 Provider
    this.disposables.forEach(d => d.dispose())
    this.disposables = []

    // 清理诊断管理器
    this.diagnosticsManager.dispose()

    // 清理状态监听器
    if (this.statusListenerCleanup) {
      this.statusListenerCleanup()
      this.statusListenerCleanup = null
    }

    // 关闭项目
    this.closeProject()
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
