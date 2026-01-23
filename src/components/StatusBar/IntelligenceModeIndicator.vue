<template>
  <div class="intelligence-mode" ref="triggerRef">
    <!-- 模式按钮 -->
    <div class="mode-trigger" @click="toggleMenu">
      <!-- 模式图标 -->
      <mdui-icon-sync v-if="intelligenceStore.isIndexing" class="spinning"></mdui-icon-sync>
      <mdui-icon-flash-on v-else-if="intelligenceStore.isSmartMode"></mdui-icon-flash-on>
      <mdui-icon-flash-off v-else></mdui-icon-flash-off>

      <!-- 模式标签 -->
      <span class="mode-label">{{ modeLabel }}</span>

      <!-- 索引进度条 (Smart Mode 索引中) -->
      <div
        v-if="intelligenceStore.isIndexing && intelligenceStore.indexingProgress"
        class="indexing-bar"
      >
        <div
          class="indexing-bar-fill"
          :style="{ width: `${intelligenceStore.indexingProgress.percentage}%` }"
        ></div>
      </div>
    </div>

    <!-- 模式切换菜单 -->
    <Teleport to="body">
      <Transition name="menu-fade">
        <div
          v-if="showMenu"
          class="mode-menu solid-floating-panel"
          :style="menuStyle"
          @click.stop
        >
          <!-- Basic Mode 选项 -->
          <div
            class="menu-item"
            :class="{ selected: intelligenceStore.isBasicMode }"
            @click="selectMode('basic')"
          >
            <div class="menu-item-header">
              <mdui-icon-flash-off></mdui-icon-flash-off>
              <span class="menu-item-title">Basic Mode</span>
              <mdui-icon-check v-if="intelligenceStore.isBasicMode" class="check-icon"></mdui-icon-check>
            </div>
            <div class="menu-item-description">
              Standard LSP - Fast startup, low memory
            </div>
            <div class="menu-item-features">
              <span class="feature-tag">Completions</span>
              <span class="feature-tag">Definitions</span>
              <span class="feature-tag">References</span>
            </div>
          </div>

          <!-- Smart Mode 选项 -->
          <div
            class="menu-item"
            :class="{ selected: intelligenceStore.isSmartMode }"
            @click="selectMode('smart')"
          >
            <div class="menu-item-header">
              <mdui-icon-flash-on></mdui-icon-flash-on>
              <span class="menu-item-title">Smart Mode</span>
              <mdui-icon-check v-if="intelligenceStore.isSmartMode" class="check-icon"></mdui-icon-check>
            </div>
            <div class="menu-item-description">
              Full indexing - Advanced refactoring & analysis
            </div>
            <div class="menu-item-features">
              <span class="feature-tag">Safe Rename</span>
              <span class="feature-tag">Call Hierarchy</span>
              <span class="feature-tag">Impact Analysis</span>
            </div>
          </div>

          <div class="menu-divider"></div>

          <!-- 自动选择选项 -->
          <div class="menu-item auto-select" @click="toggleAutoSelect">
            <mdui-icon-auto-fix-high></mdui-icon-auto-fix-high>
            <span>Auto-select based on project</span>
            <mdui-icon-check-box v-if="intelligenceStore.autoSelect" class="checkbox-icon"></mdui-icon-check-box>
            <mdui-icon-check-box-outline-blank v-else class="checkbox-icon"></mdui-icon-check-box-outline-blank>
          </div>

          <!-- 项目分析信息 (显示自动模式的决策依据) -->
          <div v-if="intelligenceStore.projectAnalysis" class="project-analysis">
            <div class="analysis-title">Project Analysis</div>
            <div class="analysis-stats">
              <div class="stat-item">
                <span class="stat-label">Files:</span>
                <span class="stat-value">{{ intelligenceStore.projectAnalysis.fileCount.toLocaleString() }}</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Est. Memory:</span>
                <span class="stat-value">{{ intelligenceStore.projectAnalysis.estimatedMemory }}MB</span>
              </div>
              <div class="stat-item">
                <span class="stat-label">Languages:</span>
                <span class="stat-value">{{ intelligenceStore.projectAnalysis.languages.join(', ') || 'N/A' }}</span>
              </div>
            </div>
            <div v-if="intelligenceStore.autoSelect" class="analysis-recommendation">
              <mdui-icon-info class="info-icon"></mdui-icon-info>
              <span>{{ getRecommendation() }}</span>
            </div>
          </div>

          <!-- 索引状态 (Smart Mode) -->
          <div v-if="intelligenceStore.isSmartMode && intelligenceStore.indexingProgress" class="indexing-info">
            <div class="indexing-phase">
              {{ indexingPhaseLabel }}
            </div>
            <div v-if="intelligenceStore.indexingProgress.currentFile" class="indexing-file">
              {{ truncateFilePath(intelligenceStore.indexingProgress.currentFile) }}
            </div>
            <div class="indexing-stats">
              {{ intelligenceStore.indexingProgress.processedFiles }} / {{ intelligenceStore.indexingProgress.totalFiles }} files
            </div>
          </div>
        </div>
      </Transition>
    </Teleport>
  </div>
