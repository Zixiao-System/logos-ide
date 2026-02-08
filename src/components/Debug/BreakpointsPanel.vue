<template>
  <div class="breakpoints-panel">
    <!-- 工具栏 -->
    <div class="panel-toolbar">
      <mdui-button-icon
        @click="toggleAllBreakpoints"
        :title="allEnabled ? '禁用所有断点' : '启用所有断点'"
      >
        <mdui-icon-toggle-on v-if="allEnabled"></mdui-icon-toggle-on>
        <mdui-icon-toggle-off v-else></mdui-icon-toggle-off>
      </mdui-button-icon>
      <mdui-button-icon @click="removeAllBreakpoints" title="删除所有断点">
        <mdui-icon-delete-sweep></mdui-icon-delete-sweep>
      </mdui-button-icon>
    </div>

    <!-- 异常断点过滤器 -->
    <div class="exception-filters" v-if="debugStore.exceptionFilters.length > 0">
      <div class="section-header">异常断点</div>
      <div
        v-for="filter in debugStore.exceptionFilters"
        :key="filter.filterId"
        class="exception-filter-item"
      >
        <mdui-checkbox
          :checked="filter.enabled"
          @change="toggleExceptionFilter(filter.filterId)"
        ></mdui-checkbox>
        <div class="filter-info">
          <span class="filter-label">{{ filter.label }}</span>
          <span class="filter-description" v-if="filter.description">{{ filter.description }}</span>
        </div>
        <input
          v-if="filter.supportsCondition && filter.enabled"
          class="filter-condition-input"
          type="text"
          :value="filter.condition || ''"
          :placeholder="filter.conditionDescription || '条件表达式'"
          @change="updateFilterCondition(filter.filterId, ($event.target as HTMLInputElement).value)"
          @keydown.stop
        />
      </div>
      <mdui-divider></mdui-divider>
    </div>

    <!-- 断点列表 -->
    <div class="breakpoints-list">
      <div
        v-for="bp in debugStore.allBreakpoints"
        :key="bp.id"
        class="breakpoint-item"
        :class="{ disabled: !bp.enabled, unverified: !bp.verified }"
      >
        <mdui-checkbox
          :checked="bp.enabled"
          @change="toggleBreakpoint(bp.id)"
        ></mdui-checkbox>

        <div class="breakpoint-icon" :class="bp.type">
          <span v-if="bp.type === 'conditional'">?</span>
          <span v-else-if="bp.type === 'logpoint'">L</span>
        </div>

        <div class="breakpoint-info" @click="goToBreakpoint(bp)">
          <div class="breakpoint-location">
            {{ getFileName(bp.source.path || '') }}:{{ bp.line }}
          </div>
          <div class="breakpoint-condition" v-if="bp.condition">
            条件: {{ bp.condition }}
          </div>
          <div class="breakpoint-log" v-if="bp.logMessage">
            日志: {{ bp.logMessage }}
          </div>
        </div>

        <mdui-button-icon
          class="remove-button"
          @click="removeBreakpoint(bp.id)"
        >
          <mdui-icon-close></mdui-icon-close>
        </mdui-button-icon>
      </div>

      <div v-if="debugStore.allBreakpoints.length === 0 && debugStore.exceptionFilters.length === 0" class="empty-state">
        <mdui-icon-radio-button-unchecked></mdui-icon-radio-button-unchecked>
        <p>没有断点</p>
        <p class="hint">点击编辑器行号设置断点</p>
      </div>
    </div>
  </div>
</template>

<script setup lang="ts">
import { computed } from 'vue'
import { useDebugStore, type BreakpointInfo } from '@/stores/debug'
import { useEditorStore } from '@/stores/editor'

const debugStore = useDebugStore()
const editorStore = useEditorStore()

const allEnabled = computed(() => {
  return debugStore.allBreakpoints.every(bp => bp.enabled)
})

async function toggleBreakpoint(breakpointId: string) {
  const api = window.electronAPI?.debug
  if (api) {
    await api.toggleBreakpoint(breakpointId)
  }
  debugStore.toggleBreakpointEnabled(breakpointId)
}

async function removeBreakpoint(breakpointId: string) {
  const api = window.electronAPI?.debug
  if (api) {
    await api.removeBreakpoint(breakpointId)
  }
  debugStore.removeBreakpoint(breakpointId)
}

