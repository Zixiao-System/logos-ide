import { autoUpdater, UpdateInfo, ProgressInfo } from 'electron-updater'
import { ipcMain, BrowserWindow } from 'electron'

// 更新状态
export type UpdateStatus =
  | 'checking'
  | 'available'
  | 'not-available'
  | 'downloading'
  | 'downloaded'
  | 'error'

interface UpdateState {
  status: UpdateStatus
  info?: UpdateInfo
  progress?: ProgressInfo
  error?: string
}

let mainWindow: BrowserWindow | null = null
let currentState: UpdateState = { status: 'not-available' }

// 发送状态到渲染进程
function sendStatusToWindow(state: UpdateState) {
  currentState = state
  if (mainWindow) {
    mainWindow.webContents.send('updater:status', state)
  }
}

// 初始化自动更新
export function initAutoUpdater(getMainWindow: () => BrowserWindow | null) {
  // 获取主窗口引用
  mainWindow = getMainWindow()

  // 配置
  autoUpdater.autoDownload = false // 手动控制下载
  autoUpdater.autoInstallOnAppQuit = true

  // 事件处理
  autoUpdater.on('checking-for-update', () => {
    console.log('[Updater] Checking for update...')
    sendStatusToWindow({ status: 'checking' })
  })

  autoUpdater.on('update-available', (info: UpdateInfo) => {
    console.log('[Updater] Update available:', info.version)
    sendStatusToWindow({ status: 'available', info })
  })

  autoUpdater.on('update-not-available', (info: UpdateInfo) => {
    console.log('[Updater] No update available')
    sendStatusToWindow({ status: 'not-available', info })
  })

  autoUpdater.on('error', (err: Error) => {
    console.error('[Updater] Error:', err.message)
    sendStatusToWindow({ status: 'error', error: err.message })
  })

  autoUpdater.on('download-progress', (progress: ProgressInfo) => {
    console.log(`[Updater] Download progress: ${progress.percent.toFixed(1)}%`)
    sendStatusToWindow({
      status: 'downloading',
      progress
    })
  })

  autoUpdater.on('update-downloaded', (info: UpdateInfo) => {
    console.log('[Updater] Update downloaded:', info.version)
    sendStatusToWindow({ status: 'downloaded', info })
  })
}

// 注册 IPC 处理程序
export function registerUpdateHandlers(getMainWindow: () => BrowserWindow | null) {
  // 初始化
  initAutoUpdater(getMainWindow)

  // 检查更新
  ipcMain.handle('updater:check', async () => {
    try {
      const result = await autoUpdater.checkForUpdates()
      return { success: true, result }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 下载更新
  ipcMain.handle('updater:download', async () => {
    try {
      await autoUpdater.downloadUpdate()
      return { success: true }
    } catch (error) {
      return { success: false, error: String(error) }
    }
  })

  // 安装更新（退出并安装）
  ipcMain.handle('updater:install', () => {
    autoUpdater.quitAndInstall(false, true)
    return { success: true }
  })

  // 获取当前状态
  ipcMain.handle('updater:getStatus', () => {
    return currentState
  })

  // 设置自动下载
  ipcMain.handle('updater:setAutoDownload', (_, enabled: boolean) => {
    autoUpdater.autoDownload = enabled
    return { success: true }
  })
}
