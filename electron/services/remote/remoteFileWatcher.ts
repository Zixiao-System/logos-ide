/**
 * Remote File Watcher
 * Monitors remote files for changes using polling mechanism
 */
import { EventEmitter } from 'events'
import type { SSHConnectionManager } from './sshConnection'
import type { RemoteFileChangeEvent, RemoteFileStat } from './types'

/**
 * Watch entry for a single path
 */
interface WatchEntry {
  watchId: string
  connectionId: string
  path: string
  isDirectory: boolean
  lastStat: RemoteFileStat | null
  lastContents: string[] | null // For directories
}

/**
 * Options for the file watcher
 */
interface RemoteFileWatcherOptions {
  /** Polling interval in milliseconds (default: 3000) */
  pollInterval?: number
}

export class RemoteFileWatcher extends EventEmitter {
  private connectionManager: SSHConnectionManager
  private watches: Map<string, WatchEntry> = new Map()
  private pollTimer: ReturnType<typeof setInterval> | null = null
  private pollInterval: number
  private nextWatchId: number = 1

  constructor(connectionManager: SSHConnectionManager, options?: RemoteFileWatcherOptions) {
    super()
    this.connectionManager = connectionManager
    this.pollInterval = options?.pollInterval ?? 3000
  }

  /**
   * Watch a remote path for changes
   */
  async watch(connectionId: string, remotePath: string): Promise<string> {
    const sftp = this.connectionManager.getSFTP(connectionId)
    if (!sftp) {
      throw new Error('SFTP not available for connection')
    }

    const watchId = `watch-${this.nextWatchId++}`

    try {
      // Get initial stat
      const stat = await this.getStat(connectionId, remotePath)
      const isDirectory = stat?.isDirectory ?? false

      const entry: WatchEntry = {
        watchId,
        connectionId,
        path: remotePath,
        isDirectory,
        lastStat: stat,
        lastContents: isDirectory ? await this.getDirectoryContents(connectionId, remotePath) : null
      }

      this.watches.set(watchId, entry)

      // Start polling if not already running
      this.startPolling()

      return watchId
    } catch (error) {
      throw new Error(`Failed to watch path: ${(error as Error).message}`)
    }
  }

  /**
   * Stop watching a specific path
   */
  unwatch(watchId: string): void {
    this.watches.delete(watchId)

    // Stop polling if no more watches
    if (this.watches.size === 0) {
      this.stopPolling()
    }
  }

  /**
   * Stop all watches for a connection
   */
  unwatchConnection(connectionId: string): void {
    for (const [watchId, entry] of this.watches.entries()) {
      if (entry.connectionId === connectionId) {
        this.watches.delete(watchId)
      }
    }

    // Stop polling if no more watches
    if (this.watches.size === 0) {
      this.stopPolling()
    }
  }

  /**
   * Get all watch IDs for a connection
   */
  getWatchesForConnection(connectionId: string): string[] {
    const watchIds: string[] = []
    for (const [watchId, entry] of this.watches.entries()) {
      if (entry.connectionId === connectionId) {
        watchIds.push(watchId)
      }
    }
    return watchIds
  }

  /**
   * Cleanup all watches
   */
  cleanup(): void {
    this.stopPolling()
    this.watches.clear()
  }

  // ============ Private Methods ============

  private startPolling(): void {
    if (this.pollTimer) return

    this.pollTimer = setInterval(() => {
      this.pollAll().catch(err => {
        console.error('[RemoteFileWatcher] Poll error:', err)
      })
    }, this.pollInterval)
  }

  private stopPolling(): void {
    if (this.pollTimer) {
      clearInterval(this.pollTimer)
      this.pollTimer = null
    }
  }

  private async pollAll(): Promise<void> {
    for (const entry of this.watches.values()) {
      try {
        await this.pollEntry(entry)
      } catch (error) {
        // Connection might be lost, skip this entry
        console.warn(`[RemoteFileWatcher] Failed to poll ${entry.path}:`, (error as Error).message)
      }
    }
  }

