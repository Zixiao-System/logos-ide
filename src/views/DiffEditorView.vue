<script setup lang="ts">
/**
 * 差异编辑器视图
 * 使用 Monaco Diff Editor 显示文件差异
 */

import { ref, watch, onMounted, onUnmounted, computed, nextTick } from 'vue'
import * as monaco from 'monaco-editor'
import { useDiffStore } from '@/stores/diff'
import { useRouter } from 'vue-router'

// 导入图标
import '@mdui/icons/close.js'
import '@mdui/icons/compare-arrows.js'
import '@mdui/icons/vertical-split.js'

const diffStore = useDiffStore()
const router = useRouter()
const diffContainer = ref<HTMLElement | null>(null)
let diffEditor: monaco.editor.IStandaloneDiffEditor | null = null

// 差异编辑器配置
const diffEditorOptions = computed(() => ({
  renderSideBySide: diffStore.config.renderSideBySide,
  readOnly: diffStore.config.readOnly,
  renderIndicators: diffStore.config.renderIndicators,
  ignoreTrimWhitespace: diffStore.config.ignoreTrimWhitespace,
  automaticLayout: true,
  scrollBeyondLastLine: false,
  fontSize: 14,
  fontFamily: "'JetBrains Mono', 'Fira Code', 'Consolas', monospace",
  minimap: { enabled: false }
}))

// 初始化差异编辑器
function initDiffEditor() {
  if (!diffContainer.value || diffEditor) return

  // 使用与主编辑器相同的主题
  diffEditor = monaco.editor.createDiffEditor(diffContainer.value, {
    ...diffEditorOptions.value,
    theme: 'lsp-dark'
  })

  // 设置差异内容
  updateDiffContent()
}

// 更新差异内容
function updateDiffContent() {
  if (!diffEditor) return

  const originalModel = monaco.editor.createModel(
    diffStore.originalContent,
    diffStore.language,
    monaco.Uri.parse(`inmemory://original/${diffStore.filePath}`)
  )

  const modifiedModel = monaco.editor.createModel(
    diffStore.modifiedContent,
    diffStore.language,
    monaco.Uri.parse(`inmemory://modified/${diffStore.filePath}`)
  )

  diffEditor.setModel({
    original: originalModel,
    modified: modifiedModel
  })
}

// 关闭差异视图
function closeDiff() {
  diffStore.closeDiff()
  router.push('/')
}

// 切换显示模式
function toggleViewMode() {
  diffStore.toggleSideBySide()
  if (diffEditor) {
    diffEditor.updateOptions({
      renderSideBySide: diffStore.config.renderSideBySide
    })
  }
}

// 监听差异内容变化
watch(
  () => [diffStore.originalContent, diffStore.modifiedContent],
  () => {
    if (diffEditor && diffStore.isOpen) {
      // 清理旧的 models
      const currentModel = diffEditor.getModel()
      if (currentModel) {
        currentModel.original.dispose()
        currentModel.modified.dispose()
      }
      updateDiffContent()
    }
  }
)

// 监听容器就绪
watch(diffContainer, (container) => {
  if (container && !diffEditor) {
    nextTick(() => {
      initDiffEditor()
    })
  }
})

onMounted(() => {
  if (diffStore.isOpen) {
    nextTick(() => {
      initDiffEditor()
    })
  }
})

onUnmounted(() => {
  if (diffEditor) {
    // 清理 models
    const currentModel = diffEditor.getModel()
    if (currentModel) {
      currentModel.original.dispose()
      currentModel.modified.dispose()
    }
    diffEditor.dispose()
    diffEditor = null
  }
})
</script>

<template>
  <div class="diff-view">
    <!-- 工具栏 -->
    <div class="diff-toolbar">
      <div class="diff-info">
        <span class="diff-title">{{ diffStore.diffTitle }}</span>
        <span v-if="diffStore.staged" class="staged-badge">Staged</span>
      </div>

      <div class="diff-actions">
        <mdui-button-icon
          @click="toggleViewMode"
          :title="diffStore.config.renderSideBySide ? '切换到行内模式' : '切换到分屏模式'"
        >
          <mdui-icon-vertical-split v-if="diffStore.config.renderSideBySide"></mdui-icon-vertical-split>
          <mdui-icon-compare-arrows v-else></mdui-icon-compare-arrows>
        </mdui-button-icon>

        <mdui-button-icon @click="closeDiff" title="关闭">
          <mdui-icon-close></mdui-icon-close>
        </mdui-button-icon>
      </div>
    </div>

    <!-- 加载状态 -->
    <div v-if="diffStore.loading" class="diff-loading">
      <mdui-circular-progress></mdui-circular-progress>
      <span>加载差异...</span>
    </div>

    <!-- 错误状态 -->
    <div v-else-if="diffStore.error" class="diff-error">
      <span>{{ diffStore.error }}</span>
      <mdui-button variant="text" @click="closeDiff">关闭</mdui-button>
    </div>

    <!-- 无差异 -->
    <div v-else-if="!diffStore.hasDiff" class="diff-empty">
      <mdui-icon-compare-arrows></mdui-icon-compare-arrows>
      <span>文件无变化</span>
      <mdui-button variant="text" @click="closeDiff">关闭</mdui-button>
    </div>

    <!-- 差异编辑器容器 -->
    <div v-else ref="diffContainer" class="diff-container"></div>
  </div>
</template>

<style scoped>
.diff-view {
  display: flex;
  flex-direction: column;
  height: 100%;
  background: var(--mdui-color-surface);
}

.diff-toolbar {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  border-bottom: 1px solid var(--mdui-color-outline-variant);
  background: var(--mdui-color-surface-container);
}

.diff-info {
  display: flex;
  align-items: center;
  gap: 8px;
}

.diff-title {
  font-weight: 500;
  font-size: 14px;
  color: var(--mdui-color-on-surface);
}

.staged-badge {
  padding: 2px 8px;
  font-size: 11px;
  font-weight: 500;
  color: var(--mdui-color-on-tertiary-container);
  background: var(--mdui-color-tertiary-container);
  border-radius: 4px;
}

.diff-actions {
  display: flex;
  gap: 4px;
}

.diff-container {
  flex: 1;
  overflow: hidden;
}

.diff-loading,
.diff-error,
.diff-empty {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  gap: 16px;
  height: 100%;
  color: var(--mdui-color-on-surface-variant);
}

.diff-loading span,
.diff-error span,
.diff-empty span {
  font-size: 14px;
}

.diff-empty mdui-icon-compare-arrows {
  font-size: 48px;
  opacity: 0.5;
}

.diff-error {
  color: var(--mdui-color-error);
}
</style>
