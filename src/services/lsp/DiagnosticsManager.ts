/**
 * 诊断管理器
 * 负责管理 Monaco Editor 的诊断信息（错误、警告等）
 */

import * as monaco from 'monaco-editor'
import type { Diagnostic } from '@/types/intelligence.ts'

export class DiagnosticsManager {
  private markers: Map<string, monaco.editor.IMarkerData[]> = new Map()

  /**
   * 设置诊断信息
   */
  setDiagnostics(model: monaco.editor.ITextModel, diagnostics: Diagnostic[]): void {
    const markers: monaco.editor.IMarkerData[] = diagnostics.map(diag => ({
      severity: this.convertSeverity(diag.severity),
      startLineNumber: diag.range.start.line,
      startColumn: diag.range.start.column,
      endLineNumber: diag.range.end.line,
      endColumn: diag.range.end.column,
      message: diag.message,
      code: diag.code?.toString(),
      source: diag.source || 'typescript',
    }))

    this.markers.set(model.uri.toString(), markers)
    monaco.editor.setModelMarkers(model, 'intelligence', markers)
  }

  /**
   * 清除指定模型的诊断信息
   */
  clearDiagnostics(model: monaco.editor.ITextModel): void {
    this.markers.delete(model.uri.toString())
    monaco.editor.setModelMarkers(model, 'intelligence', [])
  }

  /**
   * 清除所有诊断信息
   */
  clearAll(): void {
    this.markers.clear()
    // 清除所有模型的标记
    monaco.editor.getModels().forEach(model => {
      monaco.editor.setModelMarkers(model, 'intelligence', [])
    })
  }

  /**
   * 获取指定模型的诊断信息
   */
  getDiagnostics(model: monaco.editor.ITextModel): monaco.editor.IMarkerData[] {
    return this.markers.get(model.uri.toString()) || []
  }

  /**
   * 获取诊断统计
   */
  getStats(): { errors: number; warnings: number; hints: number } {
    let errors = 0
    let warnings = 0
    let hints = 0

    for (const markers of this.markers.values()) {
      for (const marker of markers) {
        switch (marker.severity) {
          case monaco.MarkerSeverity.Error:
            errors++
            break
          case monaco.MarkerSeverity.Warning:
            warnings++
            break
          case monaco.MarkerSeverity.Hint:
          case monaco.MarkerSeverity.Info:
            hints++
            break
        }
      }
    }

    return { errors, warnings, hints }
  }

  /**
   * 转换诊断严重性
   */
  private convertSeverity(severity: Diagnostic['severity']): monaco.MarkerSeverity {
    switch (severity) {
      case 'error':
        return monaco.MarkerSeverity.Error
      case 'warning':
        return monaco.MarkerSeverity.Warning
      case 'info':
        return monaco.MarkerSeverity.Info
      case 'hint':
        return monaco.MarkerSeverity.Hint
    }
  }

  /**
   * 销毁
   */
  dispose(): void {
    this.clearAll()
  }
}