  private async pollEntry(entry: WatchEntry): Promise<void> {
    const sftp = this.connectionManager.getSFTP(entry.connectionId)
    if (!sftp) return

    try {
      const currentStat = await this.getStat(entry.connectionId, entry.path)

      if (!currentStat && entry.lastStat) {
        // File/directory was deleted
        this.emitChange(entry.connectionId, 'deleted', entry.path, entry.isDirectory)
        entry.lastStat = null
        entry.lastContents = null
        return
      }

      if (currentStat && !entry.lastStat) {
        // File/directory was created
        this.emitChange(entry.connectionId, 'created', entry.path, currentStat.isDirectory)
        entry.lastStat = currentStat
        entry.isDirectory = currentStat.isDirectory
        if (entry.isDirectory) {
          entry.lastContents = await this.getDirectoryContents(entry.connectionId, entry.path)
        }
        return
      }

      if (currentStat && entry.lastStat) {
        if (entry.isDirectory) {
          // Check for directory content changes
          const currentContents = await this.getDirectoryContents(entry.connectionId, entry.path)
          if (currentContents) {
            const changes = this.compareDirectoryContents(entry.lastContents || [], currentContents)
            for (const change of changes) {
              this.emitChange(entry.connectionId, change.type, `${entry.path}/${change.name}`, false)
            }
            entry.lastContents = currentContents
          }
        } else {
          // Check for file modification
          if (currentStat.mtime !== entry.lastStat.mtime || currentStat.size !== entry.lastStat.size) {
            this.emitChange(entry.connectionId, 'changed', entry.path, false)
            entry.lastStat = currentStat
          }
        }
      }
    } catch {
      // Ignore errors - connection might be temporarily unavailable
    }
  }

  private async getStat(connectionId: string, remotePath: string): Promise<RemoteFileStat | null> {
    const sftp = this.connectionManager.getSFTP(connectionId)
    if (!sftp) return null

    return new Promise((resolve) => {
      sftp.stat(remotePath, (err, stats) => {
        if (err) {
          resolve(null)
          return
        }

        resolve({
          name: remotePath.split('/').pop() || '',
          path: remotePath,
          isDirectory: stats.isDirectory(),
          isFile: stats.isFile(),
          isSymlink: stats.isSymbolicLink(),
          size: stats.size,
          mtime: stats.mtime * 1000,
          atime: stats.atime * 1000,
          mode: stats.mode
        })
      })
    })
  }

  private async getDirectoryContents(connectionId: string, dirPath: string): Promise<string[] | null> {
    const sftp = this.connectionManager.getSFTP(connectionId)
    if (!sftp) return null

    return new Promise((resolve) => {
      sftp.readdir(dirPath, (err, list) => {
        if (err) {
          resolve(null)
          return
        }

        resolve(list.map(item => item.filename).sort())
      })
    })
  }

  private compareDirectoryContents(
    previous: string[],
    current: string[]
  ): Array<{ type: 'created' | 'deleted'; name: string }> {
    const changes: Array<{ type: 'created' | 'deleted'; name: string }> = []
    const prevSet = new Set(previous)
    const currSet = new Set(current)

    // Find deleted files
    for (const name of previous) {
      if (!currSet.has(name)) {
        changes.push({ type: 'deleted', name })
      }
    }

    // Find created files
    for (const name of current) {
      if (!prevSet.has(name)) {
        changes.push({ type: 'created', name })
      }
    }

    return changes
  }

  private emitChange(
    connectionId: string,
    type: 'created' | 'changed' | 'deleted',
    path: string,
    isDirectory: boolean
  ): void {
    const event: RemoteFileChangeEvent = {
      connectionId,
      type,
      path,
      isDirectory
    }
    this.emit('fileChanged', event)
  }
}
