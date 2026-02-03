<script setup lang="ts">
import { ref, onMounted, computed } from 'vue'
import { useRemoteStore } from '@/stores/remote'
import { useEditorStore } from '@/stores/editor'
import RemoteConnectionDialog from './RemoteConnectionDialog.vue'
import type { SSHConnectionConfig, RemoteFileNode } from '@/stores/remote'

const remoteStore = useRemoteStore()
const editorStore = useEditorStore()

const showConnectionDialog = ref(false)
const editingConfig = ref<SSHConnectionConfig | null>(null)

// Computed
const savedConnections = computed(() => remoteStore.savedConnections)
const activeConnections = computed(() => remoteStore.connections)
const activeConnection = computed(() => remoteStore.activeConnection)
const directoryTree = computed(() => remoteStore.directoryTree)
const isLoadingDirectory = computed(() => remoteStore.isLoadingDirectory)

onMounted(async () => {
  await remoteStore.init()
})

const handleNewConnection = () => {
  editingConfig.value = null
  showConnectionDialog.value = true
}

const handleEditConnection = (config: SSHConnectionConfig) => {
  editingConfig.value = config
  showConnectionDialog.value = true
}

const handleDeleteConnection = async (connectionId: string) => {
  if (confirm('确定要删除这个保存的连接吗？')) {
    await remoteStore.deleteSavedConnection(connectionId)
  }
}

const handleConnectSaved = async (config: SSHConnectionConfig) => {
  await remoteStore.connect(config)
}

const handleDisconnect = async (connectionId: string) => {
  await remoteStore.disconnect(connectionId)
}

const handleConnected = (connectionId: string) => {
  console.log('Connected to:', connectionId)
}

// File tree handling
const handleNodeClick = async (node: RemoteFileNode) => {
  if (node.isDirectory) {
    remoteStore.toggleFolder(node.path)
    if (remoteStore.isFolderExpanded(node.path)) {
      // Load children if not already loaded
      if (!node.children || node.children.length === 0) {
        const children = await remoteStore.loadDirectory(node.path)
        if (children) {
          node.children = children
        }
      }
    }
  } else {
    // Open file
    await openRemoteFile(node.path)
  }
}

const openRemoteFile = async (filePath: string) => {
  if (!remoteStore.activeConnectionId) return

  const content = await remoteStore.readFile(filePath)
  if (content !== null) {
    // Create a virtual tab for remote file
    const fileName = filePath.split('/').pop() || filePath
    editorStore.openRemoteFile(filePath, content, fileName)
  }
}
</script>

<template>
  <div class="remote-explorer">
    <div class="panel-header">
      <span class="title">远程连接</span>
      <mdui-button-icon title="新建连接" @click="handleNewConnection">
        <mdui-icon-add></mdui-icon-add>
      </mdui-button-icon>
    </div>

    <div class="panel-content">
      <!-- Active Connections -->
      <div v-if="activeConnections.length > 0" class="section">
        <div class="section-header">
          <mdui-icon-cloud></mdui-icon-cloud>
          <span>活动连接</span>
        </div>
        <div class="connection-list">
          <div
            v-for="conn in activeConnections"
            :key="conn.id"
            class="connection-item active"
            :class="{ selected: conn.id === remoteStore.activeConnectionId }"
            @click="remoteStore.setActiveConnection(conn.id)"
          >
            <div class="connection-info">
              <span class="connection-name">{{ conn.config.name }}</span>
              <span class="connection-host">{{ conn.config.username }}@{{ conn.config.host }}</span>
            </div>
            <div class="connection-actions">
              <mdui-button-icon title="断开" @click.stop="handleDisconnect(conn.id)">
                <mdui-icon-link-off></mdui-icon-link-off>
              </mdui-button-icon>
            </div>
          </div>
        </div>
      </div>

      <!-- Remote Files (if connected) -->
      <div v-if="activeConnection && directoryTree.length > 0" class="section">
        <div class="section-header">
          <mdui-icon-folder></mdui-icon-folder>
          <span>远程文件</span>
          <span class="path-hint">{{ remoteStore.remoteWorkspaceRoot }}</span>
        </div>
        <div v-if="isLoadingDirectory" class="loading">
          <mdui-icon-hourglass-empty class="spinning"></mdui-icon-hourglass-empty>
          <span>加载中...</span>
        </div>
        <div v-else class="file-tree">
          <FileTreeNode
            v-for="node in directoryTree"
            :key="node.path"
            :node="node"
            :depth="0"
            @click="handleNodeClick"
          />
        </div>
      </div>

      <!-- Saved Connections -->
      <div class="section">
        <div class="section-header">
          <mdui-icon-bookmark></mdui-icon-bookmark>
          <span>保存的连接</span>
        </div>
        <div v-if="savedConnections.length === 0" class="empty-state">
          <p>暂无保存的连接</p>
          <button class="btn-link" @click="handleNewConnection">创建新连接</button>
        </div>
        <div v-else class="connection-list">
          <div
            v-for="config in savedConnections"
            :key="config.id"
            class="connection-item"
          >
            <div class="connection-info" @click="handleConnectSaved(config)">
              <span class="connection-name">{{ config.name }}</span>
              <span class="connection-host">{{ config.username }}@{{ config.host }}:{{ config.port }}</span>
            </div>
            <div class="connection-actions">
              <mdui-button-icon title="编辑" @click.stop="handleEditConnection(config)">
                <mdui-icon-edit></mdui-icon-edit>
              </mdui-button-icon>
              <mdui-button-icon title="删除" @click.stop="handleDeleteConnection(config.id!)">
                <mdui-icon-delete></mdui-icon-delete>
              </mdui-button-icon>
            </div>
          </div>
        </div>
      </div>
    </div>

    <!-- Connection Dialog -->
    <RemoteConnectionDialog
      :visible="showConnectionDialog"
      :edit-config="editingConfig"
      @close="showConnectionDialog = false"
      @connected="handleConnected"
    />
  </div>
