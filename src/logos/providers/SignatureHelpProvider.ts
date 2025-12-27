/**
 * 签名帮助 Provider
 */

import * as monaco from 'monaco-editor'

export class SignatureHelpProvider implements monaco.languages.SignatureHelpProvider {
  signatureHelpTriggerCharacters = ['(', ',']
  signatureHelpRetriggerCharacters = [',']

  async provideSignatureHelp(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken,
    context: monaco.languages.SignatureHelpContext
  ): Promise<monaco.languages.SignatureHelpResult | null> {
    if (token.isCancellationRequested) return null

    const filePath = model.uri.fsPath
    const pos = { line: position.lineNumber, column: position.column }

    try {
      const sigHelp = await window.electronAPI.intelligence.getSignatureHelp(
        filePath,
        pos,
        context.triggerCharacter
      )

      if (token.isCancellationRequested) return null

      if (!sigHelp || sigHelp.signatures.length === 0) return null

      return {
        value: {
          signatures: sigHelp.signatures.map(sig => ({
            label: sig.label,
            documentation: sig.documentation
              ? { value: sig.documentation, isTrusted: true }
              : undefined,
            parameters: sig.parameters.map(param => ({
              label: param.label,
              documentation: param.documentation
                ? { value: param.documentation, isTrusted: true }
                : undefined,
            })),
            activeParameter: sig.activeParameter,
          })),
          activeSignature: sigHelp.activeSignature,
          activeParameter: sigHelp.activeParameter,
        },
        dispose: () => {},
      }
    } catch (error) {
      console.error('Signature help error:', error)
      return null
    }
  }
}
