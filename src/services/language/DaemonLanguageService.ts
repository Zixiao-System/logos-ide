/**
 * 守护进程语言服务封装
 * 通过 IPC 与 Electron 主进程通信，主进程再与 Rust 守护进程通信
 */

import type {
  DaemonCompletionItem,
  DaemonLocation,
  DaemonHoverInfo,
  DaemonDiagnostic,
  DaemonDocumentSymbol,
  DaemonPrepareRenameResult,
  DaemonWorkspaceEdit,
  DaemonSearchSymbol,
  DaemonTodoItem,
  DaemonTodoStats,
  DaemonUnusedItem
} from '@/types/daemon'

export class DaemonLanguageService {
  private initialized = false
  private initPromise: Promise<void> | null = null

  /**
   * 初始化守护进程
   */
  async initialize(): Promise<void> {
    if (this.initialized) return
    if (this.initPromise) return this.initPromise

    this.initPromise = this.doInitialize()
    return this.initPromise
  }

  private async doInitialize(): Promise<void> {
    try {
      console.log('[DaemonLanguageService] 正在启动语言守护进程...')
      const result = await window.electronAPI.daemon.start()

      if (!result.success) {
        throw new Error(result.error || '启动守护进程失败')
      }

      this.initialized = true
      console.log('[DaemonLanguageService] 语言守护进程启动成功')
    } catch (error) {
      console.error('[DaemonLanguageService] 初始化失败:', error)
      this.initialized = false
      throw error
    }
  }

  /**
   * 检查服务是否已初始化
   */
  isInitialized(): boolean {
    return this.initialized
  }

  /**
   * 打开文档
   */
  async openDocument(uri: string, content: string, languageId: string): Promise<void> {
    if (!this.initialized) {
      await this.initialize()
    }
    try {
      await window.electronAPI.daemon.openDocument(uri, content, languageId)
    } catch (error) {
      console.error('[DaemonLanguageService] openDocument 失败:', error)
    }
  }

  /**
   * 更新文档内容
   */
  updateDocument(uri: string, content: string): void {
    if (!this.initialized) return
    try {
      window.electronAPI.daemon.updateDocument(uri, content)
    } catch (error) {
      console.error('[DaemonLanguageService] updateDocument 失败:', error)
    }
  }

  /**
   * 关闭文档
   */
  closeDocument(uri: string): void {
    if (!this.initialized) return
    try {
      window.electronAPI.daemon.closeDocument(uri)
    } catch (error) {
      console.error('[DaemonLanguageService] closeDocument 失败:', error)
    }
  }

  /**
   * 获取补全建议
   */
  async getCompletions(uri: string, line: number, column: number): Promise<DaemonCompletionItem[]> {
    if (!this.initialized) return []
    try {
      const result = await window.electronAPI.daemon.completions(uri, line, column) as { items?: DaemonCompletionItem[] }
      return result?.items ?? []
    } catch (error) {
      console.error('[DaemonLanguageService] getCompletions 失败:', error)
      return []
    }
  }

  /**
   * 获取定义位置
   */
  async getDefinition(uri: string, line: number, column: number): Promise<DaemonLocation | null> {
    if (!this.initialized) return null
    try {
      const result = await window.electronAPI.daemon.definition(uri, line, column)
      return result as DaemonLocation | null
    } catch (error) {
      console.error('[DaemonLanguageService] getDefinition 失败:', error)
      return null
    }
  }

  /**
   * 获取所有引用
   */
  async getReferences(uri: string, line: number, column: number): Promise<DaemonLocation[]> {
    if (!this.initialized) return []
    try {
      const result = await window.electronAPI.daemon.references(uri, line, column)
      return (result as DaemonLocation[]) ?? []
    } catch (error) {
      console.error('[DaemonLanguageService] getReferences 失败:', error)
      return []
    }
  }

  /**
   * 获取悬停信息
   */
  async getHover(uri: string, line: number, column: number): Promise<DaemonHoverInfo | null> {
    if (!this.initialized) return null
    try {
      const result = await window.electronAPI.daemon.hover(uri, line, column)
      return result as DaemonHoverInfo | null
    } catch (error) {
      console.error('[DaemonLanguageService] getHover 失败:', error)
      return null
    }
  }

  /**
   * 获取诊断信息
   */
  async getDiagnostics(uri: string): Promise<DaemonDiagnostic[]> {
    if (!this.initialized) return []
    try {
      const result = await window.electronAPI.daemon.diagnostics(uri) as { items?: DaemonDiagnostic[] }
      return result?.items ?? []
    } catch (error) {
      console.error('[DaemonLanguageService] getDiagnostics 失败:', error)
      return []
    }
  }

  /**
   * 获取文档符号
   */
  async getDocumentSymbols(uri: string): Promise<DaemonDocumentSymbol[]> {
    if (!this.initialized) return []
    try {
      const result = await window.electronAPI.daemon.documentSymbols(uri)
      return (result as DaemonDocumentSymbol[]) ?? []
    } catch (error) {
      console.error('[DaemonLanguageService] getDocumentSymbols 失败:', error)
      return []
    }
  }

  /**
   * 准备重命名
   */
  async prepareRename(uri: string, line: number, column: number): Promise<DaemonPrepareRenameResult | null> {
    if (!this.initialized) return null
    try {
      const result = await window.electronAPI.daemon.prepareRename(uri, line, column)
      return result as DaemonPrepareRenameResult | null
    } catch (error) {
      console.error('[DaemonLanguageService] prepareRename 失败:', error)
      return null
    }
  }

