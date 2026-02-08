/**
 * Debug Service - Main entry point for debugging functionality
 * Manages debug sessions, breakpoints, and coordinates with UI
 */
import { EventEmitter } from 'events'
import { BrowserWindow } from 'electron'
import { ChildProcess } from 'child_process'
import * as path from 'path'
import * as fs from 'fs'
import * as crypto from 'crypto'
import { DAPClient } from './DAPClient'
import { StdioTransport } from './transports/stdioTransport'
import type { ITransport } from './transports/types'
import { getAdapterManager } from './adapters'
import type { AdapterType, AdapterInfo, DetectedDebugger } from './adapters'
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

/**
 * Strip JSON comments (// and /* *​/) for VS Code JSONC compatibility
 */
export function stripJsonComments(text: string): string {
  let result = ''
  let i = 0
  let inString = false
  let stringChar = ''

  while (i < text.length) {
    if (inString) {
      if (text[i] === '\\') {
        result += text[i] + (text[i + 1] || '')
        i += 2
        continue
      }
      if (text[i] === stringChar) {
        inString = false
      }
      result += text[i]
      i++
    } else if (text[i] === '"') {
      inString = true
      stringChar = '"'
      result += text[i]
      i++
    } else if (text[i] === '/' && text[i + 1] === '/') {
      // Line comment — skip to end of line
      while (i < text.length && text[i] !== '\n') {
        i++
      }
    } else if (text[i] === '/' && text[i + 1] === '*') {
      // Block comment — skip to */
      i += 2
      while (i < text.length && !(text[i] === '*' && text[i + 1] === '/')) {
        i++
      }
      i += 2 // skip */
    } else {
      result += text[i]
      i++
    }
  }

  return result
}

export class DebugService extends EventEmitter {
  private sessions: Map<string, { session: DebugSession; client: DAPClient; process?: ChildProcess }> = new Map()
  private activeSessionId?: string
  private breakpoints: Map<string, BreakpointInfo[]> = new Map() // file path -> breakpoints
  private watchExpressions: WatchExpression[] = []
  private getMainWindow: () => BrowserWindow | null
  private nextBreakpointId: number = 1
  private nextWatchId: number = 1
  private activeFilePath: string | null = null

  constructor(getMainWindow: () => BrowserWindow | null) {
    super()
    this.getMainWindow = getMainWindow
  }

  /**
   * Set the currently active file path for variable substitution
   */
  setActiveFile(filePath: string | null): void {
    this.activeFilePath = filePath
  }

  /**
   * Get the currently active file path
   */
  getActiveFile(): string | null {
    return this.activeFilePath
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
   * Edit an existing breakpoint's properties
   */
  async editBreakpoint(
    breakpointId: string,
    options: { condition?: string; hitCondition?: string; logMessage?: string }
  ): Promise<BreakpointInfo | null> {
    for (const [filePath, breakpoints] of this.breakpoints.entries()) {
      const bp = breakpoints.find(b => b.id === breakpointId)
      if (bp) {
        bp.condition = options.condition
        bp.hitCondition = options.hitCondition
        bp.logMessage = options.logMessage
        bp.type = options.logMessage ? 'logpoint' as BreakpointType :
                  options.condition ? 'conditional' as BreakpointType :
                  'line' as BreakpointType

        await this.syncBreakpointsToAdapterForFile(filePath)
        this.emit('breakpointChanged', bp)
        this.sendToRenderer('debug:breakpointChanged', bp)
        return bp
      }
    }
    return null
  }

  /**
   * Set exception breakpoints for the active session
   */
  async setExceptionBreakpoints(
    filters: string[],
    filterOptions?: Array<{ filterId: string; condition?: string }>,
    sessionId?: string
  ): Promise<void> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry) return

