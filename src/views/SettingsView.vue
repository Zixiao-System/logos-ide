<script setup lang="ts">
/**
 * 设置视图
 * 管理应用程序的各项设置
 */

import { computed } from 'vue'
import { useSettingsStore } from '@/stores/settings'
import { useThemeStore } from '@/stores/theme'
import type { CICDProvider } from '@/types/settings'

// 导入图标
import '@mdui/icons/dark-mode.js'
import '@mdui/icons/light-mode.js'
import '@mdui/icons/visibility.js'
import '@mdui/icons/visibility-off.js'

const settingsStore = useSettingsStore()
const themeStore = useThemeStore()

// 主题选项
const themeOptions = [
  { label: 'Logos Dark', value: 'lsp-dark' },
  { label: 'Logos Light', value: 'lsp-light' },
  { label: 'Monokai', value: 'monokai' },
  { label: 'GitHub Dark', value: 'github-dark' }
]

// CI/CD 提供者选项
const providerOptions = [
  { label: '无', value: 'none' },
  { label: 'GitHub Actions', value: 'github' },
  { label: 'GitLab CI', value: 'gitlab' }
]

// 深色模式
const darkMode = computed({
  get: () => themeStore.isDark,
  set: (value: boolean) => themeStore.setTheme(value ? 'dark' : 'light')
})

// 编辑器设置
const fontSize = computed({
  get: () => settingsStore.editor.fontSize,
  set: (value: number) => settingsStore.updateEditor({ fontSize: value })
})

const tabSize = computed({
  get: () => settingsStore.editor.tabSize,
  set: (value: number) => settingsStore.updateEditor({ tabSize: value })
})

const wordWrap = computed({
  get: () => settingsStore.editor.wordWrap,
  set: (value: boolean) => settingsStore.updateEditor({ wordWrap: value })
})

const minimap = computed({
  get: () => settingsStore.editor.minimap,
  set: (value: boolean) => settingsStore.updateEditor({ minimap: value })
})

const autoSave = computed({
  get: () => settingsStore.editor.autoSave,
  set: (value: boolean) => settingsStore.updateEditor({ autoSave: value })
})

const colorTheme = computed({
  get: () => settingsStore.editor.colorTheme,
  set: (value: string) => settingsStore.updateEditor({
    colorTheme: value as 'lsp-dark' | 'lsp-light' | 'monokai' | 'github-dark'
  })
})

// DevOps 设置
const cicdProvider = computed({
  get: () => settingsStore.devops.provider,
  set: (value: string) => settingsStore.setProvider(value as CICDProvider)
})

const githubToken = computed({
  get: () => settingsStore.devops.githubToken,
  set: (value: string) => settingsStore.setGitHubToken(value)
})

const gitlabToken = computed({
  get: () => settingsStore.devops.gitlabToken,
  set: (value: string) => settingsStore.setGitLabToken(value)
})

const gitlabUrl = computed({
  get: () => settingsStore.devops.gitlabUrl,
  set: (value: string) => settingsStore.setGitLabUrl(value)
})

const buildNotifications = computed({
  get: () => settingsStore.devops.buildNotifications,
  set: (value: boolean) => settingsStore.updateDevOps({ buildNotifications: value })
})

// 从 package.json 动态读取版本号
import pkg from '../../package.json'
const appVersion = pkg.version
</script>

