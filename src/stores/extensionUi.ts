import { defineStore } from 'pinia'
import type {
  ExtensionUiContributions,
  ExtensionView,
  ExtensionViewContainer,
  ExtensionWebviewHtml,
  ExtensionWebviewMessage,
  ExtensionWebviewResolveResult
} from '@/types'

const webviewMessageListeners = new Map<string, Set<(message: unknown) => void>>()
let unsubscribeWebviewMessage: (() => void) | null = null
let unsubscribeWebviewHtml: (() => void) | null = null
const resolvingViews = new Set<string>()
const resolveRetries = new Map<string, number>()
const MAX_RESOLVE_RETRIES = 6
const RESOLVE_RETRY_DELAY_MS = 300

function toExtensionUrl(rawPath?: string): string | undefined {
  if (!rawPath) {
    return undefined
  }
  const normalized = rawPath.replace(/\\/g, '/')
  return `logos-extension://local-file${encodeURI(normalized)}`
}

export const useExtensionUiStore = defineStore('extensionUi', {
  state: () => ({
    containers: [] as ExtensionViewContainer[],
    views: [] as ExtensionView[],
    loading: false,
    error: null as string | null,
    viewHtml: {} as Record<string, string>,
    viewHandles: {} as Record<string, string>,
    viewOptions: {} as Record<string, { enableScripts?: boolean }>,
    handleToView: {} as Record<string, string>
  }),

  getters: {
    viewsByContainer: (state) => (containerId: string) => {
      return state.views.filter(view => view.containerId === containerId)
    },
    containerById: (state) => (containerId: string) => {
      return state.containers.find(container => container.id === containerId)
    }
  },

  actions: {
    async init() {
      if (!window.electronAPI?.extensions?.listUiContributions) {
        console.warn('[extensions:init] listUiContributions missing')
        return
      }
      console.info('[extensions:init] start')

      if (!unsubscribeWebviewMessage && window.electronAPI.extensions.onWebviewMessage) {
        unsubscribeWebviewMessage = window.electronAPI.extensions.onWebviewMessage((payload: ExtensionWebviewMessage) => {
          const listeners = webviewMessageListeners.get(payload.handle)
          if (!listeners) {
            return
          }
          for (const listener of listeners) {
            listener(payload.message)
          }
        })
      }

      if (!unsubscribeWebviewHtml && window.electronAPI.extensions.onWebviewHtml) {
        unsubscribeWebviewHtml = window.electronAPI.extensions.onWebviewHtml((payload: ExtensionWebviewHtml) => {
          const viewId = this.handleToView[payload.handle]
          if (!viewId) {
            return
          }
          console.info('[extensions:webviewHtml]', {
            viewId,
            handle: payload.handle,
            htmlLength: payload.html?.length ?? 0
          })
          this.viewHtml = { ...this.viewHtml, [viewId]: payload.html }
        })
      }

      await this.refresh()
      console.info('[extensions:init] done', {
        containers: this.containers.length,
        views: this.views.length
      })
    },

    async refresh() {
      if (!window.electronAPI?.extensions?.listUiContributions) {
        console.warn('[extensions:refresh] listUiContributions missing')
        return
      }

      this.loading = true
      this.error = null

      try {
        const result = await window.electronAPI.extensions.listUiContributions() as ExtensionUiContributions
        console.info('[extensions:refresh] ui contributions', {
          containers: result.containers?.length ?? 0,
          views: result.views?.length ?? 0
        })
        this.containers = result.containers || []
        this.views = result.views || []

        const validViewIds = new Set(this.views.map(view => view.id))
        for (const viewId of Object.keys(this.viewHtml)) {
          if (!validViewIds.has(viewId)) {
            delete this.viewHtml[viewId]
            delete this.viewHandles[viewId]
            delete this.viewOptions[viewId]
          }
        }

        // Pre-resolve views to avoid missing activation signals in Electron 40.
        for (const view of this.views) {
          void this.resolveView(view.id)
        }
      } catch (error) {
        this.error = (error as Error).message
      } finally {
        this.loading = false
      }
    },

    containerIconUrl(containerId: string): string | undefined {
      const container = this.containers.find(item => item.id === containerId)
      return toExtensionUrl(container?.iconPath)
    },

    getViewHtml(viewId: string | null): string {
      if (!viewId) {
        return ''
      }
      return this.viewHtml[viewId] || ''
    },

    getViewHandle(viewId: string | null): string | null {
      if (!viewId) {
        return null
      }
      return this.viewHandles[viewId] || null
    },

    getViewOptions(viewId: string | null): { enableScripts?: boolean } | null {
      if (!viewId) {
        return null
      }
      return this.viewOptions[viewId] || null
    },

    async resolveView(viewId: string) {
      if (!window.electronAPI?.extensions?.resolveWebviewView) {
        return
      }
      if (this.viewHandles[viewId] || resolvingViews.has(viewId)) {
        return
      }
      resolvingViews.add(viewId)
      try {
        const result = await window.electronAPI.extensions.resolveWebviewView({ viewId }) as ExtensionWebviewResolveResult | null
        if (!result) {
          const attempt = (resolveRetries.get(viewId) ?? 0) + 1
          if (attempt <= MAX_RESOLVE_RETRIES) {
            resolveRetries.set(viewId, attempt)
            setTimeout(() => {
              resolvingViews.delete(viewId)
              void this.resolveView(viewId)
            }, RESOLVE_RETRY_DELAY_MS)
          }
          return
        }
        console.info('[extensions:resolveWebviewView]', {
          viewId,
          handle: result.handle,
          enableScripts: result.options?.enableScripts ?? false,
          htmlLength: result.html?.length ?? 0
        })
        resolveRetries.delete(viewId)
        this.viewHandles = { ...this.viewHandles, [viewId]: result.handle }
        this.handleToView = { ...this.handleToView, [result.handle]: viewId }
        this.viewOptions = { ...this.viewOptions, [viewId]: result.options ?? {} }
        this.viewHtml = { ...this.viewHtml, [viewId]: result.html || '' }
      } finally {
        resolvingViews.delete(viewId)
      }
    },

    async postWebviewMessage(handle: string, message: unknown) {
      if (!window.electronAPI?.extensions?.postWebviewMessage) {
        return false
      }
      return await window.electronAPI.extensions.postWebviewMessage({ handle, message })
    },

    async disposeView(viewId: string) {
      const handle = this.viewHandles[viewId]
      if (!handle || !window.electronAPI?.extensions?.disposeWebviewView) {
        return
      }
      await window.electronAPI.extensions.disposeWebviewView({ handle })
      const { [viewId]: _removed, ...restHandles } = this.viewHandles
      this.viewHandles = restHandles
      const { [viewId]: _removedHtml, ...restHtml } = this.viewHtml
      this.viewHtml = restHtml
      const { [viewId]: _removedOptions, ...restOptions } = this.viewOptions
      this.viewOptions = restOptions
      const { [handle]: _removedHandle, ...restHandleMap } = this.handleToView
      this.handleToView = restHandleMap
    },

    onWebviewMessage(handle: string, listener: (message: unknown) => void): () => void {
      const existing = webviewMessageListeners.get(handle) ?? new Set()
      existing.add(listener)
      webviewMessageListeners.set(handle, existing)
      return () => {
        const listeners = webviewMessageListeners.get(handle)
        if (!listeners) {
          return
        }
        listeners.delete(listener)
        if (listeners.size === 0) {
          webviewMessageListeners.delete(handle)
        }
      }
    }
  }
})
