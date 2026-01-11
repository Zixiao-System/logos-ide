<script setup lang="ts">
/**
 * LSP 设置对话框
 * 在遥测同意后显示，帮助用户配置代码智能功能
 */

import { computed, ref } from 'vue'
import { useSettingsStore } from '@/stores/settings'

// 导入图标
import '@mdui/icons/code.js'
import '@mdui/icons/check-circle.js'
import '@mdui/icons/speed.js'
import '@mdui/icons/memory.js'

const settingsStore = useSettingsStore()

const showDialog = computed(() => settingsStore.shouldShowLSPSetup)
const selectedMode = ref<'basic' | 'smart'>('basic')

const handleConfirm = () => {
  settingsStore.setLSPMode(selectedMode.value)
  settingsStore.dismissLSPSetup()
}

const handleSkip = () => {
  settingsStore.dismissLSPSetup()
}
</script>

<template>
  <mdui-dialog
    :open="showDialog"
    headline="代码智能设置"
    close-on-overlay-click="false"
    close-on-esc="false"
  >
    <div class="setup-content">
      <div class="setup-icon">
        <mdui-icon-code></mdui-icon-code>
      </div>

      <div class="setup-body">
        <p class="setup-intro">
          选择代码智能模式以获得更好的开发体验。
        </p>

        <div class="mode-options">
          <div
            class="mode-card"
            :class="{ selected: selectedMode === 'basic' }"
            @click="selectedMode = 'basic'"
          >
            <div class="mode-header">
              <mdui-icon-speed></mdui-icon-speed>
              <span class="mode-title">Basic 模式</span>
              <mdui-icon-check-circle v-if="selectedMode === 'basic'" class="check-icon"></mdui-icon-check-circle>
            </div>
            <p class="mode-desc">使用标准 LSP 协议，快速启动，资源占用低</p>
            <ul class="mode-features">
              <li>代码补全</li>
              <li>跳转定义</li>
              <li>查找引用</li>
              <li>悬停提示</li>
            </ul>
            <p class="mode-note">需要安装对应语言的 LSP 服务器</p>
          </div>

          <div
            class="mode-card"
            :class="{ selected: selectedMode === 'smart' }"
            @click="selectedMode = 'smart'"
          >
            <div class="mode-header">
              <mdui-icon-memory></mdui-icon-memory>
              <span class="mode-title">Smart 模式</span>
              <mdui-icon-check-circle v-if="selectedMode === 'smart'" class="check-icon"></mdui-icon-check-circle>
            </div>
            <p class="mode-desc">全量索引，类似 JetBrains 的智能体验</p>
            <ul class="mode-features">
              <li>安全重构</li>
              <li>调用层级</li>
              <li>影响分析</li>
              <li>跨项目搜索</li>
            </ul>
            <p class="mode-note">需要更多内存，首次启动较慢</p>
          </div>
        </div>

        <div class="lsp-servers">
          <h4>常用 LSP 服务器安装</h4>
          <div class="server-list">
            <code>npm i -g typescript-language-server typescript</code>
            <code>pip install pyright</code>
            <code>go install golang.org/x/tools/gopls@latest</code>
          </div>
        </div>

        <p class="setup-note">
          您可以随时在设置页面中更改此选项。
        </p>
      </div>
    </div>

    <mdui-button
      slot="action"
      variant="text"
      @click="handleSkip"
    >
      稍后设置
    </mdui-button>
    <mdui-button
      slot="action"
      variant="filled"
      @click="handleConfirm"
    >
      确认
    </mdui-button>
  </mdui-dialog>
</template>

<style scoped>
.setup-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
  padding: 8px 0;
}

.setup-icon {
  font-size: 48px;
  color: var(--mdui-color-primary);
}

.setup-icon mdui-icon-code {
  font-size: 48px;
}

.setup-body {
  width: 100%;
}

.setup-intro {
  font-size: 1rem;
  line-height: 1.6;
  margin-bottom: 16px;
  text-align: center;
}

.mode-options {
  display: flex;
  gap: 12px;
  margin-bottom: 16px;
}

.mode-card {
  flex: 1;
  background: var(--mdui-color-surface-container);
  border: 2px solid transparent;
  border-radius: 12px;
  padding: 16px;
  cursor: pointer;
  transition: all 0.2s ease;
}

.mode-card:hover {
  border-color: var(--mdui-color-outline);
}

.mode-card.selected {
  border-color: var(--mdui-color-primary);
  background: var(--mdui-color-surface-container-high);
}

.mode-header {
  display: flex;
  align-items: center;
  gap: 8px;
  margin-bottom: 8px;
}

.mode-header mdui-icon-speed,
.mode-header mdui-icon-memory {
  font-size: 20px;
  color: var(--mdui-color-primary);
}

.mode-title {
  font-weight: 600;
  font-size: 1rem;
  flex: 1;
}

.check-icon {
  color: var(--mdui-color-primary);
  font-size: 20px;
}

.mode-desc {
  font-size: 0.875rem;
  color: var(--mdui-color-on-surface-variant);
  margin: 0 0 12px 0;
}

.mode-features {
  margin: 0 0 12px 0;
  padding-left: 16px;
  font-size: 0.8rem;
  color: var(--mdui-color-on-surface);
}

.mode-features li {
  padding: 2px 0;
}

.mode-note {
  font-size: 0.75rem;
  color: var(--mdui-color-outline);
  margin: 0;
  font-style: italic;
}

.lsp-servers {
  background: var(--mdui-color-surface-container);
  border-radius: 8px;
  padding: 12px 16px;
  margin-bottom: 16px;
}

.lsp-servers h4 {
  font-size: 0.875rem;
  font-weight: 500;
  margin: 0 0 8px 0;
  color: var(--mdui-color-on-surface);
}

.server-list {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.server-list code {
  font-size: 0.75rem;
  background: var(--mdui-color-surface);
  padding: 4px 8px;
  border-radius: 4px;
  font-family: 'Fira Code', 'SF Mono', Monaco, monospace;
  color: var(--mdui-color-on-surface-variant);
}

.setup-note {
  font-size: 0.875rem;
  color: var(--mdui-color-on-surface-variant);
  text-align: center;
  margin: 0;
}
</style>
