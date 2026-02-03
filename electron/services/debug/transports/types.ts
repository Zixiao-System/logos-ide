/**
 * DAP Transport Types
 * Defines the interface for communication transports used by the DAP client
 */

import { DebugProtocol } from '@vscode/debugprotocol'

/**
 * Callback types for transport events
 */
export type MessageCallback = (message: DebugProtocol.ProtocolMessage) => void
export type ErrorCallback = (error: Error) => void
export type CloseCallback = (code?: number, signal?: string) => void

/**
 * Transport connection state
 */
export type TransportState = 'disconnected' | 'connecting' | 'connected' | 'error'

/**
 * Base interface for all DAP transports
 * Transports handle the low-level communication with debug adapters
 */
export interface ITransport {
  /**
   * Current connection state
   */
  readonly state: TransportState

  /**
   * Connect to the debug adapter
   * @returns Promise that resolves when connected
   */
  connect(): Promise<void>

  /**
   * Disconnect from the debug adapter
   */
  disconnect(): void

  /**
   * Send a message to the debug adapter
   * @param message The DAP protocol message to send
   */
  send(message: DebugProtocol.ProtocolMessage): void

  /**
   * Register a callback for incoming messages
   * @param callback Function called when a message is received
   */
  onMessage(callback: MessageCallback): void

  /**
   * Register a callback for transport errors
   * @param callback Function called when an error occurs
   */
  onError(callback: ErrorCallback): void

  /**
   * Register a callback for when the transport closes
   * @param callback Function called when the transport closes
   */
  onClose(callback: CloseCallback): void
}

/**
 * Options for stdio transport (child process)
 */
export interface StdioTransportOptions {
  /** Path to the debug adapter executable */
  adapterPath: string
  /** Arguments to pass to the debug adapter */
  adapterArgs?: string[]
  /** Working directory for the adapter process */
  cwd?: string
  /** Environment variables for the adapter process */
  env?: NodeJS.ProcessEnv
}

/**
 * Options for socket transport (TCP)
 */
export interface SocketTransportOptions {
  /** Host to connect to */
  host: string
  /** Port to connect to */
  port: number
  /** Connection timeout in milliseconds */
  timeout?: number
}

/**
 * Options for SSH transport (DAP over SSH tunnel)
 */
export interface SSHTransportOptions {
  /** SSH connection ID */
  connectionId: string
  /** Remote host to forward to */
  remoteHost: string
  /** Remote port to forward to */
  remotePort: number
  /** Local root for path mapping */
  localRoot?: string
  /** Remote root for path mapping */
  remoteRoot?: string
}

/**
 * Base class for transport implementations
 * Provides common functionality for message buffering and parsing
 */
export abstract class BaseTransport implements ITransport {
  protected _state: TransportState = 'disconnected'
  protected messageCallbacks: MessageCallback[] = []
  protected errorCallbacks: ErrorCallback[] = []
  protected closeCallbacks: CloseCallback[] = []
  protected buffer: Buffer = Buffer.alloc(0)

  get state(): TransportState {
    return this._state
  }

  abstract connect(): Promise<void>
  abstract disconnect(): void
  abstract send(message: DebugProtocol.ProtocolMessage): void

  onMessage(callback: MessageCallback): void {
    this.messageCallbacks.push(callback)
  }

  onError(callback: ErrorCallback): void {
    this.errorCallbacks.push(callback)
  }

  onClose(callback: CloseCallback): void {
    this.closeCallbacks.push(callback)
  }

  /**
   * Parse incoming data from the debug adapter
   * Handles the Content-Length header format used by DAP
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
        this.emitMessage(message)
      } catch (err) {
        this.emitError(new Error(`Failed to parse DAP message: ${err}`))
      }
    }
  }

  /**
   * Encode a message in DAP format with Content-Length header
   */
  protected encodeMessage(message: DebugProtocol.ProtocolMessage): string {
    const json = JSON.stringify(message)
    return `Content-Length: ${Buffer.byteLength(json)}\r\n\r\n${json}`
  }

  protected emitMessage(message: DebugProtocol.ProtocolMessage): void {
    for (const callback of this.messageCallbacks) {
      try {
        callback(message)
      } catch (err) {
        console.error('[Transport] Error in message callback:', err)
      }
    }
  }

  protected emitError(error: Error): void {
    for (const callback of this.errorCallbacks) {
      try {
        callback(error)
      } catch (err) {
        console.error('[Transport] Error in error callback:', err)
      }
    }
  }

  protected emitClose(code?: number, signal?: string): void {
    for (const callback of this.closeCallbacks) {
      try {
        callback(code, signal)
      } catch (err) {
        console.error('[Transport] Error in close callback:', err)
      }
    }
  }

  /**
   * Clear all callbacks and reset buffer
   */
  protected reset(): void {
    this.buffer = Buffer.alloc(0)
    this._state = 'disconnected'
  }
}
