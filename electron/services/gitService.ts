/**
 * Git 服务
 * 在 Electron 主进程中处理 Git 操作
 */

import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/** Git 文件状态 */
export type GitFileStatus = 'modified' | 'added' | 'deleted' | 'untracked' | 'renamed' | 'copied'

/** Git 变更文件 */
export interface GitFile {
  path: string
  status: GitFileStatus
  staged: boolean
  oldPath?: string
}

/** Git 分支 */
export interface GitBranch {
  name: string
  current: boolean
  remote?: string
  upstream?: string
  ahead?: number
  behind?: number
}

/** Git 提交 */
export interface GitCommit {
  hash: string
  shortHash: string
  message: string
  author: string
  authorEmail: string
  date: string
}

/** Git 状态 */
export interface GitStatus {
  branch: string
  staged: GitFile[]
  unstaged: GitFile[]
  hasChanges: boolean
  hasUnpushed: boolean
  remote?: {
    ahead: number
    behind: number
  }
}

/**
 * 执行 Git 命令
 */
async function execGit(repoPath: string, args: string): Promise<string> {
  try {
    const { stdout } = await execAsync(`git ${args}`, {
      cwd: repoPath,
      encoding: 'utf-8',
      maxBuffer: 10 * 1024 * 1024 // 10MB
    })
    return stdout
  } catch (error) {
    const err = error as { stderr?: string; message: string }
    throw new Error(err.stderr || err.message)
  }
}

/**
 * 解析 git status --porcelain=v1 输出
 */
function parseGitStatus(output: string): { staged: GitFile[]; unstaged: GitFile[] } {
  const staged: GitFile[] = []
  const unstaged: GitFile[] = []

  const lines = output.trim().split('\n').filter(Boolean)

  for (const line of lines) {
    if (line.length < 3) continue

    const x = line[0] // 暂存区状态
    const y = line[1] // 工作区状态
    let filePath = line.slice(3)
    let oldPath: string | undefined

    // 处理重命名
    if (filePath.includes(' -> ')) {
      const parts = filePath.split(' -> ')
      oldPath = parts[0]
      filePath = parts[1]
    }

    // 解析状态字符
    const parseStatus = (char: string): GitFileStatus => {
      switch (char) {
        case 'M': return 'modified'
        case 'A': return 'added'
        case 'D': return 'deleted'
        case 'R': return 'renamed'
        case 'C': return 'copied'
        case '?': return 'untracked'
        default: return 'modified'
      }
    }

    // 暂存区有变更
    if (x !== ' ' && x !== '?') {
      staged.push({
        path: filePath,
        status: parseStatus(x),
        staged: true,
        oldPath
      })
    }

    // 工作区有变更或未跟踪文件
    if (y !== ' ' || x === '?') {
      unstaged.push({
        path: filePath,
        status: parseStatus(y === ' ' ? x : y),
        staged: false,
        oldPath
      })
    }
  }

  return { staged, unstaged }
}

/**
 * 解析分支列表
 */
function parseBranches(output: string, currentBranch: string): GitBranch[] {
  const branches: GitBranch[] = []
  const lines = output.trim().split('\n').filter(Boolean)

  for (const line of lines) {
    const isCurrent = line.startsWith('*')
    const name = line.replace(/^\*?\s+/, '').trim()

    // 跳过 HEAD detached 状态
    if (name.startsWith('(HEAD')) continue

    branches.push({
      name,
      current: isCurrent || name === currentBranch
    })
  }

  return branches
}

/**
 * 解析提交日志
 */
function parseLog(output: string): GitCommit[] {
  const commits: GitCommit[] = []
  const entries = output.trim().split('\n\n').filter(Boolean)

  for (const entry of entries) {
    const [hash, shortHash, author, authorEmail, date, ...messageParts] = entry.split('\n')
    commits.push({
      hash,
      shortHash,
      author,
      authorEmail,
      date,
      message: messageParts.join('\n')
    })
  }

  return commits
}

/**
 * 注册 Git IPC 处理程序
 */
