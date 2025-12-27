/**
 * 重命名 Provider
 */

import * as monaco from 'monaco-editor'

export class RenameProvider implements monaco.languages.RenameProvider {
  async provideRenameEdits(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    newName: string,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.WorkspaceEdit | null> {
    if (token.isCancellationRequested) return null

    const filePath = model.uri.fsPath
    const pos = { line: position.lineNumber, column: position.column }

    try {
      const workspaceEdit = await window.electronAPI.intelligence.rename(
        filePath,
        pos,
        newName
      )

      if (token.isCancellationRequested) return null

      if (!workspaceEdit) return null

      const edits: monaco.languages.IWorkspaceTextEdit[] = []

      for (const [uri, textEdits] of Object.entries(workspaceEdit.changes)) {
        for (const edit of textEdits) {
          edits.push({
            resource: monaco.Uri.file(uri),
            textEdit: {
              range: new monaco.Range(
                edit.range.start.line,
                edit.range.start.column,
                edit.range.end.line,
                edit.range.end.column
              ),
              text: edit.newText,
            },
            versionId: undefined,
          })
        }
      }

      return { edits }
    } catch (error) {
      console.error('Rename error:', error)
      return null
    }
  }

  async resolveRenameLocation(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.RenameLocation | null> {
    if (token.isCancellationRequested) return null

    const filePath = model.uri.fsPath
    const pos = { line: position.lineNumber, column: position.column }

    try {
      const result = await window.electronAPI.intelligence.prepareRename(filePath, pos)

      if (token.isCancellationRequested) return null

      if (!result) return null

      return {
        range: new monaco.Range(
          result.range.start.line,
          result.range.start.column,
          result.range.end.line,
          result.range.end.column
        ),
        text: result.placeholder,
      }
    } catch (error) {
      console.error('Prepare rename error:', error)
      return null
    }
  }
}
