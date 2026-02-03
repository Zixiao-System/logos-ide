/**
 * SSH Transport for DAP
 * Allows debugging remote processes over SSH tunnels
 */
import * as path from 'path'
import type { ClientChannel } from 'ssh2'
import { DebugProtocol } from '@vscode/debugprotocol'
import { BaseTransport, SSHTransportOptions } from './types'
import { getRemoteService } from '../../remote/remoteService'
import type { SSHConnectionManager } from '../../remote/sshConnection'

export class SSHTransport extends BaseTransport {
  private options: SSHTransportOptions
  private channel: ClientChannel | null = null

  constructor(options: SSHTransportOptions) {
    super()
    this.options = options
  }

  async connect(): Promise<void> {
    if (this._state === 'connected') return

    this._state = 'connecting'

    const remoteService = getRemoteService()
    // Access connectionManager through the service
    const connectionManager = (remoteService as unknown as { connectionManager: SSHConnectionManager }).connectionManager

    const client = connectionManager.getClient(this.options.connectionId)
    if (!client) {
      this._state = 'error'
      throw new Error('SSH connection not available')
    }

    return new Promise((resolve, reject) => {
      // Create a forwarded connection to the remote DAP server
      client.forwardOut(
        '127.0.0.1',
        0, // Use any available local port
        this.options.remoteHost,
        this.options.remotePort,
        (err, channel) => {
          if (err) {
            this._state = 'error'
            this.emitError(err)
            reject(err)
            return
          }

          this.channel = channel

          channel.on('data', (data: Buffer) => {
            this.handleData(data)
          })

          channel.on('error', (err: Error) => {
            this._state = 'error'
            this.emitError(err)
          })

          channel.on('close', () => {
            this._state = 'disconnected'
            this.emitClose()
          })

          this._state = 'connected'
          resolve()
        }
      )
    })
  }

  disconnect(): void {
    if (this.channel) {
      this.channel.end()
      this.channel = null
    }
    this.reset()
  }

  send(message: DebugProtocol.ProtocolMessage): void {
    if (!this.channel) {
      throw new Error('Transport not connected')
    }

    // Apply path mapping to outgoing messages
    const mappedMessage = this.mapPathsInMessage(message, 'outgoing')
    const encoded = this.encodeMessage(mappedMessage)
    this.channel.write(encoded)
  }

  /**
   * Override handleData to apply path mapping to incoming messages
   */
  protected handleData(data: Buffer): void {
    this.buffer = Buffer.concat([this.buffer, data])

    while (true) {
      // Parse Content-Length header
      const headerEnd = this.buffer.indexOf('\r\n\r\n')
      if (headerEnd === -1) break

      const header = this.buffer.subarray(0, headerEnd).toString()
      const contentLengthMatch = header.match(/Content-Length:\s*(\d+)/i)
      if (!contentLengthMatch) {
        // Skip invalid header
        this.buffer = this.buffer.subarray(headerEnd + 4)
        continue
      }

      const contentLength = parseInt(contentLengthMatch[1], 10)
      const messageStart = headerEnd + 4
      const messageEnd = messageStart + contentLength

      if (this.buffer.length < messageEnd) break

      const messageBuffer = this.buffer.subarray(messageStart, messageEnd)
      this.buffer = this.buffer.subarray(messageEnd)

      try {
        const message = JSON.parse(messageBuffer.toString()) as DebugProtocol.ProtocolMessage
        // Apply path mapping to incoming messages
        const mappedMessage = this.mapPathsInMessage(message, 'incoming')
        this.emitMessage(mappedMessage)
      } catch (err) {
        this.emitError(new Error(`Failed to parse DAP message: ${err}`))
      }
    }
  }

  // ============ Path Mapping ============

  /**
   * Map a local path to a remote path
   */
  mapLocalToRemote(localPath: string): string {
    if (!this.options.localRoot || !this.options.remoteRoot) {
      return localPath
    }

    const normalizedLocal = path.normalize(localPath)
    const normalizedLocalRoot = path.normalize(this.options.localRoot)

    if (normalizedLocal.startsWith(normalizedLocalRoot)) {
      const relativePath = normalizedLocal.slice(normalizedLocalRoot.length)
      // Use forward slashes for remote paths
      return this.options.remoteRoot + relativePath.replace(/\\/g, '/')
    }

    return localPath
  }

  /**
   * Map a remote path to a local path
   */
  mapRemoteToLocal(remotePath: string): string {
    if (!this.options.localRoot || !this.options.remoteRoot) {
      return remotePath
    }

    // Normalize remote path (already uses forward slashes)
    const normalizedRemote = remotePath.replace(/\\/g, '/')
    const normalizedRemoteRoot = this.options.remoteRoot.replace(/\\/g, '/')

    if (normalizedRemote.startsWith(normalizedRemoteRoot)) {
      const relativePath = normalizedRemote.slice(normalizedRemoteRoot.length)
      return path.join(this.options.localRoot, relativePath)
    }

    return remotePath
  }

  /**
   * Map paths in a DAP message
   */
  private mapPathsInMessage<T extends DebugProtocol.ProtocolMessage>(
    message: T,
    direction: 'incoming' | 'outgoing'
  ): T {
    const mapFn = direction === 'incoming'
      ? (p: string) => this.mapRemoteToLocal(p)
      : (p: string) => this.mapLocalToRemote(p)

    return this.deepMapPaths(message, mapFn)
  }

  /**
   * Recursively map paths in an object
   */
  private deepMapPaths<T>(obj: T, mapFn: (path: string) => string): T {
    if (obj === null || obj === undefined) {
      return obj
    }

    if (typeof obj === 'string') {
      return obj as T
    }

    if (Array.isArray(obj)) {
      return obj.map(item => this.deepMapPaths(item, mapFn)) as T
    }

    if (typeof obj === 'object') {
      const result: Record<string, unknown> = {}

      for (const [key, value] of Object.entries(obj)) {
        // Map path-like properties
        if (
          (key === 'path' || key === 'source' || key === 'file' || key === 'sourceReference') &&
          typeof value === 'string' &&
          (value.startsWith('/') || /^[A-Za-z]:/.test(value))
        ) {
          result[key] = mapFn(value)
        } else if (
          key === 'source' &&
          typeof value === 'object' &&
          value !== null &&
          'path' in value &&
          typeof (value as { path: unknown }).path === 'string'
        ) {
          // Handle Source objects
          result[key] = {
            ...value,
            path: mapFn((value as { path: string }).path)
          }
        } else {
          result[key] = this.deepMapPaths(value, mapFn)
        }
      }

      return result as T
    }

    return obj
  }
}
