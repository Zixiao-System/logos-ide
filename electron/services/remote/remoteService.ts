/**
 * Remote Service
 * Main orchestrator for remote development functionality
 */
import { EventEmitter } from 'events'
import { app } from 'electron'
import { SSHConnectionManager } from './sshConnection'
import { RemoteFileService } from './remoteFileService'
import { RemoteFileWatcher } from './remoteFileWatcher'
import type {
  SSHConnectionConfig,
  RemoteConnection,
  RemoteFileNode,
  RemoteFileStat,
  RemoteTerminalOptions,
  RemoteOperationResult,
  PortForwardConfig,
  PortForward
} from './types'

export class RemoteService extends EventEmitter {
  private connectionManager: SSHConnectionManager
  private fileService: RemoteFileService
  private fileWatcher: RemoteFileWatcher
  private initialized = false

  constructor() {
    super()
    const userDataPath = app.getPath('userData')
    this.connectionManager = new SSHConnectionManager(userDataPath)
    this.fileService = new RemoteFileService(this.connectionManager)
    this.fileWatcher = new RemoteFileWatcher(this.connectionManager)
  }

  /**
   * Initialize the remote service
   */
  initialize(): void {
    if (this.initialized) return

    // Forward events from connection manager
    this.connectionManager.on('connectionStateChanged', (data) => {
      this.emit('connectionStateChanged', data)
      // Stop watching files when disconnected
      if (data.state === 'disconnected' || data.state === 'error') {
        this.fileWatcher.unwatchConnection(data.connectionId)
      }
    })

    this.connectionManager.on('terminalExit', (data) => {
      this.emit('terminalExit', data)
    })

    this.connectionManager.on('portForwardChanged', (data) => {
      this.emit('portForwardChanged', data)
    })

    // Forward events from file watcher
    this.fileWatcher.on('fileChanged', (event) => {
      this.emit('fileChanged', event)
    })

    this.initialized = true
    console.log('[RemoteService] Initialized')
  }

  // ============ Connection Management ============

