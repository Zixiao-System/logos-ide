/**
 * 智能模式状态管理
 * 负责管理 Basic/Smart 模式切换、索引进度、服务器状态
 */

import { defineStore } from 'pinia'
import type { IndexingProgress, LanguageServerStatus, ServerStatus } from '@/types/intelligence'

/** 智能模式类型 */
export type IntelligenceMode = 'basic' | 'smart'

/** 项目分析结果 */
export interface ProjectAnalysis {
  /** 文件数量 */
  fileCount: number
  /** 总大小 (bytes) */
  totalSize: number
  /** 预估内存需求 (MB) */
  estimatedMemory: number
  /** 是否有复杂依赖 */
  hasComplexDependencies: boolean
  /** 检测到的语言 */
  languages: string[]
}

/** Smart Mode 阈值配置 */
export interface SmartModeThreshold {
  /** 最大文件数 */
  maxFiles: number
  /** 最大内存使用 (MB) */
  maxMemoryMB: number
}

/** 智能模式状态 */
interface IntelligenceState {
  /** 当前模式 */
  mode: IntelligenceMode
  /** 是否自动选择模式 */
  autoSelect: boolean
  /** 索引进度 */
  indexingProgress: IndexingProgress | null
  /** LSP 服务器状态 */
  serverStatus: Record<string, LanguageServerStatus>
  /** 模式切换中 */
  isSwitching: boolean
  /** 项目分析结果 */
  projectAnalysis: ProjectAnalysis | null
  /** Smart Mode 阈值 */
  smartModeThreshold: SmartModeThreshold
  /** 是否有待切换到 Smart Mode */
  pendingSmartSwitch: boolean
}

/** 默认索引进度 */
const DEFAULT_INDEXING_PROGRESS: IndexingProgress = {
  phase: 'idle',
  message: '',
  processedFiles: 0,
  totalFiles: 0,
  percentage: 0
}

/** 默认阈值 */
const DEFAULT_THRESHOLD: SmartModeThreshold = {
  maxFiles: 5000,
  maxMemoryMB: 2048
}

