/**
 * DAP Client - Debug Adapter Protocol Client
 * Handles low-level communication with debug adapters
 */
import { EventEmitter } from 'events'
import { DebugProtocol } from '@vscode/debugprotocol'
import type { ITransport } from './transports/types'
import type {
  Capabilities,
  Source,
  SourceBreakpoint,
  Breakpoint,
  StackFrame,
  Scope,
  Variable,
  Thread,
  EvaluateResult,
  DebugEvents
} from './types'

interface PendingRequest {
  resolve: (response: DebugProtocol.Response) => void
  reject: (error: Error) => void
  command: string
}

export class DAPClient extends EventEmitter {
  private seq: number = 1
  private pendingRequests: Map<number, PendingRequest> = new Map()
  private _capabilities: Capabilities | null = null
  private _initialized: boolean = false
  private transport: ITransport

  constructor(transport: ITransport) {
    super()
    this.transport = transport
  }

  get capabilities(): Capabilities | null {
    return this._capabilities
  }

  get initialized(): boolean {
    return this._initialized
  }

  /**
   * Start the debug adapter process
   */
  async start(): Promise<void> {
    // Set up transport event handlers
    this.transport.onMessage((message) => {
      this.handleMessage(message)
    })

    this.transport.onError((error) => {
      console.error('[DAP Client Error]:', error)
      this.emit('error', error)
    })

    this.transport.onClose((code, signal) => {
      this.emit('exit', { code, signal })
    })

    // Connect the transport
    await this.transport.connect()
  }

  /**
   * Stop the debug adapter process
   */
  stop(): void {
    this.transport.disconnect()
    this.pendingRequests.clear()
    this._initialized = false
  }

  /**
   * Handle a parsed DAP message
   */
  private handleMessage(message: DebugProtocol.ProtocolMessage): void {
    switch (message.type) {
      case 'response':
        this.handleResponse(message as DebugProtocol.Response)
        break
      case 'event':
        this.handleEvent(message as DebugProtocol.Event)
        break
      case 'request':
        this.handleReverseRequest(message as DebugProtocol.Request)
        break
    }
  }

  /**
   * Handle a response message
   */
  private handleResponse(response: DebugProtocol.Response): void {
    const pending = this.pendingRequests.get(response.request_seq)
    if (pending) {
      this.pendingRequests.delete(response.request_seq)
      if (response.success) {
        pending.resolve(response)
      } else {
        pending.reject(new Error(response.message || `Request ${pending.command} failed`))
      }
    }
  }

  /**
   * Handle an event message
   */
  private handleEvent(event: DebugProtocol.Event): void {
    const eventName = event.event as keyof DebugEvents
    this.emit(eventName, event.body)

    // Special handling for initialized event
    if (event.event === 'initialized') {
      this._initialized = true
    }
  }

  /**
   * Handle a reverse request from the adapter
   */
  private handleReverseRequest(request: DebugProtocol.Request): void {
    // Handle runInTerminal request
    if (request.command === 'runInTerminal') {
      this.emit('runInTerminal', request.arguments, (response: DebugProtocol.RunInTerminalResponse) => {
        this.sendReverseResponse(request, response)
      })
    }
  }

  /**
   * Send a response to a reverse request
   */
  private sendReverseResponse(request: DebugProtocol.Request, response: Partial<DebugProtocol.Response>): void {
    const fullResponse: DebugProtocol.Response = {
      seq: this.seq++,
      type: 'response',
      request_seq: request.seq,
      command: request.command,
      success: true,
      ...response
    }
    this.send(fullResponse)
  }

  /**
   * Send a message to the adapter
   */
  private send(message: DebugProtocol.ProtocolMessage): void {
    this.transport.send(message)
  }

  /**
   * Send a request to the adapter and wait for response
   */
  async sendRequest<T extends DebugProtocol.Response>(
    command: string,
    args?: object
  ): Promise<T> {
    return new Promise((resolve, reject) => {
      const request: DebugProtocol.Request = {
        seq: this.seq++,
        type: 'request',
        command,
        arguments: args
      }

      this.pendingRequests.set(request.seq, {
        resolve: resolve as (response: DebugProtocol.Response) => void,
        reject,
        command
      })

      try {
        this.send(request)
      } catch (err) {
        this.pendingRequests.delete(request.seq)
        reject(err)
      }

      // Timeout after 30 seconds
      setTimeout(() => {
        if (this.pendingRequests.has(request.seq)) {
          this.pendingRequests.delete(request.seq)
          reject(new Error(`Request ${command} timed out`))
        }
      }, 30000)
    })
  }

  // ============ DAP Protocol Methods ============

