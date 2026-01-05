<script setup lang="ts">
import { ref, onMounted, onUnmounted, watch, nextTick, computed } from 'vue'
import { Terminal } from '@xterm/xterm'
import { FitAddon } from '@xterm/addon-fit'
import { WebLinksAddon } from '@xterm/addon-web-links'
import { useTerminalStore } from '@/stores/terminal'
import { useThemeStore } from '@/stores/theme'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import '@xterm/xterm/css/xterm.css'

// 导入图标
import '@mdui/icons/add.js'
import '@mdui/icons/close.js'
import '@mdui/icons/terminal.js'

const terminalStore = useTerminalStore()
const themeStore = useThemeStore()
const fileExplorerStore = useFileExplorerStore()

// DOM 引用
const terminalContainer = ref<HTMLElement | null>(null)

// 存储每个标签的 Terminal 实例和 FitAddon
const terminalInstances = new Map<string, { terminal: Terminal; fitAddon: FitAddon }>()

// 清理函数
const cleanupFunctions: (() => void)[] = []

// 主题配置
const lightTheme = {
  background: '#F5FAD8',
  foreground: '#1E1E14',
  cursor: '#8B5CF6',
  cursorAccent: '#F5FAD8',
  selectionBackground: '#E9D5FF',
  black: '#1E1E14',
  red: '#DC2626',
  green: '#16A34A',
  yellow: '#CA8A04',
  blue: '#2563EB',
  magenta: '#9333EA',
  cyan: '#0891B2',
  white: '#F5FAD8'
}

const darkTheme = {
  background: '#204C63',
  foreground: '#F0F5F8',
  cursor: '#A78BFA',
  cursorAccent: '#204C63',
  selectionBackground: '#581C87',
  black: '#204C63',
  red: '#F87171',
  green: '#4ADE80',
  yellow: '#FACC15',
  blue: '#60A5FA',
  magenta: '#C084FC',
  cyan: '#22D3EE',
  white: '#F0F5F8'
}

const currentTheme = computed(() => themeStore.isDark ? darkTheme : lightTheme)

/**
 * 创建新终端标签
 */
async function createTerminalTab() {
  // 在 store 中创建标签
  const cwd = fileExplorerStore.rootPath || undefined
  const tab = terminalStore.createTab(undefined, cwd)

  // 等待 DOM 更新
  await nextTick()

  // 创建 xterm 实例
  await initTerminalInstance(tab.id)

  // 连接到后端 PTY
  await connectToPty(tab.id)
}

/**
 * 初始化 Terminal 实例
 */
async function initTerminalInstance(id: string) {
  if (!terminalContainer.value) return

  const terminal = new Terminal({
    theme: currentTheme.value,
    fontSize: 14,
    fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
    cursorBlink: true,
    cursorStyle: 'bar',
    scrollback: 10000,
    allowProposedApi: true
  })

  const fitAddon = new FitAddon()
  terminal.loadAddon(fitAddon)
  terminal.loadAddon(new WebLinksAddon())

  // 创建容器元素
  const containerEl = document.createElement('div')
  containerEl.id = `terminal-${id}`
  containerEl.className = 'terminal-instance'
  containerEl.style.display = 'none'
  terminalContainer.value.appendChild(containerEl)

  terminal.open(containerEl)

  // 存储实例
  terminalInstances.set(id, { terminal, fitAddon })

  // 如果是当前激活的标签，显示它
  if (terminalStore.activeTabId === id) {
    showTerminal(id)
  }
}

/**
 * 连接到后端 PTY
 */