</template>

<script lang="ts">
// File tree node component
const FileTreeNode = {
  name: 'FileTreeNode',
  props: {
    node: { type: Object, required: true },
    depth: { type: Number, default: 0 }
  },
  emits: ['click'],
  setup(props: { node: RemoteFileNode; depth: number }, { emit }: { emit: (e: 'click', node: RemoteFileNode) => void }) {
    const remoteStore = useRemoteStore()

    const isExpanded = computed(() => {
      return props.node.isDirectory && remoteStore.isFolderExpanded(props.node.path)
    })

    const handleClick = () => {
      emit('click', props.node)
    }

    return { isExpanded, handleClick }
  },
  template: `
    <div class="tree-node">
      <div
        class="tree-item"
        :style="{ paddingLeft: depth * 16 + 8 + 'px' }"
        @click="handleClick"
      >
        <mdui-icon-chevron-right
          v-if="node.isDirectory"
          class="expand-icon"
          :class="{ expanded: isExpanded }"
        ></mdui-icon-chevron-right>
        <span v-else class="expand-placeholder"></span>
        <mdui-icon-folder v-if="node.isDirectory && !isExpanded"></mdui-icon-folder>
        <mdui-icon-folder-open v-else-if="node.isDirectory && isExpanded"></mdui-icon-folder-open>
        <mdui-icon-description v-else></mdui-icon-description>
        <span class="node-name">{{ node.name }}</span>
      </div>
      <div v-if="isExpanded && node.children" class="tree-children">
        <FileTreeNode
          v-for="child in node.children"
          :key="child.path"
          :node="child"
          :depth="depth + 1"
          @click="$emit('click', $event)"
        />
      </div>
    </div>
  `
}
</script>

<style scoped>
.remote-explorer {
  height: 100%;
  display: flex;
  flex-direction: column;
  overflow: hidden;
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 8px 8px 16px;
  border-bottom: 1px solid var(--mdui-color-outline-variant);
}

.panel-header .title {
  font-size: 12px;
  font-weight: 500;
  text-transform: uppercase;
  color: var(--mdui-color-on-surface-variant);
}

.panel-content {
  flex: 1;
  overflow-y: auto;
  padding: 8px 0;
}

.section {
  margin-bottom: 16px;
}

.section-header {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 8px 16px;
  font-size: 11px;
  font-weight: 600;
  text-transform: uppercase;
  color: var(--mdui-color-on-surface-variant);
}

.section-header mdui-icon-cloud,
.section-header mdui-icon-bookmark,
.section-header mdui-icon-folder {
  font-size: 14px;
}

.path-hint {
  font-weight: 400;
  opacity: 0.7;
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
  flex: 1;
}

.connection-list {
  display: flex;
  flex-direction: column;
}

.connection-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 8px 16px;
  cursor: pointer;
  transition: background 0.1s;
}

.connection-item:hover {
  background: var(--mdui-color-surface-container-high);
}

.connection-item.active {
  background: var(--mdui-color-secondary-container);
}

.connection-item.selected {
  border-left: 2px solid var(--mdui-color-primary);
}

.connection-info {
  flex: 1;
  min-width: 0;
}

.connection-name {
  display: block;
  font-size: 13px;
  font-weight: 500;
  color: var(--mdui-color-on-surface);
}

.connection-host {
  display: block;
  font-size: 11px;
  color: var(--mdui-color-on-surface-variant);
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}

.connection-actions {
  display: flex;
  gap: 4px;
  opacity: 0;
  transition: opacity 0.1s;
}

.connection-item:hover .connection-actions {
  opacity: 1;
}

.connection-actions mdui-button-icon {
  --mdui-comp-button-icon-size: 24px;
}

.empty-state {
  padding: 16px;
  text-align: center;
  color: var(--mdui-color-on-surface-variant);
}

.empty-state p {
  margin: 0 0 8px;
  font-size: 12px;
}

.btn-link {
  background: none;
  border: none;
  color: var(--mdui-color-primary);
  font-size: 12px;
  cursor: pointer;
  text-decoration: underline;
}

.loading {
  display: flex;
  align-items: center;
  gap: 8px;
  padding: 16px;
  color: var(--mdui-color-on-surface-variant);
  font-size: 12px;
}

.spinning {
  animation: spin 1s linear infinite;
}

@keyframes spin {
  from { transform: rotate(0deg); }
  to { transform: rotate(360deg); }
}

/* File Tree Styles */
.file-tree {
  font-size: 13px;
}

.tree-node {
  user-select: none;
}

.tree-item {
  display: flex;
  align-items: center;
  gap: 4px;
  padding: 4px 8px;
  cursor: pointer;
}

.tree-item:hover {
  background: var(--mdui-color-surface-container-high);
}

.expand-icon {
  font-size: 16px;
  transition: transform 0.15s;
}

.expand-icon.expanded {
  transform: rotate(90deg);
}

.expand-placeholder {
  width: 16px;
}

.tree-item mdui-icon-folder,
.tree-item mdui-icon-folder-open,
.tree-item mdui-icon-description {
  font-size: 16px;
  color: var(--mdui-color-on-surface-variant);
}

.node-name {
  overflow: hidden;
  text-overflow: ellipsis;
  white-space: nowrap;
}
</style>
