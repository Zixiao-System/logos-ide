/**
 * 编辑器状态管理
 */

import { defineStore } from 'pinia'
import type { EditorTab, EditorState, EditorConfig, CursorPosition } from '@/types'
import { DEFAULT_EDITOR_CONFIG } from '@/types'
import { detectLanguage, generateId, getFilename } from '@/utils'

const RECENT_FILES_KEY = 'logos:recentFiles'

const loadRecentFiles = (): string[] => {
  if (typeof window === 'undefined' || !window.localStorage) return []
  try {
    const saved = window.localStorage.getItem(RECENT_FILES_KEY)
    if (!saved) return []
    const parsed = JSON.parse(saved)
    return Array.isArray(parsed) ? parsed.filter(Boolean) : []
  } catch (error) {
    console.warn('Failed to load recent files:', error)
    return []
  }
}

const persistRecentFiles = (files: string[]) => {
  if (typeof window === 'undefined' || !window.localStorage) return
  window.localStorage.setItem(RECENT_FILES_KEY, JSON.stringify(files))
}

export const useEditorStore = defineStore('editor', {
  state: (): EditorState => ({
    tabs: [],
    activeTabId: null,
    recentFiles: loadRecentFiles(),
    pendingNavigation: null,
    config: { ...DEFAULT_EDITOR_CONFIG }
  }),

  getters: {
    /** 当前激活的标签页 */
    activeTab: (state): EditorTab | null => {
      if (!state.activeTabId) return null
      return state.tabs.find(tab => tab.id === state.activeTabId) || null
    },

    /** 有未保存更改的标签页 */
    dirtyTabs: (state): EditorTab[] => {
      return state.tabs.filter(tab => tab.isDirty)
    },

    /** 是否有未保存的更改 */
    hasUnsavedChanges: (state): boolean => {
      return state.tabs.some(tab => tab.isDirty)
    },

    /** 获取标签页数量 */
    tabCount: (state): number => {
      return state.tabs.length
    }
  },

  actions: {
    /**
     * 打开文件
     */
    async openFile(path: string) {
      // 检查文件是否已经打开
      const existingTab = this.tabs.find(tab => tab.path === path)
      if (existingTab) {
        this.setActiveTab(existingTab.id)
        return existingTab
      }

      try {
        // 读取文件内容
        const content = await window.electronAPI.fileSystem.readFile(path)
        const filename = getFilename(path)
        const language = detectLanguage(filename)

        // 创建新标签页
        const tab: EditorTab = {
          id: generateId(),
          path,
          filename,
          language,
          content,
          originalContent: content,
          isDirty: false,
          cursorPosition: { line: 1, column: 1 },
          scrollPosition: { top: 0, left: 0 }
        }

        this.tabs.push(tab)
        this.setActiveTab(tab.id)

        // 添加到最近文件
        this.addToRecentFiles(path)

        return tab
      } catch (error) {
        console.error('打开文件失败:', error)
        throw error
      }
    },

    /**
     * 打开虚拟文件 (只读内容)
     */
    async openVirtualFile(options: { uri: string; content: string; language?: string; title?: string; readOnly?: boolean }) {
      const existingTab = this.tabs.find(tab => tab.path === options.uri)
      if (existingTab) {
        this.setActiveTab(existingTab.id)
        return existingTab
      }

      const cleaned = options.uri.split('?')[0].split('#')[0]
      const filename = options.title || getFilename(cleaned)
      const language = options.language || detectLanguage(filename)

      const tab: EditorTab = {
        id: generateId(),
        path: options.uri,
        filename,
        language,
        content: options.content,
        originalContent: options.content,
        isDirty: false,
        cursorPosition: { line: 1, column: 1 },
        scrollPosition: { top: 0, left: 0 },
        readOnly: options.readOnly ?? true
      }

      this.tabs.push(tab)
      this.setActiveTab(tab.id)

      return tab
    },

    /**
     * 打开远程文件
     */
    openRemoteFile(remotePath: string, content: string, filename: string) {
      // Use ssh:// URI scheme for remote files
      const uri = `ssh://${remotePath}`
      const existingTab = this.tabs.find(tab => tab.path === uri)
      if (existingTab) {
        this.setActiveTab(existingTab.id)
        return existingTab
      }

      const language = detectLanguage(filename)

      const tab: EditorTab = {
        id: generateId(),
        path: uri,
        filename,
        language,
        content,
        originalContent: content,
        isDirty: false,
        cursorPosition: { line: 1, column: 1 },
        scrollPosition: { top: 0, left: 0 },
        isRemote: true
      }

      this.tabs.push(tab)
      this.setActiveTab(tab.id)

      return tab
    },

    /**
     * 关闭标签页
     */
    closeTab(id: string) {
      const index = this.tabs.findIndex(tab => tab.id === id)
      if (index === -1) return

      const tab = this.tabs[index]

      // 移除标签页
      this.tabs.splice(index, 1)

      // 如果关闭的是当前激活的标签页
      if (this.activeTabId === id) {
        if (this.tabs.length === 0) {
          this.activeTabId = null
        } else {
          // 选择相邻的标签页
          const newIndex = Math.min(index, this.tabs.length - 1)
          this.activeTabId = this.tabs[newIndex].id
        }
      }

      return tab
    },

    /**
     * 关闭其他标签页
     */
    closeOtherTabs(id: string) {
      const tabToKeep = this.tabs.find(tab => tab.id === id)
      if (!tabToKeep) return

      this.tabs = [tabToKeep]
      this.activeTabId = id
    },

    /**
     * 关闭所有标签页
     */
    closeAllTabs() {
      this.tabs = []
      this.activeTabId = null
    },

    /**
     * 关闭右侧标签页
     */
    closeTabsToRight(id: string) {
      const index = this.tabs.findIndex(tab => tab.id === id)
      if (index === -1) return

      const closedTabs = this.tabs.splice(index + 1)

      // 如果当前激活的标签页被关闭了
      if (closedTabs.some(tab => tab.id === this.activeTabId)) {
        this.activeTabId = id
      }
    },

    /**
     * 设置激活的标签页
     */
    setActiveTab(id: string) {
      const tab = this.tabs.find(t => t.id === id)
      if (tab) {
        this.activeTabId = id
        // Notify debug service of active file for variable substitution
        if (window.electronAPI?.debug?.setActiveFile) {
          // Only set for local files (not remote or virtual files)
          const filePath = tab.path && !tab.path.includes('://') ? tab.path : null
          window.electronAPI.debug.setActiveFile(filePath)
        }
      }
    },

    /**
     * 更新标签页内容
     */
    updateContent(id: string, content: string) {
      const tab = this.tabs.find(t => t.id === id)
      if (!tab) return

      tab.content = content
      tab.isDirty = content !== tab.originalContent
    },

    /**
     * 更新光标位置
     */
    updateCursorPosition(id: string, position: CursorPosition) {
      const tab = this.tabs.find(t => t.id === id)
      if (!tab) return

      tab.cursorPosition = position
    },

    /**
     * 更新滚动位置
     */
    updateScrollPosition(id: string, scrollPosition: { top: number; left: number }) {
      const tab = this.tabs.find(t => t.id === id)
      if (!tab) return

      tab.scrollPosition = scrollPosition
    },

    /**
     * 保存文件
     */
    async saveFile(id: string) {
      const tab = this.tabs.find(t => t.id === id)
      if (!tab) return false
      if (tab.readOnly || tab.path.includes('://')) return false

      try {
        await window.electronAPI.fileSystem.writeFile(tab.path, tab.content)
        tab.originalContent = tab.content
        tab.isDirty = false
        return true
      } catch (error) {
        console.error('保存文件失败:', error)
        throw error
      }
    },

    /**
     * 保存当前文件
     */
    async saveCurrentFile() {
      if (!this.activeTabId) return false
      return this.saveFile(this.activeTabId)
    },

    /**
     * 保存所有文件
     */
    async saveAllFiles() {
      const results = await Promise.allSettled(
        this.dirtyTabs.map(tab => this.saveFile(tab.id))
      )

      return results.every(r => r.status === 'fulfilled' && r.value === true)
    },

    /**
     * 添加到最近文件列表
     */
    addToRecentFiles(path: string) {
      // 移除已存在的
      const index = this.recentFiles.indexOf(path)
      if (index !== -1) {
        this.recentFiles.splice(index, 1)
      }

      // 添加到开头
      this.recentFiles.unshift(path)

      // 保持最多 20 个
      if (this.recentFiles.length > 20) {
        this.recentFiles = this.recentFiles.slice(0, 20)
      }

      persistRecentFiles(this.recentFiles)
    },

    /**
     * 清空最近文件
     */
    clearRecentFiles() {
      this.recentFiles = []
      persistRecentFiles(this.recentFiles)
    },

    /**
     * 启动时清理不存在的路径
     */
    async pruneRecentFiles() {
      if (!window.electronAPI?.fileSystem?.exists) return
      const checks = await Promise.all(
        this.recentFiles.map(async (path) => {
          try {
            const exists = await window.electronAPI.fileSystem.exists(path)
            return exists ? path : null
          } catch {
            return null
          }
        })
      )
      const next = checks.filter((path): path is string => Boolean(path))
      if (next.length !== this.recentFiles.length) {
        this.recentFiles = next
        persistRecentFiles(this.recentFiles)
      }
    },

    /**
     * 更新编辑器配置
     */
    updateConfig(config: Partial<EditorConfig>) {
      this.config = { ...this.config, ...config }
    },

    /**
     * 保存视图状态
     */
    saveViewState(id: string, viewState: unknown) {
      const tab = this.tabs.find(t => t.id === id)
      if (tab) {
        tab.viewState = viewState
      }
    },

    /**
     * 文件重命名后更新标签页
     */
    handleFileRename(oldPath: string, newPath: string) {
      const tab = this.tabs.find(t => t.path === oldPath)
      if (tab) {
        tab.path = newPath
        tab.filename = getFilename(newPath)
        tab.language = detectLanguage(newPath)
      }
    },

    /**
     * 文件删除后关闭对应标签页
     */
    handleFileDelete(path: string) {
      const tab = this.tabs.find(t => t.path === path)
      if (tab) {
        this.closeTab(tab.id)
      }
    },

    /**
     * 切换到下一个标签页
     */
    nextTab() {
      if (this.tabs.length <= 1) return

      const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId)
      const nextIndex = (currentIndex + 1) % this.tabs.length
      this.activeTabId = this.tabs[nextIndex].id
    },

    /**
     * 切换到上一个标签页
     */
    prevTab() {
      if (this.tabs.length <= 1) return

      const currentIndex = this.tabs.findIndex(t => t.id === this.activeTabId)
      const prevIndex = (currentIndex - 1 + this.tabs.length) % this.tabs.length
      this.activeTabId = this.tabs[prevIndex].id
    },

    /**
     * 跳转到指定位置
     */
    async navigateToLocation(path: string, line: number, column = 1) {
      try {
        const tab = await this.openFile(path)
        this.updateCursorPosition(tab.id, { line, column })
        this.pendingNavigation = { path, line, column }
        return true
      } catch (error) {
        console.error('导航到位置失败:', error)
        return false
      }
    },

    clearPendingNavigation() {
      this.pendingNavigation = null
    }
  }
})
