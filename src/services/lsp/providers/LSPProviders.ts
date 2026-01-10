/**
 * LSP Provider 适配器
 * 为 Basic Mode 提供统一的 Monaco Provider 实现
 * 内部使用 LSPClientService 与标准 LSP 服务器通信
 */

import * as monaco from 'monaco-editor'
import { getLSPClientService } from '../LSPClientService'

/**
 * LSP 补全 Provider
 */
export class LSPCompletionProvider implements monaco.languages.CompletionItemProvider {
  triggerCharacters = ['.', '"', "'", '/', '@', '<', '{', '(', ':']

  async provideCompletionItems(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    context: monaco.languages.CompletionContext,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.CompletionList | null> {
    if (token.isCancellationRequested) return null

    const lspClient = getLSPClientService()
    return lspClient.getCompletions(model.uri.fsPath, position, context)
  }
}

/**
 * LSP 定义跳转 Provider
 */
export class LSPDefinitionProvider implements monaco.languages.DefinitionProvider {
  async provideDefinition(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.Definition | null> {
    if (token.isCancellationRequested) return null

    const lspClient = getLSPClientService()
    return lspClient.getDefinition(model.uri.fsPath, position)
  }
}

/**
 * LSP 引用查找 Provider
 */
export class LSPReferenceProvider implements monaco.languages.ReferenceProvider {
  async provideReferences(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    context: monaco.languages.ReferenceContext,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.Location[] | null> {
    if (token.isCancellationRequested) return null

    const lspClient = getLSPClientService()
    return lspClient.getReferences(model.uri.fsPath, position, context.includeDeclaration)
  }
}

/**
 * LSP 悬停提示 Provider
 */
export class LSPHoverProvider implements monaco.languages.HoverProvider {
  async provideHover(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.Hover | null> {
    if (token.isCancellationRequested) return null

    const lspClient = getLSPClientService()
    return lspClient.getHover(model.uri.fsPath, position)
  }
}

/**
 * LSP 签名帮助 Provider
 */
export class LSPSignatureHelpProvider implements monaco.languages.SignatureHelpProvider {
  signatureHelpTriggerCharacters = ['(', ',']
  signatureHelpRetriggerCharacters = [',', ')']

  async provideSignatureHelp(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken,
    context: monaco.languages.SignatureHelpContext
  ): Promise<monaco.languages.SignatureHelpResult | null> {
    if (token.isCancellationRequested) return null

    const lspClient = getLSPClientService()
    return lspClient.getSignatureHelp(model.uri.fsPath, position, context)
  }
}

/**
 * LSP 重命名 Provider
 */
export class LSPRenameProvider implements monaco.languages.RenameProvider {
  async provideRenameEdits(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    newName: string,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.WorkspaceEdit | null> {
    if (token.isCancellationRequested) return null

    const lspClient = getLSPClientService()
    return lspClient.rename(model.uri.fsPath, position, newName)
  }

  async resolveRenameLocation(
    model: monaco.editor.ITextModel,
    position: monaco.Position,
    token: monaco.CancellationToken
  ): Promise<monaco.languages.RenameLocation | null> {
    if (token.isCancellationRequested) return null

    const lspClient = getLSPClientService()
    return lspClient.prepareRename(model.uri.fsPath, position)
  }
}

/**
 * 注册所有 LSP Provider 到指定语言
 */
export function registerLSPProviders(languageId: string): monaco.IDisposable[] {
  const disposables: monaco.IDisposable[] = []

  disposables.push(
    monaco.languages.registerCompletionItemProvider(languageId, new LSPCompletionProvider())
  )
  disposables.push(
    monaco.languages.registerDefinitionProvider(languageId, new LSPDefinitionProvider())
  )
  disposables.push(
    monaco.languages.registerReferenceProvider(languageId, new LSPReferenceProvider())
  )
  disposables.push(
    monaco.languages.registerHoverProvider(languageId, new LSPHoverProvider())
  )
  disposables.push(
    monaco.languages.registerSignatureHelpProvider(languageId, new LSPSignatureHelpProvider())
  )
  disposables.push(
    monaco.languages.registerRenameProvider(languageId, new LSPRenameProvider())
  )

  return disposables
}