  /**
   * Connect to a remote server
   */
  async connect(config: SSHConnectionConfig): Promise<RemoteOperationResult<RemoteConnection>> {
    try {
      const connection = await this.connectionManager.connect(config)
      return { success: true, data: connection }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Disconnect from a remote server
   */
  disconnect(connectionId: string): RemoteOperationResult {
    try {
      this.connectionManager.disconnect(connectionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Get a connection by ID
   */
  getConnection(connectionId: string): RemoteConnection | undefined {
    return this.connectionManager.getConnection(connectionId)
  }

  /**
   * List all active connections
   */
  listConnections(): RemoteConnection[] {
    return this.connectionManager.listConnections()
  }

  /**
   * Test a connection configuration
   */
  async testConnection(config: SSHConnectionConfig): Promise<RemoteOperationResult> {
    return this.connectionManager.testConnection(config)
  }

  // ============ Saved Connections ============

  /**
   * Save a connection configuration
   */
  async saveConnection(config: SSHConnectionConfig): Promise<RemoteOperationResult<SSHConnectionConfig>> {
    try {
      const saved = await this.connectionManager.saveConnection(config)
      return { success: true, data: saved }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Delete a saved connection
   */
  async deleteSavedConnection(connectionId: string): Promise<RemoteOperationResult> {
    try {
      await this.connectionManager.deleteSavedConnection(connectionId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Get all saved connections
   */
  async getSavedConnections(): Promise<SSHConnectionConfig[]> {
    return this.connectionManager.getSavedConnections()
  }

  // ============ File System Operations ============

  /**
   * Read directory contents
   */
  async readDirectory(connectionId: string, dirPath: string, recursive = false): Promise<RemoteOperationResult<RemoteFileNode[]>> {
    try {
      const nodes = await this.fileService.readDirectory(connectionId, dirPath, recursive)
      return { success: true, data: nodes }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Read file contents
   */
  async readFile(connectionId: string, filePath: string): Promise<RemoteOperationResult<string>> {
    try {
      const content = await this.fileService.readFile(connectionId, filePath)
      return { success: true, data: content }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Write file contents
   */
  async writeFile(connectionId: string, filePath: string, content: string): Promise<RemoteOperationResult> {
    try {
      await this.fileService.writeFile(connectionId, filePath, content)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Create a file
   */
  async createFile(connectionId: string, filePath: string, content = ''): Promise<RemoteOperationResult> {
    try {
      await this.fileService.createFile(connectionId, filePath, content)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Create a directory
   */
  async createDirectory(connectionId: string, dirPath: string): Promise<RemoteOperationResult> {
    try {
      await this.fileService.createDirectory(connectionId, dirPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Delete a file or directory
   */
  async deleteItem(connectionId: string, itemPath: string): Promise<RemoteOperationResult> {
    try {
      await this.fileService.deleteItem(connectionId, itemPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Rename/move a file or directory
   */
  async renameItem(connectionId: string, oldPath: string, newPath: string): Promise<RemoteOperationResult> {
    try {
      await this.fileService.renameItem(connectionId, oldPath, newPath)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Check if a file/directory exists
   */
  async exists(connectionId: string, itemPath: string): Promise<boolean> {
    return this.fileService.exists(connectionId, itemPath)
  }

  /**
   * Get file/directory stats
   */
  async stat(connectionId: string, itemPath: string): Promise<RemoteOperationResult<RemoteFileStat>> {
    try {
      const stat = await this.fileService.stat(connectionId, itemPath)
      return { success: true, data: stat }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  // ============ Port Forwarding ============

  /**
   * Create a port forward
   */
  async forwardPort(connectionId: string, config: PortForwardConfig): Promise<RemoteOperationResult<PortForward>> {
    try {
      const forward = await this.connectionManager.forwardPort(connectionId, config)
      return { success: true, data: forward }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Stop a port forward
   */
  unforwardPort(forwardId: string): RemoteOperationResult {
    try {
      this.connectionManager.unforwardPort(forwardId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * List all port forwards for a connection
   */
  listPortForwards(connectionId: string): PortForward[] {
    return this.connectionManager.listPortForwards(connectionId)
  }

  // ============ File Watching ============

  /**
   * Watch a remote path for changes
   */
  async watchPath(connectionId: string, remotePath: string): Promise<RemoteOperationResult<string>> {
    try {
      const watchId = await this.fileWatcher.watch(connectionId, remotePath)
      return { success: true, data: watchId }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Stop watching a path
   */
  unwatchPath(watchId: string): RemoteOperationResult {
    try {
      this.fileWatcher.unwatch(watchId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Get all watch IDs for a connection
   */
  getWatches(connectionId: string): string[] {
    return this.fileWatcher.getWatchesForConnection(connectionId)
  }

  // ============ Terminal Operations ============

  /**
   * Create a remote terminal
   */
  async createTerminal(connectionId: string, terminalId: string, options?: RemoteTerminalOptions): Promise<RemoteOperationResult> {
    try {
      const channel = await this.connectionManager.createShellChannel(connectionId, terminalId, {
        cols: options?.cols,
        rows: options?.rows,
        cwd: options?.cwd
      })

      // Forward terminal data
      channel.on('data', (data: Buffer) => {
        this.emit('terminalData', {
          connectionId,
          terminalId,
          data: data.toString()
        })
      })

      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Write to a remote terminal
   */
  writeTerminal(connectionId: string, terminalId: string, data: string): RemoteOperationResult {
    try {
      const channel = this.connectionManager.getShellChannel(connectionId, terminalId)
      if (!channel) {
        return { success: false, error: 'Terminal not found' }
      }
      channel.write(data)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Resize a remote terminal
   */
  resizeTerminal(connectionId: string, terminalId: string, cols: number, rows: number): RemoteOperationResult {
    try {
      this.connectionManager.resizeShellChannel(connectionId, terminalId, cols, rows)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  /**
   * Destroy a remote terminal
   */
  destroyTerminal(connectionId: string, terminalId: string): RemoteOperationResult {
    try {
      this.connectionManager.closeShellChannel(connectionId, terminalId)
      return { success: true }
    } catch (error) {
      return { success: false, error: (error as Error).message }
    }
  }

  // ============ Cleanup ============

  /**
   * Cleanup all connections
   */
  cleanup(): void {
    this.fileWatcher.cleanup()
    this.connectionManager.cleanup()
    console.log('[RemoteService] Cleaned up')
  }
}

// Singleton instance
let remoteServiceInstance: RemoteService | null = null

export function getRemoteService(): RemoteService {
  if (!remoteServiceInstance) {
    remoteServiceInstance = new RemoteService()
    remoteServiceInstance.initialize()
  }
  return remoteServiceInstance
}