export const useIntelligenceStore = defineStore('intelligence', {
  state: (): IntelligenceState => ({
    mode: 'basic',
    autoSelect: true,
    indexingProgress: null,
    serverStatus: {},
    isSwitching: false,
    projectAnalysis: null,
    smartModeThreshold: { ...DEFAULT_THRESHOLD },
    pendingSmartSwitch: false
  }),

  getters: {
    /** 是否为 Smart Mode */
    isSmartMode: (state): boolean => state.mode === 'smart',

    /** 是否为 Basic Mode */
    isBasicMode: (state): boolean => state.mode === 'basic',

    /** 是否正在索引 */
    isIndexing: (state): boolean => {
      const phase = state.indexingProgress?.phase
      return phase === 'scanning' || phase === 'parsing' || phase === 'indexing'
    },

    /** 索引是否就绪 */
    isReady: (state): boolean => {
      if (state.mode === 'basic') return true
      return state.indexingProgress?.phase === 'ready'
    },

    /** 获取模式图标 */
    modeIcon(): string {
      if (this.isIndexing) return 'sync'
      return this.isSmartMode ? 'flash_on' : 'flash_off'
    },

    /** 获取模式标签 */
    modeLabel(): string {
      if (this.isIndexing && this.indexingProgress) {
        return `Indexing ${this.indexingProgress.percentage}%`
      }
      return this.isSmartMode ? 'Smart' : 'Basic'
    },

    /** 获取模式完整描述 */
    modeDescription(): string {
      if (this.isSmartMode) {
        return 'Smart Mode - Full indexing, advanced refactoring'
      }
      return 'Basic Mode - Standard LSP, fast & lightweight'
    },

    /** 获取所有活跃的服务器 */
    activeServers: (state): LanguageServerStatus[] => {
      return Object.values(state.serverStatus).filter(
        s => s.status === 'ready' || s.status === 'starting'
      )
    },

    /** 获取错误的服务器 */
    errorServers: (state): LanguageServerStatus[] => {
      return Object.values(state.serverStatus).filter(s => s.status === 'error')
    },

    /** 是否所有服务器就绪 */
    allServersReady: (state): boolean => {
      const servers = Object.values(state.serverStatus)
      if (servers.length === 0) return true
      return servers.every(s => s.status === 'ready' || s.status === 'stopped')
    }
  },

  actions: {
    /**
     * 切换智能模式
     */
    async setMode(mode: IntelligenceMode) {
      if (this.mode === mode) return
      if (this.isSwitching) return

      this.isSwitching = true

      try {
        // 通知主进程切换模式
        if (window.electronAPI?.intelligence?.setMode) {
          await window.electronAPI.intelligence.setMode(mode)
        }

        this.mode = mode

        // Smart Mode 开始时重置索引进度
        if (mode === 'smart') {
          this.indexingProgress = { ...DEFAULT_INDEXING_PROGRESS }
        } else {
          this.indexingProgress = null
        }
      } catch (error) {
        console.error('Failed to switch intelligence mode:', error)
        throw error
      } finally {
        this.isSwitching = false
      }
    },

    /**
     * 切换模式 (Basic <-> Smart)
     */
    async toggleMode() {
      await this.setMode(this.mode === 'basic' ? 'smart' : 'basic')
    },

    /**
     * 更新索引进度
     */
    setIndexingProgress(progress: IndexingProgress) {
      this.indexingProgress = progress

      // 索引完成且有待切换，自动切换到 Smart Mode
      if (progress.phase === 'ready' && this.pendingSmartSwitch) {
        this.pendingSmartSwitch = false
        // Mode 已经是 smart，无需再切换
      }
    },

    /**
     * 更新服务器状态
     */
    setServerStatus(language: string, status: ServerStatus, message?: string) {
      const existing = this.serverStatus[language]
      this.serverStatus[language] = {
        language,
        status,
        message,
        capabilities: existing?.capabilities
      }
    },

    /**
     * 更新服务器完整状态
     */
    updateServerStatus(status: LanguageServerStatus) {
      this.serverStatus[status.language] = status
    },

    /**
     * 设置自动选择模式
     */
    async setAutoSelect(enabled: boolean) {
      this.autoSelect = enabled
      if (enabled) {
        await this.autoDetectMode()
      }
    },

    /**
     * 根据项目自动选择模式
     */
    async autoDetectMode() {
      const analysis = await this.analyzeProject()
      this.projectAnalysis = analysis

      if (
        analysis.fileCount > this.smartModeThreshold.maxFiles ||
        analysis.estimatedMemory > this.smartModeThreshold.maxMemoryMB
      ) {
        // 大型项目默认使用 Basic
        await this.setMode('basic')
      } else if (analysis.hasComplexDependencies) {
        // 复杂依赖关系的项目使用 Smart
        await this.setMode('smart')
      } else {
        // 默认使用 Basic (快速启动)
        await this.setMode('basic')
      }
    },

    /**
     * 分析项目
     */
    async analyzeProject(): Promise<ProjectAnalysis> {
      try {
        if (window.electronAPI?.intelligence?.analyzeProject) {
          return await window.electronAPI.intelligence.analyzeProject()
        }
      } catch (error) {
        console.error('Failed to analyze project:', error)
      }

      // 返回默认值
      return {
        fileCount: 0,
        totalSize: 0,
        estimatedMemory: 0,
        hasComplexDependencies: false,
        languages: []
      }
    },

    /**
     * 更新 Smart Mode 阈值
     */
    setSmartModeThreshold(threshold: Partial<SmartModeThreshold>) {
      this.smartModeThreshold = {
        ...this.smartModeThreshold,
        ...threshold
      }
    },

    /**
     * 重置状态
     */
    reset() {
      this.mode = 'basic'
      this.indexingProgress = null
      this.serverStatus = {}
      this.isSwitching = false
      this.projectAnalysis = null
      this.pendingSmartSwitch = false
    },

    /**
     * 从设置初始化
     * 在应用启动时调用，从 settings store 同步模式
     */
    async initFromSettings(mode: IntelligenceMode) {
      this.mode = mode
      if (mode === 'smart') {
        this.indexingProgress = { ...DEFAULT_INDEXING_PROGRESS }
      }
    }
  }
})
