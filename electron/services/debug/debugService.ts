/**
 * Debug Service - Main entry point for debugging functionality
 * Manages debug sessions, breakpoints, and coordinates with UI
 */
import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import { ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import { DAPClient } from './DAPClient'
import type {
  DebugSession,
  DebugConfig,
  LaunchConfig,
  AttachConfig,
  SessionState,
  BreakpointInfo,
  BreakpointType,
  WatchExpression,
  EvaluateResult,
  Source,
  SourceBreakpoint,
  StackFrame,
  Scope,
  Variable,
  Thread,
  LaunchConfigFile,
  DebugConsoleMessage
} from './types'

export class DebugService extends EventEmitter {
  private sessions: Map<string, { session: DebugSession; client: DAPClient; process?: ChildProcess }> = new Map()
  private activeSessionId?: string
  private breakpoints: Map<string, BreakpointInfo[]> = new Map() // file path -> breakpoints
  private watchExpressions: WatchExpression[] = []
  private getMainWindow: () => BrowserWindow | null
  private nextBreakpointId: number = 1
  private nextWatchId: number = 1

  constructor(getMainWindow: () => BrowserWindow | null) {
    super()
    this.getMainWindow = getMainWindow
  }

  // ============ Session Management ============

  /**
   * Start a new debug session
   */
  async startSession(config: DebugConfig, workspaceFolder: string): Promise<DebugSession> {
    const sessionId = this.generateSessionId()

    // Create session object
    const session: DebugSession = {
      id: sessionId,
      name: config.name,
      type: config.type,
      state: 'initializing' as SessionState,
      config,
      threads: [],
      currentThreadId: undefined,
      currentFrameId: undefined
    }

    // Start the debug adapter based on type
    const { client, process: adapterProcess } = await this.startDebugAdapter(config, workspaceFolder)

    // Store session
    this.sessions.set(sessionId, { session, client, process: adapterProcess })

    // Set up event handlers
    this.setupClientEventHandlers(sessionId, client)

    // Initialize the debug adapter
    try {
      const capabilities = await client.initialize(config.type)
      session.capabilities = capabilities

      // Set initial breakpoints before launch/attach
      await this.syncBreakpointsToAdapter(sessionId)

      // Launch or attach
      if (config.request === 'launch') {
        await client.launch(this.prepareLaunchArgs(config as LaunchConfig, workspaceFolder))
      } else {
        await client.attach(this.prepareAttachArgs(config as AttachConfig))
      }

      // Signal configuration is done
      await client.configurationDone()

      // Update session state
      session.state = 'running' as SessionState
      this.activeSessionId = sessionId

      this.emit('sessionCreated', session)
      this.emit('sessionStateChanged', sessionId, session.state)
      this.sendToRenderer('debug:sessionCreated', session)

      return session
    } catch (error) {
      // Clean up on error
      this.sessions.delete(sessionId)
      client.stop()
      throw error
    }
  }

  /**
   * Stop a debug session
   */
  async stopSession(sessionId?: string): Promise<void> {
    const id = sessionId ?? this.activeSessionId
    if (!id) return

    const entry = this.sessions.get(id)
    if (!entry) return

    const { session, client, process: adapterProcess } = entry

    try {
      if (session.state !== 'terminated') {
        await client.terminate()
      }
    } catch {
      // Ignore errors during termination
    }

    client.stop()
    if (adapterProcess) {
      adapterProcess.kill()
    }

    session.state = 'terminated' as SessionState
    this.sessions.delete(id)

    if (this.activeSessionId === id) {
      // Switch to another session if available
      const remaining = Array.from(this.sessions.keys())
      this.activeSessionId = remaining.length > 0 ? remaining[0] : undefined
    }

    this.emit('sessionTerminated', id)
    this.emit('sessionStateChanged', id, 'terminated')
    this.sendToRenderer('debug:sessionTerminated', id)
  }

  /**
   * Restart the debug session
   */
  async restartSession(sessionId?: string): Promise<void> {
    const id = sessionId ?? this.activeSessionId
    if (!id) return

    const entry = this.sessions.get(id)
    if (!entry) return

    const { session, client } = entry

    try {
      if (session.capabilities?.supportsRestartRequest) {
        await client.restart()
        session.state = 'running' as SessionState
        this.emit('sessionStateChanged', id, session.state)
        this.sendToRenderer('debug:sessionStateChanged', { sessionId: id, state: session.state })
      } else {
        // Restart by stopping and starting again
        const config = session.config
        const workspaceFolder = (config as LaunchConfig).cwd || ''
        await this.stopSession(id)
        await this.startSession(config, workspaceFolder)
      }
    } catch (error) {
      console.error('Failed to restart session:', error)
      throw error
    }
  }

  /**
   * Get all sessions
   */
  getSessions(): DebugSession[] {
    return Array.from(this.sessions.values()).map(e => e.session)
  }

  /**
   * Get active session
   */
  getActiveSession(): DebugSession | undefined {
    return this.activeSessionId ? this.sessions.get(this.activeSessionId)?.session : undefined
  }

  /**
   * Set active session
   */
  setActiveSession(sessionId: string): void {
    if (this.sessions.has(sessionId)) {
      this.activeSessionId = sessionId
      this.sendToRenderer('debug:activeSessionChanged', sessionId)
    }
  }

  // ============ Execution Control ============

  /**
   * Continue execution
   */
  async continue(sessionId?: string): Promise<void> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return

    const { session, client } = entry
    const threadId = session.currentThreadId ?? 1
    await client.continue(threadId)
  }

  /**
   * Pause execution
   */
  async pause(sessionId?: string): Promise<void> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return

    const { session, client } = entry
    const threadId = session.currentThreadId ?? 1
    await client.pause(threadId)
  }

  /**
   * Step over (next line)
   */
  async stepOver(sessionId?: string): Promise<void> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return

    const { session, client } = entry
    const threadId = session.currentThreadId ?? 1
    await client.next(threadId)
  }

  /**
   * Step into
   */
  async stepInto(sessionId?: string): Promise<void> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return

    const { session, client } = entry
    const threadId = session.currentThreadId ?? 1
    await client.stepIn(threadId)
  }

  /**
   * Step out
   */
  async stepOut(sessionId?: string): Promise<void> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return

    const { session, client } = entry
    const threadId = session.currentThreadId ?? 1
    await client.stepOut(threadId)
  }

  /**
   * Restart frame
   */
  async restartFrame(frameId: number, sessionId?: string): Promise<void> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return

    await entry.client.restartFrame(frameId)
  }

  // ============ Breakpoint Management ============

  /**
   * Set a line breakpoint
   */
  async setBreakpoint(
    filePath: string,
    line: number,
    options?: { condition?: string; hitCondition?: string; logMessage?: string }
  ): Promise<BreakpointInfo> {
    const bp: BreakpointInfo = {
      id: `bp_${this.nextBreakpointId++}`,
      verified: false,
      source: { path: filePath },
      line,
      enabled: true,
      condition: options?.condition,
      hitCondition: options?.hitCondition,
      logMessage: options?.logMessage,
      type: options?.logMessage ? 'logpoint' as BreakpointType :
            options?.condition ? 'conditional' as BreakpointType :
            'line' as BreakpointType
    }

    // Add to local storage
    const fileBreakpoints = this.breakpoints.get(filePath) || []
    fileBreakpoints.push(bp)
    this.breakpoints.set(filePath, fileBreakpoints)

    // Sync with active session
    await this.syncBreakpointsToAdapterForFile(filePath)

    this.emit('breakpointChanged', bp)
    this.sendToRenderer('debug:breakpointChanged', bp)

    return bp
  }

  /**
   * Remove a breakpoint
   */
  async removeBreakpoint(breakpointId: string): Promise<void> {
    for (const [filePath, breakpoints] of this.breakpoints.entries()) {
      const index = breakpoints.findIndex(bp => bp.id === breakpointId)
      if (index !== -1) {
        breakpoints.splice(index, 1)
        if (breakpoints.length === 0) {
          this.breakpoints.delete(filePath)
        }
        await this.syncBreakpointsToAdapterForFile(filePath)
        this.sendToRenderer('debug:breakpointRemoved', breakpointId)
        return
      }
    }
  }

  /**
   * Toggle breakpoint enabled state
   */
  async toggleBreakpoint(breakpointId: string): Promise<void> {
    for (const [filePath, breakpoints] of this.breakpoints.entries()) {
      const bp = breakpoints.find(b => b.id === breakpointId)
      if (bp) {
        bp.enabled = !bp.enabled
        await this.syncBreakpointsToAdapterForFile(filePath)
        this.emit('breakpointChanged', bp)
        this.sendToRenderer('debug:breakpointChanged', bp)
        return
      }
    }
  }

  /**
   * Toggle breakpoint at a specific line (add if not exists, remove if exists)
   */
  async toggleBreakpointAtLine(filePath: string, line: number): Promise<BreakpointInfo | null> {
    const fileBreakpoints = this.breakpoints.get(filePath) || []
    const existing = fileBreakpoints.find(bp => bp.line === line)

    if (existing) {
      await this.removeBreakpoint(existing.id)
      return null
    } else {
      return await this.setBreakpoint(filePath, line)
    }
  }

  /**
   * Get all breakpoints
   */
  getAllBreakpoints(): BreakpointInfo[] {
    const all: BreakpointInfo[] = []
    for (const breakpoints of this.breakpoints.values()) {
      all.push(...breakpoints)
    }
    return all
  }

  /**
   * Get breakpoints for a file
   */
  getBreakpointsForFile(filePath: string): BreakpointInfo[] {
    return this.breakpoints.get(filePath) || []
  }

  // ============ Variables & Evaluation ============

  /**
   * Get threads for a session
   */
  async getThreads(sessionId?: string): Promise<Thread[]> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return []

    const threads = await entry.client.threads()
    entry.session.threads = threads
    return threads
  }

  /**
   * Get stack trace for a thread
   */
  async getStackTrace(threadId: number, sessionId?: string): Promise<StackFrame[]> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return []

    const { stackFrames } = await entry.client.stackTrace(threadId)
    return stackFrames
  }

  /**
   * Get scopes for a frame
   */
  async getScopes(frameId: number, sessionId?: string): Promise<Scope[]> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return []

    return await entry.client.scopes(frameId)
  }

  /**
   * Get variables for a scope
   */
  async getVariables(variablesReference: number, sessionId?: string): Promise<Variable[]> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return []

    return await entry.client.variables(variablesReference)
  }

  /**
   * Set a variable's value
   */
  async setVariable(
    variablesReference: number,
    name: string,
    value: string,
    sessionId?: string
  ): Promise<Variable | null> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return null

    return await entry.client.setVariable(variablesReference, name, value)
  }

  /**
   * Evaluate an expression
   */
  async evaluate(
    expression: string,
    frameId?: number,
    context?: 'watch' | 'repl' | 'hover',
    sessionId?: string
  ): Promise<EvaluateResult | null> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return null

    const frame = frameId ?? entry.session.currentFrameId
    return await entry.client.evaluate(expression, frame, context)
  }

  /**
   * Select a stack frame (set as current)
   */
  selectFrame(frameId: number, sessionId?: string): void {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return

    entry.session.currentFrameId = frameId
    this.sendToRenderer('debug:frameSelected', { sessionId: entry.session.id, frameId })
  }

  // ============ Watch Expressions ============

  /**
   * Add a watch expression
   */
  addWatch(expression: string): WatchExpression {
    const watch: WatchExpression = {
      id: `watch_${this.nextWatchId++}`,
      expression
    }
    this.watchExpressions.push(watch)
    this.refreshWatch(watch.id)
    this.sendToRenderer('debug:watchAdded', watch)
    return watch
  }

  /**
   * Remove a watch expression
   */
  removeWatch(watchId: string): void {
    const index = this.watchExpressions.findIndex(w => w.id === watchId)
    if (index !== -1) {
      this.watchExpressions.splice(index, 1)
      this.sendToRenderer('debug:watchRemoved', watchId)
    }
  }

  /**
   * Refresh a watch expression
   */
  async refreshWatch(watchId: string): Promise<void> {
    const watch = this.watchExpressions.find(w => w.id === watchId)
    if (!watch) return

    try {
      const result = await this.evaluate(watch.expression, undefined, 'watch')
      watch.result = result || undefined
      watch.error = undefined
    } catch (error) {
      watch.result = undefined
      watch.error = (error as Error).message
    }

    this.sendToRenderer('debug:watchUpdated', watch)
  }

  /**
   * Refresh all watch expressions
   */
  async refreshAllWatches(): Promise<void> {
    for (const watch of this.watchExpressions) {
      await this.refreshWatch(watch.id)
    }
  }

  /**
   * Get all watch expressions
   */
  getWatchExpressions(): WatchExpression[] {
    return [...this.watchExpressions]
  }

  // ============ Debug Console ============

  /**
   * Execute a command in the debug console
   */
  async executeInConsole(command: string, sessionId?: string): Promise<EvaluateResult | null> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return null

    // Log the input
    this.addConsoleMessage(entry.session.id, 'input', command)

    try {
      const result = await entry.client.evaluate(command, entry.session.currentFrameId, 'repl')
      this.addConsoleMessage(entry.session.id, 'output', result.result)
      return result
    } catch (error) {
      this.addConsoleMessage(entry.session.id, 'error', (error as Error).message)
      throw error
    }
  }

  // ============ Launch Configuration ============

  /**
   * Read launch configuration file
   */
  async readLaunchConfig(workspaceFolder: string): Promise<LaunchConfigFile | null> {
    const configPath = path.join(workspaceFolder, '.logos', 'launch.json')

    try {
      const content = await fs.promises.readFile(configPath, 'utf-8')
      return JSON.parse(content) as LaunchConfigFile
    } catch {
      return null
    }
  }

  /**
   * Write launch configuration file
   */
  async writeLaunchConfig(workspaceFolder: string, config: LaunchConfigFile): Promise<void> {
    const configDir = path.join(workspaceFolder, '.logos')
    const configPath = path.join(configDir, 'launch.json')

    await fs.promises.mkdir(configDir, { recursive: true })
    await fs.promises.writeFile(configPath, JSON.stringify(config, null, 2), 'utf-8')
  }

  /**
   * Get default launch configuration for a debugger type
   */
  getDefaultLaunchConfig(type: string, workspaceFolder: string): DebugConfig {
    switch (type) {
      case 'node':
        return {
          type: 'node',
          request: 'launch',
          name: 'Launch Node.js',
          program: '${workspaceFolder}/index.js',
          cwd: workspaceFolder,
          console: 'integratedTerminal',
          skipFiles: ['<node_internals>/**']
        }
      case 'python':
        return {
          type: 'python',
          request: 'launch',
          name: 'Launch Python',
          program: '${file}',
          console: 'integratedTerminal',
          cwd: workspaceFolder,
          justMyCode: true
        }
      case 'chrome':
        return {
          type: 'chrome',
          request: 'launch',
          name: 'Launch Chrome',
          url: 'http://localhost:3000',
          webRoot: '${workspaceFolder}/src',
          sourceMaps: true
        }
      default:
        return {
          type,
          request: 'launch',
          name: `Launch ${type}`,
          program: '${workspaceFolder}/main'
        }
    }
  }

  // ============ Private Methods ============

  private generateSessionId(): string {
    return `session_${Date.now()}_${Math.random().toString(36).substr(2, 9)}`
  }

  private getSessionEntry(sessionId?: string) {
    const id = sessionId ?? this.activeSessionId
    return id ? this.sessions.get(id) : undefined
  }

  private async startDebugAdapter(config: DebugConfig, workspaceFolder: string): Promise<{ client: DAPClient; process?: ChildProcess }> {
    // For Node.js, we use the built-in inspector protocol
    if (config.type === 'node') {
      return await this.startNodeDebugAdapter(config, workspaceFolder)
    }

    // For other adapters, spawn the adapter process
    // This is a simplified version - in production, you'd need adapter-specific logic
    throw new Error(`Debug adapter for ${config.type} not yet implemented`)
  }

  private async startNodeDebugAdapter(_config: DebugConfig, _workspaceFolder: string): Promise<{ client: DAPClient; process?: ChildProcess }> {
    // For Node.js debugging, we use the js-debug adapter from VS Code
    // In a real implementation, you would bundle this adapter or use a library

    // For now, we'll create a simple adapter that connects to Node's inspector
    const client = new DAPClient('node', ['--inspect-brk'])

    // Start the adapter
    await client.start()

    return { client }
  }

  private setupClientEventHandlers(sessionId: string, client: DAPClient): void {
    const entry = this.sessions.get(sessionId)
    if (!entry) return

    client.on('stopped', async (event) => {
      const session = entry.session
      session.state = 'stopped' as SessionState
      session.currentThreadId = event.threadId

      // Get stack trace
      if (event.threadId) {
        const { stackFrames } = await client.stackTrace(event.threadId)
        if (stackFrames.length > 0) {
          session.currentFrameId = stackFrames[0].id
        }
        this.emit('stackTraceUpdated', sessionId, event.threadId, stackFrames)
      }

      // Refresh watches
      await this.refreshAllWatches()

      this.emit('stopped', sessionId, event.reason, event.threadId, event.allThreadsStopped)
      this.emit('sessionStateChanged', sessionId, session.state)
      this.sendToRenderer('debug:stopped', {
        sessionId,
        reason: event.reason,
        threadId: event.threadId,
        allThreadsStopped: event.allThreadsStopped
      })
    })

    client.on('continued', (event) => {
      entry.session.state = 'running' as SessionState
      this.emit('continued', sessionId, event.threadId, event.allThreadsContinued)
      this.emit('sessionStateChanged', sessionId, entry.session.state)
      this.sendToRenderer('debug:continued', {
        sessionId,
        threadId: event.threadId,
        allThreadsContinued: event.allThreadsContinued
      })
    })

    client.on('terminated', () => {
      entry.session.state = 'terminated' as SessionState
      this.emit('sessionTerminated', sessionId)
      this.emit('sessionStateChanged', sessionId, entry.session.state)
      this.sendToRenderer('debug:sessionTerminated', sessionId)
    })

    client.on('output', (event) => {
      this.emit('output', sessionId, event.category || 'console', event.output, event.source, event.line)
      this.addConsoleMessage(
        sessionId,
        event.category === 'stderr' ? 'error' : 'output',
        event.output,
        event.source?.path,
        event.line
      )
    })

    client.on('breakpoint', (event) => {
      const bp = event.breakpoint
      if (bp.source?.path && bp.line) {
        const fileBps = this.breakpoints.get(bp.source.path) || []
        const existing = fileBps.find(b => b.line === bp.line)
        if (existing) {
          existing.verified = bp.verified ?? false
          this.emit('breakpointValidated', existing)
          this.sendToRenderer('debug:breakpointValidated', existing)
        }
      }
    })

    client.on('thread', async (_event) => {
      const threads = await client.threads()
      entry.session.threads = threads
      this.emit('threadsUpdated', sessionId, threads)
      this.sendToRenderer('debug:threadsUpdated', { sessionId, threads })
    })

    client.on('exit', () => {
      this.stopSession(sessionId)
    })
  }

  private async syncBreakpointsToAdapter(sessionId: string): Promise<void> {
    for (const filePath of this.breakpoints.keys()) {
      await this.syncBreakpointsToAdapterForFile(filePath, sessionId)
    }
  }

  private async syncBreakpointsToAdapterForFile(filePath: string, sessionId?: string): Promise<void> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return

    const breakpoints = this.breakpoints.get(filePath) || []
    const enabledBps = breakpoints.filter(bp => bp.enabled)

    const source: Source = { path: filePath }
    const sourceBps: SourceBreakpoint[] = enabledBps.map(bp => ({
      line: bp.line,
      column: bp.column,
      condition: bp.condition,
      hitCondition: bp.hitCondition,
      logMessage: bp.logMessage
    }))

    try {
      const verifiedBps = await entry.client.setBreakpoints(source, sourceBps)

      // Update verification status
      for (let i = 0; i < enabledBps.length; i++) {
        if (verifiedBps[i]) {
          enabledBps[i].verified = verifiedBps[i].verified ?? false
          if (verifiedBps[i].line) {
            enabledBps[i].line = verifiedBps[i].line!
          }
        }
      }
    } catch (error) {
      console.error('Failed to sync breakpoints:', error)
    }
  }

  private prepareLaunchArgs(config: LaunchConfig, workspaceFolder: string): object {
    const args = { ...config }

    // Replace variables
    const replaceVars = (str: string): string => {
      return str
        .replace(/\$\{workspaceFolder\}/g, workspaceFolder)
        .replace(/\$\{file\}/g, '') // Would need current file from renderer
    }

    if (args.program && typeof args.program === 'string') {
      args.program = replaceVars(args.program)
    }
    if (args.cwd && typeof args.cwd === 'string') {
      args.cwd = replaceVars(args.cwd)
    }

    return args
  }

  private prepareAttachArgs(config: AttachConfig): object {
    return { ...config }
  }

  private addConsoleMessage(sessionId: string, type: 'input' | 'output' | 'error' | 'warning' | 'info', message: string, source?: string, line?: number): void {
    const msg: DebugConsoleMessage = {
      type,
      message,
      timestamp: Date.now(),
      source,
      line
    }
    this.emit('consoleMessage', sessionId, msg)
    this.sendToRenderer('debug:consoleMessage', { sessionId, message: msg })
  }

  private sendToRenderer(channel: string, data: unknown): void {
    const mainWindow = this.getMainWindow()
    if (mainWindow && !mainWindow.isDestroyed()) {
      mainWindow.webContents.send(channel, data)
    }
  }

  // ============ Cleanup ============

  /**
   * Cleanup all sessions
   */
  async cleanup(): Promise<void> {
    for (const sessionId of this.sessions.keys()) {
      await this.stopSession(sessionId)
    }
  }
}

// Singleton instance
let debugServiceInstance: DebugService | null = null

export function getDebugService(getMainWindow: () => BrowserWindow | null): DebugService {
  if (!debugServiceInstance) {
    debugServiceInstance = new DebugService(getMainWindow)
  }
  return debugServiceInstance
}

export function cleanupDebugService(): void {
  if (debugServiceInstance) {
    debugServiceInstance.cleanup()
    debugServiceInstance = null
  }
}