async function connectToPty(id: string) {
  const instance = terminalInstances.get(id)
  if (!instance) return

  const { terminal, fitAddon } = instance
  const tab = terminalStore.tabs.find(t => t.id === id)
  if (!tab) return

  // 首先 fit 以获取正确的尺寸
  fitAddon.fit()

  // 创建 PTY
  const result = await window.electronAPI.terminal.create(id, {
    cols: terminal.cols,
    rows: terminal.rows,
    cwd: tab.cwd
  })

  if (!result.success) {
    console.error('Failed to create PTY:', result.error)
    terminal.writeln(`\x1b[1;31m错误: 无法创建终端 - ${result.error}\x1b[0m`)
    return
  }

  // 标记为已连接
  terminalStore.setConnected(id, true)

  // 监听用户输入，发送到 PTY
  terminal.onData((data) => {
    window.electronAPI.terminal.write(id, data)
  })

  // 监听终端大小变化
  terminal.onResize(({ cols, rows }) => {
    window.electronAPI.terminal.resize(id, cols, rows)
  })
}

/**
 * 显示指定终端
 */
function showTerminal(id: string) {
  // 隐藏所有终端
  terminalInstances.forEach((_, instanceId) => {
    const el = document.getElementById(`terminal-${instanceId}`)
    if (el) {
      el.style.display = instanceId === id ? 'block' : 'none'
    }
  })

  // fit 当前终端
  const instance = terminalInstances.get(id)
  if (instance) {
    instance.fitAddon.fit()
    instance.terminal.focus()
  }
}

/**
 * 关闭终端标签
 */
async function closeTerminalTab(id: string) {
  // 销毁 PTY
  await window.electronAPI.terminal.destroy(id)

  // 销毁 xterm 实例
  const instance = terminalInstances.get(id)
  if (instance) {
    instance.terminal.dispose()
    terminalInstances.delete(id)
  }

  // 移除 DOM 元素
  const el = document.getElementById(`terminal-${id}`)
  if (el) {
    el.remove()
  }

  // 从 store 中移除
  terminalStore.closeTab(id)
}

/**
 * 切换到指定标签
 */
function switchToTab(id: string) {
  terminalStore.setActiveTab(id)
  showTerminal(id)
}

// 监听激活标签变化
watch(() => terminalStore.activeTabId, (newId) => {
  if (newId) {
    showTerminal(newId)
  }
})

// 监听主题变化
watch(() => themeStore.isDark, () => {
  terminalInstances.forEach((instance) => {
    instance.terminal.options.theme = currentTheme.value
  })
})

// 监听窗口大小变化
function handleResize() {
  const activeId = terminalStore.activeTabId
  if (activeId) {
    const instance = terminalInstances.get(activeId)
    if (instance) {
      instance.fitAddon.fit()
    }
  }
}

onMounted(async () => {
  // 监听 PTY 数据
  const removeDataListener = window.electronAPI.terminal.onData((event) => {
    const instance = terminalInstances.get(event.id)
    if (instance) {
      instance.terminal.write(event.data)
    }
  })
  cleanupFunctions.push(removeDataListener)

  // 监听 PTY 退出
  const removeExitListener = window.electronAPI.terminal.onExit((event) => {
    const instance = terminalInstances.get(event.id)
    if (instance) {
      instance.terminal.writeln('')
      instance.terminal.writeln(`\x1b[1;33m进程已退出，退出码: ${event.exitCode}\x1b[0m`)
      terminalStore.setConnected(event.id, false)
    }
  })
  cleanupFunctions.push(removeExitListener)

  // 监听窗口大小变化
  const resizeObserver = new ResizeObserver(handleResize)
  if (terminalContainer.value) {
    resizeObserver.observe(terminalContainer.value)
  }
  cleanupFunctions.push(() => resizeObserver.disconnect())

  // 如果没有终端标签，创建第一个
  if (terminalStore.tabs.length === 0) {
    await createTerminalTab()
  }
})

onUnmounted(() => {
  // 执行所有清理函数
  cleanupFunctions.forEach(fn => fn())

  // 销毁所有终端实例
  terminalInstances.forEach((instance, id) => {
    instance.terminal.dispose()
    window.electronAPI.terminal.destroy(id)
  })
  terminalInstances.clear()

  // 清空 store
  terminalStore.clearAllTabs()
})
</script>

