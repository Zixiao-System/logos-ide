/**
 * 设置状态管理
 * 负责应用设置的管理和持久化
 */

import { defineStore } from 'pinia'
import type { AppSettings, EditorSettings, DevOpsSettings, CICDProvider, TelemetrySettings, LSPSettings } from '@/types/settings'
import { DEFAULT_APP_SETTINGS, DEFAULT_EDITOR_SETTINGS, DEFAULT_DEVOPS_SETTINGS, DEFAULT_TELEMETRY_SETTINGS, DEFAULT_LSP_SETTINGS } from '@/types/settings'

// localStorage 键名
const SETTINGS_STORAGE_KEY = 'lsp-ide-settings'

interface SettingsState extends AppSettings {
  /** 设置是否已初始化 */
  initialized: boolean
}

export const useSettingsStore = defineStore('settings', {
  state: (): SettingsState => ({
    ...DEFAULT_APP_SETTINGS,
    initialized: false
  }),

  getters: {
    /**
     * 是否配置了 GitHub Token
     */
    hasGitHubToken: (state): boolean => {
      return !!state.devops.githubToken
    },

    /**
     * 是否配置了 GitLab Token
     */
    hasGitLabToken: (state): boolean => {
      return !!state.devops.gitlabToken
    },

    /**
     * 当前 CI/CD 提供者是否可用
     */
    isCICDAvailable: (state): boolean => {
      if (state.devops.provider === 'github') {
        return !!state.devops.githubToken
      }
      if (state.devops.provider === 'gitlab') {
        return !!state.devops.gitlabToken
      }
      return false
    },

    /**
     * 是否需要显示遥测同意对话框 (首次启动)
     */
    shouldShowTelemetryConsent: (state): boolean => {
      return !state.telemetry.hasAsked
    },

    /**
     * 遥测是否启用
     */
    isTelemetryEnabled: (state): boolean => {
      return state.telemetry.enabled
    },

    /**
     * 是否需要显示 LSP Setup 提示 (遥测弹窗后)
     */
    shouldShowLSPSetup: (state): boolean => {
      return state.telemetry.hasAsked && !state.lsp.hasShownSetup
    },

    /**
     * 当前 LSP 模式
     */
    lspMode: (state): 'basic' | 'smart' => {
      return state.lsp.mode
    }
  },

  actions: {
    /**
     * 初始化设置
     * 从 localStorage 恢复设置
     */
    init() {
      if (this.initialized) return

      try {
        const saved = localStorage.getItem(SETTINGS_STORAGE_KEY)
        if (saved) {
          const parsed = JSON.parse(saved) as Partial<AppSettings>

          // 合并保存的设置与默认值
          if (parsed.editor) {
            this.editor = { ...DEFAULT_EDITOR_SETTINGS, ...parsed.editor }
          }
          if (parsed.devops) {
            this.devops = { ...DEFAULT_DEVOPS_SETTINGS, ...parsed.devops }
          }
          if (parsed.telemetry) {
            this.telemetry = { ...DEFAULT_TELEMETRY_SETTINGS, ...parsed.telemetry }
          }
          if (parsed.lsp) {
            this.lsp = { ...DEFAULT_LSP_SETTINGS, ...parsed.lsp }
            if (this.lsp.mode === 'basic') {
              this.lsp.mode = 'smart'
            }
          }
        }
      } catch (error) {
        console.error('Failed to load settings:', error)
      }

      this.initialized = true
    },

    /**
     * 保存设置到 localStorage
     */
    save() {
      try {
        const settings: AppSettings = {
          editor: this.editor,
          devops: this.devops,
          telemetry: this.telemetry,
          lsp: this.lsp
        }
        localStorage.setItem(SETTINGS_STORAGE_KEY, JSON.stringify(settings))
      } catch (error) {
        console.error('Failed to save settings:', error)
      }
    },

    /**
     * 更新编辑器设置
     */
    updateEditor(settings: Partial<EditorSettings>) {
      this.editor = { ...this.editor, ...settings }
      this.save()
    },

    /**
     * 更新 DevOps 设置
     */
    updateDevOps(settings: Partial<DevOpsSettings>) {
      this.devops = { ...this.devops, ...settings }
      this.save()
    },

    /**
     * 设置 CI/CD 提供者
     */
    setProvider(provider: CICDProvider) {
      this.devops.provider = provider
      this.save()
    },

    /**
     * 设置 GitHub Token
     */
    setGitHubToken(token: string) {
      this.devops.githubToken = token
      this.save()
    },

    /**
     * 设置 GitHub OAuth Client ID
     */
    setGitHubOAuthClientId(clientId: string) {
      this.devops.githubOAuthClientId = clientId
      this.save()
    },

    /**
     * 设置 GitLab Token
     */
    setGitLabToken(token: string) {
      this.devops.gitlabToken = token
      this.save()
    },

    /**
     * 设置 GitLab URL
     */
    setGitLabUrl(url: string) {
      this.devops.gitlabUrl = url
      this.save()
    },

    /**
     * 重置为默认设置
     */
    reset() {
      this.editor = { ...DEFAULT_EDITOR_SETTINGS }
      this.devops = { ...DEFAULT_DEVOPS_SETTINGS }
      this.save()
    },

    /**
     * 更新遥测设置
     */
    updateTelemetry(settings: Partial<TelemetrySettings>) {
      this.telemetry = { ...this.telemetry, ...settings }
      this.save()
    },

    /**
     * 用户同意遥测 (首次启动时调用)
     */
    acceptTelemetry() {
      this.telemetry = {
        hasAsked: true,
        enabled: true
      }
      this.save()
    },

    /**
     * 用户拒绝遥测 (首次启动时调用)
     */
    rejectTelemetry() {
      this.telemetry = {
        hasAsked: true,
        enabled: false
      }
      this.save()
    },

    /**
     * 切换遥测状态 (在设置页面中使用)
     */
    toggleTelemetry() {
      this.telemetry.enabled = !this.telemetry.enabled
      this.save()
    },

    /**
     * 标记 LSP Setup 已显示
     */
    dismissLSPSetup() {
      this.lsp.hasShownSetup = true
      this.save()
    },

    /**
     * 设置 LSP 模式
     */
    setLSPMode(mode: 'basic' | 'smart') {
      this.lsp.mode = mode === 'basic' ? 'smart' : mode
      this.save()
    },

    /**
     * 更新 LSP 设置
     */
    updateLSP(settings: Partial<LSPSettings>) {
      this.lsp = { ...this.lsp, ...settings }
      this.save()
    }
  }
})
