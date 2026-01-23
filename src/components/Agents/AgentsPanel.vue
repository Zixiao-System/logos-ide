<script setup lang="ts">
/**
 * AI Agents Panel (Cursor-style)
 */

import { computed, onMounted, ref } from 'vue'
import { useAgentsStore } from '@/stores/agents'
import { useSettingsStore } from '@/stores/settings'

import '@mdui/icons/auto-awesome.js'
import '@mdui/icons/add.js'
import '@mdui/icons/close.js'
import '@mdui/icons/login.js'
import '@mdui/icons/key.js'

const agentsStore = useAgentsStore()
const settingsStore = useSettingsStore()

const messageInput = ref('')
const openAiLoading = ref(false)
const anthropicLoading = ref(false)
const anthropicDialogOpen = ref(false)
const anthropicRequestId = ref<string | null>(null)
const anthropicIntent = ref<'oauth' | 'api'>('oauth')
const anthropicCode = ref('')
const authError = ref('')

onMounted(() => {
  agentsStore.init()
})

const activeAgent = computed(() => agentsStore.activeAgent)

const defaultProvider = computed({
  get: () => settingsStore.ai.provider,
  set: (value: string) => settingsStore.updateAI({ provider: value as 'openai' | 'anthropic' })
})

const openAiApiKey = computed({
  get: () => settingsStore.ai.openai.apiKey,
  set: (value: string) => settingsStore.updateAI({
    openai: { ...settingsStore.ai.openai, apiKey: value, authType: value ? 'api' : 'none' }
  })
})

const anthropicApiKey = computed({
  get: () => settingsStore.ai.anthropic.apiKey,
  set: (value: string) => settingsStore.updateAI({
    anthropic: { ...settingsStore.ai.anthropic, apiKey: value, authType: value ? 'api' : 'none' }
  })
})

const handleSend = async () => {
  const content = messageInput.value.trim()
  if (!content || !activeAgent.value) return
  messageInput.value = ''
  await agentsStore.sendMessage(activeAgent.value.id, content)
}

const handleOpenAiOAuth = async () => {
  authError.value = ''
  openAiLoading.value = true
  try {
    const { state, authUrl } = await window.electronAPI.ai.openaiOauthStart()
    await window.electronAPI.openExternal(authUrl)
    const tokens = await window.electronAPI.ai.openaiOauthWait(state)
    settingsStore.updateAI({
      openai: {
        ...settingsStore.ai.openai,
        authType: 'oauth',
        oauth: tokens
      }
    })
  } catch (error) {
    authError.value = (error as Error).message
  } finally {
    openAiLoading.value = false
  }
}

const startAnthropicOAuth = async (mode: 'max' | 'console', intent: 'oauth' | 'api') => {
  authError.value = ''
  anthropicLoading.value = true
  try {
    const { requestId, authUrl } = await window.electronAPI.ai.anthropicOauthStart(mode)
    anthropicRequestId.value = requestId
    anthropicIntent.value = intent
    anthropicCode.value = ''
    anthropicDialogOpen.value = true
    await window.electronAPI.openExternal(authUrl)
  } catch (error) {
    authError.value = (error as Error).message
  } finally {
    anthropicLoading.value = false
  }
}

const completeAnthropicOAuth = async () => {
  if (!anthropicRequestId.value || !anthropicCode.value.trim()) return
  authError.value = ''
  anthropicLoading.value = true
  try {
    const result = await window.electronAPI.ai.anthropicOauthExchange(
      anthropicRequestId.value,
      anthropicCode.value.trim(),
      anthropicIntent.value
    )
    if (result.type === 'api') {
      settingsStore.updateAI({
        anthropic: {
          ...settingsStore.ai.anthropic,
          authType: 'api',
          apiKey: result.apiKey,
          oauth: null
        }
      })
    } else {
      settingsStore.updateAI({
        anthropic: {
          ...settingsStore.ai.anthropic,
          authType: 'oauth',
          oauth: result
        }
      })
    }
    anthropicDialogOpen.value = false
  } catch (error) {
    authError.value = (error as Error).message
  } finally {
    anthropicLoading.value = false
  }
}
</script>

