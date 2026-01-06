<template>
  <mdui-dialog
    :open="isOpen"
    @closed="handleClose"
    class="launch-config-dialog"
  >
    <span slot="headline">运行和调试配置</span>

    <div class="dialog-content">
      <!-- 左侧配置列表 -->
      <div class="config-list">
        <div class="list-header">
          <span>配置</span>
          <div class="list-actions">
            <mdui-button-icon @click="handleAddNew" title="添加配置">
              <mdui-icon-add></mdui-icon-add>
            </mdui-button-icon>
          </div>
        </div>
        <div class="list-items">
          <div
            v-for="(config, index) in debugStore.launchConfigurations"
            :key="index"
            class="config-item"
            :class="{ selected: selectedIndex === index }"
            @click="selectConfig(index)"
          >
            <mdui-icon-bug-report v-if="config.request === 'launch'" class="config-icon"></mdui-icon-bug-report>
            <mdui-icon-link v-else class="config-icon"></mdui-icon-link>
            <span class="config-name">{{ config.name }}</span>
            <mdui-button-icon
              class="delete-btn"
              @click.stop="handleDelete(index)"
              title="删除"
            >
              <mdui-icon-delete></mdui-icon-delete>
            </mdui-button-icon>
          </div>
          <div v-if="debugStore.launchConfigurations.length === 0" class="empty-list">
            <p>没有配置</p>
            <mdui-button variant="text" @click="handleAddNew">
              <mdui-icon-add slot="icon"></mdui-icon-add>
              添加配置
            </mdui-button>
          </div>
        </div>
      </div>

      <!-- 右侧配置详情 -->
      <div class="config-details" v-if="selectedConfig">
        <div class="detail-section">
          <label class="field-label">名称</label>
          <mdui-text-field
            :value="editingConfig.name"
            @input="handleNameChange"
            variant="outlined"
          ></mdui-text-field>
        </div>

        <div class="detail-row">
          <div class="detail-section half">
            <label class="field-label">类型</label>
            <mdui-select
              :value="editingConfig.type"
              @change="handleTypeChange"
              variant="outlined"
            >
              <mdui-menu-item value="node">Node.js</mdui-menu-item>
              <mdui-menu-item value="python">Python</mdui-menu-item>
              <mdui-menu-item value="chrome">Chrome</mdui-menu-item>
              <mdui-menu-item value="go">Go</mdui-menu-item>
            </mdui-select>
          </div>

          <div class="detail-section half">
            <label class="field-label">请求类型</label>
            <mdui-select
              :value="editingConfig.request"
              @change="handleRequestChange"
              variant="outlined"
            >
              <mdui-menu-item value="launch">启动</mdui-menu-item>
              <mdui-menu-item value="attach">附加</mdui-menu-item>
            </mdui-select>
          </div>
        </div>

        <!-- Launch 配置 -->
        <template v-if="editingConfig.request === 'launch'">
          <div class="section-title">启动选项</div>

          <div class="detail-section">
            <label class="field-label">程序</label>
            <mdui-text-field
              :value="editingConfig.program || ''"
              @input="handleFieldChange('program', $event)"
              variant="outlined"
              placeholder="${workspaceFolder}/index.js"
            ></mdui-text-field>
          </div>

          <div class="detail-section">
            <label class="field-label">参数</label>
            <mdui-text-field
              :value="(editingConfig.args || []).join(' ')"
              @input="handleArgsChange"
              variant="outlined"
              placeholder="arg1 arg2 arg3"
            ></mdui-text-field>
          </div>

          <div class="detail-section">
            <label class="field-label">工作目录</label>
            <mdui-text-field
              :value="editingConfig.cwd || ''"
              @input="handleFieldChange('cwd', $event)"
              variant="outlined"
              placeholder="${workspaceFolder}"
            ></mdui-text-field>
          </div>

          <div class="detail-row checkboxes">
            <label class="checkbox-label">
              <mdui-checkbox
                :checked="editingConfig.stopOnEntry"
                @change="handleCheckboxChange('stopOnEntry', $event)"
              ></mdui-checkbox>
              入口处停止
            </label>
            <label class="checkbox-label">
              <mdui-checkbox
                :checked="editingConfig.sourceMaps !== false"
                @change="handleCheckboxChange('sourceMaps', $event)"
              ></mdui-checkbox>
              启用 Source Maps
            </label>
          </div>

          <!-- Node.js 特定选项 -->
          <template v-if="editingConfig.type === 'node'">
            <div class="detail-section">
              <label class="field-label">控制台</label>
              <mdui-select
                :value="editingConfig.console || 'internalConsole'"
                @change="handleFieldChange('console', $event)"
                variant="outlined"
              >
                <mdui-menu-item value="internalConsole">内部控制台</mdui-menu-item>
                <mdui-menu-item value="integratedTerminal">集成终端</mdui-menu-item>
                <mdui-menu-item value="externalTerminal">外部终端</mdui-menu-item>
              </mdui-select>
            </div>
          </template>

          <!-- Python 特定选项 -->
          <template v-if="editingConfig.type === 'python'">
            <div class="detail-section">
              <label class="field-label">Python 解释器</label>
              <mdui-text-field
                :value="editingConfig.python || ''"
                @input="handleFieldChange('python', $event)"
                variant="outlined"
                placeholder="python3"
              ></mdui-text-field>
            </div>
            <label class="checkbox-label">
              <mdui-checkbox
                :checked="editingConfig.justMyCode !== false"
                @change="handleCheckboxChange('justMyCode', $event)"
              ></mdui-checkbox>
              仅我的代码
            </label>
          </template>

          <!-- Chrome 特定选项 -->
          <template v-if="editingConfig.type === 'chrome'">
            <div class="detail-section">
              <label class="field-label">URL</label>
              <mdui-text-field
                :value="editingConfig.url || ''"
                @input="handleFieldChange('url', $event)"
                variant="outlined"
                placeholder="http://localhost:3000"
              ></mdui-text-field>
            </div>
            <div class="detail-section">
              <label class="field-label">Web Root</label>
              <mdui-text-field
                :value="editingConfig.webRoot || ''"
                @input="handleFieldChange('webRoot', $event)"
                variant="outlined"
                placeholder="${workspaceFolder}"
              ></mdui-text-field>
            </div>
          </template>
        </template>

        <!-- Attach 配置 -->
        <template v-else>
          <div class="section-title">附加选项</div>

          <div class="detail-row">
            <div class="detail-section half">
              <label class="field-label">端口</label>
              <mdui-text-field
                :value="editingConfig.port?.toString() || ''"
                @input="handlePortChange"
                variant="outlined"
                placeholder="9229"
                type="number"
              ></mdui-text-field>
            </div>

            <div class="detail-section half">
              <label class="field-label">地址</label>
              <mdui-text-field
                :value="editingConfig.address || ''"
                @input="handleFieldChange('address', $event)"
                variant="outlined"
                placeholder="localhost"
              ></mdui-text-field>
            </div>
          </div>

          <div class="detail-section">
            <label class="field-label">进程 ID</label>
            <mdui-text-field
              :value="editingConfig.processId?.toString() || ''"
              @input="handleProcessIdChange"
              variant="outlined"
              placeholder="留空则自动选择"
              type="number"
            ></mdui-text-field>
          </div>
        </template>
      </div>

      <!-- 添加新配置面板 -->
      <div class="config-details add-panel" v-else-if="isAddingNew">
        <div class="add-header">
          <h3>选择配置类型</h3>
        </div>
        <div class="config-templates">
          <div class="template-item" @click="createFromTemplate('node')">
            <mdui-icon-javascript class="template-icon"></mdui-icon-javascript>
            <span>Node.js</span>
          </div>
          <div class="template-item" @click="createFromTemplate('python')">
            <mdui-icon-code class="template-icon"></mdui-icon-code>
            <span>Python</span>
          </div>
          <div class="template-item" @click="createFromTemplate('chrome')">
            <mdui-icon-language class="template-icon"></mdui-icon-language>
            <span>Chrome</span>
          </div>
          <div class="template-item" @click="createFromTemplate('go')">
            <mdui-icon-code class="template-icon"></mdui-icon-code>
            <span>Go</span>
          </div>
        </div>
      </div>

      <!-- 空状态 -->
      <div class="config-details empty" v-else>
        <p>选择一个配置进行编辑，或添加新配置</p>
      </div>
    </div>

    <mdui-button slot="action" variant="text" @click="handleClose">
      取消
    </mdui-button>
    <mdui-button slot="action" variant="filled" @click="handleSave" :disabled="!hasChanges">
      保存
    </mdui-button>
  </mdui-dialog>
