/**
 * Remote Development Store
 * Pinia store for managing remote SSH connections
 */
import { defineStore } from 'pinia'

/** SSH authentication method */
export type AuthMethod = 'password' | 'key' | 'agent'

/** Connection state */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/** SSH connection configuration */
export interface SSHConnectionConfig {
  id?: string
  name: string
  host: string
  port: number
  username: string
  authMethod: AuthMethod
  password?: string
  privateKeyPath?: string
  passphrase?: string
  remoteWorkspacePath?: string
  keepAliveInterval?: number
}

/** Remote connection */
export interface RemoteConnection {
  id: string
  config: SSHConnectionConfig
  state: ConnectionState
  error?: string
  connectedAt?: number
  fingerprint?: string
}

/** Remote file node */
export interface RemoteFileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: RemoteFileNode[]
}

/** Port forward configuration */
export interface PortForwardConfig {
  localPort: number
  remoteHost: string
  remotePort: number
}

/** Port forward */
export interface PortForward {
  id: string
  connectionId: string
  config: PortForwardConfig
  state: 'starting' | 'active' | 'error' | 'stopped'
  error?: string
}

/** Remote state */
export interface RemoteState {
  /** All active connections */
  connections: RemoteConnection[]
  /** Currently selected connection ID */
  activeConnectionId: string | null
  /** Saved connection configurations */
  savedConnections: SSHConnectionConfig[]
  /** Whether a connection operation is in progress */
  isConnecting: boolean
  /** Connection error message */
  connectionError: string | null
  /** Remote workspace root path */
  remoteWorkspaceRoot: string | null
  /** Expanded folders in remote explorer */
  expandedFolders: Set<string>
  /** Remote directory tree */
  directoryTree: RemoteFileNode[]
  /** Loading state */
  isLoadingDirectory: boolean
  /** Active port forwards */
  portForwards: PortForward[]
}