<template>
  <div class="settings-view">
    <h1>设置</h1>

    <!-- 外观设置 -->
    <mdui-card variant="outlined" class="settings-section">
      <h2>外观</h2>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">深色模式</span>
          <span class="setting-description">使用深色主题</span>
        </div>
        <mdui-switch :checked="darkMode" @change="darkMode = !darkMode"></mdui-switch>
      </div>

      <mdui-divider></mdui-divider>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">颜色主题</span>
          <span class="setting-description">选择编辑器配色方案</span>
        </div>
        <mdui-select :value="colorTheme" @change="(e: any) => colorTheme = e.target.value">
          <mdui-menu-item
            v-for="theme in themeOptions"
            :key="theme.value"
            :value="theme.value"
          >
            {{ theme.label }}
          </mdui-menu-item>
        </mdui-select>
      </div>
    </mdui-card>

    <!-- 编辑器设置 -->
    <mdui-card variant="outlined" class="settings-section">
      <h2>编辑器</h2>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">字体大小</span>
          <span class="setting-description">编辑器字体大小 ({{ fontSize }}px)</span>
        </div>
        <mdui-slider
          :value="fontSize"
          :min="10"
          :max="24"
          :step="1"
          labeled
          @change="(e: any) => fontSize = Number(e.target.value)"
        ></mdui-slider>
      </div>

      <mdui-divider></mdui-divider>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">Tab 大小</span>
          <span class="setting-description">缩进空格数</span>
        </div>
        <mdui-segmented-button-group :value="String(tabSize)" @change="(e: any) => tabSize = Number(e.target.value)">
          <mdui-segmented-button value="2">2</mdui-segmented-button>
          <mdui-segmented-button value="4">4</mdui-segmented-button>
          <mdui-segmented-button value="8">8</mdui-segmented-button>
        </mdui-segmented-button-group>
      </div>

      <mdui-divider></mdui-divider>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">自动换行</span>
          <span class="setting-description">长行自动折行显示</span>
        </div>
        <mdui-switch :checked="wordWrap" @change="wordWrap = !wordWrap"></mdui-switch>
      </div>

      <mdui-divider></mdui-divider>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">迷你地图</span>
          <span class="setting-description">显示代码缩略图</span>
        </div>
        <mdui-switch :checked="minimap" @change="minimap = !minimap"></mdui-switch>
      </div>

      <mdui-divider></mdui-divider>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">自动保存</span>
          <span class="setting-description">失去焦点时自动保存</span>
        </div>
        <mdui-switch :checked="autoSave" @change="autoSave = !autoSave"></mdui-switch>
      </div>
    </mdui-card>

    <!-- DevOps 设置 -->
    <mdui-card variant="outlined" class="settings-section">
      <h2>DevOps / CI/CD</h2>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">CI/CD 平台</span>
          <span class="setting-description">选择持续集成平台</span>
        </div>
        <mdui-select :value="cicdProvider" @change="(e: any) => cicdProvider = e.target.value">
          <mdui-menu-item
            v-for="provider in providerOptions"
            :key="provider.value"
            :value="provider.value"
          >
            {{ provider.label }}
          </mdui-menu-item>
        </mdui-select>
      </div>

      <!-- GitHub 配置 -->
      <template v-if="cicdProvider === 'github'">
        <mdui-divider></mdui-divider>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">GitHub Token</span>
            <span class="setting-description">Personal Access Token (需要 repo 和 workflow 权限)</span>
          </div>
          <mdui-text-field
            :value="githubToken"
            type="password"
            variant="outlined"
            placeholder="ghp_xxxxxxxxxxxx"
            @input="(e: any) => githubToken = e.target.value"
          ></mdui-text-field>
        </div>
      </template>

      <!-- GitLab 配置 -->
      <template v-if="cicdProvider === 'gitlab'">
        <mdui-divider></mdui-divider>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">GitLab URL</span>
            <span class="setting-description">GitLab 服务器地址 (支持自托管)</span>
          </div>
          <mdui-text-field
            :value="gitlabUrl"
            variant="outlined"
            placeholder="https://gitlab.com"
            @input="(e: any) => gitlabUrl = e.target.value"
          ></mdui-text-field>
        </div>

        <mdui-divider></mdui-divider>
        <div class="setting-item">
          <div class="setting-info">
            <span class="setting-label">GitLab Token</span>
            <span class="setting-description">Personal Access Token (需要 api 权限)</span>
          </div>
          <mdui-text-field
            :value="gitlabToken"
            type="password"
            variant="outlined"
            placeholder="glpat-xxxxxxxxxxxx"
            @input="(e: any) => gitlabToken = e.target.value"
          ></mdui-text-field>
        </div>
      </template>

      <mdui-divider></mdui-divider>

      <div class="setting-item">
        <div class="setting-info">
          <span class="setting-label">构建通知</span>
          <span class="setting-description">流水线完成时通知</span>
        </div>
        <mdui-switch :checked="buildNotifications" @change="buildNotifications = !buildNotifications"></mdui-switch>
      </div>
    </mdui-card>

    <!-- 关于 -->
    <mdui-card variant="outlined" class="settings-section about-section">
      <h2>关于</h2>
      <div class="about-content">
        <div class="about-logo">
          <span class="logo-text">Logos</span>
        </div>
        <div class="about-info">
          <p class="version">版本 {{ appVersion }}</p>
          <p class="copyright">© 2025～2026 Zixiao System</p>
        </div>
      </div>
    </mdui-card>
  </div>
</template>

<style scoped>
.settings-view {
  padding: 24px;
  max-width: 800px;
  margin: 0 auto;
  height: 100%;
  overflow-y: auto;
}

.settings-view h1 {
  margin-bottom: 24px;
  font-size: 1.75rem;
  font-weight: 500;
}

.settings-section {
  padding: 20px;
  margin-bottom: 16px;
}

.settings-section h2 {
  margin: 0 0 16px 0;
  font-size: 1.125rem;
  font-weight: 500;
  color: var(--mdui-color-primary);
}

.setting-item {
  display: flex;
  justify-content: space-between;
  align-items: center;
  padding: 12px 0;
}

.setting-info {
  display: flex;
  flex-direction: column;
  gap: 4px;
}

.setting-label {
  font-weight: 500;
}

.setting-description {
  font-size: 0.875rem;
  color: var(--mdui-color-on-surface-variant);
}

mdui-slider {
  width: 200px;
}

mdui-text-field {
  width: 300px;
}

mdui-select {
  width: 200px;
}

.about-section {
  text-align: center;
}

.about-content {
  display: flex;
  flex-direction: column;
  align-items: center;
  gap: 16px;
}

.about-logo {
  display: flex;
  flex-direction: column;
  align-items: center;
}

.logo-text {
  font-size: 2rem;
  font-weight: 700;
  color: var(--mdui-color-primary);
}

.logo-subtitle {
  font-size: 1rem;
  color: var(--mdui-color-on-surface-variant);
}

.about-info {
  color: var(--mdui-color-on-surface-variant);
}

.about-info p {
  margin: 4px 0;
}

.about-info .version {
  font-weight: 500;
}

.about-info .copyright {
  font-size: 0.875rem;
}
</style>