</template>

<script setup lang="ts">
import { ref, computed, watch } from 'vue'
import { useDebugStore, type LaunchConfig } from '@/stores/debug'

// 图标导入
import '@mdui/icons/add.js'
import '@mdui/icons/delete.js'
import '@mdui/icons/bug-report.js'
import '@mdui/icons/link.js'
import '@mdui/icons/javascript.js'
import '@mdui/icons/code.js'
import '@mdui/icons/language.js'

const debugStore = useDebugStore()

const isOpen = ref(false)
const selectedIndex = ref(-1)
const isAddingNew = ref(false)
const editingConfig = ref<LaunchConfig>({
  type: 'node',
  request: 'launch',
  name: ''
})
const originalConfig = ref<string>('')

const emit = defineEmits<{
  (e: 'config-added'): void
}>()

const selectedConfig = computed(() => {
  if (selectedIndex.value >= 0 && selectedIndex.value < debugStore.launchConfigurations.length) {
    return debugStore.launchConfigurations[selectedIndex.value]
  }
  return null
})

const hasChanges = computed(() => {
  if (selectedIndex.value < 0) return false
  return JSON.stringify(editingConfig.value) !== originalConfig.value
})

watch(selectedConfig, (config) => {
  if (config) {
    editingConfig.value = { ...config }
    originalConfig.value = JSON.stringify(config)
    isAddingNew.value = false
  }
})

