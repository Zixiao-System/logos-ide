/**
 * Intelligence Store 单元测试
 * 测试 .logos 项目级智能模式设置
 */

import { describe, it, expect, beforeEach, vi } from 'vitest'
import { setActivePinia, createPinia } from 'pinia'

// Mock IntelligenceManager 在导入 store 之前
vi.mock('@/services/lsp', () => ({
  getIntelligenceManager: vi.fn(() => ({
    setMode: vi.fn().mockResolvedValue(undefined),
    initialize: vi.fn().mockResolvedValue(undefined),
    openProject: vi.fn().mockResolvedValue(undefined),
    closeProject: vi.fn().mockResolvedValue(undefined),
    syncFile: vi.fn(),
    updateDiagnostics: vi.fn()
  }))
}))

import { useIntelligenceStore } from '@/stores/intelligence'
import { useSettingsStore } from '@/stores/settings'

// Mock window.electronAPI
const mockElectronAPI = {
  intelligence: {
    setMode: vi.fn().mockResolvedValue(undefined),
    loadMergedSettings: vi.fn(),
    saveProjectSettings: vi.fn().mockResolvedValue(undefined)
  }
}

// @ts-ignore
global.window = {
  electronAPI: mockElectronAPI
}

describe('Intelligence Store - Project Settings', () => {
  beforeEach(() => {
    setActivePinia(createPinia())
    vi.clearAllMocks()
  })

  describe('loadFromProject', () => {
    it('应该从 .logos 加载项目设置并应用', async () => {
      const intelligenceStore = useIntelligenceStore()
      const settingsStore = useSettingsStore()
      // 设置 LSP mode
      settingsStore.setLSPMode('basic')

      const projectRoot = '/test/project'
      const mergedSettings = {
        preferredMode: 'smart' as const,
        autoSelect: false,
        smartModeThreshold: { maxFiles: 3000, maxMemoryMB: 1500 }
      }

      mockElectronAPI.intelligence.loadMergedSettings.mockResolvedValue(mergedSettings)

      await intelligenceStore.loadFromProject(projectRoot)

      expect(mockElectronAPI.intelligence.loadMergedSettings).toHaveBeenCalledWith(
        projectRoot,
        expect.objectContaining({
          preferredMode: 'basic',
          autoSelect: expect.any(Boolean),
          smartModeThreshold: expect.any(Object)
        })
      )
      expect(intelligenceStore.mode).toBe('smart')
      expect(intelligenceStore.autoSelect).toBe(false)
      expect(intelligenceStore.smartModeThreshold.maxFiles).toBe(3000)
    })

    it('应该处理加载失败', async () => {
      const intelligenceStore = useIntelligenceStore()
      const projectRoot = '/test/project'

      mockElectronAPI.intelligence.loadMergedSettings.mockRejectedValue(
        new Error('Failed to load')
      )

      await expect(intelligenceStore.loadFromProject(projectRoot)).resolves.not.toThrow()
    })
  })

  describe('persistToProject', () => {
    it('应该保存当前设置到 .logos', async () => {
      const intelligenceStore = useIntelligenceStore()
      intelligenceStore.mode = 'smart'
      intelligenceStore.autoSelect = true
      intelligenceStore.smartModeThreshold = { maxFiles: 5000, maxMemoryMB: 2048 }

      const projectRoot = '/test/project'

      await intelligenceStore.persistToProject(projectRoot)

      expect(mockElectronAPI.intelligence.saveProjectSettings).toHaveBeenCalledWith(
        projectRoot,
        {
          preferredMode: 'smart',
          autoSelect: true,
          smartModeThreshold: { maxFiles: 5000, maxMemoryMB: 2048 }
        }
      )
    })

    it('应该处理保存失败', async () => {
      const intelligenceStore = useIntelligenceStore()
      const projectRoot = '/test/project'

      mockElectronAPI.intelligence.saveProjectSettings.mockRejectedValue(
        new Error('Failed to save')
      )

      await expect(intelligenceStore.persistToProject(projectRoot)).resolves.not.toThrow()
    })
  })

  describe('setMode with skipLocalStorage', () => {
    it('应该切换模式但不写入 localStorage', async () => {
      const intelligenceStore = useIntelligenceStore()
      intelligenceStore.mode = 'basic'

      const localStorageSpy = vi.spyOn(Storage.prototype, 'setItem')

      await intelligenceStore.setMode('smart', { skipLocalStorage: true })

      expect(intelligenceStore.mode).toBe('smart')
      expect(mockElectronAPI.intelligence.setMode).toHaveBeenCalledWith('smart')
      // localStorage 不应该被调用
      expect(localStorageSpy).not.toHaveBeenCalled()
    })
  })
})