  /**
   * 执行重命名
   */
  async rename(uri: string, line: number, column: number, newName: string): Promise<DaemonWorkspaceEdit | null> {
    if (!this.initialized) return null
    try {
      const result = await window.electronAPI.daemon.rename(uri, line, column, newName)
      return result as DaemonWorkspaceEdit | null
    } catch (error) {
      console.error('[DaemonLanguageService] rename 失败:', error)
      return null
    }
  }

  /**
   * 搜索符号
   */
  async searchSymbols(query: string): Promise<DaemonSearchSymbol[]> {
    if (!this.initialized) return []
    try {
      const result = await window.electronAPI.daemon.searchSymbols(query)
      return (result as DaemonSearchSymbol[]) ?? []
    } catch (error) {
      console.error('[DaemonLanguageService] searchSymbols 失败:', error)
      return []
    }
  }

  /**
   * 获取文档的 TODO 项
   */
  async getTodoItems(uri: string): Promise<DaemonTodoItem[]> {
    if (!this.initialized) return []
    try {
      const result = await window.electronAPI.daemon.getTodoItems(uri)
      return (result as DaemonTodoItem[]) ?? []
    } catch (error) {
      console.error('[DaemonLanguageService] getTodoItems 失败:', error)
      return []
    }
  }

  /**
   * 获取所有文档的 TODO 项
   */
  async getAllTodoItems(): Promise<DaemonTodoItem[]> {
    if (!this.initialized) return []
    try {
      const result = await window.electronAPI.daemon.getAllTodoItems()
      return (result as DaemonTodoItem[]) ?? []
    } catch (error) {
      console.error('[DaemonLanguageService] getAllTodoItems 失败:', error)
      return []
    }
  }

  /**
   * 获取 TODO 统计信息
   */
  async getTodoStats(): Promise<DaemonTodoStats | null> {
    if (!this.initialized) return null
    try {
      const result = await window.electronAPI.daemon.getTodoStats()
      return result as DaemonTodoStats | null
    } catch (error) {
      console.error('[DaemonLanguageService] getTodoStats 失败:', error)
      return null
    }
  }

  /**
   * 获取未使用的符号
   */
  async getUnusedSymbols(uri: string): Promise<DaemonUnusedItem[]> {
    if (!this.initialized) return []
    try {
      const result = await window.electronAPI.daemon.getUnusedSymbols(uri)
      return (result as DaemonUnusedItem[]) ?? []
    } catch (error) {
      console.error('[DaemonLanguageService] getUnusedSymbols 失败:', error)
      return []
    }
  }

  /**
   * 获取重构动作
   */
  async getRefactorActions(
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ): Promise<unknown[]> {
    if (!this.initialized) return []
    try {
      const result = await window.electronAPI.daemon.getRefactorActions(uri, startLine, startCol, endLine, endCol)
      return (result as unknown[]) ?? []
    } catch (error) {
      console.error('[DaemonLanguageService] getRefactorActions 失败:', error)
      return []
    }
  }

  /**
   * 提取为变量
   */
  async extractVariable(
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    variableName: string
  ): Promise<unknown> {
    if (!this.initialized) return { success: false, error: '服务未初始化' }
    try {
      return await window.electronAPI.daemon.extractVariable(uri, startLine, startCol, endLine, endCol, variableName)
    } catch (error) {
      console.error('[DaemonLanguageService] extractVariable 失败:', error)
      return { success: false, error: String(error) }
    }
  }

  /**
   * 提取为方法
   */
  async extractMethod(
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    methodName: string
  ): Promise<unknown> {
    if (!this.initialized) return { success: false, error: '服务未初始化' }
    try {
      return await window.electronAPI.daemon.extractMethod(uri, startLine, startCol, endLine, endCol, methodName)
    } catch (error) {
      console.error('[DaemonLanguageService] extractMethod 失败:', error)
      return { success: false, error: String(error) }
    }
  }

  /**
   * 检查是否可以安全删除
   */
  async canSafeDelete(
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ): Promise<unknown> {
    if (!this.initialized) return { canDelete: false, error: '服务未初始化' }
    try {
      return await window.electronAPI.daemon.canSafeDelete(uri, startLine, startCol, endLine, endCol)
    } catch (error) {
      console.error('[DaemonLanguageService] canSafeDelete 失败:', error)
      return { canDelete: false, error: String(error) }
    }
  }

  /**
   * 安全删除
   */
  async safeDelete(
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ): Promise<unknown> {
    if (!this.initialized) return { success: false, error: '服务未初始化' }
    try {
      return await window.electronAPI.daemon.safeDelete(uri, startLine, startCol, endLine, endCol)
    } catch (error) {
      console.error('[DaemonLanguageService] safeDelete 失败:', error)
      return { success: false, error: String(error) }
    }
  }

  /**
   * 监听诊断事件
   */
  onDiagnostics(callback: (params: unknown) => void): () => void {
    return window.electronAPI.daemon.onDiagnostics(callback)
  }

  /**
   * 释放资源
   */
  async dispose(): Promise<void> {
    if (this.initialized) {
      try {
        await window.electronAPI.daemon.stop()
      } catch {
        // 忽略释放错误
      }
      this.initialized = false
      this.initPromise = null
    }
  }
}

// 导出单例实例
export const daemonService = new DaemonLanguageService()