function open() {
  isOpen.value = true
  isAddingNew.value = false
  if (debugStore.launchConfigurations.length > 0) {
    selectedIndex.value = debugStore.selectedConfigIndex >= 0 ? debugStore.selectedConfigIndex : 0
  } else {
    selectedIndex.value = -1
    isAddingNew.value = true
  }
}

function openForAdd() {
  isOpen.value = true
  selectedIndex.value = -1
  isAddingNew.value = true
}

function handleClose() {
  isOpen.value = false
  selectedIndex.value = -1
  isAddingNew.value = false
}

function selectConfig(index: number) {
  selectedIndex.value = index
  isAddingNew.value = false
}

function handleAddNew() {
  selectedIndex.value = -1
  isAddingNew.value = true
}

async function handleDelete(index: number) {
  await debugStore.removeConfiguration(index)
  if (selectedIndex.value === index) {
    selectedIndex.value = -1
  } else if (selectedIndex.value > index) {
    selectedIndex.value--
  }
}

async function createFromTemplate(type: string) {
  const template = await debugStore.getDefaultConfiguration(type)
  if (template) {
    await debugStore.addConfiguration(template)
    selectedIndex.value = debugStore.launchConfigurations.length - 1
    isAddingNew.value = false
    emit('config-added')
  } else {
    // 创建基本配置
    const newConfig: LaunchConfig = {
      type,
      request: 'launch',
      name: `${type.charAt(0).toUpperCase() + type.slice(1)} Launch`,
      program: '${workspaceFolder}/index.js'
    }
    await debugStore.addConfiguration(newConfig)
    selectedIndex.value = debugStore.launchConfigurations.length - 1
    isAddingNew.value = false
    emit('config-added')
  }
}

function handleNameChange(event: Event) {
  const target = event.target as HTMLInputElement
  editingConfig.value.name = target.value
}

function handleTypeChange(event: Event) {
  const target = event.target as HTMLSelectElement
  editingConfig.value.type = target.value
}

function handleRequestChange(event: Event) {
  const target = event.target as HTMLSelectElement
  editingConfig.value.request = target.value as 'launch' | 'attach'
}

function handleFieldChange(field: string, event: Event) {
  const target = event.target as HTMLInputElement | HTMLSelectElement
  ;(editingConfig.value as Record<string, unknown>)[field] = target.value
}

function handleArgsChange(event: Event) {
  const target = event.target as HTMLInputElement
  const value = target.value.trim()
  editingConfig.value.args = value ? value.split(/\s+/) : []
}

