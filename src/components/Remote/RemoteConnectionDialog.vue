<script setup lang="ts">
import { ref, reactive } from 'vue'
import { useRemoteStore } from '@/stores/remote'
import type { SSHConnectionConfig, AuthMethod } from '@/stores/remote'

const remoteStore = useRemoteStore()

const props = defineProps<{
  visible: boolean
  editConfig?: SSHConnectionConfig | null
}>()

const emit = defineEmits<{
  (e: 'close'): void
  (e: 'connected', connectionId: string): void
}>()

const form = reactive<SSHConnectionConfig>({
  name: '',
  host: '',
  port: 22,
  username: '',
  authMethod: 'key' as AuthMethod,
  password: '',
  privateKeyPath: '',
  passphrase: '',
  remoteWorkspacePath: '/home',
  keepAliveInterval: 30
})

const isTesting = ref(false)
const testResult = ref<{ success: boolean; error?: string } | null>(null)
const isSubmitting = ref(false)
const submitError = ref<string | null>(null)

// Reset form when dialog opens
const resetForm = () => {
  if (props.editConfig) {
    Object.assign(form, props.editConfig)
  } else {
    form.name = ''
    form.host = ''
    form.port = 22
    form.username = ''
    form.authMethod = 'key'
    form.password = ''
    form.privateKeyPath = ''
    form.passphrase = ''
    form.remoteWorkspacePath = '/home'
    form.keepAliveInterval = 30
  }
  testResult.value = null
  submitError.value = null
}

const handleClose = () => {
  resetForm()
  emit('close')
}

const handleTestConnection = async () => {
  isTesting.value = true
  testResult.value = null

  try {
    testResult.value = await remoteStore.testConnection(form)
  } catch (error) {
    testResult.value = { success: false, error: (error as Error).message }
  } finally {
    isTesting.value = false
  }
}

const handleConnect = async () => {
  isSubmitting.value = true
  submitError.value = null

  try {
    // Save the connection first
    await remoteStore.saveConnection(form)

    // Connect
    const success = await remoteStore.connect(form)
    if (success) {
      const activeConn = remoteStore.activeConnection
      if (activeConn) {
        emit('connected', activeConn.id)
      }
      handleClose()
    } else {
      submitError.value = remoteStore.connectionError ?? 'Connection failed'
    }
  } catch (error) {
    submitError.value = (error as Error).message
  } finally {
    isSubmitting.value = false
  }
}

const handleSaveOnly = async () => {
  await remoteStore.saveConnection(form)
  handleClose()
}

const handleBrowseKey = async () => {
  if (!window.electronAPI?.fileSystem) return
  const result = await window.electronAPI.fileSystem.openFileDialog({
    filters: [{ name: 'SSH Keys', extensions: ['pem', 'key', ''] }]
  })
  if (result && typeof result === 'string') {
    form.privateKeyPath = result
  }
}

defineExpose({ resetForm })
</script>

<template>
  <div v-if="visible" class="dialog-overlay" @click.self="handleClose">
    <div class="dialog">
      <div class="dialog-header">
        <h3>{{ editConfig ? '编辑连接' : '新建 SSH 连接' }}</h3>
        <mdui-button-icon @click="handleClose">
          <mdui-icon-close></mdui-icon-close>
        </mdui-button-icon>
      </div>

      <div class="dialog-body">
        <div class="form-group">
          <label>连接名称</label>
          <input v-model="form.name" type="text" placeholder="My Server" />
        </div>

        <div class="form-row">
          <div class="form-group flex-grow">
            <label>主机地址</label>
            <input v-model="form.host" type="text" placeholder="192.168.1.100" />
          </div>
          <div class="form-group port-field">
            <label>端口</label>
            <input v-model.number="form.port" type="number" min="1" max="65535" />
          </div>
        </div>

        <div class="form-group">
          <label>用户名</label>
          <input v-model="form.username" type="text" placeholder="root" />
        </div>

        <div class="form-group">
          <label>认证方式</label>
          <select v-model="form.authMethod">
            <option value="key">SSH 密钥</option>
            <option value="password">密码</option>
            <option value="agent">SSH Agent</option>
          </select>
        </div>

        <div v-if="form.authMethod === 'password'" class="form-group">
          <label>密码</label>
          <input v-model="form.password" type="password" placeholder="输入密码" />
        </div>

        <div v-if="form.authMethod === 'key'" class="form-group">
          <label>私钥路径</label>
          <div class="input-with-button">
            <input v-model="form.privateKeyPath" type="text" placeholder="~/.ssh/id_rsa" />
            <button class="browse-btn" @click="handleBrowseKey">浏览</button>
          </div>
        </div>

        <div v-if="form.authMethod === 'key'" class="form-group">
          <label>密钥密码 (可选)</label>
          <input v-model="form.passphrase" type="password" placeholder="密钥密码" />
        </div>

        <div class="form-group">
          <label>远程工作目录</label>
          <input v-model="form.remoteWorkspacePath" type="text" placeholder="/home/user/project" />
        </div>

        <!-- Test result -->
        <div v-if="testResult" class="test-result" :class="{ success: testResult.success, error: !testResult.success }">
          <span v-if="testResult.success">连接测试成功</span>
          <span v-else>连接测试失败: {{ testResult.error }}</span>
        </div>

        <!-- Submit error -->
        <div v-if="submitError" class="test-result error">
          {{ submitError }}
        </div>
      </div>

      <div class="dialog-footer">
        <button class="btn btn-secondary" @click="handleTestConnection" :disabled="isTesting || !form.host || !form.username">
          {{ isTesting ? '测试中...' : '测试连接' }}
        </button>
        <div class="footer-right">
          <button class="btn btn-secondary" @click="handleSaveOnly">仅保存</button>
          <button class="btn btn-primary" @click="handleConnect" :disabled="isSubmitting || !form.host || !form.username">
            {{ isSubmitting ? '连接中...' : '连接' }}
          </button>
        </div>
      </div>
    </div>
  </div>
