/**
 * 引用查找 Provider
 * 支持双路径: IPC (TypeScript/JavaScript) 和 Daemon (Rust 守护进程)
 */

import * as monaco from 'monaco-editor'
import { daemonService } from '@/services/language/DaemonLanguageService'

export class ReferenceProvider implements monaco.languages.ReferenceProvider {
  private mode: 'ipc' | 'daemon'

  constructor(mode: 'ipc' | 'daemon' = 'ipc') {
    this.mode = mode
  }

  async provideReferences(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    context: monaco.languages.ReferenceContext,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.Location[] | null> {
    if (token.isCancellationRequested) return null

    const filePath = model.uri.fsPath

    try {
      if (this.mode === 'daemon') {
        return this.provideDaemonReferences(filePath, position, token)
      } else {
        return this.provideIpcReferences(filePath, position, context, token)
      }
    } catch (error) {
      console.error('References error:', error)
      return null
    }
  }

  private async provideIpcReferences(
    filePath: string,
    position: monaco.Position,
    context: monaco.languages.ReferenceContext,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.Location[] | null> {
    const pos = { line: position.lineNumber, column: position.column }

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
  }

  private async provideDaemonReferences(
    filePath: string,
    position: monaco.Position,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.Location[] | null> {
    if (!daemonService.isInitialized()) return null

    // Daemon 使用 0-indexed 行列号
    const references = await daemonService.getReferences(
      filePath,
      position.lineNumber - 1,
      position.column - 1
    )

    if (token.isCancellationRequested) return null

    if (!references || references.length === 0) return null

    return references.map(ref => ({
      uri: monaco.Uri.file(ref.uri),
      range: new monaco.Range(
        ref.range.startLine + 1,
        ref.range.startColumn + 1,
        ref.range.endLine + 1,
        ref.range.endColumn + 1
      ),
    }))
  }
}
