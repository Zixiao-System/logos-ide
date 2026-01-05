/**
 * 文件系统服务
 * 在 Electron 主进程中处理文件系统操作
 */

import { dialog, ipcMain, BrowserWindow } from 'electron'
import * as fs from 'fs/promises'
import * as fsSync from 'fs'
import * as path from 'path'

/** 文件节点接口 */
export interface FileNode {
  path: string
  name: string
  type: 'file' | 'directory'
  children?: FileNode[]
  size?: number
  modifiedAt?: number
}

/** 文件信息接口 */
export interface FileStat {
  isFile: boolean
  isDirectory: boolean
  size: number
  modifiedAt: number
}

/** 需要忽略的目录和文件 */
const IGNORED_PATTERNS = [
  'node_modules',
  '.git',
  '.DS_Store',
  'Thumbs.db',
  '.idea',
  '.vscode',
  '__pycache__',
  '.pytest_cache',
  '.mypy_cache',
  'dist',
  'build',
  '.next',
  '.nuxt',
  'coverage',
  '.nyc_output',
]

/** 允许显示的以点开头的文件/文件夹 */
const ALLOWED_DOT_FILES = [
  '.gitignore',
  '.github',
  '.gitlab',
  '.gitlab-ci.yml',
  '.env.example',
  '.editorconfig',
  '.prettierrc',
  '.prettierrc.json',
  '.prettierrc.js',
  '.eslintrc',
  '.eslintrc.json',
  '.eslintrc.js',
  '.npmrc',
  '.nvmrc',
  '.dockerignore',
  '.gitattributes',
]

/**
 * 检查是否应该忽略该文件/目录
 */
function shouldIgnore(name: string): boolean {
  // 先检查是否在忽略列表中
  if (IGNORED_PATTERNS.includes(name)) {
    return true
  }
  // 如果是以点开头的文件，检查是否在允许列表中
  if (name.startsWith('.')) {
    return !ALLOWED_DOT_FILES.includes(name)
  }
  return false
}

/**
 * 读取目录内容 (递归)
 */
async function readDirectoryRecursive(
  dirPath: string,
  depth: number = 0,
  maxDepth: number = 2
): Promise<FileNode[]> {
  const nodes: FileNode[] = []

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    // 排序：目录在前，文件在后，按名称排序
    const sortedEntries = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of sortedEntries) {
      // 跳过隐藏文件和特定目录
      if (shouldIgnore(entry.name)) continue

      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        const node: FileNode = {
          path: fullPath,
          name: entry.name,
          type: 'directory',
          children: depth < maxDepth ? await readDirectoryRecursive(fullPath, depth + 1, maxDepth) : []
        }
        nodes.push(node)
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath)
          nodes.push({
            path: fullPath,
            name: entry.name,
            type: 'file',
            size: stat.size,
            modifiedAt: stat.mtimeMs
          })
        } catch {
          // 无法获取文件信息，跳过
          nodes.push({
            path: fullPath,
            name: entry.name,
            type: 'file'
          })
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error)
  }

  return nodes
}

/**
 * 读取单级目录内容 (懒加载用)
 */
async function readDirectorySingle(dirPath: string): Promise<FileNode[]> {
  const nodes: FileNode[] = []

  try {
    const entries = await fs.readdir(dirPath, { withFileTypes: true })

    const sortedEntries = entries.sort((a, b) => {
      if (a.isDirectory() && !b.isDirectory()) return -1
      if (!a.isDirectory() && b.isDirectory()) return 1
      return a.name.localeCompare(b.name)
    })

    for (const entry of sortedEntries) {
      if (shouldIgnore(entry.name)) continue

      const fullPath = path.join(dirPath, entry.name)

      if (entry.isDirectory()) {
        nodes.push({
          path: fullPath,
          name: entry.name,
          type: 'directory',
          children: [] // 空数组表示未展开
        })
      } else if (entry.isFile()) {
        try {
          const stat = await fs.stat(fullPath)
          nodes.push({
            path: fullPath,
            name: entry.name,
            type: 'file',
            size: stat.size,
            modifiedAt: stat.mtimeMs
          })
        } catch {
          nodes.push({
            path: fullPath,
            name: entry.name,
            type: 'file'
          })
        }
      }
    }
  } catch (error) {
    console.error(`Error reading directory ${dirPath}:`, error)
  }

  return nodes
}