  /**
   * Initialize the debug session
   */
  async initialize(adapterID: string): Promise<Capabilities> {
    const response = await this.sendRequest<DebugProtocol.InitializeResponse>('initialize', {
      clientID: 'logos-ide',
      clientName: 'Logos IDE',
      adapterID,
      pathFormat: 'path',
      linesStartAt1: true,
      columnsStartAt1: true,
      supportsVariableType: true,
      supportsVariablePaging: true,
      supportsRunInTerminalRequest: true,
      supportsMemoryReferences: true,
      supportsProgressReporting: true,
      supportsInvalidatedEvent: true,
      supportsMemoryEvent: true
    })
    this._capabilities = response.body || {}
    return this._capabilities
  }

  /**
   * Launch a program
   */
  async launch(config: object): Promise<void> {
    await this.sendRequest('launch', config)
  }

  /**
   * Attach to a running program
   */
  async attach(config: object): Promise<void> {
    await this.sendRequest('attach', config)
  }

  /**
   * Disconnect from the debuggee
   */
  async disconnect(restart?: boolean, terminateDebuggee?: boolean): Promise<void> {
    await this.sendRequest('disconnect', { restart, terminateDebuggee })
  }

  /**
   * Terminate the debuggee
   */
  async terminate(restart?: boolean): Promise<void> {
    if (this._capabilities?.supportsTerminateRequest) {
      await this.sendRequest('terminate', { restart })
    } else {
      await this.disconnect(restart, true)
    }
  }

  /**
   * Restart the debugging session
   */
  async restart(args?: object): Promise<void> {
    if (this._capabilities?.supportsRestartRequest) {
      await this.sendRequest('restart', args)
    } else {
      throw new Error('Restart not supported by this adapter')
    }
  }

  /**
   * Set breakpoints in a source file
   */
  async setBreakpoints(source: Source, breakpoints: SourceBreakpoint[]): Promise<Breakpoint[]> {
    const response = await this.sendRequest<DebugProtocol.SetBreakpointsResponse>('setBreakpoints', {
      source,
      breakpoints,
      sourceModified: false
    })
    return response.body.breakpoints
  }

  /**
   * Set function breakpoints
   */
  async setFunctionBreakpoints(breakpoints: DebugProtocol.FunctionBreakpoint[]): Promise<Breakpoint[]> {
    const response = await this.sendRequest<DebugProtocol.SetFunctionBreakpointsResponse>('setFunctionBreakpoints', {
      breakpoints
    })
    return response.body.breakpoints
  }

  /**
   * Set exception breakpoints
   */
  async setExceptionBreakpoints(filters: string[], filterOptions?: DebugProtocol.ExceptionFilterOptions[]): Promise<Breakpoint[] | undefined> {
    const response = await this.sendRequest<DebugProtocol.SetExceptionBreakpointsResponse>('setExceptionBreakpoints', {
      filters,
      filterOptions
    })
    return response.body?.breakpoints
  }

  /**
   * Configuration done - signals that initial configuration is complete
   */
  async configurationDone(): Promise<void> {
    await this.sendRequest('configurationDone', {})
  }

  /**
   * Get all threads
   */
  async threads(): Promise<Thread[]> {
    const response = await this.sendRequest<DebugProtocol.ThreadsResponse>('threads', {})
    return response.body.threads
  }

  /**
   * Get the stack trace for a thread
   */
  async stackTrace(threadId: number, startFrame?: number, levels?: number): Promise<{ stackFrames: StackFrame[]; totalFrames?: number }> {
    const response = await this.sendRequest<DebugProtocol.StackTraceResponse>('stackTrace', {
      threadId,
      startFrame: startFrame ?? 0,
      levels: levels ?? 20
    })
    return {
      stackFrames: response.body.stackFrames,
      totalFrames: response.body.totalFrames
    }
  }

  /**
   * Get scopes for a stack frame
   */
  async scopes(frameId: number): Promise<Scope[]> {
    const response = await this.sendRequest<DebugProtocol.ScopesResponse>('scopes', { frameId })
    return response.body.scopes
  }

  /**
   * Get variables for a scope
   */
  async variables(variablesReference: number, filter?: 'indexed' | 'named', start?: number, count?: number): Promise<Variable[]> {
    const response = await this.sendRequest<DebugProtocol.VariablesResponse>('variables', {
      variablesReference,
      filter,
      start,
      count
    })
    return response.body.variables
  }

  /**
   * Set a variable's value
   */
  async setVariable(variablesReference: number, name: string, value: string): Promise<Variable> {
    const response = await this.sendRequest<DebugProtocol.SetVariableResponse>('setVariable', {
      variablesReference,
      name,
      value
    })
    return {
      name,
      value: response.body.value,
      type: response.body.type,
      variablesReference: response.body.variablesReference ?? 0,
      namedVariables: response.body.namedVariables,
      indexedVariables: response.body.indexedVariables
    }
  }

  /**
   * Evaluate an expression
   */
  async evaluate(expression: string, frameId?: number, context?: 'watch' | 'repl' | 'hover' | 'clipboard'): Promise<EvaluateResult> {
    const response = await this.sendRequest<DebugProtocol.EvaluateResponse>('evaluate', {
      expression,
      frameId,
      context: context ?? 'repl'
    })
    return {
      result: response.body.result,
      type: response.body.type,
      variablesReference: response.body.variablesReference,
      namedVariables: response.body.namedVariables,
      indexedVariables: response.body.indexedVariables,
      memoryReference: response.body.memoryReference
    }
  }

