/**
 * 主题状态管理
 * 负责深色/浅色模式的切换和持久化
 * 支持动态配色功能
 */

import { defineStore } from 'pinia'
import { setColorScheme } from 'mdui/functions/setColorScheme.js'
import { removeColorScheme } from 'mdui/functions/removeColorScheme.js'
import { getColorFromImage } from 'mdui/functions/getColorFromImage.js'

// 主题类型定义
type ThemeMode = 'light' | 'dark' | 'auto'

// localStorage 键名
const THEME_STORAGE_KEY = 'lsp-ide-theme'
const COLOR_SCHEME_STORAGE_KEY = 'lsp-ide-color-scheme'

interface ThemeState {
  /** 当前主题设置 */
  mode: ThemeMode
  /** 系统偏好 (用于 auto 模式计算) */
  systemPrefersDark: boolean
  /** 自定义配色 (十六进制颜色值) */
  customColor: string | null
  /** 是否正在从壁纸提取颜色 */
  extractingColor: boolean
}

export const useThemeStore = defineStore('theme', {
  state: (): ThemeState => ({
    mode: 'dark',
    systemPrefersDark: false,
    customColor: null,
    extractingColor: false
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

      // 从 localStorage 恢复自定义配色
      const savedColor = localStorage.getItem(COLOR_SCHEME_STORAGE_KEY)
      if (savedColor) {
        this.customColor = savedColor
        setColorScheme(savedColor)
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
    },

    /**
     * 设置自定义配色方案
     * @param color 十六进制颜色值
     */
    setCustomColor(color: string) {
      this.customColor = color
      localStorage.setItem(COLOR_SCHEME_STORAGE_KEY, color)
      setColorScheme(color)
    },

    /**
     * 从壁纸图片提取颜色并设置配色方案
     * @param imageUrl 图片 URL
     */
    async extractColorFromWallpaper(imageUrl: string): Promise<string> {
      this.extractingColor = true
      try {
        const image = new Image()
        image.crossOrigin = 'anonymous'

        return new Promise((resolve, reject) => {
          image.onload = async () => {
            try {
              const color = await getColorFromImage(image)
              this.setCustomColor(color)
              this.extractingColor = false
              resolve(color)
            } catch (err) {
              this.extractingColor = false
              reject(err)
            }
          }
          image.onerror = () => {
            this.extractingColor = false
            reject(new Error('Failed to load image'))
          }
          image.src = imageUrl
        })
      } catch (err) {
        this.extractingColor = false
        throw err
      }
    },

    /**
     * 重置配色方案到默认
     */
    resetColorScheme() {
      this.customColor = null
      localStorage.removeItem(COLOR_SCHEME_STORAGE_KEY)
      removeColorScheme()
    }
  }
})