</template>

<script setup lang="ts">
import { ref, computed, onMounted, onUnmounted } from 'vue'
import { useIntelligenceStore, type IntelligenceMode } from '@/stores/intelligence'
import { useFileExplorerStore } from '@/stores/fileExplorer'

// 导入需要的图标
import '@mdui/icons/flash-on.js'
import '@mdui/icons/flash-off.js'
import '@mdui/icons/check.js'
import '@mdui/icons/check-box.js'
import '@mdui/icons/check-box-outline-blank.js'
import '@mdui/icons/auto-fix-high.js'
import '@mdui/icons/info.js'

const intelligenceStore = useIntelligenceStore()
const fileExplorerStore = useFileExplorerStore()

const showMenu = ref(false)
const triggerRef = ref<HTMLElement | null>(null)
const menuStyle = ref<{ bottom: string; right: string }>({ bottom: '0', right: '0' })

/** 模式标签 */
const modeLabel = computed(() => {
  if (intelligenceStore.isIndexing && intelligenceStore.indexingProgress) {
    return `Indexing ${intelligenceStore.indexingProgress.percentage}%`
  }
  return intelligenceStore.isSmartMode ? 'Smart' : 'Basic'
})

/** 索引阶段标签 */
const indexingPhaseLabel = computed(() => {
  const phase = intelligenceStore.indexingProgress?.phase
  switch (phase) {
    case 'scanning': return 'Scanning files...'
    case 'parsing': return 'Parsing sources...'
    case 'indexing': return 'Building index...'
    case 'ready': return 'Index ready'
    default: return 'Idle'
  }
})

/** 切换菜单 */
const toggleMenu = () => {
  if (!showMenu.value) {
    // 计算菜单位置
    if (triggerRef.value) {
      const rect = triggerRef.value.getBoundingClientRect()
      menuStyle.value = {
        bottom: `${window.innerHeight - rect.top + 4}px`,
        right: `${window.innerWidth - rect.right}px`
      }
    }
  }
  showMenu.value = !showMenu.value
}

/** 选择模式 */
const selectMode = async (mode: IntelligenceMode) => {
  showMenu.value = false
  if (intelligenceStore.mode !== mode) {
    await intelligenceStore.setMode(mode)
    if (fileExplorerStore.rootPath) {
      await intelligenceStore.persistToProject(fileExplorerStore.rootPath)
    }
  }
}

/** 切换自动选择 */
const toggleAutoSelect = async () => {
  await intelligenceStore.setAutoSelect(!intelligenceStore.autoSelect)
  if (fileExplorerStore.rootPath) {
    await intelligenceStore.persistToProject(fileExplorerStore.rootPath)
  }
}

/** 截断文件路径 */
const truncateFilePath = (filePath: string) => {
  const maxLength = 40
  if (filePath.length <= maxLength) return filePath
  const parts = filePath.split('/')
  if (parts.length > 2) {
    return `.../${parts.slice(-2).join('/')}`
  }
  return `...${filePath.slice(-maxLength)}`
}

/** 获取自动模式推荐说明 */
const getRecommendation = () => {
  const analysis = intelligenceStore.projectAnalysis
  if (!analysis) return ''

  if (analysis.fileCount > intelligenceStore.smartModeThreshold.maxFiles) {
    return `Large project (${analysis.fileCount} files) - Basic Mode recommended`
  }
  if (analysis.estimatedMemory > intelligenceStore.smartModeThreshold.maxMemoryMB) {
    return `High memory usage (${analysis.estimatedMemory}MB) - Basic Mode recommended`
  }
  if (analysis.hasComplexDependencies) {
    return 'Complex dependencies detected - Smart Mode recommended'
  }
  return 'Small project - Basic Mode for fast startup'
}

/** 点击外部关闭菜单 */
const handleClickOutside = (event: MouseEvent) => {
  if (showMenu.value && triggerRef.value && !triggerRef.value.contains(event.target as Node)) {
    showMenu.value = false
  }
}

onMounted(() => {
  document.addEventListener('click', handleClickOutside)
})

onUnmounted(() => {
  document.removeEventListener('click', handleClickOutside)
})
</script>

<style scoped>
.intelligence-mode {
  position: relative;
  height: 100%;
}

.mode-trigger {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 0 8px;
  height: 100%;
  cursor: pointer;
  border-radius: 2px;
  transition: background-color 0.15s;
}

.mode-trigger:hover {
  background: rgba(255, 255, 255, 0.1);
}

