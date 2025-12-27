/**
 * 代码智能相关类型定义
 */

// ============ 基础类型 ============

/** 位置 (1-based, 与 Monaco 一致) */
export interface Position {
  line: number
  column: number
}

/** 范围 */
export interface Range {
  start: Position
  end: Position
}

/** 语言支持层级 */
export type LanguageTier = 'native' | 'lsp' | 'basic'

/** 语言配置 */
export interface LanguageConfig {
  id: string
  tier: LanguageTier
  extensions: string[]
  aliases?: string[]
}

// ============ 补全相关 ============

/** 补全项类型 */
export enum CompletionItemKind {
  Text = 1,
  Method = 2,
  Function = 3,
  Constructor = 4,
  Field = 5,
  Variable = 6,
  Class = 7,
  Interface = 8,
  Module = 9,
  Property = 10,
  Unit = 11,
  Value = 12,
  Enum = 13,
  Keyword = 14,
  Snippet = 15,
  Color = 16,
  File = 17,
  Reference = 18,
  Folder = 19,
  EnumMember = 20,
  Constant = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

/** 插入文本规则 */
export enum InsertTextRule {
  None = 0,
  InsertAsSnippet = 4,
}

/** 补全项 */
export interface CompletionItem {
  label: string
  kind: CompletionItemKind
  detail?: string
  documentation?: string | { value: string; isTrusted?: boolean }
  insertText: string
  insertTextRules?: InsertTextRule
  sortText?: string
  filterText?: string
  preselect?: boolean
  range?: {
    startLineNumber: number
    startColumn: number
    endLineNumber: number
    endColumn: number
  }
  commitCharacters?: string[]
}

/** 补全结果 */
export interface CompletionResult {
  suggestions: CompletionItem[]
  incomplete?: boolean
}

// ============ 定义与引用 ============

/** 定义位置 */
export interface DefinitionLocation {
  uri: string
  range: Range
}

/** 引用位置 */
export interface ReferenceLocation {
  uri: string
  range: Range
  isDefinition?: boolean
}

// ============ 诊断 ============

/** 诊断严重性 */
export type DiagnosticSeverity = 'error' | 'warning' | 'info' | 'hint'

/** 诊断信息 */
export interface Diagnostic {
  range: Range
  message: string
  severity: DiagnosticSeverity
  code?: string | number
  source?: string
  relatedInformation?: Array<{
    location: { uri: string; range: Range }
    message: string
  }>
}

// ============ 悬停信息 ============

/** 悬停内容 */
export interface HoverInfo {
  contents: Array<{ value: string; language?: string }>
  range?: Range
}

// ============ 签名帮助 ============

/** 参数信息 */
export interface ParameterInfo {
  label: string | [number, number]
  documentation?: string
}

/** 签名信息 */
export interface SignatureInfo {
  label: string
  documentation?: string
  parameters: ParameterInfo[]
  activeParameter?: number
}

/** 签名帮助 */
export interface SignatureHelp {
  signatures: SignatureInfo[]
  activeSignature: number
  activeParameter: number
}

// ============ 内联提示 ============

/** 内联提示类型 */
export type InlayHintKind = 'type' | 'parameter'

/** 内联提示 */
export interface InlayHint {
  position: Position
  label: string
  kind: InlayHintKind
  paddingLeft?: boolean
  paddingRight?: boolean
  tooltip?: string
}

// ============ 重命名 ============

/** 重命名准备结果 */
export interface PrepareRenameResult {
  range: Range
  placeholder: string
}

/** 文本编辑 */
export interface TextEdit {
  range: Range
  newText: string
}

/** 工作区编辑 */
export interface WorkspaceEdit {
  changes: Record<string, TextEdit[]>
}

// ============ 重构 ============

/** 重构动作类型 */
export type RefactorActionKind =
  | 'refactor.extract.function'
  | 'refactor.extract.constant'
  | 'refactor.extract.variable'
  | 'refactor.inline'
  | 'refactor.move'
  | 'refactor.rewrite'

/** 重构动作 */
export interface RefactorAction {
  title: string
  kind: RefactorActionKind | string
  description?: string
  isPreferred?: boolean
  disabled?: { reason: string }
  edit?: WorkspaceEdit
}

// ============ 符号 ============

/** 符号类型 */
export enum SymbolKind {
  File = 0,
  Module = 1,
  Namespace = 2,
  Package = 3,
  Class = 4,
  Method = 5,
  Property = 6,
  Field = 7,
  Constructor = 8,
  Enum = 9,
  Interface = 10,
  Function = 11,
  Variable = 12,
  Constant = 13,
  String = 14,
  Number = 15,
  Boolean = 16,
  Array = 17,
  Object = 18,
  Key = 19,
  Null = 20,
  EnumMember = 21,
  Struct = 22,
  Event = 23,
  Operator = 24,
  TypeParameter = 25,
}

/** 文档符号 */
export interface DocumentSymbol {
  name: string
  detail?: string
  kind: SymbolKind
  range: Range
  selectionRange: Range
  children?: DocumentSymbol[]
}

// ============ 语言服务器状态 ============

/** 服务器状态 */
export type ServerStatus = 'starting' | 'ready' | 'error' | 'stopped'

/** 语言服务器状态 */
export interface LanguageServerStatus {
  language: string
  status: ServerStatus
  message?: string
  capabilities?: {
    completionProvider?: boolean
    definitionProvider?: boolean
    referencesProvider?: boolean
    renameProvider?: boolean
    hoverProvider?: boolean
    signatureHelpProvider?: boolean
    inlayHintsProvider?: boolean
    diagnosticProvider?: boolean
  }
}

// ============ 项目信息 ============

/** 项目配置 */
export interface ProjectConfig {
  rootPath: string
  compilerOptions?: Record<string, unknown>
  include?: string[]
  exclude?: string[]
}

/** 文件版本信息 */
export interface FileVersion {
  path: string
  version: number
  content?: string
}

// ============ IPC 请求/响应类型 ============

/** 补全请求 */
export interface CompletionRequest {
  filePath: string
  position: Position
  triggerCharacter?: string
}

/** 定义请求 */
export interface DefinitionRequest {
  filePath: string
  position: Position
}

/** 引用请求 */
export interface ReferencesRequest {
  filePath: string
  position: Position
  includeDeclaration?: boolean
}

/** 重命名请求 */
export interface RenameRequest {
  filePath: string
  position: Position
  newName: string
}

/** 重构请求 */
export interface RefactorRequest {
  filePath: string
  range: Range
  actionKind?: string
}

/** 悬停请求 */
export interface HoverRequest {
  filePath: string
  position: Position
}

/** 签名帮助请求 */
export interface SignatureHelpRequest {
  filePath: string
  position: Position
  triggerCharacter?: string
}

/** 内联提示请求 */
export interface InlayHintsRequest {
  filePath: string
  range: Range
}

// ============ 索引进度 ============

/** 索引阶段 */
export type IndexingPhase =
  | 'idle'           // 空闲
  | 'scanning'       // 扫描文件
  | 'parsing'        // 解析文件
  | 'indexing'       // 建立索引
  | 'ready'          // 就绪

/** 索引进度信息 */
export interface IndexingProgress {
  phase: IndexingPhase
  message: string
  /** 当前处理的文件 */
  currentFile?: string
  /** 已处理文件数 */
  processedFiles: number
  /** 总文件数 */
  totalFiles: number
  /** 进度百分比 (0-100) */
  percentage: number
  /** 开始时间 */
  startTime?: number
  /** 预计剩余时间 (ms) */
  estimatedTimeRemaining?: number
}

/** 分析状态 */
export interface AnalysisStatus {
  /** 是否正在分析 */
  isAnalyzing: boolean
  /** 当前分析的文件 */
  currentFile?: string
  /** 队列中的文件数 */
  queuedFiles: number
}

/** Logos 服务整体状态 */
export interface LogosServiceStatus {
  /** 索引进度 */
  indexing: IndexingProgress
  /** 分析状态 */
  analysis: AnalysisStatus
  /** 语言服务器状态 */
  servers: LanguageServerStatus[]
  /** 诊断统计 */
  diagnostics: {
    errors: number
    warnings: number
    hints: number
  }
}