function handlePortChange(event: Event) {
  const target = event.target as HTMLInputElement
  const value = parseInt(target.value, 10)
  editingConfig.value.port = isNaN(value) ? undefined : value
}

function handleProcessIdChange(event: Event) {
  const target = event.target as HTMLInputElement
  const value = parseInt(target.value, 10)
  editingConfig.value.processId = isNaN(value) ? undefined : value
}

function handleCheckboxChange(field: string, event: Event) {
  const target = event.target as HTMLInputElement
  ;(editingConfig.value as Record<string, unknown>)[field] = target.checked
}

async function handleSave() {
  if (selectedIndex.value >= 0 && hasChanges.value) {
    await debugStore.updateConfiguration(selectedIndex.value, editingConfig.value)
    originalConfig.value = JSON.stringify(editingConfig.value)
  }
  handleClose()
}

defineExpose({
  open,
  openForAdd
})
</script>

<style scoped>
.launch-config-dialog {
  --mdui-dialog-max-width: 800px;
  --mdui-dialog-min-width: 700px;
}

.dialog-content {
  display: flex;
  height: 450px;
  gap: 16px;
}

.config-list {
  width: 220px;
  flex-shrink: 0;
  border: 1px solid var(--mdui-color-outline-variant);
  border-radius: 8px;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.list-header {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 8px 12px;
  border-bottom: 1px solid var(--mdui-color-outline-variant);
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  color: var(--mdui-color-on-surface-variant);
}

.list-actions mdui-button-icon {
  --mdui-comp-icon-button-size: 28px;
}

.list-items {
  flex: 1;
  overflow-y: auto;
}

.config-item {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 12px;
  cursor: pointer;
  border-bottom: 1px solid var(--mdui-color-outline-variant);
}

.config-item:hover {
  background: var(--mdui-color-surface-container-high);
}

.config-item.selected {
  background: var(--mdui-color-primary-container);
}

.config-icon {
  font-size: 18px;
  color: var(--mdui-color-on-surface-variant);
}

.config-name {
  flex: 1;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  font-size: 13px;
}

.delete-btn {
  opacity: 0;
  --mdui-comp-icon-button-size: 24px;
}

.config-item:hover .delete-btn {
  opacity: 1;
}

.empty-list {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--mdui-color-outline);
  gap: 8px;
}

.config-details {
  flex: 1;
  overflow-y: auto;
  padding: 4px;
}

.config-details.empty,
.config-details.add-panel {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  color: var(--mdui-color-outline);
}

.add-header h3 {
  margin: 0 0 24px 0;
  font-size: 16px;
  font-weight: 500;
  color: var(--mdui-color-on-surface);
}

.config-templates {
  display: grid;
  grid-template-columns: repeat(2, 1fr);
  gap: 12px;
}

.template-item {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 8px;
  padding: 24px 16px;
  border: 1px solid var(--mdui-color-outline-variant);
  border-radius: 12px;
  cursor: pointer;
  transition: all 0.2s;
}

.template-item:hover {
  background: var(--mdui-color-surface-container-high);
  border-color: var(--mdui-color-primary);
}

.template-icon {
  font-size: 32px;
  color: var(--mdui-color-primary);
}

.detail-section {
  margin-bottom: 16px;
}

.detail-section.half {
  flex: 1;
}

.detail-row {
  display: flex;
  gap: 16px;
}

.detail-row.checkboxes {
  margin-bottom: 16px;
}

.field-label {
  display: block;
  margin-bottom: 4px;
  font-size: 12px;
  font-weight: 500;
  color: var(--mdui-color-on-surface-variant);
}

.section-title {
  margin: 24px 0 12px 0;
  font-size: 14px;
  font-weight: 500;
  color: var(--mdui-color-on-surface);
  border-bottom: 1px solid var(--mdui-color-outline-variant);
  padding-bottom: 8px;
}

.checkbox-label {
  display: flex;
  align-items: center;
  gap: 8px;
  font-size: 13px;
  cursor: pointer;
  margin-right: 16px;
}

.config-details mdui-text-field,
.config-details mdui-select {
  width: 100%;
}
</style>