.mode-trigger mdui-icon-flash-on,
.mode-trigger mdui-icon-flash-off,
.mode-trigger mdui-icon-sync {
  font-size: 14px;
}

.mode-label {
  font-size: 12px;
  font-weight: 500;
}

.indexing-bar {
  width: 40px;
  height: 4px;
  background: rgba(255, 255, 255, 0.2);
  border-radius: 2px;
  overflow: hidden;
  margin-left: 4px;
}

.indexing-bar-fill {
  height: 100%;
  background: rgba(255, 255, 255, 0.8);
  border-radius: 2px;
  transition: width 0.3s ease;
}

.spinning {
  animation: spin 2s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* 菜单样式：实心悬浮面板，不透明 */
.mode-menu {
  position: fixed;
  min-width: 280px;
  background: var(--mdui-color-surface-container-high, #2d2d2d);
  background-color: var(--mdui-color-surface-container-high, #2d2d2d);
  border: 1px solid var(--mdui-color-outline-variant);
  border-radius: 8px;
  box-shadow: 0 8px 24px rgba(0, 0, 0, 0.25);
  padding: 8px;
  z-index: 9999;
  opacity: 1;
  backdrop-filter: none;
}

.menu-item {
  padding: 12px;
  border-radius: 6px;
  cursor: pointer;
  transition: background-color 0.15s;
}

.menu-item:hover {
  background: var(--mdui-color-surface-container-highest);
}

.menu-item.selected {
  background: var(--mdui-color-secondary-container);
}

.menu-item-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 4px;
}

.menu-item-header mdui-icon-flash-on,
.menu-item-header mdui-icon-flash-off {
  font-size: 18px;
  color: var(--mdui-color-primary);
}

.menu-item-title {
  font-size: 14px;
  font-weight: 500;
  color: var(--mdui-color-on-surface);
  flex: 1;
}

.check-icon {
  font-size: 16px;
  color: var(--mdui-color-primary);
}

.menu-item-description {
  font-size: 12px;
  color: var(--mdui-color-on-surface-variant);
  margin-bottom: 8px;
  padding-left: 26px;
}

.menu-item-features {
  display: flex;
  flex-wrap: wrap;
  gap: 4px;
  padding-left: 26px;
}

.feature-tag {
  font-size: 10px;
  padding: 2px 6px;
  background: var(--mdui-color-surface-container);
  color: var(--mdui-color-on-surface-variant);
  border-radius: 4px;
}

.menu-divider {
  height: 1px;
  background: var(--mdui-color-outline-variant);
  margin: 8px 0;
}

.menu-item.auto-select {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 10px 12px;
}

.menu-item.auto-select mdui-icon-auto-fix-high {
  font-size: 18px;
  color: var(--mdui-color-on-surface-variant);
}

.menu-item.auto-select span {
  flex: 1;
  font-size: 13px;
  color: var(--mdui-color-on-surface);
}

.checkbox-icon {
  font-size: 18px;
  color: var(--mdui-color-primary);
}

.indexing-info {
  padding: 12px;
  background: var(--mdui-color-surface-container);
  border-radius: 6px;
  margin-top: 8px;
}

.indexing-phase {
  font-size: 12px;
  font-weight: 500;
  color: var(--mdui-color-primary);
  margin-bottom: 4px;
}

.indexing-file {
  font-size: 11px;
  color: var(--mdui-color-on-surface-variant);
  margin-bottom: 4px;
  font-family: monospace;
}

.indexing-stats {
  font-size: 11px;
  color: var(--mdui-color-on-surface-variant);
}

/* 项目分析信息样式 */
.project-analysis {
  padding: 12px;
  background: var(--mdui-color-surface-container);
  border-radius: 6px;
  margin-top: 8px;
}

.analysis-title {
  font-size: 12px;
  font-weight: 600;
  color: var(--mdui-color-on-surface);
  margin-bottom: 8px;
}

.analysis-stats {
  display: flex;
  flex-direction: column;
  gap: 4px;
  margin-bottom: 8px;
}

.stat-item {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
}

.stat-label {
  color: var(--mdui-color-on-surface-variant);
  font-weight: 500;
}

.stat-value {
  color: var(--mdui-color-on-surface);
  font-family: monospace;
}

.analysis-recommendation {
  display: flex;
  align-items: center;
  gap: 6px;
  padding: 8px;
  background: var(--mdui-color-primary-container);
  border-radius: 4px;
  font-size: 11px;
  color: var(--mdui-color-on-primary-container);
  line-height: 1.4;
}

.info-icon {
  font-size: 14px;
  flex-shrink: 0;
}

/* 菜单动画 */
.menu-fade-enter-active,
.menu-fade-leave-active {
  transition: opacity 0.15s ease, transform 0.15s ease;
}

.menu-fade-enter-from,
.menu-fade-leave-to {
  opacity: 0;
  transform: translateY(4px);
}
</style>