async function toggleAllBreakpoints() {
  const api = window.electronAPI?.debug
  if (!api) return

  for (const bp of debugStore.allBreakpoints) {
    if (allEnabled.value ? bp.enabled : !bp.enabled) {
      await api.toggleBreakpoint(bp.id)
      debugStore.toggleBreakpointEnabled(bp.id)
    }
  }
}

async function removeAllBreakpoints() {
  const api = window.electronAPI?.debug
  if (!api) return

  for (const bp of [...debugStore.allBreakpoints]) {
    await api.removeBreakpoint(bp.id)
    debugStore.removeBreakpoint(bp.id)
  }
}

function toggleExceptionFilter(filterId: string) {
  debugStore.toggleExceptionFilter(filterId)
}

function updateFilterCondition(filterId: string, condition: string) {
  debugStore.updateExceptionFilterCondition(filterId, condition)
}

function goToBreakpoint(bp: BreakpointInfo) {
  if (bp.source.path) {
    editorStore.openFile(bp.source.path)
  }
}

function getFileName(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path
}
</script>

<style scoped>
.breakpoints-panel {
  height: 100%;
  display: flex;
  flex-direction: column;
}

.panel-toolbar {
  display: flex;
  gap: 4px;
  padding: 4px 8px;
  border-bottom: 1px solid var(--mdui-color-outline-variant);
}

.breakpoints-list {
  flex: 1;
  overflow: auto;
}

.exception-filters {
  border-bottom: 1px solid var(--mdui-color-outline-variant);
}

.section-header {
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--mdui-color-outline);
  padding: 6px 12px 2px;
}

.exception-filter-item {
  display: flex;
  align-items: center;
  padding: 4px 12px;
  gap: 8px;
  flex-wrap: wrap;
}

.exception-filter-item:hover {
  background: var(--mdui-color-surface-container-highest);
}

.filter-info {
  flex: 1;
  display: flex;
  flex-direction: column;
  min-width: 0;
}

.filter-label {
  font-size: 13px;
}

.filter-description {
  font-size: 11px;
  color: var(--mdui-color-outline);
}

.filter-condition-input {
  width: 100%;
  margin-left: 32px;
  margin-bottom: 4px;
  padding: 3px 8px;
  font-size: 12px;
  font-family: monospace;
  background: var(--mdui-color-surface-container);
  color: var(--mdui-color-on-surface);
  border: 1px solid var(--mdui-color-outline-variant);
  border-radius: 3px;
  outline: none;
}

.filter-condition-input:focus {
  border-color: var(--mdui-color-primary);
}

.breakpoint-item {
  display: flex;
  align-items: center;
  padding: 6px 12px;
  gap: 8px;
  border-bottom: 1px solid var(--mdui-color-outline-variant);
}

.breakpoint-item:hover {
  background: var(--mdui-color-surface-container-highest);
}

.breakpoint-item.disabled {
  opacity: 0.5;
}

.breakpoint-item.unverified .breakpoint-icon {
  opacity: 0.5;
}

.breakpoint-icon {
  width: 16px;
  height: 16px;
  border-radius: 50%;
  background: var(--mdui-color-error);
  display: flex;
  align-items: center;
  justify-content: center;
  font-size: 10px;
  color: white;
  font-weight: bold;
}

.breakpoint-icon.conditional {
  background: var(--mdui-color-tertiary);
}

.breakpoint-icon.logpoint {
  background: var(--mdui-color-primary);
  border-radius: 4px;
}

.breakpoint-info {
  flex: 1;
  cursor: pointer;
  overflow: hidden;
}

.breakpoint-location {
  font-size: 13px;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.breakpoint-condition,
.breakpoint-log {
  font-size: 11px;
  color: var(--mdui-color-outline);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.remove-button {
  opacity: 0;
  transition: opacity 0.2s;
  --mdui-comp-icon-button-shape-corner: 4px;
}

.breakpoint-item:hover .remove-button {
  opacity: 1;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--mdui-color-outline);
  text-align: center;
  padding: 24px;
}

.empty-state mdui-icon-radio-button-unchecked {
  font-size: 48px;
  opacity: 0.5;
}

.empty-state .hint {
  font-size: 12px;
  opacity: 0.7;
}
</style>
