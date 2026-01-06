<template>
  <div class="debug-console">
    <!-- 消息列表 -->
    <div class="messages-container" ref="messagesContainer">
      <div
        v-for="(msg, index) in debugStore.consoleMessages"
        :key="index"
        class="console-message"
        :class="msg.type"
      >
        <span class="message-prefix" v-if="msg.type === 'input'">&gt;</span>
        <span class="message-prefix" v-else-if="msg.type === 'output'">&lt;</span>
        <span class="message-content">{{ msg.message }}</span>
        <span class="message-source" v-if="msg.source">
          {{ getFileName(msg.source) }}{{ msg.line ? `:${msg.line}` : '' }}
        </span>
      </div>

      <div v-if="debugStore.consoleMessages.length === 0" class="empty-state">
        <p>调试控制台</p>
        <p class="hint">在下方输入表达式进行求值</p>
      </div>
    </div>

    <!-- 输入框 -->
    <div class="input-container">
      <span class="input-prefix">&gt;</span>
      <input
        ref="inputEl"
        v-model="inputValue"
        class="console-input"
        placeholder="输入表达式..."
        @keydown="handleKeydown"
        :disabled="!debugStore.isPaused"
      />
      <mdui-button-icon @click="clearConsole" title="清除控制台">
        <mdui-icon-delete></mdui-icon-delete>
      </mdui-button-icon>
    </div>
  </div>
</template>

<script setup lang="ts">
import { ref, watch, nextTick } from 'vue'
import { useDebugStore } from '@/stores/debug'

const debugStore = useDebugStore()

const inputValue = ref('')
const messagesContainer = ref<HTMLElement>()
const inputEl = ref<HTMLInputElement>()

// 历史记录
const history = ref<string[]>([])
const historyIndex = ref(-1)

// 自动滚动到底部
watch(() => debugStore.consoleMessages.length, () => {
  nextTick(() => {
    if (messagesContainer.value) {
      messagesContainer.value.scrollTop = messagesContainer.value.scrollHeight
    }
  })
})

async function handleKeydown(event: KeyboardEvent) {
  if (event.key === 'Enter' && inputValue.value.trim()) {
    const command = inputValue.value.trim()

    // 添加到历史
    history.value.unshift(command)
    if (history.value.length > 100) {
      history.value.pop()
    }
    historyIndex.value = -1

    // 执行命令
    await debugStore.executeInConsole(command)

    inputValue.value = ''
  } else if (event.key === 'ArrowUp') {
    // 上一条历史
    event.preventDefault()
    if (historyIndex.value < history.value.length - 1) {
      historyIndex.value++
      inputValue.value = history.value[historyIndex.value]
    }
  } else if (event.key === 'ArrowDown') {
    // 下一条历史
    event.preventDefault()
    if (historyIndex.value > 0) {
      historyIndex.value--
      inputValue.value = history.value[historyIndex.value]
    } else if (historyIndex.value === 0) {
      historyIndex.value = -1
      inputValue.value = ''
    }
  }
}

function clearConsole() {
  debugStore.clearConsole()
}

function getFileName(path: string): string {
  return path.split('/').pop() || path.split('\\').pop() || path
}
</script>

<style scoped>
.debug-console {
  height: 100%;
  display: flex;
  flex-direction: column;
  font-family: 'SF Mono', Monaco, Consolas, monospace;
  font-size: 12px;
}

.messages-container {
  flex: 1;
  overflow: auto;
  padding: 8px;
}

.console-message {
  display: flex;
  align-items: flex-start;
  padding: 2px 0;
  gap: 8px;
}

.console-message.error {
  color: var(--mdui-color-error);
  background: rgba(var(--mdui-color-error-rgb), 0.1);
  padding: 4px 8px;
  margin: 2px -8px;
}

.console-message.warning {
  color: var(--mdui-color-tertiary);
  background: rgba(var(--mdui-color-tertiary-rgb), 0.1);
  padding: 4px 8px;
  margin: 2px -8px;
}

.console-message.input {
  color: var(--mdui-color-primary);
}

.console-message.output {
  color: var(--mdui-color-on-surface);
}

.message-prefix {
  color: var(--mdui-color-outline);
  flex-shrink: 0;
  width: 16px;
}

.message-content {
  flex: 1;
  white-space: pre-wrap;
  word-break: break-word;
}

.message-source {
  color: var(--mdui-color-outline);
  font-size: 10px;
  flex-shrink: 0;
}

.empty-state {
  display: flex;
  flex-direction: column;
  align-items: center;
  justify-content: center;
  height: 100%;
  color: var(--mdui-color-outline);
  text-align: center;
}

.empty-state .hint {
  font-size: 11px;
  opacity: 0.7;
}

.input-container {
  display: flex;
  align-items: center;
  padding: 8px;
  border-top: 1px solid var(--mdui-color-outline-variant);
  gap: 8px;
}

.input-prefix {
  color: var(--mdui-color-primary);
  font-weight: bold;
}

.console-input {
  flex: 1;
  background: transparent;
  border: none;
  outline: none;
  color: var(--mdui-color-on-surface);
  font-family: inherit;
  font-size: inherit;
}

.console-input::placeholder {
  color: var(--mdui-color-outline);
}

.console-input:disabled {
  opacity: 0.5;
}
</style>
