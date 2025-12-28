/**
 * 补全 Provider
 */

import * as monaco from 'monaco-editor'

export class CompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ['.', '"', "'", '/', '@', '<', '{', '(']

  async provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    context: monaco.languages.CompletionContext,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.CompletionList | null> {
    if (token.isCancellationRequested) return null

    const filePath = model.uri.fsPath
    const pos = { line: position.lineNumber, column: position.column }
    const triggerChar = context.triggerCharacter

    try {
      const result = await window.electronAPI.intelligence.getCompletions(
        filePath,
        pos,
        triggerChar
      )

      if (token.isCancellationRequested) return null

      return {
        suggestions: result.suggestions.map(item => {
          const suggestion: monaco.languages.CompletionItem = {
            label: item.label,
            kind: item.kind as monaco.languages.CompletionItemKind,
            detail: item.detail,
            documentation: item.documentation
              ? typeof item.documentation === 'string'
                ? item.documentation
                : { value: item.documentation.value, isTrusted: item.documentation.isTrusted }
              : undefined,
            insertText: item.insertText,
            insertTextRules: item.insertTextRules as monaco.languages.CompletionItemInsertTextRule,
            sortText: item.sortText,
            filterText: item.filterText,
            preselect: item.preselect,
            range: undefined as unknown as monaco.IRange, // Will be auto-computed by Monaco
          }

          // 如果有自定义 range，设置它
          if (item.range) {
            suggestion.range = new monaco.Range(
              item.range.startLineNumber,
              item.range.startColumn,
              item.range.endLineNumber,
              item.range.endColumn
            )
          }

          return suggestion
        }),
        incomplete: result.incomplete ?? false,
      }
    } catch (error) {
      console.error('Completion error:', error)
      return null
    }
  }
}
