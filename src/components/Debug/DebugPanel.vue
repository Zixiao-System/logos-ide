<template>
  <div class="debug-panel">
    <!-- 工具栏 -->
    <DebugToolbar @start-debug="showLaunchConfigDialog" />

    <!-- 面板选项卡 -->
    <mdui-tabs :value="debugStore.activePanel" @change="handleTabChange">
      <mdui-tab value="variables">变量</mdui-tab>
      <mdui-tab value="watch">监视</mdui-tab>
      <mdui-tab value="callStack">调用堆栈</mdui-tab>
      <mdui-tab value="breakpoints">断点</mdui-tab>
      <mdui-tab value="console">控制台</mdui-tab>
    </mdui-tabs>

    <!-- 面板内容 -->
    <div class="panel-content">
      <VariablesPanel v-if="debugStore.activePanel === 'variables'" />
      <WatchPanel v-else-if="debugStore.activePanel === 'watch'" />
      <CallStackPanel v-else-if="debugStore.activePanel === 'callStack'" />
      <BreakpointsPanel v-else-if="debugStore.activePanel === 'breakpoints'" />
      <DebugConsole v-else-if="debugStore.activePanel === 'console'" />
    </div>

    <!-- 启动配置对话框 -->
    <mdui-dialog
      :open="showLaunchDialog"
      @close="showLaunchDialog = false"
      headline="选择调试配置"
    >
      <div class="launch-config-list">
        <div
          v-for="config in launchConfigs"
          :key="config.name"
          class="launch-config-item"
          @click="startDebugWithConfig(config)"
        >
          <mdui-icon-play-arrow></mdui-icon-play-arrow>
          <div class="config-info">
            <div class="config-name">{{ config.name }}</div>
            <div class="config-type">{{ config.type }} - {{ config.request }}</div>
          </div>
        </div>

        <div v-if="launchConfigs.length === 0" class="no-configs">
          <p>没有找到启动配置</p>
          <mdui-button @click="createDefaultConfig" variant="text">
            创建默认配置
          </mdui-button>
        </div>
      </div>

      <mdui-button slot="action" variant="text" @click="showLaunchDialog = false">
        取消
      </mdui-button>
    </mdui-dialog>
  </div>
</template>

<script setup lang="ts">
import { ref, onMounted } from 'vue'
import { useDebugStore, type DebugConfig } from '@/stores/debug'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import DebugToolbar from './DebugToolbar.vue'
import VariablesPanel from './VariablesPanel.vue'
import WatchPanel from './WatchPanel.vue'
import CallStackPanel from './CallStackPanel.vue'
import BreakpointsPanel from './BreakpointsPanel.vue'
import DebugConsole from './DebugConsole.vue'

const debugStore = useDebugStore()
const fileExplorerStore = useFileExplorerStore()

const showLaunchDialog = ref(false)
const launchConfigs = ref<DebugConfig[]>([])

onMounted(() => {
  // 初始化事件监听
  debugStore.initEventListeners()
  // 加载断点
  debugStore.loadBreakpoints()
})

function handleTabChange(event: Event) {
  const target = event.target as HTMLElement
  const value = (target as any).value as string
  debugStore.setActivePanel(value as any)
}

async function showLaunchConfigDialog() {
  const workspaceFolder = fileExplorerStore.rootPath
  if (!workspaceFolder) {
    alert('请先打开一个文件夹')
    return
  }

  // 读取启动配置
  const api = window.electronAPI?.debug
  if (api) {
    const result = await api.readLaunchConfig(workspaceFolder)
    if (result.success && result.config) {
      launchConfigs.value = result.config.configurations
    } else {
      launchConfigs.value = []
    }
  }

  showLaunchDialog.value = true
}

async function startDebugWithConfig(config: DebugConfig) {
  showLaunchDialog.value = false
  const workspaceFolder = fileExplorerStore.rootPath
  if (!workspaceFolder) return

  await debugStore.startDebugging(config, workspaceFolder)
}

async function createDefaultConfig() {
  const workspaceFolder = fileExplorerStore.rootPath
  if (!workspaceFolder) return

  const api = window.electronAPI?.debug
  if (!api) return

  // 创建默认 Node.js 配置
  const result = await api.getDefaultLaunchConfig('node', workspaceFolder)
  if (!result.success || !result.config) return
  const defaultConfig = result.config

  const launchFile = {
    version: '0.2.0',
    configurations: [defaultConfig]
  }

  await api.writeLaunchConfig(workspaceFolder, launchFile)
  launchConfigs.value = [defaultConfig]
}
</script>

<style scoped>
.debug-panel {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--mdui-color-surface);
}

mdui-tabs {
  --mdui-comp-tabs-height: 36px;
  border-bottom: 1px solid var(--mdui-color-outline-variant);
}

mdui-tab {
  font-size: 12px;
}

.panel-content {
  flex: 1;
  overflow: auto;
}

.launch-config-list {
  padding: 8px 0;
}

.launch-config-item {
  display: flex;
  align-items: center;
  gap: 12px;
  padding: 12px 16px;
  cursor: pointer;
  transition: background-color 0.2s;
}

.launch-config-item:hover {
  background: var(--mdui-color-surface-container-highest);
}

.config-info {
  flex: 1;
}

.config-name {
  font-weight: 500;
}

.config-type {
  font-size: 12px;
  color: var(--mdui-color-outline);
}

.no-configs {
  text-align: center;
  padding: 24px;
  color: var(--mdui-color-outline);
}
</style>
