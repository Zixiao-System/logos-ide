export type ExtensionHostStatus = 'stopped' | 'starting' | 'running' | 'error'

export interface ExtensionHostState {
  status: ExtensionHostStatus
  pid?: number
  startedAt?: number
  error?: string
}

export interface LocalExtensionInfo {
  id: string
  name: string
  publisher?: string
  version?: string
  displayName?: string
  description?: string
  path: string
  enabled: boolean
  trusted?: boolean
  iconPath?: string
  categories?: string[]
}

export interface ExtensionHostMessage {
  level: 'info' | 'warning' | 'error'
  message: string
}

export interface ExtensionPosition {
  line: number
  character: number
}

export interface ExtensionRange {
  start: ExtensionPosition
  end: ExtensionPosition
}

export interface ExtensionDocumentPayload {
  uri: string
  languageId: string
  content: string
  version: number
}

export interface ExtensionDocumentChangePayload {
  uri: string
  languageId: string
  content: string
  version: number
}

export interface ExtensionCompletionRequest {
  uri: string
  position: ExtensionPosition
  context?: {
    triggerKind?: number
    triggerCharacter?: string
  }
}

export interface ExtensionCompletionItem {
  label: string
  kind?: number
  detail?: string
  documentation?: string
  insertText?: string
  insertTextFormat?: number
  textEdit?: {
    range: ExtensionRange
    newText: string
  }
}

export interface ExtensionCompletionResult {
  items: ExtensionCompletionItem[]
  isIncomplete?: boolean
}

export interface ExtensionInlineCompletionRequest {
  uri: string
  position: ExtensionPosition
}

export interface ExtensionInlineCompletionItem {
  insertText: string
  range?: ExtensionRange
}

export interface ExtensionInlineCompletionResult {
  items: ExtensionInlineCompletionItem[]
}

export interface ExtensionLocation {
  uri: string
  range: ExtensionRange
}

export interface ExtensionHoverRequest {
  uri: string
  position: ExtensionPosition
}

export interface ExtensionHoverResult {
  contents: string[]
  range?: ExtensionRange
}

export interface ExtensionDefinitionRequest {
  uri: string
  position: ExtensionPosition
}

export interface ExtensionReferencesRequest {
  uri: string
  position: ExtensionPosition
  context?: {
    includeDeclaration?: boolean
  }
}

export interface ExtensionDocumentSymbol {
  name: string
  detail?: string
  kind: number
  range: ExtensionRange
  selectionRange: ExtensionRange
  children?: ExtensionDocumentSymbol[]
}

export interface ExtensionSignatureHelpRequest {
  uri: string
  position: ExtensionPosition
  context?: {
    triggerKind?: number
    triggerCharacter?: string
    isRetrigger?: boolean
  }
}

export interface ExtensionSignatureHelpResult {
  signatures: Array<{
    label: string
    documentation?: string
    parameters?: Array<{
      label: string | [number, number]
      documentation?: string
    }>
  }>
  activeSignature?: number
  activeParameter?: number
}

export interface ExtensionTextEdit {
  range: ExtensionRange
  newText: string
}

export interface ExtensionWorkspaceEdit {
  edits: Array<{
    uri: string
    edits: ExtensionTextEdit[]
  }>
}

export interface ExtensionRenameRequest {
  uri: string
  position: ExtensionPosition
  newName: string
}

export interface ExtensionPrepareRenameResult {
  range: ExtensionRange
  placeholder?: string
}

export interface ExtensionCodeAction {
  title: string
  kind?: string
  isPreferred?: boolean
  edit?: ExtensionWorkspaceEdit
  command?: { command: string; title: string; arguments?: unknown[] }
}

export interface ExtensionCodeActionRequest {
  uri: string
  range: ExtensionRange
  context?: {
    only?: string
    triggerKind?: number
  }
}

export interface ExtensionFormattingRequest {
  uri: string
  options?: { tabSize: number; insertSpaces: boolean }
}

export interface ExtensionRangeFormattingRequest {
  uri: string
  range: ExtensionRange
  options?: { tabSize: number; insertSpaces: boolean }
}

export interface ExtensionOnTypeFormattingRequest {
  uri: string
  position: ExtensionPosition
  ch: string
  options?: { tabSize: number; insertSpaces: boolean }
}

export interface ExtensionViewContainer {
  id: string
  title: string
  iconPath?: string
  extensionId?: string
}

export interface ExtensionView {
  id: string
  name: string
  containerId: string
  extensionId?: string
}

export interface ExtensionUiContributions {
  containers: ExtensionViewContainer[]
  views: ExtensionView[]
}

export interface ExtensionWebviewResolveResult {
  handle: string
  html: string
  options?: {
    enableScripts?: boolean
  }
}

export interface ExtensionWebviewMessage {
  handle: string
  message: unknown
}

export interface ExtensionWebviewHtml {
  handle: string
  html: string
}

export interface ExtensionMarketplaceItem {
  id: string
  publisher: string
  name: string
  displayName?: string
  description?: string
  version?: string
  downloads?: number
  iconUrl?: string
  downloadUrl?: string
}