/**
 * 注册文件系统 IPC 处理程序
 */
export function registerFileSystemHandlers(): void {
  // 打开文件夹选择对话框
  ipcMain.handle('fs:openFolderDialog', async () => {
    const result = await dialog.showOpenDialog({
      properties: ['openDirectory'],
      title: '选择项目文件夹'
    })

    if (result.canceled || result.filePaths.length === 0) {
      return null
    }

    return result.filePaths[0]
  })

  // 打开文件选择对话框
  ipcMain.handle('fs:openFileDialog', async (_, options?: {
    filters?: { name: string; extensions: string[] }[]
    multiple?: boolean
  }) => {
    const result = await dialog.showOpenDialog({
      properties: options?.multiple ? ['openFile', 'multiSelections'] : ['openFile'],
      filters: options?.filters,
      title: '选择文件'
    })

    if (result.canceled) {
      return options?.multiple ? [] : null
    }

    return options?.multiple ? result.filePaths : result.filePaths[0]
  })

  // 保存文件对话框
  ipcMain.handle('fs:saveFileDialog', async (_, options?: {
    defaultPath?: string
    filters?: { name: string; extensions: string[] }[]
  }) => {
    const result = await dialog.showSaveDialog({
      defaultPath: options?.defaultPath,
      filters: options?.filters,
      title: '保存文件'
    })

    if (result.canceled) {
      return null
    }

    return result.filePath
  })

  // 读取目录内容
  ipcMain.handle('fs:readDirectory', async (_, dirPath: string, recursive: boolean = false) => {
    if (recursive) {
      return readDirectoryRecursive(dirPath)
    }
    return readDirectorySingle(dirPath)
  })

  // 读取文件内容
  ipcMain.handle('fs:readFile', async (_, filePath: string) => {
    try {
      const content = await fs.readFile(filePath, 'utf-8')
      return content
    } catch (error) {
      throw new Error(`无法读取文件: ${(error as Error).message}`)
    }
  })

  // 读取二进制文件
  ipcMain.handle('fs:readFileBuffer', async (_, filePath: string) => {
    try {
      const buffer = await fs.readFile(filePath)
      return buffer
    } catch (error) {
      throw new Error(`无法读取文件: ${(error as Error).message}`)
    }
  })

  // 写入文件内容
  ipcMain.handle('fs:writeFile', async (_, filePath: string, content: string) => {
    try {
      // 确保目录存在
      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })

      await fs.writeFile(filePath, content, 'utf-8')
    } catch (error) {
      throw new Error(`无法写入文件: ${(error as Error).message}`)
    }
  })

  // 创建文件
  ipcMain.handle('fs:createFile', async (_, filePath: string, content: string = '') => {
    try {
      // 检查文件是否已存在
      try {
        await fs.access(filePath)
        throw new Error('文件已存在')
      } catch (e) {
        if ((e as NodeJS.ErrnoException).code !== 'ENOENT') {
          throw e
        }
      }

      // 确保目录存在
      const dir = path.dirname(filePath)
      await fs.mkdir(dir, { recursive: true })

      await fs.writeFile(filePath, content, 'utf-8')
    } catch (error) {
      throw new Error(`无法创建文件: ${(error as Error).message}`)
    }
  })

  // 创建目录
  ipcMain.handle('fs:createDirectory', async (_, dirPath: string) => {
    try {
      await fs.mkdir(dirPath, { recursive: true })
    } catch (error) {
      throw new Error(`无法创建目录: ${(error as Error).message}`)
    }
  })

  // 删除文件或目录
  ipcMain.handle('fs:deleteItem', async (_, itemPath: string) => {
    try {
      const stat = await fs.stat(itemPath)
      if (stat.isDirectory()) {
        await fs.rm(itemPath, { recursive: true, force: true })
      } else {
        await fs.unlink(itemPath)
      }
    } catch (error) {
      throw new Error(`无法删除: ${(error as Error).message}`)
    }
  })

  // 重命名文件或目录
  ipcMain.handle('fs:renameItem', async (_, oldPath: string, newPath: string) => {
    try {
      await fs.rename(oldPath, newPath)
    } catch (error) {
      throw new Error(`无法重命名: ${(error as Error).message}`)
    }
  })

  // 移动文件或目录
  ipcMain.handle('fs:moveItem', async (_, sourcePath: string, targetPath: string) => {
    try {
      await fs.rename(sourcePath, targetPath)
    } catch (error) {
      throw new Error(`无法移动: ${(error as Error).message}`)
    }
  })

  // 复制文件或目录
  ipcMain.handle('fs:copyItem', async (_, sourcePath: string, targetPath: string) => {
    try {
      const stat = await fs.stat(sourcePath)
      if (stat.isDirectory()) {
        await fs.cp(sourcePath, targetPath, { recursive: true })
      } else {
        await fs.copyFile(sourcePath, targetPath)
      }
    } catch (error) {
      throw new Error(`无法复制: ${(error as Error).message}`)
    }
  })

  // 检查文件/目录是否存在
  ipcMain.handle('fs:exists', async (_, itemPath: string) => {
    try {
      await fs.access(itemPath)
      return true
    } catch {
      return false
    }
  })

  // 获取文件/目录信息
  ipcMain.handle('fs:stat', async (_, itemPath: string): Promise<FileStat> => {
    try {
      const stat = await fs.stat(itemPath)
      return {
        isFile: stat.isFile(),
        isDirectory: stat.isDirectory(),
        size: stat.size,
        modifiedAt: stat.mtimeMs
      }
    } catch (error) {
      throw new Error(`无法获取文件信息: ${(error as Error).message}`)
    }
  })

  // 获取用户主目录
  ipcMain.handle('fs:getHomeDir', () => {
    return process.env.HOME || process.env.USERPROFILE || '/'
  })

  // 获取路径分隔符
  ipcMain.handle('fs:getPathSeparator', () => {
    return path.sep
  })

  // 路径操作
  ipcMain.handle('fs:joinPath', (_, ...parts: string[]) => {
    return path.join(...parts)
  })

  ipcMain.handle('fs:dirname', (_, filePath: string) => {
    return path.dirname(filePath)
  })

  ipcMain.handle('fs:basename', (_, filePath: string) => {
    return path.basename(filePath)
  })

  ipcMain.handle('fs:extname', (_, filePath: string) => {
    return path.extname(filePath)
  })
}