<template>
  <div class="agents-panel">
    <div class="panel-header">
      <span class="title">AI Agents</span>
      <div class="actions">
        <mdui-button-icon @click="agentsStore.addAgent()" title="新建 Agent">
          <mdui-icon-add></mdui-icon-add>
        </mdui-button-icon>
      </div>
    </div>

    <div class="agents-list">
      <div
        v-for="agent in agentsStore.agents"
        :key="agent.id"
        class="agent-item"
        :class="{ active: agent.id === agentsStore.activeAgentId }"
        @click="agentsStore.setActiveAgent(agent.id)"
      >
        <div class="agent-title">
          <mdui-icon-auto-awesome class="agent-icon"></mdui-icon-auto-awesome>
          <span class="name">{{ agent.name }}</span>
          <span class="status" :class="agent.status">{{ agent.status }}</span>
        </div>
        <mdui-button-icon
          class="remove-btn"
          title="移除 Agent"
          @click.stop="agentsStore.removeAgent(agent.id)"
          :disabled="agentsStore.agents.length === 1"
        >
          <mdui-icon-close></mdui-icon-close>
        </mdui-button-icon>
      </div>
    </div>

    <div class="agent-config" v-if="activeAgent">
      <div class="config-row">
        <label>Provider</label>
        <mdui-select
          :value="activeAgent.provider"
          @change="(e: any) => agentsStore.updateAgent(activeAgent.id, { provider: e.target.value })"
        >
          <mdui-menu-item value="openai">OpenAI</mdui-menu-item>
          <mdui-menu-item value="anthropic">Anthropic</mdui-menu-item>
        </mdui-select>
      </div>
      <div class="config-row">
        <label>Model</label>
        <mdui-text-field
          :value="activeAgent.model"
          @input="(e: any) => agentsStore.updateAgent(activeAgent.id, { model: e.target.value })"
          placeholder="模型名称"
        ></mdui-text-field>
      </div>
    </div>

    <div class="auth-section">
      <div class="section-title">Provider 登录</div>
      <div class="config-row">
        <label>默认 Provider</label>
        <mdui-select :value="defaultProvider" @change="(e: any) => defaultProvider = e.target.value">
          <mdui-menu-item value="openai">OpenAI</mdui-menu-item>
          <mdui-menu-item value="anthropic">Anthropic</mdui-menu-item>
        </mdui-select>
      </div>

      <div class="provider-card">
        <div class="provider-title">OpenAI</div>
        <mdui-text-field
          type="password"
          :value="openAiApiKey"
          @input="(e: any) => openAiApiKey = e.target.value"
          placeholder="OpenAI API Key"
        ></mdui-text-field>
        <mdui-button
          class="auth-button"
          :loading="openAiLoading"
          @click="handleOpenAiOAuth"
        >
          <mdui-icon-login slot="icon"></mdui-icon-login>
          ChatGPT OAuth
        </mdui-button>
      </div>

      <div class="provider-card">
        <div class="provider-title">Anthropic</div>
        <mdui-text-field
          type="password"
          :value="anthropicApiKey"
          @input="(e: any) => anthropicApiKey = e.target.value"
          placeholder="Anthropic API Key"
        ></mdui-text-field>
        <div class="auth-row">
          <mdui-button
            class="auth-button"
            :loading="anthropicLoading"
            @click="startAnthropicOAuth('max', 'oauth')"
          >
            <mdui-icon-login slot="icon"></mdui-icon-login>
            Claude Pro/Max OAuth
          </mdui-button>
          <mdui-button
            class="auth-button secondary"
            :loading="anthropicLoading"
            @click="startAnthropicOAuth('console', 'api')"
          >
            <mdui-icon-key slot="icon"></mdui-icon-key>
            OAuth 创建 API Key
          </mdui-button>
        </div>
      </div>

      <div v-if="authError" class="auth-error">{{ authError }}</div>
    </div>

    <div class="chat-section">
      <div class="section-title">Conversation</div>
      <div class="messages">
        <div
          v-for="message in activeAgent?.messages"
          :key="message.id"
          class="message"
          :class="message.role"
        >
          <div class="bubble">
            <span class="role">{{ message.role }}</span>
            <pre>{{ message.content }}</pre>
          </div>
        </div>
      </div>
      <div class="input-row">
        <textarea
          v-model="messageInput"
          placeholder="Ask your agents..."
          @keydown.enter.exact.prevent="handleSend"
        ></textarea>
        <mdui-button class="send-button" @click="handleSend">发送</mdui-button>
      </div>
    </div>

    <div class="tasks-section" v-if="activeAgent?.tasks?.length">
      <div class="section-title">Tasks</div>
      <div v-for="task in activeAgent.tasks" :key="task.id" class="task-card">
        <div class="task-title">
          <span>{{ task.title }}</span>
          <span class="status" :class="task.status">{{ task.status }}</span>
        </div>
        <div v-for="step in task.steps" :key="step.id" class="task-step">
          <span class="step-name">{{ step.title }}</span>
          <span class="status" :class="step.status">{{ step.status }}</span>
        </div>
      </div>
    </div>

    <mdui-dialog :open="anthropicDialogOpen" @closed="anthropicDialogOpen = false">
      <div class="dialog-content">
        <h3>Anthropic OAuth</h3>
        <p>授权完成后粘贴授权码。</p>
        <mdui-text-field
          autofocus
          :value="anthropicCode"
          @input="(e: any) => anthropicCode = e.target.value"
          placeholder="Authorization code"
        ></mdui-text-field>
        <div class="dialog-actions">
          <mdui-button variant="tonal" @click="anthropicDialogOpen = false">取消</mdui-button>
          <mdui-button @click="completeAnthropicOAuth" :loading="anthropicLoading">完成</mdui-button>
        </div>
      </div>
    </mdui-dialog>
  </div>