export const useRemoteStore = defineStore('remote', {
  state: (): RemoteState => ({
    connections: [],
    activeConnectionId: null,
    savedConnections: [],
    isConnecting: false,
    connectionError: null,
    remoteWorkspaceRoot: null,
    expandedFolders: new Set(),
    directoryTree: [],
    isLoadingDirectory: false,
    portForwards: []
  }),

  getters: {
    /** Get the active connection */
    activeConnection(state): RemoteConnection | null {
      if (!state.activeConnectionId) return null
      return state.connections.find(c => c.id === state.activeConnectionId) ?? null
    },

    /** Check if connected to a remote server */
    isConnected(state): boolean {
      return state.connections.some(c => c.state === 'connected')
    },

    /** Get connected connections */
    connectedConnections(state): RemoteConnection[] {
      return state.connections.filter(c => c.state === 'connected')
    }
  },

  actions: {
    /** Initialize the store - load saved connections */
    async init() {
      await this.loadSavedConnections()

      // Set up event listeners
      if (window.electronAPI?.remote) {
        window.electronAPI.remote.onConnectionStateChanged((data) => {
          this.updateConnectionState(data.connectionId, data.state, data.error)
        })

        window.electronAPI.remote.onPortForwardChanged((data) => {
          this.updatePortForwardState(data.forwardId, data.state as PortForward['state'], data.error)
        })

        window.electronAPI.remote.onFileChanged((data) => {
          this.handleRemoteFileChange(data)
        })
      }
    },

    /** Load saved connections from storage */
    async loadSavedConnections() {
      if (!window.electronAPI?.remote) return

      try {
        this.savedConnections = await window.electronAPI.remote.getSavedConnections()
      } catch (error) {
        console.error('[RemoteStore] Failed to load saved connections:', error)
      }
    },

    /** Connect to a remote server */
    async connect(config: SSHConnectionConfig): Promise<boolean> {
      if (!window.electronAPI?.remote) return false

      this.isConnecting = true
      this.connectionError = null

      try {
        const result = await window.electronAPI.remote.connect(config)
        if (result.success && result.data) {
          const connection = result.data
          this.connections.push(connection)
          this.activeConnectionId = connection.id

          // Set workspace root if configured
          if (config.remoteWorkspacePath) {
            this.remoteWorkspaceRoot = config.remoteWorkspacePath
            await this.loadDirectory(config.remoteWorkspacePath)
          }

          return true
        } else {
          this.connectionError = result.error ?? 'Connection failed'
          return false
        }
      } catch (error) {
        this.connectionError = (error as Error).message
        return false
      } finally {
        this.isConnecting = false
      }
    },

    /** Disconnect from a remote server */
    async disconnect(connectionId: string): Promise<boolean> {
      if (!window.electronAPI?.remote) return false

      try {
        const result = await window.electronAPI.remote.disconnect(connectionId)
        if (result.success) {
          this.removeConnection(connectionId)
          return true
        }
        return false
      } catch (error) {
        console.error('[RemoteStore] Disconnect failed:', error)
        return false
      }
    },

    /** Disconnect all connections */
    async disconnectAll(): Promise<void> {
      const connectionIds = this.connections.map(c => c.id)
      for (const id of connectionIds) {
        await this.disconnect(id)
      }
    },

    /** Test a connection configuration */
    async testConnection(config: SSHConnectionConfig): Promise<{ success: boolean; error?: string }> {
      if (!window.electronAPI?.remote) {
        return { success: false, error: 'Remote API not available' }
      }

      return window.electronAPI.remote.testConnection(config)
    },

    /** Save a connection configuration */
    async saveConnection(config: SSHConnectionConfig): Promise<boolean> {
      if (!window.electronAPI?.remote) return false

      try {
        const result = await window.electronAPI.remote.saveConnection(config)
        if (result.success && result.data) {
          // Update or add to saved connections
          const index = this.savedConnections.findIndex(c => c.id === result.data!.id)
          if (index >= 0) {
            this.savedConnections[index] = result.data
          } else {
            this.savedConnections.push(result.data)
          }
          return true
        }
        return false
      } catch (error) {
        console.error('[RemoteStore] Failed to save connection:', error)
        return false
      }
    },

    /** Delete a saved connection */
    async deleteSavedConnection(connectionId: string): Promise<boolean> {
      if (!window.electronAPI?.remote) return false

      try {
        const result = await window.electronAPI.remote.deleteSavedConnection(connectionId)
        if (result.success) {
          this.savedConnections = this.savedConnections.filter(c => c.id !== connectionId)
          return true
        }
        return false
      } catch (error) {
        console.error('[RemoteStore] Failed to delete saved connection:', error)
        return false
      }
    },

    /** Update connection state */
    updateConnectionState(connectionId: string, state: ConnectionState, error?: string) {
      const connection = this.connections.find(c => c.id === connectionId)
      if (connection) {
        connection.state = state
        connection.error = error

        if (state === 'disconnected' || state === 'error') {
          this.removeConnection(connectionId)
        }
      }
    },

    /** Remove a connection from the list */
    removeConnection(connectionId: string) {
      const index = this.connections.findIndex(c => c.id === connectionId)
      if (index >= 0) {
        this.connections.splice(index, 1)
      }

      if (this.activeConnectionId === connectionId) {
        this.activeConnectionId = this.connections[0]?.id ?? null

        // Clear directory tree if no active connection
        if (!this.activeConnectionId) {
          this.directoryTree = []
          this.remoteWorkspaceRoot = null
        }
      }
    },

    /** Set the active connection */
    setActiveConnection(connectionId: string | null) {
      this.activeConnectionId = connectionId
    },

    // ============ File System Operations ============

    /** Load a directory */
    async loadDirectory(dirPath: string): Promise<RemoteFileNode[] | null> {
      if (!window.electronAPI?.remote || !this.activeConnectionId) return null

      this.isLoadingDirectory = true

      try {
        const result = await window.electronAPI.remote.fs.readDirectory(
          this.activeConnectionId,
          dirPath
        )

        if (result.success && result.data) {
          if (dirPath === this.remoteWorkspaceRoot) {
            this.directoryTree = result.data
          }
          return result.data
        }
        return null
      } catch (error) {
        console.error('[RemoteStore] Failed to load directory:', error)
        return null
      } finally {
        this.isLoadingDirectory = false
      }
    },

    /** Toggle folder expanded state */
    toggleFolder(folderPath: string) {
      if (this.expandedFolders.has(folderPath)) {
        this.expandedFolders.delete(folderPath)
      } else {
        this.expandedFolders.add(folderPath)
      }
    },

    /** Check if a folder is expanded */
    isFolderExpanded(folderPath: string): boolean {
      return this.expandedFolders.has(folderPath)
    },

    /** Read a file from the remote server */
    async readFile(filePath: string): Promise<string | null> {
      if (!window.electronAPI?.remote || !this.activeConnectionId) return null

      try {
        const result = await window.electronAPI.remote.fs.readFile(
          this.activeConnectionId,
          filePath
        )
        return result.success ? result.data ?? null : null
      } catch (error) {
        console.error('[RemoteStore] Failed to read file:', error)
        return null
      }
    },

    /** Write a file to the remote server */
    async writeFile(filePath: string, content: string): Promise<boolean> {
      if (!window.electronAPI?.remote || !this.activeConnectionId) return false

      try {
        const result = await window.electronAPI.remote.fs.writeFile(
          this.activeConnectionId,
          filePath,
          content
        )
        return result.success
      } catch (error) {
        console.error('[RemoteStore] Failed to write file:', error)
        return false
      }
    },

    /** Create a new file */
    async createFile(filePath: string, content = ''): Promise<boolean> {
      if (!window.electronAPI?.remote || !this.activeConnectionId) return false

      try {
        const result = await window.electronAPI.remote.fs.createFile(
          this.activeConnectionId,
          filePath,
          content
        )
        if (result.success) {
          // Reload parent directory
          const parentPath = filePath.substring(0, filePath.lastIndexOf('/'))
          await this.loadDirectory(parentPath || this.remoteWorkspaceRoot || '/')
        }
        return result.success
      } catch (error) {
        console.error('[RemoteStore] Failed to create file:', error)
        return false
      }
    },

    /** Create a new directory */
    async createDirectory(dirPath: string): Promise<boolean> {
      if (!window.electronAPI?.remote || !this.activeConnectionId) return false

      try {
        const result = await window.electronAPI.remote.fs.createDirectory(
          this.activeConnectionId,
          dirPath
        )
        if (result.success) {
          // Reload parent directory
          const parentPath = dirPath.substring(0, dirPath.lastIndexOf('/'))
          await this.loadDirectory(parentPath || this.remoteWorkspaceRoot || '/')
        }
        return result.success
      } catch (error) {
        console.error('[RemoteStore] Failed to create directory:', error)
        return false
      }
    },

    /** Delete a file or directory */
    async deleteItem(itemPath: string): Promise<boolean> {
      if (!window.electronAPI?.remote || !this.activeConnectionId) return false

      try {
        const result = await window.electronAPI.remote.fs.deleteItem(
          this.activeConnectionId,
          itemPath
        )
        if (result.success) {
          // Reload parent directory
          const parentPath = itemPath.substring(0, itemPath.lastIndexOf('/'))
          await this.loadDirectory(parentPath || this.remoteWorkspaceRoot || '/')
        }
        return result.success
      } catch (error) {
        console.error('[RemoteStore] Failed to delete item:', error)
        return false
      }
    },

    /** Rename/move a file or directory */
    async renameItem(oldPath: string, newPath: string): Promise<boolean> {
      if (!window.electronAPI?.remote || !this.activeConnectionId) return false

      try {
        const result = await window.electronAPI.remote.fs.renameItem(
          this.activeConnectionId,
          oldPath,
          newPath
        )
        if (result.success) {
          // Reload parent directories
          const oldParent = oldPath.substring(0, oldPath.lastIndexOf('/'))
          const newParent = newPath.substring(0, newPath.lastIndexOf('/'))
          await this.loadDirectory(oldParent || this.remoteWorkspaceRoot || '/')
          if (oldParent !== newParent) {
            await this.loadDirectory(newParent || this.remoteWorkspaceRoot || '/')
          }
        }
        return result.success
      } catch (error) {
        console.error('[RemoteStore] Failed to rename item:', error)
        return false
      }
    },

    /** Clear all state */
    clear() {
      this.connections = []
      this.activeConnectionId = null
      this.connectionError = null
      this.remoteWorkspaceRoot = null
      this.expandedFolders.clear()
      this.directoryTree = []
      this.portForwards = []
    },

    // ============ Port Forwarding ============

    /** Create a port forward */
    async createPortForward(connectionId: string, config: PortForwardConfig): Promise<PortForward | null> {
      if (!window.electronAPI?.remote?.port) return null

      try {
        const result = await window.electronAPI.remote.port.forward(connectionId, config)
        if (result.success && result.data) {
          const forward: PortForward = {
            id: result.data.id,
            connectionId: result.data.connectionId,
            config: result.data.config,
            state: result.data.state as PortForward['state'],
            error: result.data.error
          }
          this.portForwards.push(forward)
          return forward
        }
        return null
      } catch (error) {
        console.error('[RemoteStore] Failed to create port forward:', error)
        return null
      }
    },

    /** Stop a port forward */
    async stopPortForward(forwardId: string): Promise<boolean> {
      if (!window.electronAPI?.remote?.port) return false

      try {
        const result = await window.electronAPI.remote.port.unforward(forwardId)
        if (result.success) {
          this.portForwards = this.portForwards.filter(f => f.id !== forwardId)
          return true
        }
        return false
      } catch (error) {
        console.error('[RemoteStore] Failed to stop port forward:', error)
        return false
      }
    },

    /** List port forwards for a connection */
    async loadPortForwards(connectionId: string): Promise<void> {
      if (!window.electronAPI?.remote?.port) return

      try {
        const forwards = await window.electronAPI.remote.port.list(connectionId)
        // Update port forwards for this connection
        this.portForwards = this.portForwards.filter(f => f.connectionId !== connectionId)
        for (const f of forwards) {
          this.portForwards.push({
            id: f.id,
            connectionId: f.connectionId,
            config: f.config,
            state: f.state as PortForward['state'],
            error: f.error
          })
        }
      } catch (error) {
        console.error('[RemoteStore] Failed to load port forwards:', error)
      }
    },

    /** Update port forward state (called from event listener) */
    updatePortForwardState(forwardId: string, state: PortForward['state'], error?: string) {
      const forward = this.portForwards.find(f => f.id === forwardId)
      if (forward) {
        forward.state = state
        forward.error = error
        if (state === 'stopped' || state === 'error') {
          this.portForwards = this.portForwards.filter(f => f.id !== forwardId)
        }
      }
    },

    /** Get port forwards for a connection */
    getPortForwards(connectionId: string): PortForward[] {
      return this.portForwards.filter(f => f.connectionId === connectionId)
    },

    // ============ File Watching ============

    /** Watch a remote path for changes */
    async watchPath(connectionId: string, remotePath: string): Promise<string | null> {
      if (!window.electronAPI?.remote?.watch) return null

      try {
        const result = await window.electronAPI.remote.watch(connectionId, remotePath)
        return result.success ? result.data ?? null : null
      } catch (error) {
        console.error('[RemoteStore] Failed to watch path:', error)
        return null
      }
    },

    /** Stop watching a path */
    async unwatchPath(watchId: string): Promise<boolean> {
      if (!window.electronAPI?.remote?.unwatch) return false

      try {
        const result = await window.electronAPI.remote.unwatch(watchId)
        return result.success
      } catch (error) {
        console.error('[RemoteStore] Failed to unwatch path:', error)
        return false
      }
    },

    /** Handle remote file change event */
    handleRemoteFileChange(data: { connectionId: string; type: 'created' | 'changed' | 'deleted'; path: string; isDirectory: boolean }) {
      console.log(`[RemoteStore] File ${data.type}: ${data.path}`)

      // Reload directory if the change is in the workspace root or an expanded folder
      if (data.isDirectory || data.type === 'created' || data.type === 'deleted') {
        const parentPath = data.path.substring(0, data.path.lastIndexOf('/'))
        if (parentPath && (parentPath === this.remoteWorkspaceRoot || this.expandedFolders.has(parentPath))) {
          this.loadDirectory(parentPath)
        }
      }
    }
  }
})
