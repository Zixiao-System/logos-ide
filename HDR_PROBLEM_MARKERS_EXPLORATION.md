# Logos IDE HDR 问题标记完整探索

## 📖 目录
1. [项目概述](#项目概述)
2. [现有系统分析](#现有系统分析)
3. [诊断系统详解](#诊断系统详解)
4. [HDR 支持方案](#hdr-支持方案)
5. [VS Code 对标分析](#vs-code-对标分析)
6. [实现路线图](#实现路线图)

---

## 项目概述

### 背景

Logos IDE 是一个现代化的代码编辑器，使用 Vue 3 + Electron + Monaco Editor。用户希望在 IDE 中使用 HDR（High Dynamic Range，高动态范围）技术来标记代码问题，达到类似 VS Code 的红线和问题面板的功能，同时支持 Apple EDR（Extended Dynamic Range），并在不支持的设备上优雅回退。

### 需求分析

```
要求：
├─ 类似 VS Code 的问题标记方式（红线 + 问题面板）
├─ 支持 Apple EDR 显示
├─ 不支持设备上的优雅回退
├─ 高性能、低资源占用
└─ 与现有系统集成
```

---

## 现有系统分析

### 整体架构

Logos IDE 的诊断系统分为三层：

```
应用层 (Vue 3 Components)
    ↓
诊断管理层 (DiagnosticsManager + IntelligenceManager)
    ↓
诊断源层 (TypeScript + LSP + Daemon)
```

### 关键组件

#### 1. DiagnosticsManager (src/services/lsp/DiagnosticsManager.ts)

**职责**: 管理 Monaco Editor 中的诊断标记生命周期

```typescript
// 核心方法
class DiagnosticsManager {
  // 注册诊断到 Monaco
  setDiagnostics(model: ITextModel, diagnostics: Diagnostic[])
  
  // 清除诊断
  clearDiagnostics(modelId: string)
  
  // 转换诊断严重级别
  private convertSeverity(severity: string): MarkerSeverity
  
  // 获取统计信息
  getStats(): DiagnosticStats
}
```

**工作流**:
1. 接收 `Diagnostic[]` 数组
2. 将 'error' | 'warning' | 'info' | 'hint' 转换为 Monaco 的 `MarkerSeverity` 枚举
3. 调用 `monaco.editor.setModelMarkers(model, 'owner-id', markers)`
4. Monaco 自动渲染波浪线、Glyph Margin 图标、Minimap 指示

**颜色映射**:
| 严重级别 | Monaco 颜色 | 典型值 |
|---------|-----------|-------|
| Error | 红色 (#F48771) | RGB |
| Warning | 黄色 (#DDB100) | RGB |
| Info | 蓝色 (#3FB0D0) | RGB |
| Hint | 灰色 (#A9A9A9) | RGB |

#### 2. IntelligenceManager (src/services/lsp/IntelligenceManager.ts)

**职责**: 智能诊断路由 - 根据文件类型选择最合适的诊断源

```typescript
async updateDiagnostics(model: ITextModel) {
  const filePath = model.uri.fsPath
  
  if (this.isNativeLanguage(filePath)) {
    // .ts, .tsx, .js, .jsx → TypeScript Language Service
    const diagnostics = await this.getTypeScriptDiagnostics(filePath)
    diagnosticsManager.setDiagnostics(model, diagnostics)
  } 
  else if (this.isDaemonLanguage(filePath)) {
    // .logos → Logos Daemon (Smart Mode only)
    const diagnostics = await this.getDaemonDiagnostics(filePath)
    diagnosticsManager.setDiagnostics(model, diagnostics)
  } 
  else if (this.isSupported(filePath)) {
    // 其他语言 → LSP 服务器
    const diagnostics = await this.getLSPDiagnostics(filePath)
    diagnosticsManager.setDiagnostics(model, diagnostics)
  }
}

private isNativeLanguage(filePath: string): boolean {
  return /\.(ts|tsx|js|jsx)$/.test(filePath)
}

private isDaemonLanguage(filePath: string): boolean {
  return filePath.endsWith('.logos') && this.isSmartMode
}

private isSupported(filePath: string): boolean {
  // 检查 LSP 服务器是否支持该文件类型
  return this.lspRegistry.hasServer(filePath)
}
```

**路由决策树**:
```
文件类型检查
    ├─ TypeScript/JavaScript? → TypeScript API (最快)
    ├─ Logos 文件 + Smart Mode? → Daemon (最功能丰富)
    ├─ 其他语言 + LSP? → LSP 服务器 (通用)
    └─ 不支持 → 无诊断
```

#### 3. 编辑器集成 (EditorView.vue)

**防抖机制** (行 226-235):
```typescript
let diagnosticsTimer: NodeJS.Timeout | null = null

editor.onDidChangeModelContent(() => {
  if (diagnosticsTimer) clearTimeout(diagnosticsTimer)
  diagnosticsTimer = setTimeout(() => {
    intelligenceManager.updateDiagnostics(model)
  }, 500) // 500ms 防抖
})
```

**为什么需要防抖？**
- 用户快速打字时频繁触发诊断请求
- LSP 服务器可能占用高 CPU
- 500ms 是输入延迟感知的临界值

---

## 诊断系统详解

### 问题渲染位置

#### 1. **编辑器内渲染** (自动)

![编辑器问题标记示意]

```
Error in code line:

1  const x = 
2              ↑ (波浪线：Expected ';')
```

- **波浪线**: 不同颜色标示严重级别
- **Glyph Margin**: 左侧圆点图标，鼠标悬停显示详情
- **Minimap**: 右侧条纹显示问题分布

#### 2. **问题面板** (BottomPanel.vue)

当前状态: 框架存在，数据绑定未实现

```vue
<!-- 行 136-142: 当前实现 -->
<div v-show="bottomPanelStore.activeTab === 'problems'" class="problems-panel">
  <div class="empty-message">暂无问题</div>
</div>

<!-- 应该实现的 -->
<div class="problems-panel">
  <!-- 严重错误 -->
  <div class="problems-group error">
    <h3>Errors (3)</h3>
    <div v-for="diagnostic in errorDiagnostics" class="problem-item">
      <span class="file-path">{{ diagnostic.source }}</span>
      <span class="message">{{ diagnostic.message }}</span>
      <span class="location">({{ diagnostic.range.start.line + 1 }}:{{ diagnostic.range.start.character }})</span>
    </div>
  </div>
  
  <!-- 警告 -->
  <div class="problems-group warning">
    <h3>Warnings (5)</h3>
    <!-- 类似结构 -->
  </div>
</div>
```

**待实现功能**:
- ✅ 按严重级别分组
- ✅ 统计错误/警告/提示数量
- ✅ 点击定位到对应位置
- ✅ 搜索和过滤
- ✅ 展开/折叠分组

### 诊断类型 (src/types/intelligence.ts)

```typescript
interface Diagnostic {
  // 问题位置
  range: {
    start: { line: number; character: number }  // 0-based (like Monaco)
    end: { line: number; character: number }
  }
  
  // 问题消息
  message: string
  
  // 严重级别: error | warning | info | hint
  severity: DiagnosticSeverity
  
  // 诊断代码 (可选)
  code?: string | number  // e.g., 'TS1234', 'E001'
  
  // 源标识
  source?: string  // e.g., 'typescript', 'eslint', 'daemon', 'rust-analyzer'
  
  // 相关信息 (可选)
  relatedInformation?: Array<{
    location: { uri: string; range: Range }
    message: string
  }>
}
```

### 三种诊断模式详解

#### Mode 1: 原生 TypeScript 诊断

**触发条件**: .ts, .tsx, .js, .jsx 文件

**过程**:
```
编辑 TS 文件
    ↓
Electron main process
    ↓
TypeScript Language Service API (electron/services/intelligenceService.ts)
    ↓
TS 编译器诊断
    ├─ 语法错误 (syntactic)
    ├─ 类型错误 (semantic)
    └─ 建议 (suggestion)
    ↓
转换为 Logos 诊断格式
    ↓
IPC 返回到 renderer
    ↓
DiagnosticsManager.setDiagnostics()
```

**优点**:
- 最快 (直接编译器 API)
- 最准确 (官方 TS 诊断)
- 支持完整的 TS 特性

**缺点**:
- 仅支持 TypeScript/JavaScript
- 内存占用中等

#### Mode 2: Smart Mode (Logos Daemon)

**触发条件**: .logos 文件 + Smart Mode 启用

**过程**:
```
编辑 Logos 文件
    ↓
500ms 防抖
    ↓
DaemonLanguageService.getDiagnostics()
    ↓
Logos Daemon RPC
    ↓
Logos 编译器分析
    ├─ 语法检查
    ├─ 类型推导
    ├─ 符号检查
    └─ 最佳实践建议
    ↓
诊断信息返回
    ↓
DiagnosticsManager.setDiagnostics()
```

**优点**:
- 深度分析能力 (自定义规则)
- 高准确度 (自实现编译器)

**缺点**:
- 仅支持 Logos 语言
- 内存占用高 (Daemon 进程)
- 需要保持进程运行

#### Mode 3: Basic Mode (LSP 服务器)

**触发条件**: 其他语言 (Rust, Go, Python, C++) + Basic Mode

**过程**:
```
编辑其他语言文件
    ↓
LSP 客户端
    ↓
LSP 服务器 (独立进程)
    ├─ rust-analyzer (Rust)
    ├─ gopls (Go)
    ├─ pylance (Python)
    └─ clangd (C++)
    ↓
诊断信息推送
    ↓
DiagnosticsManager.setDiagnostics()
```

**优点**:
- 支持多语言 (任何有 LSP 实现的语言)
- 诊断质量由语言社区维护

**缺点**:
- 需要启动多个外部进程
- 内存占用取决于服务器
- 延迟可能较高

### 监控和调试

#### 获取诊断统计

```typescript
const stats = diagnosticsManager.getStats()
console.log(stats)
// {
//   errors: 12,
//   warnings: 45,
//   hints: 8,
//   total: 65
// }
```

#### 在控制台查看诊断

```typescript
// 调试: 查看 IntelligenceManager 路由决策
const filePath = '/path/to/file.ts'
console.log(`Native: ${intelligenceManager.isNativeLanguage(filePath)}`)
console.log(`Daemon: ${intelligenceManager.isDaemonLanguage(filePath)}`)
console.log(`Supported: ${intelligenceManager.isSupported(filePath)}`)
```

---

## HDR 支持方案

### HDR 原理

HDR (High Dynamic Range) 允许显示器展示更大的亮度范围和更广的色域，带来：
- **更鲜艳的颜色** (饱和度更高)
- **更好的阴影细节** (深色更暗，细节更清楚)
- **更亮的高光** (不损失细节)

### 现代浏览器 HDR 支持

#### CSS Color Module Level 4

```css
/* Display-P3 色域 (Apple 设备) */
.error { color: color(display-p3 1 0.2 0.2); }

/* Rec2020 色域 (高端显示器) */
.error { color: color(rec2020 0.95 0.15 0.15); }

/* 回退到 sRGB */
.error { color: rgb(255, 51, 51); }
```

#### 媒体查询检测

```css
/* 检测设备支持的色域 */
@media (color-gamut: display-p3) {
  /* 在 iPad Pro, 新款 Mac 上应用 Display-P3 颜色 */
}

@media (color-gamut: rec2020) {
  /* 在高端显示器上应用 Rec2020 颜色 */
}

@media (color-gamut: srgb) {
  /* 标准显示器，使用 sRGB */
}
```

#### Canvas HDR 支持

```javascript
const canvas = document.createElement('canvas')
const ctx = canvas.getContext('2d', {
  colorSpace: 'display-p3'  // 或 'rec2020'
})

// 使用 Display-P3 颜色
ctx.fillStyle = 'color(display-p3 1 0.2 0.2)'
```

### 5 阶段实现方案

#### Phase 1: HDR 能力检测

```typescript
// src/utils/hdrCapabilities.ts

export class HDRDetector {
  private static capabilities: HDRCapabilities | null = null
  
  static getCapabilities(): HDRCapabilities {
    if (this.capabilities) return this.capabilities
    
    const capabilities = {
      // CSS color() 函数支持
      cssColorFunction: this.supportsCSSColorFunction(),
      
      // 媒体查询支持
      displayP3: this.supportsMediaQuery('(color-gamut: display-p3)'),
      rec2020: this.supportsMediaQuery('(color-gamut: rec2020)'),
      
      // Canvas HDR 支持
      canvasHDR: this.supportsCanvasHDR(),
      
      // 当前色域
      currentGamut: this.getCurrentGamut()
    }
    
    this.capabilities = capabilities
    return capabilities
  }
  
  private static supportsCSSColorFunction(): boolean {
    const el = document.createElement('div')
    el.style.color = 'color(display-p3 1 0 0)'
    return el.style.color !== ''
  }
  
  private static supportsMediaQuery(query: string): boolean {
    return window.matchMedia(query).matches
  }
  
  private static supportsCanvasHDR(): boolean {
    const canvas = document.createElement('canvas')
    try {
      const ctx = canvas.getContext('2d', { colorSpace: 'display-p3' })
      return ctx !== null
    } catch {
      return false
    }
  }
  
  private static getCurrentGamut(): 'srgb' | 'display-p3' | 'rec2020' {
    if (window.matchMedia('(color-gamut: rec2020)').matches) return 'rec2020'
    if (window.matchMedia('(color-gamut: display-p3)').matches) return 'display-p3'
    return 'srgb'
  }
}

interface HDRCapabilities {
  cssColorFunction: boolean
  displayP3: boolean
  rec2020: boolean
  canvasHDR: boolean
  currentGamut: 'srgb' | 'display-p3' | 'rec2020'
}
```

#### Phase 2: 诊断颜色系统

```typescript
// src/utils/diagnosticColors.ts

export class DiagnosticColors {
  static getErrorColor(gamut: string): string {
    switch (gamut) {
      case 'rec2020':
        return 'color(rec2020 0.95 0.1 0.1)'  // 最亮的红
      case 'display-p3':
        return 'color(display-p3 1 0.15 0.15)'  // 鲜艳的红
      default:
        return '#ff3333'  // sRGB 回退
    }
  }
  
  static getWarningColor(gamut: string): string {
    switch (gamut) {
      case 'rec2020':
        return 'color(rec2020 0.95 0.8 0.1)'
      case 'display-p3':
        return 'color(display-p3 1 0.9 0.15)'
      default:
        return '#ddaa00'
    }
  }
  
  static getInfoColor(gamut: string): string {
    switch (gamut) {
      case 'rec2020':
        return 'color(rec2020 0.2 0.8 0.95)'
      case 'display-p3':
        return 'color(display-p3 0.2 0.85 1)'
      default:
        return '#3399ff'
    }
  }
  
  static getHintColor(gamut: string): string {
    switch (gamut) {
      case 'rec2020':
        return 'color(rec2020 0.5 0.5 0.5)'
      case 'display-p3':
        return 'color(display-p3 0.6 0.6 0.6)'
      default:
        return '#999999'
    }
  }
}
```

#### Phase 3: Monaco 主题集成

```typescript
// 在 theme.ts 中扩展主题系统

export function createMonacoThemeWithHDR(isDark: boolean) {
  const hdrCapabilities = HDRDetector.getCapabilities()
  const gamut = hdrCapabilities.currentGamut
  
  return {
    base: isDark ? 'vs-dark' : 'vs',
    inherit: true,
    rules: [
      {
        token: 'error',
        foreground: DiagnosticColors.getErrorColor(gamut)
      },
      {
        token: 'warning',
        foreground: DiagnosticColors.getWarningColor(gamut)
      },
      // ... 更多规则
    ]
  }
}
```

#### Phase 4: 问题面板 HDR 样式

```vue
<!-- ProblemsPanel.vue 中的 CSS -->
<style scoped>
.problems-group.error {
  /* 支持 HDR */
  background-color: color(display-p3 1 0.2 0.2 / 0.1);
  border-left-color: color(display-p3 1 0.15 0.15);
  
  /* 回退到 sRGB */
  @supports not (color(display-p3 1 0 0)) {
    background-color: rgba(255, 51, 51, 0.1);
    border-left-color: #ff3333;
  }
}

.problems-group.warning {
  background-color: color(display-p3 1 0.9 0.15 / 0.1);
  border-left-color: color(display-p3 1 0.85 0.1);
  
  @supports not (color(display-p3 1 0 0)) {
    background-color: rgba(221, 170, 0, 0.1);
    border-left-color: #ddaa00;
  }
}
</style>
```

#### Phase 5: 测试和文档

**测试清单**:
- [ ] M1/M2 Mac 上的 Display-P3 渲染
- [ ] iPad Pro (ProMotion) 上的 Display-P3
- [ ] 标准显示器的 sRGB 回退
- [ ] Windows HDR 支持 (Rec2020 仿真)
- [ ] 颜色可访问性 (WCAG AA 对比度)

**文档**:
- HDR 用户指南
- 开发者颜色指南
- 色域检测调试步骤

---

## VS Code 对标分析

### 功能对比

| 功能 | Logos IDE | VS Code | 优势方 |
|------|-----------|---------|--------|
| **诊断来源** | 多源 (TS/LSP/Daemon) | LSP 为主 | **Logos** (灵活性) |
| **防抖优化** | 500ms | 配置可调 | 平手 |
| **问题面板** | 框架仅 | 完整功能 | **VS Code** |
| **快速修复** | LSP 支持但无 UI | 完整实现 | **VS Code** |
| **主题系统** | MDUI 动态色 | 固定色 | **Logos** |
| **HDR 支持** | 可实现 | 无 | **Logos** (若实现) |
| **Smart Mode** | 有 (Logos) | 无 | **Logos** |

### 设计决策对比

#### VS Code 方式

```
LSP Protocol (标准化)
    ↓
所有诊断统一处理
    ↓
问题面板
    ├─ 按文件分组
    ├─ 按严重级别分组
    └─ 完整搜索/过滤
```

**优点**: 简单、通用
**缺点**: 无法利用特定语言的优化

#### Logos IDE 方式

```
多源诊断 + 智能路由
    ↓
为每种语言选择最优策略
    ├─ TypeScript: 原生 API
    ├─ Logos: Daemon
    └─ 其他: LSP
```

**优点**: 性能更好、功能更丰富
**缺点**: 复杂度更高

### 可学习的特性

从 VS Code 学习：
- ✅ **问题面板分组**: 按文件、按严重级别、按来源
- ✅ **快速修复 UI**: lightbulb 图标、建议列表
- ✅ **代码操作**: 不仅修复诊断，还有其他代码操作

Logos IDE 的优势：
- 🎯 **多源诊断路由**: 对不同语言的最佳实践
- 🎯 **Smart Mode**: 通过自定义 Daemon 提供深度分析
- 🎯 **HDR 支持**: 现代显示器的最佳体验

---

## 实现路线图

### 短期 (1-2 周)

**目标**: 完成问题面板功能

```markdown
## 任务列表

- [ ] 创建 ProblemsPanel.vue 组件
  - 按严重级别分组
  - 实现展开/折叠
  - 添加统计信息
  
- [ ] 数据绑定
  - 连接 intelligenceStore.diagnostics
  - 响应诊断更新
  
- [ ] 用户交互
  - 点击定位到问题位置
  - 搜索和过滤
  - 清除诊断
  
- [ ] 样式调整
  - 图标和颜色
  - 深色主题支持
```

**预计耗时**: 2-3 天

### 中期 (2-4 周)

**目标**: 集成快速修复

```markdown
## 任务列表

- [ ] CodeAction UI
  - lightbulb 图标
  - 建议列表
  
- [ ] 修复应用
  - 文本编辑 API
  - 多重编辑支持
  
- [ ] 测试
  - 单元测试
  - 集成测试
```

**预计耗时**: 2-3 周

### 长期 (1-3 个月)

**目标**: HDR 支持全量实现

```markdown
## 分阶段计划

Phase 1 (1 天): 能力检测 + 基础颜色
Phase 2 (1 天): 编辑器主题集成
Phase 3 (2 天): 问题面板样式
Phase 4 (2 天): Canvas 和特效
Phase 5 (2 天): 测试和文档
```

**预计耗时**: 8-10 天核心开发 + 文档和测试

---

## 总结

Logos IDE 已经具备：
- ✅ 强大的多源诊断系统
- ✅ 现代化的主题架构
- ✅ 良好的 Monaco 集成

需要补完的：
- ⚠️ 问题面板 UI (框架仅)
- ⚠️ 快速修复集成
- ⚠️ HDR 支持

通过按照本文档的计划实现这些功能，Logos IDE 可以成为代码诊断体验上**超越 VS Code** 的编辑器。

特别是 HDR 支持，这是 VS Code 目前完全没有的功能，可以成为 Logos IDE 的重要差异化优势。
