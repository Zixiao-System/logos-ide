/**
 * 语言守护进程 IPC 处理程序
 * 注册所有与语言服务相关的 IPC handlers
 */

import { ipcMain, BrowserWindow } from 'electron'
import { getLanguageDaemonService, cleanupLanguageDaemon } from './languageDaemonService'

/** 注册语言守护进程 IPC handlers */
export function registerLanguageDaemonHandlers(getMainWindow: () => BrowserWindow | null): void {
  const daemon = getLanguageDaemonService(getMainWindow)

  // ==================== 生命周期 ====================

  /** 启动守护进程 */
  ipcMain.handle('daemon:start', async () => {
    try {
      await daemon.start()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  /** 停止守护进程 */
  ipcMain.handle('daemon:stop', async () => {
    try {
      await daemon.stop()
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  /** 检查守护进程状态 */
  ipcMain.handle('daemon:isRunning', () => {
    return daemon.isRunning()
  })

  // ==================== 文档管理 ====================

  /** 打开文档 */
  ipcMain.handle('daemon:openDocument', async (_, uri: string, content: string, languageId: string) => {
    try {
      await daemon.openDocument(uri, content, languageId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  /** 更新文档 (无返回值) */
  ipcMain.on('daemon:updateDocument', (_, uri: string, content: string) => {
    daemon.updateDocument(uri, content)
  })

  /** 关闭文档 (无返回值) */
  ipcMain.on('daemon:closeDocument', (_, uri: string) => {
    daemon.closeDocument(uri)
  })

  // ==================== 代码智能 ====================

  /** 获取代码补全 */
  ipcMain.handle('daemon:completions', async (_, uri: string, line: number, column: number) => {
    try {
      return await daemon.getCompletions(uri, line, column)
    } catch (error) {
      console.error('[daemon:completions] Error:', error)
      return { isIncomplete: false, items: [] }
    }
  })

  /** 获取定义位置 */
  ipcMain.handle('daemon:definition', async (_, uri: string, line: number, column: number) => {
    try {
      return await daemon.getDefinition(uri, line, column)
    } catch (error) {
      console.error('[daemon:definition] Error:', error)
      return null
    }
  })

  /** 获取引用 */
  ipcMain.handle('daemon:references', async (_, uri: string, line: number, column: number) => {
    try {
      return await daemon.getReferences(uri, line, column)
    } catch (error) {
      console.error('[daemon:references] Error:', error)
      return []
    }
  })

  /** 获取悬停信息 */
  ipcMain.handle('daemon:hover', async (_, uri: string, line: number, column: number) => {
    try {
      return await daemon.getHover(uri, line, column)
    } catch (error) {
      console.error('[daemon:hover] Error:', error)
      return null
    }
  })

  /** 获取文档符号 */
  ipcMain.handle('daemon:documentSymbols', async (_, uri: string) => {
    try {
      return await daemon.getDocumentSymbols(uri)
    } catch (error) {
      console.error('[daemon:documentSymbols] Error:', error)
      return []
    }
  })

  /** 搜索工作区符号 */
  ipcMain.handle('daemon:searchSymbols', async (_, query: string) => {
    try {
      return await daemon.searchSymbols(query)
    } catch (error) {
      console.error('[daemon:searchSymbols] Error:', error)
      return []
    }
  })

  /** 获取诊断 */
  ipcMain.handle('daemon:diagnostics', async (_, uri: string) => {
    try {
      return await daemon.getDiagnostics(uri)
    } catch (error) {
      console.error('[daemon:diagnostics] Error:', error)
      return { kind: 'full', items: [] }
    }
  })

  // ==================== 重命名 ====================

  /** 准备重命名 */
  ipcMain.handle('daemon:prepareRename', async (_, uri: string, line: number, column: number) => {
    try {
      return await daemon.prepareRename(uri, line, column)
    } catch (error) {
      console.error('[daemon:prepareRename] Error:', error)
      return null
    }
  })

  /** 重命名符号 */
  ipcMain.handle('daemon:rename', async (_, uri: string, line: number, column: number, newName: string) => {
    try {
      return await daemon.rename(uri, line, column, newName)
    } catch (error) {
      console.error('[daemon:rename] Error:', error)
      return null
    }
  })

  // ==================== 重构 ====================

  /** 获取重构动作 */
  ipcMain.handle('daemon:getRefactorActions', async (
    _,
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ) => {
    try {
      return await daemon.getRefactorActions(uri, startLine, startCol, endLine, endCol)
    } catch (error) {
      console.error('[daemon:getRefactorActions] Error:', error)
      return []
    }
  })

  /** 提取为变量 */
  ipcMain.handle('daemon:extractVariable', async (
    _,
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    variableName: string
  ) => {
    try {
      return await daemon.extractVariable(uri, startLine, startCol, endLine, endCol, variableName)
    } catch (error) {
      console.error('[daemon:extractVariable] Error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  /** 提取为方法 */
  ipcMain.handle('daemon:extractMethod', async (
    _,
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number,
    methodName: string
  ) => {
    try {
      return await daemon.extractMethod(uri, startLine, startCol, endLine, endCol, methodName)
    } catch (error) {
      console.error('[daemon:extractMethod] Error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  /** 检查是否可以安全删除 */
  ipcMain.handle('daemon:canSafeDelete', async (
    _,
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ) => {
    try {
      return await daemon.canSafeDelete(uri, startLine, startCol, endLine, endCol)
    } catch (error) {
      console.error('[daemon:canSafeDelete] Error:', error)
      return { canDelete: false, error: (error as Error).message }
    }
  })

  /** 安全删除 */
  ipcMain.handle('daemon:safeDelete', async (
    _,
    uri: string,
    startLine: number,
    startCol: number,
    endLine: number,
    endCol: number
  ) => {
    try {
      return await daemon.safeDelete(uri, startLine, startCol, endLine, endCol)
    } catch (error) {
      console.error('[daemon:safeDelete] Error:', error)
      return { success: false, error: (error as Error).message }
    }
  })

  // ==================== 分析 ====================

  /** 获取 TODO 项 */
  ipcMain.handle('daemon:getTodoItems', async (_, uri: string) => {
    try {
      return await daemon.getTodoItems(uri)
    } catch (error) {
      console.error('[daemon:getTodoItems] Error:', error)
      return []
    }
  })

  /** 获取所有 TODO 项 */
  ipcMain.handle('daemon:getAllTodoItems', async () => {
    try {
      return await daemon.getAllTodoItems()
    } catch (error) {
      console.error('[daemon:getAllTodoItems] Error:', error)
      return []
    }
  })

  /** 获取 TODO 统计 */
  ipcMain.handle('daemon:getTodoStats', async () => {
    try {
      return await daemon.getTodoStats()
    } catch (error) {
      console.error('[daemon:getTodoStats] Error:', error)
      return { total: 0, byKind: {} }
    }
  })

  /** 获取未使用的符号 */
  ipcMain.handle('daemon:getUnusedSymbols', async (_, uri: string) => {
    try {
      return await daemon.getUnusedSymbols(uri)
    } catch (error) {
      console.error('[daemon:getUnusedSymbols] Error:', error)
      return []
    }
  })
}

/** 导出清理函数 */
export { cleanupLanguageDaemon }
