/**
 * 内联提示 Provider
 */

import * as monaco from 'monaco-editor'

export class InlayHintsProvider implements monaco.languages.InlayHintsProvider {
  async provideInlayHints(
    model: monaco.editor.ITextModel,
    range: monaco.Range,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.InlayHintList | null> {
    if (token.isCancellationRequested) return null

    const filePath = model.uri.fsPath
    const rangeData = {
      start: { line: range.startLineNumber, column: range.startColumn },
      end: { line: range.endLineNumber, column: range.endColumn },
    }

    try {
      const hints = await window.electronAPI.intelligence.getInlayHints(filePath, rangeData)

      if (token.isCancellationRequested) return null

      if (!hints || hints.length === 0) return null

      return {
        hints: hints.map(hint => ({
          position: new monaco.Position(hint.position.line, hint.position.column),
          label: hint.label,
          kind: hint.kind === 'type'
            ? monaco.languages.InlayHintKind.Type
            : monaco.languages.InlayHintKind.Parameter,
          paddingLeft: hint.paddingLeft,
          paddingRight: hint.paddingRight,
        })),
        dispose: () => {},
      }
    } catch (error) {
      console.error('Inlay hints error:', error)
      return null
    }
  }
}
