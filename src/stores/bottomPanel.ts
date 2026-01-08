/**
 * 底部面板状态管理
 * 管理终端、Output Log、问题面板等底部面板的显示状态
 */

import { defineStore } from 'pinia'

export type BottomPanelTab = 'terminal' | 'output' | 'problems' | 'debug-console'

export interface OutputLogEntry {
  id: string
  timestamp: Date
  level: 'info' | 'warn' | 'error' | 'debug'
  source: string
  message: string
}

export interface BottomPanelState {
  /** 面板是否可见 */
  isVisible: boolean
  /** 当前激活的标签页 */
  activeTab: BottomPanelTab
  /** 面板高度 (像素) */
  height: number
  /** Output Log 条目 */
  outputLogs: OutputLogEntry[]
  /** 最大日志条目数 */
  maxLogEntries: number
}

export const useBottomPanelStore = defineStore('bottomPanel', {
  state: (): BottomPanelState => ({
    isVisible: false,
    activeTab: 'terminal',
    height: 250,
    outputLogs: [],
    maxLogEntries: 1000
  }),

  getters: {
    /** 获取指定级别的日志 */
    logsByLevel: (state) => (level: OutputLogEntry['level']) => {
      return state.outputLogs.filter(log => log.level === level)
    },

    /** 错误日志数量 */
    errorCount: (state): number => {
      return state.outputLogs.filter(log => log.level === 'error').length
    },

    /** 警告日志数量 */
    warningCount: (state): number => {
      return state.outputLogs.filter(log => log.level === 'warn').length
    }
  },

  actions: {
    /** 显示/隐藏面板 */
    setVisible(visible: boolean) {
      this.isVisible = visible
    },

    /** 切换面板显示 */
    togglePanel() {
      this.isVisible = !this.isVisible
    },

    /** 设置激活的标签页 */
    setActiveTab(tab: BottomPanelTab) {
      this.activeTab = tab
      if (!this.isVisible) {
        this.isVisible = true
      }
    },

    /** 设置面板高度 */
    setHeight(height: number) {
      this.height = Math.max(100, Math.min(height, window.innerHeight - 200))
    },

    /** 添加日志条目 */
    addLog(entry: Omit<OutputLogEntry, 'id' | 'timestamp'>) {
      const log: OutputLogEntry = {
        id: Date.now().toString(36) + Math.random().toString(36).substring(2),
        timestamp: new Date(),
        ...entry
      }
      this.outputLogs.push(log)

      // 超过最大条目数时移除旧日志
      if (this.outputLogs.length > this.maxLogEntries) {
        this.outputLogs.shift()
      }
    },

    /** 清空日志 */
    clearLogs() {
      this.outputLogs = []
    },

    /** 便捷方法：添加信息日志 */
    logInfo(source: string, message: string) {
      this.addLog({ level: 'info', source, message })
    },

    /** 便捷方法：添加警告日志 */
    logWarn(source: string, message: string) {
      this.addLog({ level: 'warn', source, message })
    },

    /** 便捷方法：添加错误日志 */
    logError(source: string, message: string) {
      this.addLog({ level: 'error', source, message })
    },

    /** 便捷方法：添加调试日志 */
    logDebug(source: string, message: string) {
      this.addLog({ level: 'debug', source, message })
    }
  }
})
