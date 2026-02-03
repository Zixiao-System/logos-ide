/**
 * Stdio Transport - Communicates with debug adapters via child process stdio
 */
import { ChildProcess, spawn } from 'child_process'
import { DebugProtocol } from '@vscode/debugprotocol'
import { BaseTransport, StdioTransportOptions } from './types'

export class StdioTransport extends BaseTransport {
  private process: ChildProcess | null = null

  constructor(private options: StdioTransportOptions) {
    super()
  }

  async connect(): Promise<void> {
    if (this._state === 'connected') return

    this._state = 'connecting'

    return new Promise((resolve, reject) => {
      this.process = spawn(this.options.adapterPath, this.options.adapterArgs || [], {
        stdio: ['pipe', 'pipe', 'pipe'],
        cwd: this.options.cwd,
        env: this.options.env
      })

      this.process.stdout?.on('data', (data: Buffer) => {
        this.handleData(data)
      })

      this.process.stderr?.on('data', (data: Buffer) => {
        console.error('[DAP Adapter Error]:', data.toString())
      })

      this.process.on('error', (err) => {
        this._state = 'error'
        this.emitError(err)
        reject(err)
      })

      this.process.on('exit', (code, signal) => {
        this._state = 'disconnected'
        this.emitClose(code ?? undefined, signal ?? undefined)
      })

      // Give the adapter a moment to start
      setTimeout(() => {
        this._state = 'connected'
        resolve()
      }, 100)
    })
  }

  disconnect(): void {
    if (this.process) {
      this.process.kill()
      this.process = null
    }
    this.reset()
  }

  send(message: DebugProtocol.ProtocolMessage): void {
    if (!this.process?.stdin) {
      throw new Error('Transport not connected')
    }
    this.process.stdin.write(this.encodeMessage(message))
  }
}
