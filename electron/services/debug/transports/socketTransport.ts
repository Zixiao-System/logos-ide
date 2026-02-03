/**
 * Socket Transport - Communicates with debug adapters via TCP socket
 */
import * as net from 'net'
import { DebugProtocol } from '@vscode/debugprotocol'
import { BaseTransport, SocketTransportOptions } from './types'

export class SocketTransport extends BaseTransport {
  private socket: net.Socket | null = null
  private readonly DEFAULT_TIMEOUT = 10000 // 10 seconds

  constructor(private options: SocketTransportOptions) {
    super()
  }

  async connect(): Promise<void> {
    if (this._state === 'connected') return

    this._state = 'connecting'

    return new Promise((resolve, reject) => {
      const timeout = this.options.timeout ?? this.DEFAULT_TIMEOUT

      this.socket = new net.Socket()

      const timeoutId = setTimeout(() => {
        this.socket?.destroy()
        this._state = 'error'
        reject(new Error(`Connection timeout after ${timeout}ms`))
      }, timeout)

      this.socket.on('connect', () => {
        clearTimeout(timeoutId)
        this._state = 'connected'
        resolve()
      })

      this.socket.on('data', (data: Buffer) => {
        this.handleData(data)
      })

      this.socket.on('error', (err) => {
        clearTimeout(timeoutId)
        this._state = 'error'
        this.emitError(err)
        reject(err)
      })

      this.socket.on('close', (hadError) => {
        this._state = 'disconnected'
        this.emitClose(hadError ? 1 : 0)
      })

      this.socket.connect(this.options.port, this.options.host)
    })
  }

  disconnect(): void {
    if (this.socket) {
      this.socket.destroy()
      this.socket = null
    }
    this.reset()
  }

  send(message: DebugProtocol.ProtocolMessage): void {
    if (!this.socket) {
      throw new Error('Transport not connected')
    }
    this.socket.write(this.encodeMessage(message))
  }
}
