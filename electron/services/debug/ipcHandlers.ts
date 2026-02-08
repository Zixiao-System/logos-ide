/**
 * Debug IPC Handlers - Register IPC handlers for debug functionality
 */
import { ipcMain, BrowserWindow } from 'electron'
import { getDebugService, cleanupDebugService } from './debugService'
import type { DebugConfig } from './types'

export function registerDebugHandlers(getMainWindow: () => BrowserWindow | null): void {
  const debugService = getDebugService(getMainWindow)

  // ============ Session Management ============

  ipcMain.handle('debug:startSession', async (_, config: DebugConfig, workspaceFolder: string) => {
    try {
      const session = await debugService.startSession(config, workspaceFolder)
      return { success: true, session }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:stopSession', async (_, sessionId?: string) => {
    try {
      await debugService.stopSession(sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:restartSession', async (_, sessionId?: string) => {
    try {
      await debugService.restartSession(sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:getSessions', () => {
    return debugService.getSessions()
  })

  ipcMain.handle('debug:getActiveSession', () => {
    return debugService.getActiveSession()
  })

  ipcMain.handle('debug:setActiveSession', (_, sessionId: string) => {
    debugService.setActiveSession(sessionId)
  })

  // ============ Execution Control ============

  ipcMain.handle('debug:continue', async (_, sessionId?: string) => {
    try {
      await debugService.continue(sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:pause', async (_, sessionId?: string) => {
    try {
      await debugService.pause(sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:stepOver', async (_, sessionId?: string) => {
    try {
      await debugService.stepOver(sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:stepInto', async (_, sessionId?: string) => {
    try {
      await debugService.stepInto(sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:stepOut', async (_, sessionId?: string) => {
    try {
      await debugService.stepOut(sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:restartFrame', async (_, frameId: number, sessionId?: string) => {
    try {
      await debugService.restartFrame(frameId, sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // ============ Breakpoint Management ============

  ipcMain.handle('debug:setBreakpoint', async (_, filePath: string, line: number, options?: {
    condition?: string
    hitCondition?: string
    logMessage?: string
  }) => {
    try {
      const breakpoint = await debugService.setBreakpoint(filePath, line, options)
      return { success: true, breakpoint }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:removeBreakpoint', async (_, breakpointId: string) => {
    try {
      await debugService.removeBreakpoint(breakpointId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:toggleBreakpoint', async (_, breakpointId: string) => {
    try {
      await debugService.toggleBreakpoint(breakpointId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:toggleBreakpointAtLine', async (_, filePath: string, line: number) => {
    try {
      const breakpoint = await debugService.toggleBreakpointAtLine(filePath, line)
      return { success: true, breakpoint }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:getAllBreakpoints', () => {
    return debugService.getAllBreakpoints()
  })

  ipcMain.handle('debug:getBreakpointsForFile', (_, filePath: string) => {
    return debugService.getBreakpointsForFile(filePath)
  })

  ipcMain.handle('debug:editBreakpoint', async (_, breakpointId: string, options: {
    condition?: string
    hitCondition?: string
    logMessage?: string
  }) => {
    try {
      const breakpoint = await debugService.editBreakpoint(breakpointId, options)
      return { success: true, breakpoint }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // ============ Exception Breakpoints ============

  ipcMain.handle('debug:setExceptionBreakpoints', async (_, filters: string[], filterOptions?: Array<{ filterId: string; condition?: string }>, sessionId?: string) => {
    try {
      await debugService.setExceptionBreakpoints(filters, filterOptions, sessionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:getExceptionFilters', (_, sessionId?: string) => {
    try {
      const filters = debugService.getExceptionFilters(sessionId)
      return { success: true, filters }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // ============ Variables & Stack Trace ============

  ipcMain.handle('debug:getThreads', async (_, sessionId?: string) => {
    try {
      const threads = await debugService.getThreads(sessionId)
      return { success: true, threads }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:getStackTrace', async (_, threadId: number, sessionId?: string) => {
    try {
      const frames = await debugService.getStackTrace(threadId, sessionId)
      return { success: true, frames }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:getScopes', async (_, frameId: number, sessionId?: string) => {
    try {
      const scopes = await debugService.getScopes(frameId, sessionId)
      return { success: true, scopes }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:getVariables', async (_, variablesReference: number, sessionId?: string) => {
    try {
      const variables = await debugService.getVariables(variablesReference, sessionId)
      return { success: true, variables }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:setVariable', async (_, variablesReference: number, name: string, value: string, sessionId?: string) => {
    try {
      const variable = await debugService.setVariable(variablesReference, name, value, sessionId)
      return { success: true, variable }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:evaluate', async (_, expression: string, frameId?: number, context?: 'watch' | 'repl' | 'hover', sessionId?: string) => {
    try {
      const result = await debugService.evaluate(expression, frameId, context, sessionId)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:selectFrame', (_, frameId: number, sessionId?: string) => {
    debugService.selectFrame(frameId, sessionId)
  })

  // ============ Watch Expressions ============

  ipcMain.handle('debug:addWatch', (_, expression: string) => {
    return debugService.addWatch(expression)
  })

  ipcMain.handle('debug:removeWatch', (_, watchId: string) => {
    debugService.removeWatch(watchId)
  })

  ipcMain.handle('debug:refreshWatch', async (_, watchId: string) => {
    await debugService.refreshWatch(watchId)
  })

  ipcMain.handle('debug:refreshAllWatches', async () => {
    await debugService.refreshAllWatches()
  })

  ipcMain.handle('debug:getWatchExpressions', () => {
    return debugService.getWatchExpressions()
  })

  // ============ Debug Console ============

  ipcMain.handle('debug:executeInConsole', async (_, command: string, sessionId?: string) => {
    try {
      const result = await debugService.executeInConsole(command, sessionId)
      return { success: true, result }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // ============ Launch Configuration ============

  ipcMain.handle('debug:readLaunchConfig', async (_, workspaceFolder: string) => {
    try {
      const result = await debugService.readLaunchConfig(workspaceFolder)
      return { success: true, config: result.config, source: result.source }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:writeLaunchConfig', async (_, workspaceFolder: string, config: unknown) => {
    try {
      await debugService.writeLaunchConfig(workspaceFolder, config as any)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:getDefaultLaunchConfig', (_, type: string, workspaceFolder: string) => {
    return debugService.getDefaultLaunchConfig(type, workspaceFolder)
  })

  // ============ Auto-Generation & VS Code Import ============

  ipcMain.handle('debug:autoGenerateConfigurations', async (_, workspaceFolder: string) => {
    try {
      const configurations = await debugService.autoGenerateConfigurations(workspaceFolder)
      return { success: true, configurations }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:importFromVSCode', async (_, workspaceFolder: string) => {
    try {
      const imported = await debugService.importFromVSCode(workspaceFolder)
      return { success: imported }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // ============ Adapter Management ============

  ipcMain.handle('debug:getAvailableAdapters', async () => {
    try {
      const adapters = await debugService.getAvailableAdapters()
      return { success: true, adapters }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:getInstalledAdapters', async () => {
    try {
      const adapters = await debugService.getInstalledAdapters()
      return { success: true, adapters }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  ipcMain.handle('debug:detectDebuggers', async (_, workspaceFolder: string) => {
    try {
      const debuggers = await debugService.detectDebuggers(workspaceFolder)
      return { success: true, debuggers }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  })

  // ============ Active File Management ============

  ipcMain.handle('debug:setActiveFile', (_, filePath: string | null) => {
    debugService.setActiveFile(filePath)
  })

  ipcMain.handle('debug:getActiveFile', () => {
    return debugService.getActiveFile()
  })
}

export { cleanupDebugService }