export function registerGitHandlers(): void {
  // 检查是否是 Git 仓库
  ipcMain.handle('git:isRepo', async (_, repoPath: string): Promise<boolean> => {
    try {
      await execGit(repoPath, 'rev-parse --git-dir')
      return true
    } catch {
      return false
    }
  })

  // 获取 Git 状态
  ipcMain.handle('git:status', async (_, repoPath: string): Promise<GitStatus> => {
    // 获取当前分支
    let branch = 'HEAD'
    try {
      branch = (await execGit(repoPath, 'branch --show-current')).trim() || 'HEAD'
    } catch {
      // detached HEAD
    }

    // 获取文件状态
    const statusOutput = await execGit(repoPath, 'status --porcelain=v1')
    const { staged, unstaged } = parseGitStatus(statusOutput)

    // 获取远程状态
    let remote: { ahead: number; behind: number } | undefined
    let hasUnpushed = false

    try {
      const aheadBehind = await execGit(repoPath, 'rev-list --left-right --count HEAD...@{u}')
      const [ahead, behind] = aheadBehind.trim().split(/\s+/).map(Number)
      remote = { ahead, behind }
      hasUnpushed = ahead > 0
    } catch {
      // 没有上游分支
    }

    return {
      branch,
      staged,
      unstaged,
      hasChanges: staged.length > 0 || unstaged.length > 0,
      hasUnpushed,
      remote
    }
  })

  // 暂存文件
  ipcMain.handle('git:stage', async (_, repoPath: string, filePath: string) => {
    await execGit(repoPath, `add "${filePath}"`)
  })

  // 取消暂存文件
  ipcMain.handle('git:unstage', async (_, repoPath: string, filePath: string) => {
    await execGit(repoPath, `reset HEAD "${filePath}"`)
  })

  // 暂存所有文件
  ipcMain.handle('git:stageAll', async (_, repoPath: string) => {
    await execGit(repoPath, 'add -A')
  })

  // 取消暂存所有文件
  ipcMain.handle('git:unstageAll', async (_, repoPath: string) => {
    await execGit(repoPath, 'reset HEAD')
  })

  // 提交
  ipcMain.handle('git:commit', async (_, repoPath: string, message: string) => {
    // 转义反斜杠和引号，防止破坏 shell 字符串
    const escapedMessage = message.replace(/\\/g, '\\\\').replace(/"/g, '\\"')
    await execGit(repoPath, `commit -m "${escapedMessage}"`)
  })

  // 放弃更改
  ipcMain.handle('git:discard', async (_, repoPath: string, filePath: string) => {
    await execGit(repoPath, `checkout -- "${filePath}"`)
  })

  // 放弃所有更改
  ipcMain.handle('git:discardAll', async (_, repoPath: string) => {
    await execGit(repoPath, 'checkout -- .')
  })

  // 获取分支列表
  ipcMain.handle('git:branches', async (_, repoPath: string): Promise<GitBranch[]> => {
    const currentBranch = (await execGit(repoPath, 'branch --show-current')).trim()
    const output = await execGit(repoPath, 'branch -a')
    return parseBranches(output, currentBranch)
  })

  // 切换分支
  ipcMain.handle('git:checkout', async (_, repoPath: string, branchName: string) => {
    await execGit(repoPath, `checkout "${branchName}"`)
  })

  // 创建分支
  ipcMain.handle('git:createBranch', async (_, repoPath: string, branchName: string, checkout: boolean = true) => {
    if (checkout) {
      await execGit(repoPath, `checkout -b "${branchName}"`)
    } else {
      await execGit(repoPath, `branch "${branchName}"`)
    }
  })

  // 删除分支
  ipcMain.handle('git:deleteBranch', async (_, repoPath: string, branchName: string, force: boolean = false) => {
    const flag = force ? '-D' : '-d'
    await execGit(repoPath, `branch ${flag} "${branchName}"`)
  })

  // 获取文件差异
  ipcMain.handle('git:diff', async (_, repoPath: string, filePath: string, staged: boolean): Promise<string> => {
    const stagedFlag = staged ? '--staged' : ''
    return await execGit(repoPath, `diff ${stagedFlag} "${filePath}"`)
  })

  // 获取文件内容 (某个提交版本)
  ipcMain.handle('git:showFile', async (_, repoPath: string, filePath: string, ref: string = 'HEAD'): Promise<string> => {
    return await execGit(repoPath, `show "${ref}:${filePath}"`)
  })

  // 获取提交历史
  ipcMain.handle('git:log', async (_, repoPath: string, limit: number = 50): Promise<GitCommit[]> => {
    const format = '%H%n%h%n%an%n%ae%n%ci%n%s'
    const output = await execGit(repoPath, `log --format="${format}" -n ${limit}`)
    return parseLog(output)
  })

  // 获取文件的提交历史
  ipcMain.handle('git:logFile', async (_, repoPath: string, filePath: string, limit: number = 20): Promise<GitCommit[]> => {
    const format = '%H%n%h%n%an%n%ae%n%ci%n%s'
    const output = await execGit(repoPath, `log --format="${format}" -n ${limit} --follow -- "${filePath}"`)
    return parseLog(output)
  })

  // 推送
  ipcMain.handle('git:push', async (_, repoPath: string, remote: string = 'origin', branch?: string) => {
    const branchArg = branch ? ` "${branch}"` : ''
    await execGit(repoPath, `push "${remote}"${branchArg}`)
  })

  // 拉取
  ipcMain.handle('git:pull', async (_, repoPath: string, remote: string = 'origin', branch?: string) => {
    const branchArg = branch ? ` "${branch}"` : ''
    await execGit(repoPath, `pull "${remote}"${branchArg}`)
  })

  // 获取远程仓库列表
  ipcMain.handle('git:remotes', async (_, repoPath: string): Promise<string[]> => {
    const output = await execGit(repoPath, 'remote')
    return output.trim().split('\n').filter(Boolean)
  })

  // 初始化仓库
  ipcMain.handle('git:init', async (_, repoPath: string) => {
    await execGit(repoPath, 'init')
  })

  // 克隆仓库
  ipcMain.handle('git:clone', async (_, url: string, targetPath: string) => {
    await execAsync(`git clone "${url}" "${targetPath}"`)
  })

  // 获取当前用户配置
  ipcMain.handle('git:getConfig', async (_, repoPath: string, key: string): Promise<string | null> => {
    try {
      const output = await execGit(repoPath, `config --get ${key}`)
      return output.trim()
    } catch {
      return null
    }
  })

  // 设置配置
  ipcMain.handle('git:setConfig', async (_, repoPath: string, key: string, value: string) => {
    await execGit(repoPath, `config ${key} "${value}"`)
  })

  // 获取 blame 信息
  ipcMain.handle('git:blame', async (_, repoPath: string, filePath: string): Promise<string> => {
    return await execGit(repoPath, `blame "${filePath}"`)
  })

  // Stash 操作
  ipcMain.handle('git:stash', async (_, repoPath: string, message?: string) => {
    const msgArg = message ? ` -m "${message}"` : ''
    await execGit(repoPath, `stash${msgArg}`)
  })

  ipcMain.handle('git:stashPop', async (_, repoPath: string) => {
    await execGit(repoPath, 'stash pop')
  })

  ipcMain.handle('git:stashList', async (_, repoPath: string): Promise<string[]> => {
    const output = await execGit(repoPath, 'stash list')
    return output.trim().split('\n').filter(Boolean)
  })
}