// 文件监听相关
const watchers = new Map<string, fsSync.FSWatcher>()

/**
 * 注册文件监听 IPC 处理程序
 */
export function registerFileWatcherHandlers(getMainWindow: () => BrowserWindow | null): void {
  // 开始监听目录
  ipcMain.handle('fs:watchDirectory', (_, dirPath: string) => {
    if (watchers.has(dirPath)) {
      return // 已经在监听
    }

    try {
      const watcher = fsSync.watch(dirPath, { recursive: true }, (eventType, filename) => {
        const mainWindow = getMainWindow()
        if (mainWindow && filename) {
          mainWindow.webContents.send('fs:change', {
            type: eventType,
            path: path.join(dirPath, filename)
          })
        }
      })

      watchers.set(dirPath, watcher)
    } catch (error) {
      console.error(`无法监听目录 ${dirPath}:`, error)
    }
  })

  // 停止监听目录
  ipcMain.handle('fs:unwatchDirectory', (_, dirPath: string) => {
    const watcher = watchers.get(dirPath)
    if (watcher) {
      watcher.close()
      watchers.delete(dirPath)
    }
  })

  // 停止所有监听
  ipcMain.handle('fs:unwatchAll', () => {
    for (const watcher of watchers.values()) {
      watcher.close()
    }
    watchers.clear()
  })
}

/**
 * 清理所有文件监听器
 */
export function cleanupFileWatchers(): void {
  for (const watcher of watchers.values()) {
    watcher.close()
  }
  watchers.clear()
}
