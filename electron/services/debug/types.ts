/**
 * Debug Adapter Protocol (DAP) Types for Logos IDE
 */
import { DebugProtocol } from '@vscode/debugprotocol'

// Re-export commonly used DAP types
export type Capabilities = DebugProtocol.Capabilities
export type Source = DebugProtocol.Source
export type SourceBreakpoint = DebugProtocol.SourceBreakpoint
export type Breakpoint = DebugProtocol.Breakpoint
export type StackFrame = DebugProtocol.StackFrame
export type Scope = DebugProtocol.Scope
export type Variable = DebugProtocol.Variable
export type Thread = DebugProtocol.Thread

/** Debugger types supported by the IDE */
export type DebuggerType = 'node' | 'chrome' | 'gdb' | 'lldb' | 'python' | 'go'

/** Debug session state */
export enum SessionState {
  Initializing = 'initializing',
  Running = 'running',
  Stopped = 'stopped',
  Terminated = 'terminated'
}

/** Breakpoint types */
export enum BreakpointType {
  Line = 'line',
  Conditional = 'conditional',
  Logpoint = 'logpoint',
  Function = 'function',
  Exception = 'exception',
  Data = 'data'
}

/** Launch request configuration */
export interface LaunchConfig {
  type: DebuggerType | string
  request: 'launch'
  name: string
  program?: string
  args?: string[]
  cwd?: string
  env?: Record<string, string>
  runtimeExecutable?: string
  runtimeArgs?: string[]
  console?: 'internalConsole' | 'integratedTerminal' | 'externalTerminal'
  stopOnEntry?: boolean
  sourceMaps?: boolean
  outFiles?: string[]
  skipFiles?: string[]
  // Node.js specific
  port?: number
  // C/C++ specific
  MIMode?: 'gdb' | 'lldb'
  miDebuggerPath?: string
  setupCommands?: Array<{ description?: string; text: string; ignoreFailures?: boolean }>
  // Python specific
  python?: string
  justMyCode?: boolean
  // Chrome specific
  url?: string
  webRoot?: string
  // Common
  preLaunchTask?: string
  postDebugTask?: string
  // Remote debugging
  remote?: RemoteDebugConfig
  [key: string]: unknown
}

/** Remote debugging configuration */
export interface RemoteDebugConfig {
  /** SSH connection ID */
  connectionId: string
  /** Remote host where the DAP server is running */
  remoteHost: string
  /** Remote port where the DAP server is running */
  remotePort: number
  /** Local workspace root for path mapping */
  localRoot?: string
  /** Remote workspace root for path mapping */
  remoteRoot?: string
}

/** Attach request configuration */
export interface AttachConfig {
  type: DebuggerType | string
  request: 'attach'
  name: string
  port?: number
  address?: string
  processId?: number
  sourceMaps?: boolean
  localRoot?: string
  remoteRoot?: string
  sourceMapPathOverrides?: Record<string, string>
  [key: string]: unknown
}

/** Debug configuration (launch or attach) */
export type DebugConfig = LaunchConfig | AttachConfig

/** Debug session info */
export interface DebugSession {
  id: string
  name: string
  type: DebuggerType | string
  state: SessionState
  config: DebugConfig
  capabilities?: Capabilities
  threads: Thread[]
  currentThreadId?: number
  currentFrameId?: number
}

/** Breakpoint with additional metadata */
export interface BreakpointInfo {
  id: string
  verified: boolean
  source: Source
  line: number
  column?: number
  enabled: boolean
  condition?: string
  hitCondition?: string
  logMessage?: string
  type: BreakpointType
}

/** Watch expression */
export interface WatchExpression {
  id: string
  expression: string
  result?: EvaluateResult
  error?: string
}

/** Evaluate result */
export interface EvaluateResult {
  result: string
  type?: string
  variablesReference: number
  namedVariables?: number
  indexedVariables?: number
  memoryReference?: string
}

/** Launch configuration file format */
export interface LaunchConfigFile {
  version: string
  configurations: DebugConfig[]
  compounds?: CompoundConfig[]
}

/** Compound debug configuration */
export interface CompoundConfig {
  name: string
  configurations: string[]
  stopAll?: boolean
  preLaunchTask?: string
}

/** Debug event types */
export interface DebugEvents {
  initialized: void
  stopped: DebugProtocol.StoppedEvent['body']
  continued: DebugProtocol.ContinuedEvent['body']
  terminated: DebugProtocol.TerminatedEvent['body'] | undefined
  output: DebugProtocol.OutputEvent['body']
  breakpoint: DebugProtocol.BreakpointEvent['body']
  thread: DebugProtocol.ThreadEvent['body']
  exited: DebugProtocol.ExitedEvent['body']
  module: DebugProtocol.ModuleEvent['body']
  loadedSource: DebugProtocol.LoadedSourceEvent['body']
  process: DebugProtocol.ProcessEvent['body']
  capabilities: DebugProtocol.CapabilitiesEvent['body']
  progressStart: DebugProtocol.ProgressStartEvent['body']
  progressUpdate: DebugProtocol.ProgressUpdateEvent['body']
  progressEnd: DebugProtocol.ProgressEndEvent['body']
  invalidated: DebugProtocol.InvalidatedEvent['body']
  memory: DebugProtocol.MemoryEvent['body']
}

/** Variable tree node for UI */
export interface VariableNode {
  name: string
  value: string
  type?: string
  variablesReference: number
  namedVariables?: number
  indexedVariables?: number
  children?: VariableNode[]
  expanded?: boolean
}

/** Call stack frame for UI */
export interface CallStackFrame {
  id: number
  name: string
  source?: Source
  line: number
  column: number
  presentationHint?: 'normal' | 'label' | 'subtle'
  canRestart?: boolean
  current?: boolean
}

/** Debug console message */
export interface DebugConsoleMessage {
  type: 'input' | 'output' | 'error' | 'warning' | 'info'
  message: string
  timestamp: number
  source?: string
  line?: number
}