  /**
   * Continue execution
   */
  async continue(threadId: number): Promise<{ allThreadsContinued?: boolean }> {
    const response = await this.sendRequest<DebugProtocol.ContinueResponse>('continue', { threadId })
    return { allThreadsContinued: response.body.allThreadsContinued }
  }

  /**
   * Step over (next)
   */
  async next(threadId: number, granularity?: 'statement' | 'line' | 'instruction'): Promise<void> {
    await this.sendRequest('next', { threadId, granularity })
  }

  /**
   * Step into
   */
  async stepIn(threadId: number, targetId?: number, granularity?: 'statement' | 'line' | 'instruction'): Promise<void> {
    await this.sendRequest('stepIn', { threadId, targetId, granularity })
  }

  /**
   * Step out
   */
  async stepOut(threadId: number, granularity?: 'statement' | 'line' | 'instruction'): Promise<void> {
    await this.sendRequest('stepOut', { threadId, granularity })
  }

  /**
   * Pause execution
   */
  async pause(threadId: number): Promise<void> {
    await this.sendRequest('pause', { threadId })
  }

  /**
   * Restart a stack frame
   */
  async restartFrame(frameId: number): Promise<void> {
    if (this._capabilities?.supportsRestartFrame) {
      await this.sendRequest('restartFrame', { frameId })
    } else {
      throw new Error('Restart frame not supported by this adapter')
    }
  }

  /**
   * Get source content
   */
  async source(sourceReference: number, source?: Source): Promise<string> {
    const response = await this.sendRequest<DebugProtocol.SourceResponse>('source', {
      sourceReference,
      source
    })
    return response.body.content
  }

  /**
   * Get step-in targets for the current location
   */
  async stepInTargets(frameId: number): Promise<DebugProtocol.StepInTarget[]> {
    if (this._capabilities?.supportsStepInTargetsRequest) {
      const response = await this.sendRequest<DebugProtocol.StepInTargetsResponse>('stepInTargets', { frameId })
      return response.body.targets
    }
    return []
  }

  /**
   * Get completions for the debug console
   */
  async completions(text: string, column: number, frameId?: number): Promise<DebugProtocol.CompletionItem[]> {
    if (this._capabilities?.supportsCompletionsRequest) {
      const response = await this.sendRequest<DebugProtocol.CompletionsResponse>('completions', {
        frameId,
        text,
        column,
        line: 1
      })
      return response.body.targets
    }
    return []
  }

  /**
   * Read memory from the debuggee
   */
  async readMemory(memoryReference: string, offset: number, count: number): Promise<{ address: string; data?: string }> {
    if (this._capabilities?.supportsReadMemoryRequest) {
      const response = await this.sendRequest<DebugProtocol.ReadMemoryResponse>('readMemory', {
        memoryReference,
        offset,
        count
      })
      return {
        address: response.body?.address ?? '',
        data: response.body?.data
      }
    }
    throw new Error('Read memory not supported by this adapter')
  }

  /**
   * Write memory to the debuggee
   */
  async writeMemory(memoryReference: string, offset: number, data: string): Promise<void> {
    if (this._capabilities?.supportsWriteMemoryRequest) {
      await this.sendRequest('writeMemory', {
        memoryReference,
        offset,
        data,
        allowPartial: false
      })
    } else {
      throw new Error('Write memory not supported by this adapter')
    }
  }

  /**
   * Get loaded modules
   */
  async modules(startModule?: number, moduleCount?: number): Promise<{ modules: DebugProtocol.Module[]; totalModules?: number }> {
    if (this._capabilities?.supportsModulesRequest) {
      const response = await this.sendRequest<DebugProtocol.ModulesResponse>('modules', {
        startModule,
        moduleCount
      })
      return {
        modules: response.body.modules,
        totalModules: response.body.totalModules
      }
    }
    return { modules: [] }
  }

  /**
   * Get exception info
   */
  async exceptionInfo(threadId: number): Promise<DebugProtocol.ExceptionInfoResponse['body'] | undefined> {
    if (this._capabilities?.supportsExceptionInfoRequest) {
      const response = await this.sendRequest<DebugProtocol.ExceptionInfoResponse>('exceptionInfo', { threadId })
      return response.body
    }
    return undefined
  }

  /**
   * Disassemble code
   */
  async disassemble(memoryReference: string, offset?: number, instructionCount?: number): Promise<DebugProtocol.DisassembledInstruction[]> {
    if (this._capabilities?.supportsDisassembleRequest) {
      const response = await this.sendRequest<DebugProtocol.DisassembleResponse>('disassemble', {
        memoryReference,
        offset,
        instructionCount: instructionCount ?? 100
      })
      return response.body?.instructions ?? []
    }
    return []
  }
}
