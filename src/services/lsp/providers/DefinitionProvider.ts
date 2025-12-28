/**
 * 定义跳转 Provider
 */

import * as monaco from 'monaco-editor'

export class DefinitionProvider implements monaco.languages.DefinitionProvider {
  async provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.Definition | null> {
    if (token.isCancellationRequested) return null

    const filePath = model.uri.fsPath
    const pos = { line: position.lineNumber, column: position.column }

    try {
      const definitions = await window.electronAPI.intelligence.getDefinitions(filePath, pos)

      if (token.isCancellationRequested) return null

      if (!definitions || definitions.length === 0) return null

      return definitions.map(def => ({
        uri: monaco.Uri.file(def.uri),
        range: new monaco.Range(
          def.range.start.line,
          def.range.start.column,
          def.range.end.line,
          def.range.end.column
        ),
      }))
    } catch (error) {
      console.error('Definition error:', error)
      return null
    }
  }
}
