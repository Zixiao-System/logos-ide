/**
 * 主题状态管理
 * 负责深色/浅色模式的切换和持久化
 */

import { defineStore } from 'pinia'

// 主题类型定义
type ThemeMode = 'light' | 'dark' | 'auto'

// localStorage 键名
const THEME_STORAGE_KEY = 'lsp-ide-theme'

interface ThemeState {
  /** 当前主题设置 */
  mode: ThemeMode
  /** 系统偏好 (用于 auto 模式计算) */
  systemPrefersDark: boolean
}

export const useThemeStore = defineStore('theme', {
  state: (): ThemeState => ({
    mode: 'dark',
    systemPrefersDark: false
  }),

  getters: {
    /**
     * 当前是否为深色模式
     * 考虑 auto 模式和系统偏好
     */
    isDark: (state): boolean => {
      if (state.mode === 'auto') {
        return state.systemPrefersDark
      }
      return state.mode === 'dark'
    },

    /**
     * 获取当前实际应用的主题
     */
    effectiveTheme: (state): 'light' | 'dark' => {
      if (state.mode === 'auto') {
        return state.systemPrefersDark ? 'dark' : 'light'
      }
      return state.mode
    }
  },

  actions: {
    /**
     * 初始化主题
     * 从 localStorage 恢复设置，监听系统偏好变化
     */
    initTheme() {
      // 检测系统偏好
      const mediaQuery = window.matchMedia('(prefers-color-scheme: dark)')
      this.systemPrefersDark = mediaQuery.matches

      // 监听系统偏好变化
      mediaQuery.addEventListener('change', (e) => {
        this.systemPrefersDark = e.matches
        if (this.mode === 'auto') {
          this.applyTheme()
        }
      })

      // 从 localStorage 恢复主题设置
      const savedTheme = localStorage.getItem(THEME_STORAGE_KEY) as ThemeMode | null
      if (savedTheme && ['light', 'dark', 'auto'].includes(savedTheme)) {
        this.mode = savedTheme
      }

      // 应用主题
      this.applyTheme()
    },

    /**
     * 设置主题
     */
    setTheme(mode: ThemeMode) {
      this.mode = mode
      localStorage.setItem(THEME_STORAGE_KEY, mode)
      this.applyTheme()
    },

    /**
     * 切换深色/浅色模式
     * 如果当前是 auto，则根据实际显示切换
     */
    toggleTheme() {
      if (this.isDark) {
        this.setTheme('light')
      } else {
        this.setTheme('dark')
      }
    },

    /**
     * 应用主题到 DOM
     */
    applyTheme() {
      const html = document.documentElement

      // 移除所有主题类
      html.classList.remove('mdui-theme-light', 'mdui-theme-dark', 'mdui-theme-auto')

      // 应用新主题
      if (this.mode === 'auto') {
        // auto 模式下根据系统偏好添加类
        html.classList.add(this.systemPrefersDark ? 'mdui-theme-dark' : 'mdui-theme-light')
      } else {
        html.classList.add(`mdui-theme-${this.mode}`)
      }
    }
  }
})
