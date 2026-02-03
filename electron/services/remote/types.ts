/**
 * Remote Development Types
 * Types for SSH connections and remote file operations
 */

/**
 * SSH authentication methods
 */
export type AuthMethod = 'password' | 'key' | 'agent'

/**
 * Connection state
 */
export type ConnectionState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * SSH connection configuration
 */
export interface SSHConnectionConfig {
  /** Unique identifier (generated on save) */
  id?: string
  /** Display name for the connection */
  name: string
  /** Remote host */
  host: string
  /** SSH port (default: 22) */
  port: number
  /** Username for SSH login */
  username: string
  /** Authentication method */
  authMethod: AuthMethod
  /** Password (for password auth, encrypted in storage) */
  password?: string
  /** Path to private key file (for key auth) */
  privateKeyPath?: string
  /** Passphrase for private key (encrypted in storage) */
  passphrase?: string
  /** Remote workspace path to open */
  remoteWorkspacePath?: string
  /** Keep alive interval in seconds (default: 30) */
  keepAliveInterval?: number
}

/**
 * Active remote connection
 */
export interface RemoteConnection {
  /** Unique connection ID */
  id: string
  /** Configuration used for this connection */
  config: SSHConnectionConfig
  /** Current connection state */
  state: ConnectionState
  /** Connection error message if any */
  error?: string
  /** When the connection was established */
  connectedAt?: number
  /** Server fingerprint (for verification) */
  fingerprint?: string
}

/**
 * Remote file information (mirrors local FileStat)
 */
export interface RemoteFileStat {
  name: string
  path: string
  isDirectory: boolean
  isFile: boolean
  isSymlink: boolean
  size: number
  mtime: number
  atime: number
  mode: number
}

/**
 * Remote file node (for directory tree)
 */
export interface RemoteFileNode {
  name: string
  path: string
  isDirectory: boolean
  children?: RemoteFileNode[]
}

/**
 * File change event for remote files
 */
export interface RemoteFileChangeEvent {
  connectionId: string
  type: 'created' | 'changed' | 'deleted'
  path: string
  isDirectory: boolean
}

/**
 * Remote terminal options
 */
export interface RemoteTerminalOptions {
  /** Initial working directory */
  cwd?: string
  /** Terminal columns */
  cols?: number
  /** Terminal rows */
  rows?: number
  /** Environment variables */
  env?: Record<string, string>
}

/**
 * Port forwarding configuration
 */
export interface PortForwardConfig {
  /** Local port to listen on */
  localPort: number
  /** Remote host to forward to */
  remoteHost: string
  /** Remote port to forward to */
  remotePort: number
}

/**
 * Active port forward
 */
export interface PortForward {
  id: string
  connectionId: string
  config: PortForwardConfig
  state: 'starting' | 'active' | 'error' | 'stopped'
  error?: string
}

/**
 * Remote service events
 */
export interface RemoteEvents {
  connectionStateChanged: {
    connectionId: string
    state: ConnectionState
    error?: string
  }
  fileChanged: RemoteFileChangeEvent
  terminalData: {
    connectionId: string
    terminalId: string
    data: string
  }
  terminalExit: {
    connectionId: string
    terminalId: string
    exitCode?: number
  }
  portForwardChanged: {
    forwardId: string
    state: PortForward['state']
    error?: string
  }
}

/**
 * Result type for remote operations
 */
export interface RemoteOperationResult<T = void> {
  success: boolean
  data?: T
  error?: string
}