    await entry.client.setExceptionBreakpoints(filters, filterOptions)
  }

  /**
   * Get exception filters from session capabilities
   */
  getExceptionFilters(sessionId?: string): Array<{ filter: string; label: string; description?: string; default?: boolean; supportsCondition?: boolean; conditionDescription?: string }> {
    const entry = this.getSessionEntry(sessionId)
    if (!entry?.session.capabilities) return []

    return (entry.session.capabilities.exceptionBreakpointFilters || []).map(f => ({
      filter: f.filter,
      label: f.label,
      description: f.description,
      default: f.default,
      supportsCondition: f.supportsCondition,
      conditionDescription: f.conditionDescription
    }))
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
   * Tries .logos/launch.json first, falls back to .vscode/launch.json
   */
  async readLaunchConfig(workspaceFolder: string): Promise<{ config: LaunchConfigFile | null; source: 'logos' | 'vscode' | null }> {
    // Try .logos/launch.json first
    const logosPath = path.join(workspaceFolder, '.logos', 'launch.json')
    try {
      const content = await fs.promises.readFile(logosPath, 'utf-8')
      return { config: JSON.parse(content) as LaunchConfigFile, source: 'logos' }
    } catch {
      // Fall through to VS Code path
    }

    // Fall back to .vscode/launch.json
    const vscodePath = path.join(workspaceFolder, '.vscode', 'launch.json')
    try {
      const content = await fs.promises.readFile(vscodePath, 'utf-8')
      const stripped = stripJsonComments(content)
      return { config: JSON.parse(stripped) as LaunchConfigFile, source: 'vscode' }
    } catch {
      return { config: null, source: null }
    }
  }

  /**
   * Import launch.json from .vscode/ to .logos/
   */
  async importFromVSCode(workspaceFolder: string): Promise<boolean> {
    const vscodePath = path.join(workspaceFolder, '.vscode', 'launch.json')
    try {
      const content = await fs.promises.readFile(vscodePath, 'utf-8')
      const stripped = stripJsonComments(content)
      const config = JSON.parse(stripped) as LaunchConfigFile
      await this.writeLaunchConfig(workspaceFolder, config)
      return true
    } catch {
      return false
    }
  }

  /**
   * Auto-generate debug configurations based on detected project type
   */
  async autoGenerateConfigurations(workspaceFolder: string): Promise<DebugConfig[]> {
    const detectedDebuggers = await this.detectDebuggers(workspaceFolder)
    const configs: DebugConfig[] = []

    for (const detected of detectedDebuggers) {
      const typeConfigs = await this.generateConfigsForType(detected.type, workspaceFolder)
      configs.push(...typeConfigs)
    }

    return configs
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
  getDefaultLaunchConfig(type: string, workspaceFolder: string): { success: true; config: DebugConfig } {
    let config: DebugConfig
    switch (type) {
      case 'node':
        config = {
          type: 'node',
          request: 'launch',
          name: 'Launch Node.js',
          program: '${workspaceFolder}/index.js',
          cwd: workspaceFolder,
          console: 'integratedTerminal',
          skipFiles: ['<node_internals>/**']
        }
        break
      case 'python':
        config = {
          type: 'python',
          request: 'launch',
          name: 'Launch Python',
          program: '${file}',
          console: 'integratedTerminal',
          cwd: workspaceFolder,
          justMyCode: true
        }
        break
      case 'chrome':
        config = {
          type: 'chrome',
          request: 'launch',
          name: 'Launch Chrome',
          url: 'http://localhost:3000',
          webRoot: '${workspaceFolder}/src',
          sourceMaps: true
        }
        break
      case 'go':
        config = {
          type: 'go',
          request: 'launch',
          name: 'Launch Go',
          mode: 'auto',
          program: '${workspaceFolder}',
          cwd: workspaceFolder
        }
        break
      case 'cppdbg':
        config = {
          type: 'cppdbg',
          request: 'launch',
          name: 'Launch C/C++ (GDB/LLDB)',
          program: '${workspaceFolder}/a.out',
          args: [],
          stopOnEntry: false,
          cwd: workspaceFolder,
          MIMode: process.platform === 'darwin' ? 'lldb' : 'gdb',
          setupCommands: [
            { description: 'Enable pretty-printing for gdb', text: '-enable-pretty-printing', ignoreFailures: true }
          ]
        }
        break
      case 'lldb':
        config = {
          type: 'lldb',
          request: 'launch',
          name: 'Launch C/C++ (LLDB)',
          program: '${workspaceFolder}/a.out',
          args: [],
          cwd: workspaceFolder,
          stopOnEntry: false
        }
        break
      default:
        config = {
          type,
          request: 'launch',
          name: `Launch ${type}`,
          program: '${workspaceFolder}/main'
        }
        break
    }
    return { success: true, config }
  }

  // ============ Private Methods ============

  /**
   * Generate debug configurations for a specific debugger type
   */
  private async generateConfigsForType(type: string, workspaceFolder: string): Promise<DebugConfig[]> {
    const configs: DebugConfig[] = []

    switch (type) {
      case 'node': {
        // Read package.json for smart config
        try {
          const pkgContent = await fs.promises.readFile(path.join(workspaceFolder, 'package.json'), 'utf-8')
          const pkg = JSON.parse(pkgContent) as Record<string, unknown>
          const scripts = pkg.scripts as Record<string, string> | undefined

          // Detect TypeScript
          let hasTypeScript = false
          try {
            await fs.promises.access(path.join(workspaceFolder, 'tsconfig.json'))
            hasTypeScript = true
          } catch { /* not TS */ }

          // Main entry
          const main = (pkg.main as string) || 'index.js'
          configs.push({
            type: 'node',
            request: 'launch',
            name: hasTypeScript ? 'Launch TypeScript' : 'Launch Node.js',
            program: `\${workspaceFolder}/${main}`,
            cwd: workspaceFolder,
            console: 'integratedTerminal',
            skipFiles: ['<node_internals>/**'],
            ...(hasTypeScript ? { outFiles: ['${workspaceFolder}/dist/**/*.js'], sourceMaps: true } : {})
          })

          // scripts.start
          if (scripts?.start) {
            configs.push({
              type: 'node',
              request: 'launch',
              name: 'npm start',
              runtimeExecutable: 'npm',
              runtimeArgs: ['run', 'start'],
              cwd: workspaceFolder,
              console: 'integratedTerminal'
            })
          }

          // scripts.dev
          if (scripts?.dev) {
            configs.push({
              type: 'node',
              request: 'launch',
              name: 'npm run dev',
              runtimeExecutable: 'npm',
              runtimeArgs: ['run', 'dev'],
              cwd: workspaceFolder,
              console: 'integratedTerminal'
            })
          }
        } catch {
          // No package.json, use basic config
          configs.push(this.getDefaultLaunchConfig('node', workspaceFolder).config)
        }
        break
      }

      case 'python': {
        // Check for Django
        try {
          await fs.promises.access(path.join(workspaceFolder, 'manage.py'))
          configs.push({
            type: 'python',
            request: 'launch',
            name: 'Django',
            program: '${workspaceFolder}/manage.py',
            args: ['runserver'],
            console: 'integratedTerminal',
            cwd: workspaceFolder,
            justMyCode: true
          })
        } catch { /* not Django */ }

        // Check for Flask
        try {
          await fs.promises.access(path.join(workspaceFolder, 'app.py'))
          configs.push({
            type: 'python',
            request: 'launch',
            name: 'Flask',
            program: '${workspaceFolder}/app.py',
            console: 'integratedTerminal',
            cwd: workspaceFolder,
            justMyCode: true,
            env: { FLASK_APP: 'app.py', FLASK_DEBUG: '1' }
          })
        } catch { /* not Flask */ }

        // Check for main.py
        try {
          await fs.promises.access(path.join(workspaceFolder, 'main.py'))
          configs.push({
            type: 'python',
            request: 'launch',
            name: 'Launch main.py',
            program: '${workspaceFolder}/main.py',
            console: 'integratedTerminal',
            cwd: workspaceFolder,
            justMyCode: true
          })
        } catch { /* no main.py */ }

        // If no specific configs, add current file
        if (configs.length === 0) {
          configs.push(this.getDefaultLaunchConfig('python', workspaceFolder).config)
        }
        break
      }

      case 'go': {
        // Read go.mod for module name
        try {
          await fs.promises.access(path.join(workspaceFolder, 'go.mod'))

          configs.push({
            type: 'go',
            request: 'launch',
            name: 'Launch Package',
            mode: 'auto',
            program: '${workspaceFolder}',
            cwd: workspaceFolder
          })

          configs.push({
            type: 'go',
            request: 'launch',
            name: 'Test Package',
            mode: 'test',
            program: '${workspaceFolder}',
            cwd: workspaceFolder
          })
        } catch {
          configs.push(this.getDefaultLaunchConfig('go', workspaceFolder).config)
        }
        break
      }

      case 'cppdbg':
      case 'lldb': {
        const miMode: 'gdb' | 'lldb' = process.platform === 'darwin' ? 'lldb' : 'gdb'
        const useType = type === 'lldb' ? 'lldb' : 'cppdbg'

        // Detect CMake
        try {
          const cmakeContent = await fs.promises.readFile(path.join(workspaceFolder, 'CMakeLists.txt'), 'utf-8')
          const projectMatch = cmakeContent.match(/project\s*\(\s*(\w+)/i)
          const projectName = projectMatch ? projectMatch[1] : 'app'

          configs.push({
            type: useType,
            request: 'launch',
            name: `Launch CMake (${projectName})`,
            program: `\${workspaceFolder}/build/${projectName}`,
            args: [],
            stopOnEntry: false,
            cwd: workspaceFolder,
            ...(useType === 'cppdbg' ? {
              MIMode: miMode,
              setupCommands: [
                { description: 'Enable pretty-printing for gdb', text: '-enable-pretty-printing', ignoreFailures: true }
              ]
            } : {})
          })
        } catch { /* no CMake */ }

        // Detect Makefile
        try {
          await fs.promises.access(path.join(workspaceFolder, 'Makefile'))
          if (configs.length === 0) {
            configs.push({
              type: useType,
              request: 'launch',
              name: 'Launch (Makefile)',
              program: '${workspaceFolder}/a.out',
              args: [],
              stopOnEntry: false,
              cwd: workspaceFolder,
              ...(useType === 'cppdbg' ? {
                MIMode: miMode,
                setupCommands: [
                  { description: 'Enable pretty-printing for gdb', text: '-enable-pretty-printing', ignoreFailures: true }
                ]
              } : {})
            })
          }
        } catch { /* no Makefile */ }

        if (configs.length === 0) {
          configs.push(this.getDefaultLaunchConfig(useType, workspaceFolder).config)
        }
        break
      }
    }

    return configs
  }

  private generateSessionId(): string {
    // Use cryptographically secure randomness for session identifiers
    const randomPart = typeof crypto.randomUUID === 'function'
      ? crypto.randomUUID()
      : crypto.randomBytes(16).toString('hex')
    return `session_${Date.now()}_${randomPart}`
  }

  private getSessionEntry(sessionId?: string) {
    const id = sessionId ?? this.activeSessionId
    return id ? this.sessions.get(id) : undefined
  }

  private async startDebugAdapter(config: DebugConfig, workspaceFolder: string): Promise<{ client: DAPClient; process?: ChildProcess }> {
    const adapterManager = getAdapterManager()
    const adapterType = config.type as AdapterType

    // Check for remote debugging configuration
    if ('remote' in config && config.remote) {
      const remoteConfig = config.remote as {
        connectionId: string
        remoteHost: string
        remotePort: number
        localRoot?: string
        remoteRoot?: string
      }

      const transport = adapterManager.createSSHTransport({
        connectionId: remoteConfig.connectionId,
        remoteHost: remoteConfig.remoteHost,
        remotePort: remoteConfig.remotePort,
        localRoot: remoteConfig.localRoot || workspaceFolder,
        remoteRoot: remoteConfig.remoteRoot
      })

      const client = new DAPClient(transport)
      await client.start()
      return { client }
    }

    // Try to create transport via AdapterManager
    try {
      const transport = await adapterManager.createTransport(adapterType, workspaceFolder)
      const client = new DAPClient(transport)
      await client.start()
      return { client }
    } catch (err) {
      // Fallback for Node.js
      if (config.type === 'node') {
        return await this.startNodeDebugAdapter(config, workspaceFolder)
      }
      throw err
    }
  }

  private async startNodeDebugAdapter(_config: DebugConfig, _workspaceFolder: string): Promise<{ client: DAPClient; process?: ChildProcess }> {
    // Fallback: Create a stdio transport for the Node.js debug adapter
    const transport: ITransport = new StdioTransport({
      adapterPath: 'node',
      adapterArgs: ['--inspect-brk']
    })

    const client = new DAPClient(transport)

    // Start the adapter
    await client.start()

    return { client }
  }

  // ============ Adapter Management Methods ============

  /**
   * Get available debug adapters
   */
  async getAvailableAdapters(): Promise<AdapterInfo[]> {
    const adapterManager = getAdapterManager()
    return adapterManager.getAvailableAdapters()
  }

  /**
   * Get installed debug adapters
   */
  async getInstalledAdapters(): Promise<AdapterInfo[]> {
    const adapterManager = getAdapterManager()
    return adapterManager.getInstalledAdapters()
  }

  /**
   * Detect debuggers for a workspace
   */
  async detectDebuggers(workspaceFolder: string): Promise<DetectedDebugger[]> {
    const adapterManager = getAdapterManager()
    return adapterManager.detectDebuggers(workspaceFolder)
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
    const activeFile = this.activeFilePath || ''

    // Compute file-related variables
    const fileBasename = activeFile ? path.basename(activeFile) : ''
    const fileExtname = activeFile ? path.extname(activeFile) : ''
    const fileBasenameNoExtension = fileBasename ? fileBasename.slice(0, -fileExtname.length || fileBasename.length) : ''
    const fileDirname = activeFile ? path.dirname(activeFile) : ''
    const relativeFile = activeFile && workspaceFolder
      ? path.relative(workspaceFolder, activeFile)
      : ''

    // Replace variables in string values
    const replaceVars = (str: string): string => {
      return str
        .replace(/\$\{workspaceFolder\}/g, workspaceFolder)
        .replace(/\$\{file\}/g, activeFile)
        .replace(/\$\{fileBasename\}/g, fileBasename)
        .replace(/\$\{fileBasenameNoExtension\}/g, fileBasenameNoExtension)
        .replace(/\$\{fileDirname\}/g, fileDirname)
        .replace(/\$\{fileExtname\}/g, fileExtname)
        .replace(/\$\{relativeFile\}/g, relativeFile)
        .replace(/\$\{relativeFileDirname\}/g, relativeFile ? path.dirname(relativeFile) : '')
    }

    // Recursively replace variables in object values
    const replaceInObject = (obj: Record<string, unknown>): Record<string, unknown> => {
      const result: Record<string, unknown> = {}
      for (const [key, value] of Object.entries(obj)) {
        if (typeof value === 'string') {
          result[key] = replaceVars(value)
        } else if (Array.isArray(value)) {
          result[key] = value.map(item =>
            typeof item === 'string' ? replaceVars(item) : item
          )
        } else if (value !== null && typeof value === 'object') {
          result[key] = replaceInObject(value as Record<string, unknown>)
        } else {
          result[key] = value
        }
      }
      return result
    }

    return replaceInObject(args as unknown as Record<string, unknown>)
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
