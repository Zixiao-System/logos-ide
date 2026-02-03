/**
 * SSH Connection Manager
 * Handles SSH connections using ssh2 library
 */
import { EventEmitter } from 'events'
import { Client, ClientChannel, SFTPWrapper } from 'ssh2'
import * as fs from 'fs'
import * as path from 'path'
import * as crypto from 'crypto'
import * as net from 'net'
import { safeStorage } from 'electron'
import type {
  SSHConnectionConfig,
  RemoteConnection,
  ConnectionState,
  PortForwardConfig,
  PortForward
} from './types'

/**
 * Internal connection entry with client reference
 */
interface ConnectionEntry {
  connection: RemoteConnection
  client: Client
  sftp: SFTPWrapper | null
  shellChannels: Map<string, ClientChannel>
  keepAliveTimer?: ReturnType<typeof setInterval>
}

/**
 * Internal port forward entry
 */
interface PortForwardEntry {
  forward: PortForward
  server: net.Server
}

export class SSHConnectionManager extends EventEmitter {
  private connections: Map<string, ConnectionEntry> = new Map()
  private portForwards: Map<string, PortForwardEntry> = new Map()
  private savedConnectionsPath: string

  constructor(userDataPath: string) {
    super()
    this.savedConnectionsPath = path.join(userDataPath, 'ssh-connections.json')
  }

  /**
   * Connect to an SSH server
   */
  async connect(config: SSHConnectionConfig): Promise<RemoteConnection> {
    const connectionId = config.id || this.generateConnectionId()

    // Check if already connected
    const existing = this.connections.get(connectionId)
    if (existing?.connection.state === 'connected') {
      return existing.connection
    }

    // Create connection entry
    const connection: RemoteConnection = {
      id: connectionId,
      config: { ...config, id: connectionId },
      state: 'connecting'
    }

    const client = new Client()
    const entry: ConnectionEntry = {
      connection,
      client,
      sftp: null,
      shellChannels: new Map()
    }
    this.connections.set(connectionId, entry)
    this.emitStateChange(connectionId, 'connecting')

    return new Promise((resolve, reject) => {
      client.on('ready', async () => {
        connection.state = 'connected'
        connection.connectedAt = Date.now()
        this.emitStateChange(connectionId, 'connected')

        // Initialize SFTP
        try {
          entry.sftp = await this.initSFTP(client)
        } catch (err) {
          console.warn('[SSH] SFTP initialization failed:', err)
        }

        // Start keep-alive
        this.startKeepAlive(connectionId, config.keepAliveInterval || 30)

        resolve(connection)
      })

      client.on('error', (err) => {
        connection.state = 'error'
        connection.error = err.message
        this.emitStateChange(connectionId, 'error', err.message)
        reject(new Error(`SSH connection failed: ${err.message}`))
      })

      client.on('end', () => {
        this.handleDisconnect(connectionId)
      })

      client.on('close', () => {
        this.handleDisconnect(connectionId)
      })

      // Get authentication config
      const authConfig = this.buildAuthConfig(config)

      // Connect
      client.connect({
        host: config.host,
        port: config.port || 22,
        username: config.username,
        ...authConfig,
        readyTimeout: 30000,
        keepaliveInterval: (config.keepAliveInterval || 30) * 1000
      })
    })
  }

  /**
   * Disconnect from an SSH server
   */
  disconnect(connectionId: string): void {
    const entry = this.connections.get(connectionId)
    if (!entry) return

    // Stop keep-alive
    if (entry.keepAliveTimer) {
      clearInterval(entry.keepAliveTimer)
    }

    // Close all shell channels
    for (const channel of entry.shellChannels.values()) {
      channel.end()
    }

    // Close client
    entry.client.end()

    this.handleDisconnect(connectionId)
  }

  /**
   * Get a connection by ID
   */
  getConnection(connectionId: string): RemoteConnection | undefined {
    return this.connections.get(connectionId)?.connection
  }

