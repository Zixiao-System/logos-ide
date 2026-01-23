/**
 * 设置相关类型定义
 */

import type { EditorConfig } from './editor'

/** 编辑器设置 */
export interface EditorSettings {
  /** 字体大小 */
  fontSize: number
  /** Tab 大小 */
  tabSize: number
  /** 是否自动换行 */
  wordWrap: boolean
  /** 是否显示 minimap */
  minimap: boolean
  /** 是否自动保存 */
  autoSave: boolean
  /** 颜色主题 */
  colorTheme: 'lsp-dark' | 'lsp-light' | 'monokai' | 'github-dark'
}

/** CI/CD 提供者类型 */
export type CICDProvider = 'none' | 'github' | 'gitlab'

/** AI 提供者 */
export type AIProvider = 'openai' | 'anthropic'

/** OAuth Token */
export interface AIOAuthToken {
  accessToken: string
  refreshToken: string
  expiresAt: number
  accountId?: string
}

/** AI Provider 配置 */
export interface AIProviderSettings {
  authType: 'none' | 'api' | 'oauth'
  apiKey: string
  oauth?: AIOAuthToken | null
  model: string
}

/** AI 设置 */
export interface AISettings {
  provider: AIProvider
  openai: AIProviderSettings
  anthropic: AIProviderSettings
}

/** DevOps 设置 */
export interface DevOpsSettings {
  /** 当前使用的 CI/CD 提供者 */
  provider: CICDProvider
  /** GitHub Personal Access Token */
  githubToken: string
  /** GitLab Personal Access Token */
  gitlabToken: string
  /** GitLab 服务器地址 (支持自托管) */
  gitlabUrl: string
  /** GitHub App ID */
  githubAppId: string
  /** GitHub App 私钥路径 */
  githubAppPrivateKeyPath: string
  /** 构建完成通知 */
  buildNotifications: boolean
  /** Slack Webhook URL (用于发送通知) */
  slackWebhookUrl: string
}

/** 遥测设置 */
export interface TelemetrySettings {
  /** 是否已询问过用户 (首次启动时询问) */
  hasAsked: boolean
  /** 用户是否同意遥测 */
  enabled: boolean
}

/** LSP 设置 */
export interface LSPSettings {
  /** 是否已显示过 LSP Setup 提示 */
  hasShownSetup: boolean
  /** 智能模式: basic (标准 LSP) 或 smart (全量索引) */
  mode: 'basic' | 'smart'
}

/** UI 设置 */
export interface UISettings {
  /** 侧边栏宽度 */
  sidebarWidth: number
}

/** 应用设置 */
export interface AppSettings {
  /** 编辑器设置 */
  editor: EditorSettings
  /** DevOps 设置 */
  devops: DevOpsSettings
  /** AI 设置 */
  ai: AISettings
  /** 遥测设置 */
  telemetry: TelemetrySettings
  /** LSP 设置 */
  lsp: LSPSettings
  /** UI 设置 */
  ui: UISettings
}

/** 默认编辑器设置 */
export const DEFAULT_EDITOR_SETTINGS: EditorSettings = {
  fontSize: 14,
  tabSize: 2,
  wordWrap: true,
  minimap: true,
  autoSave: true,
  colorTheme: 'lsp-dark'
}

/** 默认 DevOps 设置 */
export const DEFAULT_DEVOPS_SETTINGS: DevOpsSettings = {
  provider: 'none',
  githubToken: '',
  gitlabToken: '',
  gitlabUrl: 'https://gitlab.com',
  githubAppId: '',
  githubAppPrivateKeyPath: '',
  buildNotifications: true,
  slackWebhookUrl: ''
}

/** 默认 AI 设置 */
export const DEFAULT_AI_SETTINGS: AISettings = {
  provider: 'openai',
  openai: {
    authType: 'none',
    apiKey: '',
    oauth: null,
    model: 'gpt-4.1'
  },
  anthropic: {
    authType: 'none',
    apiKey: '',
    oauth: null,
    model: 'claude-3-5-sonnet-20240620'
  }
}

/** 默认遥测设置 */
export const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = {
  hasAsked: false,
  enabled: false
}

/** 默认 LSP 设置 */
export const DEFAULT_LSP_SETTINGS: LSPSettings = {
  hasShownSetup: false,
  mode: 'basic'
}

/** 默认 UI 设置 */
export const DEFAULT_UI_SETTINGS: UISettings = {
  sidebarWidth: 260
}

/** 默认应用设置 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  editor: DEFAULT_EDITOR_SETTINGS,
  devops: DEFAULT_DEVOPS_SETTINGS,
  ai: DEFAULT_AI_SETTINGS,
  telemetry: DEFAULT_TELEMETRY_SETTINGS,
  lsp: DEFAULT_LSP_SETTINGS,
  ui: DEFAULT_UI_SETTINGS
}

/**
 * 将 EditorSettings 转换为 Monaco EditorConfig
 */
export function toEditorConfig(settings: EditorSettings): Partial<EditorConfig> {
  return {
    fontSize: settings.fontSize,
    tabSize: settings.tabSize,
    wordWrap: settings.wordWrap ? 'on' : 'off',
    minimap: settings.minimap,
    theme: settings.colorTheme === 'lsp-light' ? 'lsp-light' : 'lsp-dark'
  }
}
