/**
 * LSP 相关类型定义
 */

import type { ChildProcess } from 'child_process'
import type { MessageConnection } from 'vscode-jsonrpc/node'

// ============ LSP 客户端状态 ============

export type LSPClientStatus = 'stopped' | 'starting' | 'ready' | 'error'

// ============ LSP 配置 ============

export interface LSPServerConfig {
  /** 语言 ID */
  languageId: string
  /** 可执行文件名 */
  command: string
  /** 命令行参数 */
  args: string[]
  /** 支持的文件扩展名 */
  extensions: string[]
  /** LSP 初始化选项 */
  initializationOptions?: Record<string, unknown>
  /** 环境变量 */
  env?: Record<string, string>
}

// ============ LSP 客户端实例 ============

export interface LSPClientInstance {
  /** 语言 ID */
  languageId: string
  /** 子进程 */
  process: ChildProcess | null
  /** JSON-RPC 连接 */
  connection: MessageConnection | null
  /** 当前状态 */
  status: LSPClientStatus
  /** 错误信息 */
  errorMessage?: string
  /** 项目根路径 */
  rootPath: string
  /** 已打开的文档 URI 集合 */
  openDocuments: Set<string>
  /** 文档版本映射 */
  documentVersions: Map<string, number>
}

// ============ 语言层级 ============

export type LanguageTier = 'native' | 'lsp' | 'basic'

export interface LanguageInfo {
  /** 语言 ID */
  languageId: string
  /** 服务层级 */
  tier: LanguageTier
  /** LSP 服务器 ID（仅 LSP 层级） */
  lspServerId?: string
  /** 显示名称 */
  displayName: string
}

// ============ LSP 请求参数 ============

export interface LSPPosition {
  line: number
  character: number
}

export interface LSPRange {
  start: LSPPosition
  end: LSPPosition
}

export interface LSPLocation {
  uri: string
  range: LSPRange
}

export interface LSPTextDocumentIdentifier {
  uri: string
}

export interface LSPTextDocumentPositionParams {
  textDocument: LSPTextDocumentIdentifier
  position: LSPPosition
}

// ============ LSP 状态事件 ============

export interface LSPServerStatusEvent {
  languageId: string
  status: LSPClientStatus
  message?: string
}

// ============ 语言映射 ============

export const LANGUAGE_MAP: Record<string, LanguageInfo> = {
  // Tier 1: Native (TypeScript Compiler API)
  'typescript': { languageId: 'typescript', tier: 'native', displayName: 'TypeScript' },
  'javascript': { languageId: 'javascript', tier: 'native', displayName: 'JavaScript' },
  'typescriptreact': { languageId: 'typescriptreact', tier: 'native', displayName: 'TypeScript React' },
  'javascriptreact': { languageId: 'javascriptreact', tier: 'native', displayName: 'JavaScript React' },

  // Tier 2: LSP
  'python': { languageId: 'python', tier: 'lsp', lspServerId: 'pyright', displayName: 'Python' },
  'go': { languageId: 'go', tier: 'lsp', lspServerId: 'gopls', displayName: 'Go' },
  'rust': { languageId: 'rust', tier: 'lsp', lspServerId: 'rust-analyzer', displayName: 'Rust' },
  'java': { languageId: 'java', tier: 'lsp', lspServerId: 'jdtls', displayName: 'Java' },

  // Tier 3: Basic (Monaco built-in)
  'html': { languageId: 'html', tier: 'basic', displayName: 'HTML' },
  'css': { languageId: 'css', tier: 'basic', displayName: 'CSS' },
  'json': { languageId: 'json', tier: 'basic', displayName: 'JSON' },
  'markdown': { languageId: 'markdown', tier: 'basic', displayName: 'Markdown' },
  'yaml': { languageId: 'yaml', tier: 'basic', displayName: 'YAML' },
  'xml': { languageId: 'xml', tier: 'basic', displayName: 'XML' },
  'shell': { languageId: 'shell', tier: 'basic', displayName: 'Shell' },
  'dockerfile': { languageId: 'dockerfile', tier: 'basic', displayName: 'Dockerfile' },
}

// ============ 文件扩展名映射 ============

export const EXTENSION_TO_LANGUAGE: Record<string, string> = {
  // TypeScript/JavaScript
  '.ts': 'typescript',
  '.tsx': 'typescriptreact',
  '.js': 'javascript',
  '.jsx': 'javascriptreact',
  '.mjs': 'javascript',
  '.cjs': 'javascript',
  '.mts': 'typescript',
  '.cts': 'typescript',

  // Python
  '.py': 'python',
  '.pyi': 'python',
  '.pyw': 'python',

  // Go
  '.go': 'go',

  // Rust
  '.rs': 'rust',

  // Java
  '.java': 'java',

  // Web
  '.html': 'html',
  '.htm': 'html',
  '.css': 'css',
  '.scss': 'css',
  '.less': 'css',

  // Data formats
  '.json': 'json',
  '.jsonc': 'json',
  '.yaml': 'yaml',
  '.yml': 'yaml',
  '.xml': 'xml',
  '.svg': 'xml',

  // Markdown
  '.md': 'markdown',
  '.mdx': 'markdown',

  // Shell
  '.sh': 'shell',
  '.bash': 'shell',
  '.zsh': 'shell',

  // Docker
  'Dockerfile': 'dockerfile',
  '.dockerfile': 'dockerfile',
}