  /**
   * Get all active connections
   */
  listConnections(): RemoteConnection[] {
    return Array.from(this.connections.values()).map(e => e.connection)
  }

  /**
   * Get the SFTP client for a connection
   */
  getSFTP(connectionId: string): SFTPWrapper | null {
    return this.connections.get(connectionId)?.sftp ?? null
  }

  /**
   * Get the raw SSH client for a connection
   */
  getClient(connectionId: string): Client | undefined {
    return this.connections.get(connectionId)?.client
  }

  /**
   * Test if a connection config is valid
   */
  async testConnection(config: SSHConnectionConfig): Promise<{ success: boolean; error?: string }> {
    const testClient = new Client()

    return new Promise((resolve) => {
      const timeout = setTimeout(() => {
        testClient.end()
        resolve({ success: false, error: 'Connection timeout' })
      }, 15000)

      testClient.on('ready', () => {
        clearTimeout(timeout)
        testClient.end()
        resolve({ success: true })
      })

      testClient.on('error', (err) => {
        clearTimeout(timeout)
        testClient.end()
        resolve({ success: false, error: err.message })
      })

      const authConfig = this.buildAuthConfig(config)

      testClient.connect({
        host: config.host,
        port: config.port || 22,
        username: config.username,
        ...authConfig,
        readyTimeout: 15000
      })
    })
  }

  /**
   * Create a shell channel for terminal
   */
  async createShellChannel(connectionId: string, terminalId: string, options?: { cols?: number; rows?: number; cwd?: string }): Promise<ClientChannel> {
    const entry = this.connections.get(connectionId)
    if (!entry || entry.connection.state !== 'connected') {
      throw new Error('Connection not available')
    }

    return new Promise((resolve, reject) => {
      const ptyOptions = {
        cols: options?.cols || 80,
        rows: options?.rows || 24,
        term: 'xterm-256color'
      }

      entry.client.shell(ptyOptions, (err, stream) => {
        if (err) {
          reject(err)
          return
        }

        entry.shellChannels.set(terminalId, stream)

        // Change to initial directory if specified
        if (options?.cwd) {
          stream.write(`cd ${this.escapeShellArg(options.cwd)}\n`)
        }

        stream.on('close', () => {
          entry.shellChannels.delete(terminalId)
          this.emit('terminalExit', { connectionId, terminalId })
        })

        resolve(stream)
      })
    })
  }

  /**
   * Get a shell channel
   */
  getShellChannel(connectionId: string, terminalId: string): ClientChannel | undefined {
    return this.connections.get(connectionId)?.shellChannels.get(terminalId)
  }

  /**
   * Resize a shell channel
   */
  resizeShellChannel(connectionId: string, terminalId: string, cols: number, rows: number): void {
    const channel = this.getShellChannel(connectionId, terminalId)
    if (channel) {
      channel.setWindow(rows, cols, 0, 0)
    }
  }

  /**
   * Close a shell channel
   */
  closeShellChannel(connectionId: string, terminalId: string): void {
    const channel = this.getShellChannel(connectionId, terminalId)
    if (channel) {
      channel.end()
    }
  }

  // ============ Port Forwarding ============

