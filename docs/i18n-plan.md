# Logos IDE i18n 计划

## 目标
- 提供基础的多语言能力（优先英文 + 中文），后续可扩展到更多语言。
- 支持“系统语言/手动选择”的切换，并可持久化。
- Renderer 与 Main Process 的 UI 文案统一走同一套翻译资源。

## 范围
- Renderer（Vue 3 + Pinia + MDUI）所有可见文本。
- Main Process：菜单、对话框、托盘/通知、更新提示。
- 预留给扩展/插件 UI 的本地化挂钩（后续阶段）。

## 技术选型（建议）
- Renderer：`vue-i18n`（Composition API）。
- Main Process：共享 JSON 资源 + 轻量 `t()` 辅助函数。
- 资源结构：`src/i18n/locales/{locale}.json` + `electron/i18n/locales/{locale}.json`（或共享 `resources/i18n/`）。

## 资源与组织
- 语言代码：`en-US`、`zh-CN`（首发），后续 `zh-TW`、`ja-JP` 等。
- Key 规则：模块化前缀（例如 `menu.file.open`、`settings.editor.tabSize`）。
- 避免在组件中拼接完整句子，使用参数插值（`{count}`、`{name}`）。

## 系统语言与用户选择
- 默认读取系统语言（Electron `app.getLocale()` / `app.getPreferredSystemLanguages()`）。
- Settings 中提供语言选择：`system` / 指定语言。
- 存储位置：现有设置体系（`src/stores/*` 对应配置持久化）。
- 渲染层热更新：切换语言后无需重启（主进程菜单可能需要重建）。

## Renderer 侧实施步骤
1. 引入 `vue-i18n` 并在 `src/main.ts` 注入。
2. 新建 `src/i18n/index.ts`，暴露 `i18n` 实例与 `t()`。
3. 核心页面替换硬编码文案（Settings、菜单、状态栏、面板标题）。
4. 全面替换组件中的硬编码文本，确保新增文案必须走 `t()`。

## Main Process 侧实施步骤
1. 新建 `electron/i18n/index.ts`，加载语言资源并提供 `t()`。
2. 菜单构建时调用 `t()`；语言变化时重建菜单。
3. 对话框、通知、更新提示文案统一改为 `t()`。
4. 通过 IPC 提供当前语言给 Renderer，必要时同步变更。

## Monaco / 编辑器相关
- 评估 Monaco 内置文本与错误提示的本地化支持。
- 如果需要国际化 Monaco UI，计划引入官方 nls 方案（后续阶段）。

## 工具与流程
- 增加简单的 `i18n` 校验脚本：检测缺失 key / 未使用 key。
- 逐步将文案从代码中抽离，先覆盖高频 UI。
- 文案变更通过 PR 评审，确保 key 一致与翻译完整。

## 阶段划分（建议）
1. **Phase 1**：基础 i18n 结构 + 英文/中文资源 + Settings 语言切换。
2. **Phase 2**：Main Process 菜单/对话框国际化；核心功能覆盖。
3. **Phase 3**：全量 UI 替换 + 工具化校验 + 额外语言支持。

## 风险与注意事项
- 硬编码文案分散在大量组件中，替换成本高，需分阶段推进。
- 主进程菜单/对话框更新需要统一的语言状态管理。
- 需要规范 key 命名，避免重复与歧义。