</template>

<style scoped>
.dialog-overlay {
  position: fixed;
  inset: 0;
  z-index: 3000;
  background: rgba(0, 0, 0, 0.5);
  display: flex;
  align-items: center;
  justify-content: center;
}

.dialog {
  width: 480px;
  max-height: 80vh;
  background: var(--mdui-color-surface-container);
  border-radius: 12px;
  box-shadow: 0 16px 48px rgba(0, 0, 0, 0.3);
  display: flex;
  flex-direction: column;
}

.dialog-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 16px 20px;
  border-bottom: 1px solid var(--mdui-color-outline-variant);
}

.dialog-header h3 {
  margin: 0;
  font-size: 16px;
  font-weight: 600;
}

.dialog-body {
  padding: 20px;
  overflow-y: auto;
  display: flex;
  flex-direction: column;
  gap: 16px;
}

.form-group {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.form-group label {
  font-size: 12px;
  font-weight: 500;
  color: var(--mdui-color-on-surface-variant);
}

.form-group input,
.form-group select {
  padding: 8px 12px;
  border: 1px solid var(--mdui-color-outline-variant);
  border-radius: 6px;
  background: var(--mdui-color-surface);
  color: var(--mdui-color-on-surface);
  font-size: 13px;
}

.form-group input:focus,
.form-group select:focus {
  outline: none;
  border-color: var(--mdui-color-primary);
}

.form-row {
  display: flex;
  gap: 12px;
}

.flex-grow {
  flex: 1;
}

.port-field {
  width: 100px;
}

.input-with-button {
  display: flex;
  gap: 8px;
}

.input-with-button input {
  flex: 1;
}

.browse-btn {
  padding: 8px 12px;
  border: 1px solid var(--mdui-color-outline-variant);
  border-radius: 6px;
  background: var(--mdui-color-surface-container-high);
  color: var(--mdui-color-on-surface);
  font-size: 12px;
  cursor: pointer;
  white-space: nowrap;
}

.browse-btn:hover {
  background: var(--mdui-color-surface-container-highest);
}

.test-result {
  padding: 8px 12px;
  border-radius: 6px;
  font-size: 12px;
}

.test-result.success {
  background: rgba(76, 175, 80, 0.15);
  color: #4caf50;
}

.test-result.error {
  background: rgba(244, 67, 54, 0.15);
  color: #f44336;
}

.dialog-footer {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 12px 20px;
  border-top: 1px solid var(--mdui-color-outline-variant);
}

.footer-right {
  display: flex;
  gap: 8px;
}

.btn {
  padding: 8px 16px;
  border: none;
  border-radius: 6px;
  font-size: 13px;
  font-weight: 500;
  cursor: pointer;
}

.btn:disabled {
  opacity: 0.5;
  cursor: not-allowed;
}

.btn-primary {
  background: var(--mdui-color-primary);
  color: var(--mdui-color-on-primary);
}

.btn-primary:hover:not(:disabled) {
  filter: brightness(1.1);
}

.btn-secondary {
  background: var(--mdui-color-surface-container-high);
  color: var(--mdui-color-on-surface);
}

.btn-secondary:hover:not(:disabled) {
  background: var(--mdui-color-surface-container-highest);
}
</style>
