/**
 * 引用查找 Provider
 */

import * as monaco from 'monaco-editor'

export class ReferenceProvider implements monaco.languages.ReferenceProvider {
  async provideReferences(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    context: monaco.languages.ReferenceContext,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.Location[] | null> {
    if (token.isCancellationRequested) return null

    const filePath = model.uri.fsPath
    const pos = { line: position.lineNumber, column: position.column }

    try {
      const references = await window.electronAPI.intelligence.getReferences(
        filePath,
        pos,
        context.includeDeclaration
      )

      if (token.isCancellationRequested) return null

      if (!references || references.length === 0) return null

      return references.map(ref => ({
        uri: monaco.Uri.file(ref.uri),
        range: new monaco.Range(
          ref.range.start.line,
          ref.range.start.column,
          ref.range.end.line,
          ref.range.end.column
        ),
      }))
    } catch (error) {
      console.error('References error:', error)
      return null
    }
  }
}