</template>

<style scoped>
.agents-panel {
  display: flex;
  flex-direction: column;
  gap: 12px;
  height: 100%;
  padding: 10px;
  color: var(--mdui-color-on-surface, #eaeaea);
}

.panel-header {
  display: flex;
  align-items: center;
  justify-content: space-between;
}

.panel-header .title {
  font-size: 14px;
  font-weight: 600;
}

.agents-list {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.agent-item {
  display: flex;
  align-items: center;
  justify-content: space-between;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.03);
  cursor: pointer;
}

.agent-item.active {
  background: rgba(255, 255, 255, 0.08);
}

.agent-title {
  display: flex;
  align-items: center;
  gap: 6px;
}

.agent-icon {
  font-size: 16px;
}

.agent-title .name {
  font-size: 13px;
  font-weight: 600;
}

.agent-title .status {
  font-size: 10px;
  opacity: 0.7;
}

.agent-title .status.thinking {
  color: #ffcc66;
}

.agent-title .status.running-tools {
  color: #6ad4ff;
}

.agent-title .status.error {
  color: #ff6b6b;
}

.agent-config,
.auth-section {
  padding: 8px;
  border-radius: 10px;
  background: rgba(255, 255, 255, 0.03);
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.config-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.config-row label {
  font-size: 12px;
  opacity: 0.7;
}

.provider-card {
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
}

.provider-title {
  font-size: 12px;
  font-weight: 600;
  letter-spacing: 0.3px;
}

.auth-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.auth-button.secondary {
  opacity: 0.8;
}

.auth-error {
  font-size: 12px;
  color: #ff7b7b;
}

.section-title {
  font-size: 12px;
  text-transform: uppercase;
  letter-spacing: 0.8px;
  opacity: 0.7;
}

.chat-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
  flex: 1;
  min-height: 0;
}

.messages {
  flex: 1;
  overflow: auto;
  display: flex;
  flex-direction: column;
  gap: 8px;
  padding-right: 4px;
}

.message .bubble {
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.05);
}

.message.user .bubble {
  background: rgba(93, 173, 255, 0.2);
}

.message.assistant .bubble {
  background: rgba(123, 255, 202, 0.15);
}

.message.tool .bubble {
  background: rgba(255, 200, 123, 0.15);
}

.message pre {
  margin: 4px 0 0;
  white-space: pre-wrap;
  font-family: inherit;
  font-size: 12px;
}

.message .role {
  font-size: 10px;
  text-transform: uppercase;
  opacity: 0.6;
}

.input-row {
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.input-row textarea {
  width: 100%;
  min-height: 60px;
  resize: vertical;
  padding: 6px 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  color: inherit;
  border: 1px solid rgba(255, 255, 255, 0.08);
  font-size: 12px;
}

.send-button {
  align-self: flex-end;
}

.tasks-section {
  display: flex;
  flex-direction: column;
  gap: 8px;
}

.task-card {
  padding: 8px;
  border-radius: 8px;
  background: rgba(255, 255, 255, 0.04);
  display: flex;
  flex-direction: column;
  gap: 6px;
}

.task-title {
  display: flex;
  justify-content: space-between;
  font-size: 12px;
  font-weight: 600;
}

.task-step {
  display: flex;
  justify-content: space-between;
  font-size: 11px;
  opacity: 0.8;
}

.status.completed {
  color: #76e3a8;
}

.status.error {
  color: #ff7b7b;
}

.dialog-content {
  display: flex;
  flex-direction: column;
  gap: 12px;
  min-width: 320px;
}

.dialog-actions {
  display: flex;
  justify-content: flex-end;
  gap: 8px;
}
</style>
