/**
 * 悬停信息 Provider
 */

import * as monaco from 'monaco-editor'

export class HoverProvider implements monaco.languages.HoverProvider {
  async provideHover(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.Hover | null> {
    if (token.isCancellationRequested) return null

    const filePath = model.uri.fsPath
    const pos = { line: position.lineNumber, column: position.column }

    try {
      const hover = await window.electronAPI.intelligence.getHover(filePath, pos)

      if (token.isCancellationRequested) return null

      if (!hover || hover.contents.length === 0) return null

      const contents: monaco.IMarkdownString[] = hover.contents.map(content => ({
        value: content.language
          ? `\`\`\`${content.language}\n${content.value}\n\`\`\``
          : content.value,
        isTrusted: true,
      }))

      return {
        contents,
        range: hover.range
          ? new monaco.Range(
              hover.range.start.line,
              hover.range.start.column,
              hover.range.end.line,
              hover.range.end.column
            )
          : undefined,
      }
    } catch (error) {
      console.error('Hover error:', error)
      return null
    }
  }
}
