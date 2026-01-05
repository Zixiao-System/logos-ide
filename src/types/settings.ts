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
  /** 构建完成通知 */
  buildNotifications: boolean
}

/** 遥测设置 */
export interface TelemetrySettings {
  /** 是否已询问过用户 (首次启动时询问) */
  hasAsked: boolean
  /** 用户是否同意遥测 */
  enabled: boolean
}

/** 应用设置 */
export interface AppSettings {
  /** 编辑器设置 */
  editor: EditorSettings
  /** DevOps 设置 */
  devops: DevOpsSettings
  /** 遥测设置 */
  telemetry: TelemetrySettings
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
  buildNotifications: true
}

/** 默认遥测设置 */
export const DEFAULT_TELEMETRY_SETTINGS: TelemetrySettings = {
  hasAsked: false,
  enabled: false
}

/** 默认应用设置 */
export const DEFAULT_APP_SETTINGS: AppSettings = {
  editor: DEFAULT_EDITOR_SETTINGS,
  devops: DEFAULT_DEVOPS_SETTINGS,
  telemetry: DEFAULT_TELEMETRY_SETTINGS
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