  /**
   * Create a port forward (local -> remote)
   */
  async forwardPort(connectionId: string, config: PortForwardConfig): Promise<PortForward> {
    const entry = this.connections.get(connectionId)
    if (!entry || entry.connection.state !== 'connected') {
      throw new Error('Connection not available')
    }

    const forwardId = `pf-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
    const forward: PortForward = {
      id: forwardId,
      connectionId,
      config,
      state: 'starting'
    }

    const forwardEntry: PortForwardEntry = {
      forward,
      server: null as unknown as net.Server
    }
    this.portForwards.set(forwardId, forwardEntry)

    return new Promise((resolve, reject) => {
      const server = net.createServer((socket) => {
        // Forward incoming connection through SSH tunnel
        entry.client.forwardOut(
          '127.0.0.1',
          config.localPort,
          config.remoteHost,
          config.remotePort,
          (err, stream) => {
            if (err) {
              console.error('[SSH] Port forward error:', err)
              socket.end()
              return
            }

            socket.pipe(stream)
            stream.pipe(socket)

            socket.on('error', (err: Error) => {
              console.error('[SSH] Socket error:', err.message)
              stream.end()
            })

            stream.on('error', (err: Error) => {
              console.error('[SSH] Stream error:', err.message)
              socket.end()
            })
          }
        )
      })

      server.on('error', (err) => {
        forward.state = 'error'
        forward.error = err.message
        this.portForwards.delete(forwardId)
        this.emitPortForwardChange(forwardId, 'error', err.message)
        reject(new Error(`Port forward failed: ${err.message}`))
      })

      server.listen(config.localPort, '127.0.0.1', () => {
        forward.state = 'active'
        forwardEntry.server = server
        this.emitPortForwardChange(forwardId, 'active')
        resolve(forward)
      })
    })
  }

  /**
   * Stop a port forward
   */
  unforwardPort(forwardId: string): void {
    const entry = this.portForwards.get(forwardId)
    if (!entry) return

    if (entry.server) {
      entry.server.close()
    }

    entry.forward.state = 'stopped'
    this.portForwards.delete(forwardId)
    this.emitPortForwardChange(forwardId, 'stopped')
  }

  /**
   * List all port forwards for a connection
   */
  listPortForwards(connectionId: string): PortForward[] {
    const forwards: PortForward[] = []
    for (const entry of this.portForwards.values()) {
      if (entry.forward.connectionId === connectionId) {
        forwards.push(entry.forward)
      }
    }
    return forwards
  }

  /**
   * Stop all port forwards for a connection
   */
  private stopPortForwardsForConnection(connectionId: string): void {
    for (const [forwardId, entry] of this.portForwards.entries()) {
      if (entry.forward.connectionId === connectionId) {
        if (entry.server) {
          entry.server.close()
        }
        this.portForwards.delete(forwardId)
      }
    }
  }

  private emitPortForwardChange(forwardId: string, state: PortForward['state'], error?: string): void {
    this.emit('portForwardChanged', { forwardId, state, error })
  }

  // ============ Saved Connections ============

  /**
   * Save a connection configuration
   */
  async saveConnection(config: SSHConnectionConfig): Promise<SSHConnectionConfig> {
    const connections = await this.loadSavedConnections()

    // Assign ID if not present
    const savedConfig: SSHConnectionConfig = {
      ...config,
      id: config.id || this.generateConnectionId()
    }

    // Encrypt sensitive data
    if (savedConfig.password) {
      savedConfig.password = this.encryptSecret(savedConfig.password)
    }
    if (savedConfig.passphrase) {
      savedConfig.passphrase = this.encryptSecret(savedConfig.passphrase)
    }

    // Update or add
    const existingIndex = connections.findIndex(c => c.id === savedConfig.id)
    if (existingIndex >= 0) {
      connections[existingIndex] = savedConfig
    } else {
      connections.push(savedConfig)
    }

    await this.writeSavedConnections(connections)
    return savedConfig
  }

  /**
   * Delete a saved connection
   */
  async deleteSavedConnection(connectionId: string): Promise<void> {
    const connections = await this.loadSavedConnections()
    const filtered = connections.filter(c => c.id !== connectionId)
    await this.writeSavedConnections(filtered)
  }

  /**
   * Get all saved connections
   */
  async getSavedConnections(): Promise<SSHConnectionConfig[]> {
    const connections = await this.loadSavedConnections()

    // Decrypt sensitive data before returning
    return connections.map(config => {
      const decrypted = { ...config }
      if (decrypted.password) {
        try {
          decrypted.password = this.decryptSecret(decrypted.password)
        } catch {
          decrypted.password = undefined
        }
      }
      if (decrypted.passphrase) {
        try {
          decrypted.passphrase = this.decryptSecret(decrypted.passphrase)
        } catch {
          decrypted.passphrase = undefined
        }
      }
      return decrypted
    })
  }

  // ============ Private Methods ============

  private buildAuthConfig(config: SSHConnectionConfig): object {
    switch (config.authMethod) {
      case 'password':
        return { password: config.password }

      case 'key':
        if (!config.privateKeyPath) {
          throw new Error('Private key path is required for key authentication')
        }
        const privateKey = fs.readFileSync(config.privateKeyPath)
        return {
          privateKey,
          passphrase: config.passphrase
        }

      case 'agent':
        return { agent: process.env.SSH_AUTH_SOCK }

      default:
        throw new Error(`Unknown auth method: ${config.authMethod}`)
    }
  }

  private initSFTP(client: Client): Promise<SFTPWrapper> {
    return new Promise((resolve, reject) => {
      client.sftp((err, sftp) => {
        if (err) {
          reject(err)
        } else {
          resolve(sftp)
        }
      })
    })
  }

  private startKeepAlive(connectionId: string, intervalSeconds: number): void {
    const entry = this.connections.get(connectionId)
    if (!entry) return

    entry.keepAliveTimer = setInterval(() => {
      // The ssh2 client handles keep-alive automatically with keepaliveInterval option
      // This is just for monitoring
      if (entry.connection.state !== 'connected') {
        clearInterval(entry.keepAliveTimer)
      }
    }, intervalSeconds * 1000)
  }

  private handleDisconnect(connectionId: string): void {
    const entry = this.connections.get(connectionId)
    if (!entry) return

    if (entry.connection.state !== 'disconnected') {
      entry.connection.state = 'disconnected'
      this.emitStateChange(connectionId, 'disconnected')
    }

    // Stop all port forwards for this connection
    this.stopPortForwardsForConnection(connectionId)

    // Cleanup
    if (entry.keepAliveTimer) {
      clearInterval(entry.keepAliveTimer)
    }

    this.connections.delete(connectionId)
  }

  private emitStateChange(connectionId: string, state: ConnectionState, error?: string): void {
    this.emit('connectionStateChanged', { connectionId, state, error })
  }

  private generateConnectionId(): string {
    return `ssh-${Date.now()}-${crypto.randomBytes(4).toString('hex')}`
  }

  private escapeShellArg(arg: string): string {
    return `'${arg.replace(/'/g, "'\\''")}'`
  }

  private async loadSavedConnections(): Promise<SSHConnectionConfig[]> {
    try {
      const data = await fs.promises.readFile(this.savedConnectionsPath, 'utf-8')
      return JSON.parse(data)
    } catch {
      return []
    }
  }

  private async writeSavedConnections(connections: SSHConnectionConfig[]): Promise<void> {
    await fs.promises.writeFile(
      this.savedConnectionsPath,
      JSON.stringify(connections, null, 2),
      'utf-8'
    )
  }

  private encryptSecret(value: string): string {
    if (safeStorage.isEncryptionAvailable()) {
      const encrypted = safeStorage.encryptString(value)
      return `encrypted:${encrypted.toString('base64')}`
    }
    // Fallback: base64 encode (not secure, but better than plain text)
    return `encoded:${Buffer.from(value).toString('base64')}`
  }

  private decryptSecret(value: string): string {
    if (value.startsWith('encrypted:')) {
      const encrypted = Buffer.from(value.slice(10), 'base64')
      return safeStorage.decryptString(encrypted)
    }
    if (value.startsWith('encoded:')) {
      return Buffer.from(value.slice(8), 'base64').toString()
    }
    // Plain text (legacy or error)
    return value
  }

  /**
   * Cleanup all connections
   */
  cleanup(): void {
    for (const connectionId of this.connections.keys()) {
      this.disconnect(connectionId)
    }
  }
}
