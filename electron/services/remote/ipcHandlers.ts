/**
 * Remote IPC Handlers
 * Registers IPC handlers for remote development functionality
 */
import { ipcMain, BrowserWindow } from 'electron'
import { getRemoteService } from './remoteService'
import type { SSHConnectionConfig, RemoteTerminalOptions, PortForwardConfig } from './types'

export function registerRemoteHandlers(): void {
  const remoteService = getRemoteService()

  // ============ Connection Management ============

  ipcMain.handle('remote:connect', async (_, config: SSHConnectionConfig) => {
    return remoteService.connect(config)
  })

  ipcMain.handle('remote:disconnect', (_, connectionId: string) => {
    return remoteService.disconnect(connectionId)
  })

  ipcMain.handle('remote:getConnection', (_, connectionId: string) => {
    return remoteService.getConnection(connectionId)
  })

  ipcMain.handle('remote:listConnections', () => {
    return remoteService.listConnections()
  })

  ipcMain.handle('remote:testConnection', async (_, config: SSHConnectionConfig) => {
    return remoteService.testConnection(config)
  })

  // ============ Saved Connections ============

  ipcMain.handle('remote:saveConnection', async (_, config: SSHConnectionConfig) => {
    return remoteService.saveConnection(config)
  })

  ipcMain.handle('remote:deleteSavedConnection', async (_, connectionId: string) => {
    return remoteService.deleteSavedConnection(connectionId)
  })

  ipcMain.handle('remote:getSavedConnections', async () => {
    return remoteService.getSavedConnections()
  })

  // ============ File System Operations ============

  ipcMain.handle('remote:fs:readDirectory', async (_, connectionId: string, dirPath: string, recursive?: boolean) => {
    return remoteService.readDirectory(connectionId, dirPath, recursive)
  })

  ipcMain.handle('remote:fs:readFile', async (_, connectionId: string, filePath: string) => {
    return remoteService.readFile(connectionId, filePath)
  })

  ipcMain.handle('remote:fs:writeFile', async (_, connectionId: string, filePath: string, content: string) => {
    return remoteService.writeFile(connectionId, filePath, content)
  })

  ipcMain.handle('remote:fs:createFile', async (_, connectionId: string, filePath: string, content?: string) => {
    return remoteService.createFile(connectionId, filePath, content)
  })

  ipcMain.handle('remote:fs:createDirectory', async (_, connectionId: string, dirPath: string) => {
    return remoteService.createDirectory(connectionId, dirPath)
  })

  ipcMain.handle('remote:fs:deleteItem', async (_, connectionId: string, itemPath: string) => {
    return remoteService.deleteItem(connectionId, itemPath)
  })

  ipcMain.handle('remote:fs:renameItem', async (_, connectionId: string, oldPath: string, newPath: string) => {
    return remoteService.renameItem(connectionId, oldPath, newPath)
  })

  ipcMain.handle('remote:fs:exists', async (_, connectionId: string, itemPath: string) => {
    return remoteService.exists(connectionId, itemPath)
  })

  ipcMain.handle('remote:fs:stat', async (_, connectionId: string, itemPath: string) => {
    return remoteService.stat(connectionId, itemPath)
  })

  // ============ Terminal Operations ============

  ipcMain.handle('remote:terminal:create', async (_, connectionId: string, terminalId: string, options?: RemoteTerminalOptions) => {
    return remoteService.createTerminal(connectionId, terminalId, options)
  })

  ipcMain.handle('remote:terminal:write', (_, connectionId: string, terminalId: string, data: string) => {
    return remoteService.writeTerminal(connectionId, terminalId, data)
  })

  ipcMain.handle('remote:terminal:resize', (_, connectionId: string, terminalId: string, cols: number, rows: number) => {
    return remoteService.resizeTerminal(connectionId, terminalId, cols, rows)
  })

  ipcMain.handle('remote:terminal:destroy', (_, connectionId: string, terminalId: string) => {
    return remoteService.destroyTerminal(connectionId, terminalId)
  })

  // ============ Port Forwarding ============

  ipcMain.handle('remote:port:forward', async (_, connectionId: string, config: PortForwardConfig) => {
    return remoteService.forwardPort(connectionId, config)
  })

  ipcMain.handle('remote:port:unforward', (_, forwardId: string) => {
    return remoteService.unforwardPort(forwardId)
  })

  ipcMain.handle('remote:port:list', (_, connectionId: string) => {
    return remoteService.listPortForwards(connectionId)
  })

  // ============ File Watching ============

  ipcMain.handle('remote:watch', async (_, connectionId: string, remotePath: string) => {
    return remoteService.watchPath(connectionId, remotePath)
  })

  ipcMain.handle('remote:unwatch', (_, watchId: string) => {
    return remoteService.unwatchPath(watchId)
  })

  // ============ Event Forwarding ============

  // Forward connection state changes to renderer
  remoteService.on('connectionStateChanged', (data) => {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      window.webContents.send('remote:connectionStateChanged', data)
    }
  })

  // Forward terminal data to renderer
  remoteService.on('terminalData', (data) => {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      window.webContents.send('remote:terminal:data', data)
    }
  })

  // Forward terminal exit to renderer
  remoteService.on('terminalExit', (data) => {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      window.webContents.send('remote:terminal:exit', data)
    }
  })

  // Forward port forward changes to renderer
  remoteService.on('portForwardChanged', (data) => {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      window.webContents.send('remote:port:changed', data)
    }
  })

  // Forward file changes to renderer
  remoteService.on('fileChanged', (data) => {
    const windows = BrowserWindow.getAllWindows()
    for (const window of windows) {
      window.webContents.send('remote:fileChanged', data)
    }
  })

  console.log('[RemoteHandlers] Registered')
}

export function cleanupRemoteConnections(): void {
  const remoteService = getRemoteService()
  remoteService.cleanup()
}
