/**
 * 编辑器相关类型定义
 */

/** 编辑器标签页 */
export interface EditorTab {
  /** 唯一标识 */
  id: string
  /** 文件路径 */
  path: string
  /** 文件名 */
  filename: string
  /** 语言类型 */
  language: string
  /** 当前内容 */
  content: string
  /** 原始内容 (用于检测修改) */
  originalContent: string
  /** 是否有未保存的修改 */
  isDirty: boolean
  /** 光标位置 */
  cursorPosition: CursorPosition
  /** 滚动位置 */
  scrollPosition: ScrollPosition
  /** 视图状态 (Monaco 专用) */
  viewState?: unknown
  /** 只读 / 虚拟文档 */
  readOnly?: boolean
  /** 是否为远程文件 */
  isRemote?: boolean
}

/** 光标位置 */
export interface CursorPosition {
  line: number
  column: number
}

/** 滚动位置 */
export interface ScrollPosition {
  top: number
  left: number
}

/** 编辑器配置 */
export interface EditorConfig {
  /** 字体大小 */
  fontSize: number
  /** 字体家族 */
  fontFamily: string
  /** Tab 大小 */
  tabSize: number
  /** 是否使用空格代替 Tab */
  insertSpaces: boolean
  /** 是否显示 minimap */
  minimap: boolean
  /** 是否自动换行 */
  wordWrap: 'on' | 'off' | 'wordWrapColumn' | 'bounded'
  /** 主题 */
  theme: 'lsp-dark' | 'lsp-light'
  /** 是否显示行号 */
  lineNumbers: 'on' | 'off' | 'relative'
  /** 是否启用连字 */
  fontLigatures: boolean
}

/** 编辑器 Store 状态 */
export interface EditorState {
  /** 所有打开的标签页 */
  tabs: EditorTab[]
  /** 当前激活的标签页 ID */
  activeTabId: string | null
  /** 最近打开的文件列表 */
  recentFiles: string[]
  /** 待跳转的位置 */
  pendingNavigation: NavigationTarget | null
  /** 编辑器配置 */
  config: EditorConfig
}

/** 导航位置 */
export interface NavigationTarget {
  path: string
  line: number
  column: number
}

/** 默认编辑器配置 */
export const DEFAULT_EDITOR_CONFIG: EditorConfig = {
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  tabSize: 2,
  insertSpaces: true,
  minimap: true,
  wordWrap: 'on',
  theme: 'lsp-dark',
  lineNumbers: 'on',
  fontLigatures: true
}