<template>
  <div class="terminal-view">
    <!-- 终端标签栏 -->
    <div class="terminal-tabs">
      <div class="tabs-scroll">
        <div
          v-for="tab in terminalStore.tabs"
          :key="tab.id"
          class="terminal-tab"
          :class="{ active: tab.id === terminalStore.activeTabId }"
          @click="switchToTab(tab.id)"
        >
          <mdui-icon-terminal class="tab-icon"></mdui-icon-terminal>
          <span class="tab-name">{{ tab.name }}</span>
          <span v-if="!tab.connected" class="disconnected-badge">断开</span>
          <mdui-button-icon
            class="close-btn"
            @click.stop="closeTerminalTab(tab.id)"
          >
            <mdui-icon-close></mdui-icon-close>
          </mdui-button-icon>
        </div>
      </div>
      <mdui-button-icon
        class="add-tab-btn"
        @click="createTerminalTab"
        title="新建终端"
      >
        <mdui-icon-add></mdui-icon-add>
      </mdui-button-icon>
    </div>

    <!-- 终端容器 -->
    <div ref="terminalContainer" class="terminal-container" v-show="terminalStore.tabs.length > 0"></div>

    <!-- 空状态 -->
    <div v-if="terminalStore.tabs.length === 0" class="empty-state">
      <mdui-icon-terminal class="empty-icon"></mdui-icon-terminal>
      <p>没有打开的终端</p>
      <mdui-button variant="tonal" @click="createTerminalTab">
        <mdui-icon-add slot="icon"></mdui-icon-add>
        新建终端
      </mdui-button>
    </div>
  </div>
</template>

<style scoped>
.terminal-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--mdui-color-surface);
}

.terminal-tabs {
  display: flex;
  align-items: center;
  height: 36px;
  background: var(--mdui-color-surface-container);
  border-bottom: 1px solid var(--mdui-color-outline-variant);
  padding: 0 4px;
}

.tabs-scroll {
  display: flex;
  flex: 1;
  overflow-x: auto;
  scrollbar-width: none;
}

.tabs-scroll::-webkit-scrollbar {
  display: none;
}

.terminal-tab {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 0 8px 0 12px;
  height: 32px;
  min-width: 100px;
  max-width: 160px;
  background: var(--mdui-color-surface-container);
  border-radius: 8px 8px 0 0;
  cursor: pointer;
  user-select: none;
  transition: background-color 0.1s;
  margin-right: 2px;
}

.terminal-tab:hover {
  background: var(--mdui-color-surface-container-high);
}

.terminal-tab.active {
  background: var(--mdui-color-surface);
}

.tab-icon {
  font-size: 16px;
  color: var(--mdui-color-on-surface-variant);
}

.tab-name {
  flex: 1;
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  color: var(--mdui-color-on-surface);
}

.disconnected-badge {
  font-size: 10px;
  padding: 2px 4px;
  background: var(--mdui-color-error-container);
  color: var(--mdui-color-on-error-container);
  border-radius: 4px;
}

.terminal-tab .close-btn {
  --mdui-comp-button-icon-size: 20px;
  opacity: 0;
  transition: opacity 0.1s;
}

.terminal-tab:hover .close-btn,
.terminal-tab.active .close-btn {
  opacity: 1;
}

.add-tab-btn {
  --mdui-comp-button-icon-size: 28px;
  margin-left: 4px;
}

.terminal-container {
  flex: 1;
  padding: 8px;
  overflow: hidden;
}

.terminal-container :deep(.terminal-instance) {
  height: 100%;
}

.terminal-container :deep(.xterm) {
  height: 100%;
  padding: 4px;
}

.terminal-container :deep(.xterm-viewport) {
  border-radius: 4px;
}

/* 空状态 */
.empty-state {
  flex: 1;
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  color: var(--mdui-color-on-surface-variant);
}

.empty-icon {
  font-size: 64px;
  opacity: 0.5;
}

.empty-state p {
  margin: 0;
  font-size: 14px;
}
</style>
