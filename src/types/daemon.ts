/**
 * 守护进程语言服务类型定义
 * 用于解析 Rust 守护进程返回的 JSON 数据
 */

/** 位置信息 */
export interface DaemonPosition {
  line: number
  column: number
}

/** 范围信息 */
export interface DaemonRange {
  startLine: number
  startColumn: number
  endLine: number
  endColumn: number
}

/** 补全项 */
export interface DaemonCompletionItem {
  label: string
  kind: number
  detail?: string
}

/** 位置引用 */
export interface DaemonLocation {
  uri: string
  range: DaemonRange
}

/** 悬停信息 */
export interface DaemonHoverInfo {
  contents: string
  range?: DaemonRange
}

/** 文档符号 */
export interface DaemonDocumentSymbol {
  name: string
  kind: number
  range: DaemonRange
  selectionRange: DaemonRange
}

/** 诊断信息 */
export interface DaemonDiagnostic {
  range: DaemonRange
  message: string
  severity: 'error' | 'warning' | 'info' | 'hint'
}

/** 准备重命名结果 */
export interface DaemonPrepareRenameResult {
  range: DaemonRange
  placeholder: string
}

/** 文本编辑 */
export interface DaemonTextEdit {
  range: DaemonRange
  newText: string
}

/** 工作区编辑 */
export interface DaemonWorkspaceEdit {
  changes: Record<string, DaemonTextEdit[]>
}

/** 搜索结果符号 */
export interface DaemonSearchSymbol {
  name: string
  kind: number
  uri: string
  range: DaemonRange
}

/** TODO 项类型 */
export type DaemonTodoKind = 'todo' | 'fixme' | 'hack' | 'xxx' | 'note' | 'bug' | 'optimize' | 'custom'

/** TODO 项 */
export interface DaemonTodoItem {
  kind: DaemonTodoKind
  text: string
  author?: string
  priority: number
  line: number
  range: DaemonRange
  uri?: string
}

/** TODO 统计 */
export interface DaemonTodoStats {
  total: number
  byKind: Record<DaemonTodoKind, number>
}

/** 未使用符号类型 */
export type DaemonUnusedKind = 'variable' | 'function' | 'import' | 'parameter' | 'class' | 'constant' | 'typealias'

/** 未使用符号 */
export interface DaemonUnusedItem {
  kind: DaemonUnusedKind
  name: string
  canRemove: boolean
  fixAction?: string
  range: DaemonRange
}

/** Daemon 支持的语言列表 */
export const DAEMON_SUPPORTED_LANGUAGES = ['python', 'go', 'rust', 'c', 'cpp', 'java'] as const
export type DaemonSupportedLanguage = typeof DAEMON_SUPPORTED_LANGUAGES[number]

/** 文件扩展名到语言 ID 的映射 */
export const DAEMON_EXTENSION_MAP: Record<string, DaemonSupportedLanguage> = {
  '.py': 'python',
  '.pyw': 'python',
  '.go': 'go',
  '.rs': 'rust',
  '.c': 'c',
  '.h': 'c',
  '.cpp': 'cpp',
  '.cxx': 'cpp',
  '.cc': 'cpp',
  '.hpp': 'cpp',
  '.hxx': 'cpp',
  '.hh': 'cpp',
  '.java': 'java'
}
