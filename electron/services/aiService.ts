/**
 * AI 服务 (OpenAI/Anthropic OAuth + 聊天/工具调用)
 */

import { ipcMain } from 'electron'
import { createServer, type Server } from 'http'
import { randomBytes, createHash } from 'crypto'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

const OPENAI_CLIENT_ID = 'app_EMoamEEZ73f0CkXaXp7hrann'
const OPENAI_ISSUER = 'https://auth.openai.com'
const OPENAI_CODEX_ENDPOINT = 'https://chatgpt.com/backend-api/codex/responses'
const OPENAI_OAUTH_PORT = 1455
const OPENAI_OAUTH_REDIRECT_PATH = '/auth/callback'

const ANTHROPIC_CLIENT_ID = '9d1c250a-e61b-44d9-88ed-5944d1962f5e'

type OpenAIAuth =
  | { type: 'api'; apiKey: string }
  | { type: 'oauth'; accessToken: string; refreshToken: string; expiresAt: number; accountId?: string }

type AnthropicAuth =
  | { type: 'api'; apiKey: string }
  | { type: 'oauth'; accessToken: string; refreshToken: string; expiresAt: number }

interface PendingOAuth {
  state: string
  verifier: string
  resolve: (tokens: OpenAIOAuthTokens) => void
  reject: (error: Error) => void
  promise: Promise<OpenAIOAuthTokens>
}

interface OpenAIOAuthTokens {
  access_token: string
  refresh_token: string
  expires_in?: number
  id_token?: string
}

let openaiOauthServer: Server | null = null
const openaiPending = new Map<string, PendingOAuth>()

function base64UrlEncode(buffer: Buffer): string {
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

function generateRandomString(length: number): string {
  const chars = 'ABCDEFGHIJKLMNOPQRSTUVWXYZabcdefghijklmnopqrstuvwxyz0123456789-._~'
  const bytes = randomBytes(length)
  return Array.from(bytes)
    .map((b) => chars[b % chars.length])
    .join('')
}

function generatePKCE(): { verifier: string; challenge: string } {
  const verifier = generateRandomString(43)
  const challenge = base64UrlEncode(createHash('sha256').update(verifier).digest())
  return { verifier, challenge }
}

function generateState(): string {
  return base64UrlEncode(randomBytes(32))
}

function buildOpenAIAuthorizeUrl(redirectUri: string, pkce: { verifier: string; challenge: string }, state: string): string {
  const params = new URLSearchParams({
    response_type: 'code',
    client_id: OPENAI_CLIENT_ID,
    redirect_uri: redirectUri,
    scope: 'openid profile email offline_access',
    code_challenge: pkce.challenge,
    code_challenge_method: 'S256',
    id_token_add_organizations: 'true',
    codex_cli_simplified_flow: 'true',
    state,
    originator: 'opencode'
  })
  return `${OPENAI_ISSUER}/oauth/authorize?${params.toString()}`
}

async function exchangeOpenAICodeForTokens(code: string, redirectUri: string, pkce: { verifier: string }) {
  const response = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'authorization_code',
      code,
      redirect_uri: redirectUri,
      client_id: OPENAI_CLIENT_ID,
      code_verifier: pkce.verifier
    }).toString()
  })
  if (!response.ok) {
    throw new Error(`OpenAI token exchange failed: ${response.status}`)
  }
  return response.json() as Promise<OpenAIOAuthTokens>
}

async function refreshOpenAI(refreshToken: string): Promise<OpenAIOAuthTokens> {
  const response = await fetch(`${OPENAI_ISSUER}/oauth/token`, {
    method: 'POST',
    headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
    body: new URLSearchParams({
      grant_type: 'refresh_token',
      refresh_token: refreshToken,
      client_id: OPENAI_CLIENT_ID
    }).toString()
  })
  if (!response.ok) {
    throw new Error(`OpenAI token refresh failed: ${response.status}`)
  }
  return response.json() as Promise<OpenAIOAuthTokens>
}

function parseJwtClaims(token: string): Record<string, any> | undefined {
  const parts = token.split('.')
  if (parts.length !== 3) return undefined
  try {
    return JSON.parse(Buffer.from(parts[1], 'base64url').toString())
  } catch {
    return undefined
  }
}

function extractOpenAIAccountId(tokens: OpenAIOAuthTokens): string | undefined {
  if (tokens.id_token) {
    const claims = parseJwtClaims(tokens.id_token)
    const accountId = claims?.chatgpt_account_id || claims?.['https://api.openai.com/auth']?.chatgpt_account_id
    if (accountId) return accountId
  }
  if (tokens.access_token) {
    const claims = parseJwtClaims(tokens.access_token)
    return claims?.chatgpt_account_id || claims?.['https://api.openai.com/auth']?.chatgpt_account_id
  }
  return undefined
}

async function ensureOpenAIAccess(auth: OpenAIAuth): Promise<{ auth: OpenAIAuth; refreshed: boolean }> {
  if (auth.type !== 'oauth') return { auth, refreshed: false }
  if (auth.accessToken && auth.expiresAt > Date.now() + 10_000) {
    return { auth, refreshed: false }
  }
  const tokens = await refreshOpenAI(auth.refreshToken)
  const accountId = extractOpenAIAccountId(tokens) || auth.accountId
  const next: OpenAIAuth = {
    type: 'oauth',
    accessToken: tokens.access_token,
    refreshToken: tokens.refresh_token,
    expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
    ...(accountId ? { accountId } : {})
  }
  return { auth: next, refreshed: true }
}

async function ensureAnthropicAccess(auth: AnthropicAuth): Promise<{ auth: AnthropicAuth; refreshed: boolean }> {
  if (auth.type !== 'oauth') return { auth, refreshed: false }
  if (auth.accessToken && auth.expiresAt > Date.now() + 10_000) {
    return { auth, refreshed: false }
  }
  const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      grant_type: 'refresh_token',
      refresh_token: auth.refreshToken,
      client_id: ANTHROPIC_CLIENT_ID
    })
  })
  if (!response.ok) {
    throw new Error(`Anthropic token refresh failed: ${response.status}`)
  }
  const json = await response.json() as { access_token: string; refresh_token: string; expires_in: number }
  const next: AnthropicAuth = {
    type: 'oauth',
    accessToken: json.access_token,
    refreshToken: json.refresh_token,
    expiresAt: Date.now() + json.expires_in * 1000
  }
  return { auth: next, refreshed: true }
}

function startOpenAIOAuthServer(): string {
  if (openaiOauthServer) {
    return `http://localhost:${OPENAI_OAUTH_PORT}${OPENAI_OAUTH_REDIRECT_PATH}`
  }

  openaiOauthServer = createServer((req, res) => {
    if (!req.url) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Bad request')
      return
    }

    const url = new URL(req.url, `http://localhost:${OPENAI_OAUTH_PORT}`)
    if (url.pathname !== OPENAI_OAUTH_REDIRECT_PATH) {
      res.writeHead(404, { 'Content-Type': 'text/plain' })
      res.end('Not found')
      return
    }

    const code = url.searchParams.get('code')
    const state = url.searchParams.get('state')
    const error = url.searchParams.get('error') || url.searchParams.get('error_description')

    if (error) {
      if (state) {
        const pending = openaiPending.get(state)
        if (pending) {
          pending.reject(new Error(error))
          openaiPending.delete(state)
        }
      }
      res.writeHead(200, { 'Content-Type': 'text/plain' })
      res.end('Authorization failed, you can close this window.')
      return
    }

    if (!code || !state || !openaiPending.has(state)) {
      res.writeHead(400, { 'Content-Type': 'text/plain' })
      res.end('Invalid authorization request.')
      return
    }

    const safeState = state as string
    const pending = openaiPending.get(safeState)!
    openaiPending.delete(safeState)

    exchangeOpenAICodeForTokens(code, `http://localhost:${OPENAI_OAUTH_PORT}${OPENAI_OAUTH_REDIRECT_PATH}`, {
      verifier: pending.verifier
    })
      .then((tokens) => pending.resolve(tokens))
      .catch((err) => pending.reject(err))

    res.writeHead(200, { 'Content-Type': 'text/plain' })
    res.end('Authorization successful. You can close this window.')
  })

  openaiOauthServer.listen(OPENAI_OAUTH_PORT)
  return `http://localhost:${OPENAI_OAUTH_PORT}${OPENAI_OAUTH_REDIRECT_PATH}`
}

async function buildAnthropicAuthorize(mode: 'max' | 'console'): Promise<{ url: string; verifier: string }> {
  const pkce = generatePKCE()
  const base = mode === 'console' ? 'https://console.anthropic.com/oauth/authorize' : 'https://claude.ai/oauth/authorize'
  const url = new URL(base)
  url.searchParams.set('code', 'true')
  url.searchParams.set('client_id', ANTHROPIC_CLIENT_ID)
  url.searchParams.set('response_type', 'code')
  url.searchParams.set('redirect_uri', 'https://console.anthropic.com/oauth/code/callback')
  url.searchParams.set('scope', 'org:create_api_key user:profile user:inference')
  url.searchParams.set('code_challenge', pkce.challenge)
  url.searchParams.set('code_challenge_method', 'S256')
  url.searchParams.set('state', pkce.verifier)
  return { url: url.toString(), verifier: pkce.verifier }
}

async function exchangeAnthropic(code: string, verifier: string) {
  const splits = code.split('#')
  const response = await fetch('https://console.anthropic.com/v1/oauth/token', {
    method: 'POST',
    headers: { 'Content-Type': 'application/json' },
    body: JSON.stringify({
      code: splits[0],
      state: splits[1],
      grant_type: 'authorization_code',
      client_id: ANTHROPIC_CLIENT_ID,
      redirect_uri: 'https://console.anthropic.com/oauth/code/callback',
      code_verifier: verifier
    })
  })
  if (!response.ok) {
    throw new Error(`Anthropic token exchange failed: ${response.status}`)
  }
  return response.json() as Promise<{ access_token: string; refresh_token: string; expires_in: number }>
}

async function runOpenAIChat(input: {
  model: string
  messages: Array<{ role: string; content: string; toolCallId?: string }>
  tools?: Array<{ name: string; description?: string; parameters?: any }>
  auth: OpenAIAuth
}) {
  const { auth: maybeUpdated, refreshed } = await ensureOpenAIAccess(input.auth)
  const token = maybeUpdated.type === 'api' ? maybeUpdated.apiKey : maybeUpdated.accessToken

  const payload: any = {
    model: input.model,
    input: input.messages.map((message) => ({
      role: message.role,
      content: message.content,
      ...(message.toolCallId ? { tool_call_id: message.toolCallId } : {})
    }))
  }

  if (input.tools && input.tools.length > 0) {
    payload.tools = input.tools.map((tool) => ({
      type: 'function',
      name: tool.name,
      description: tool.description,
      parameters: tool.parameters
    }))
  }

  const headers: Record<string, string> = {
    'Content-Type': 'application/json',
    Authorization: `Bearer ${token}`
  }

  if (maybeUpdated.type === 'oauth' && maybeUpdated.accountId) {
    headers['ChatGPT-Account-Id'] = maybeUpdated.accountId
  }

  const url = maybeUpdated.type === 'oauth' ? OPENAI_CODEX_ENDPOINT : 'https://api.openai.com/v1/responses'

  const response = await fetch(url, {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`OpenAI API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  const toolCalls: Array<{ id: string; name: string; arguments: string }> = []
  const textChunks: string[] = []

  if (Array.isArray(data.output)) {
    for (const item of data.output) {
      if (item.type === 'message' && Array.isArray(item.content)) {
        for (const content of item.content) {
          if (content.type === 'output_text' && content.text) {
            textChunks.push(content.text)
          }
        }
      }
      if (item.type === 'tool_call') {
        toolCalls.push({
          id: item.id,
          name: item.name,
          arguments: typeof item.arguments === 'string' ? item.arguments : JSON.stringify(item.arguments ?? {})
        })
      }
    }
  }

  const text = textChunks.join('').trim() || data.output_text || ''
  return { text, toolCalls, updatedAuth: refreshed ? maybeUpdated : undefined }
}

async function runAnthropicChat(input: {
  model: string
  messages: Array<{ role: string; content: string; toolCallId?: string }>
  tools?: Array<{ name: string; description?: string; parameters?: any }>
  auth: AnthropicAuth
}) {
  const { auth: maybeUpdated, refreshed } = await ensureAnthropicAccess(input.auth)
  const headers: Record<string, string> = {
    'Content-Type': 'application/json'
  }

  if (maybeUpdated.type === 'api') {
    headers['x-api-key'] = maybeUpdated.apiKey
  } else {
    headers.authorization = `Bearer ${maybeUpdated.accessToken}`
    headers['anthropic-beta'] = 'oauth-2025-04-20,interleaved-thinking-2025-05-14'
    headers['user-agent'] = 'claude-cli/2.1.2 (external, cli)'
  }

  const systemMessages = input.messages.filter((msg) => msg.role === 'system')
  const system = systemMessages.map((msg) => msg.content).join('\n').trim()

  const messages = input.messages
    .filter((msg) => msg.role !== 'system')
    .map((msg) => {
      if (msg.role === 'tool') {
        return {
          role: 'user',
          content: [
            {
              type: 'tool_result',
              tool_use_id: msg.toolCallId,
              content: msg.content
            }
          ]
        }
      }
      return { role: msg.role, content: msg.content }
    })

  const payload: any = {
    model: input.model,
    max_tokens: 1024,
    messages
  }

  if (system) {
    payload.system = system
  }

  if (input.tools && input.tools.length > 0) {
    payload.tools = input.tools.map((tool) => ({
      name: tool.name,
      description: tool.description,
      input_schema: tool.parameters ?? { type: 'object', properties: {} }
    }))
  }

  const response = await fetch('https://api.anthropic.com/v1/messages', {
    method: 'POST',
    headers,
    body: JSON.stringify(payload)
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`Anthropic API error: ${response.status} - ${error}`)
  }

  const data = await response.json()
  const toolCalls: Array<{ id: string; name: string; arguments: string }> = []
  const textChunks: string[] = []

  if (Array.isArray(data.content)) {
    for (const content of data.content) {
      if (content.type === 'text') {
        textChunks.push(content.text)
      }
      if (content.type === 'tool_use') {
        toolCalls.push({
          id: content.id,
          name: content.name,
          arguments: JSON.stringify(content.input ?? {})
        })
      }
    }
  }

  const text = textChunks.join('').trim()
  return { text, toolCalls, updatedAuth: refreshed ? maybeUpdated : undefined }
}

async function runCommand(repoPath: string, command: string): Promise<string> {
  const { stdout, stderr } = await execAsync(command, { cwd: repoPath })
  if (stderr?.trim()) {
    return `${stdout}\n${stderr}`.trim()
  }
  return stdout.trim()
}

export function registerAIHandlers() {
  ipcMain.handle('ai:openaiOauthStart', async () => {
    const redirectUri = startOpenAIOAuthServer()
    const pkce = generatePKCE()
    const state = generateState()
    const authUrl = buildOpenAIAuthorizeUrl(redirectUri, pkce, state)

    let resolve: PendingOAuth['resolve']
    let reject: PendingOAuth['reject']
    const promise = new Promise<OpenAIOAuthTokens>((res, rej) => {
      resolve = res
      reject = rej
    })

    openaiPending.set(state, {
      state,
      verifier: pkce.verifier,
      resolve: resolve!,
      reject: reject!,
      promise
    })

    return { state, authUrl }
  })

  ipcMain.handle('ai:openaiOauthWait', async (_event, state: string) => {
    const pending = openaiPending.get(state)
    if (!pending) {
      throw new Error('OpenAI OAuth not pending')
    }
    const tokens = await pending.promise
    const accountId = extractOpenAIAccountId(tokens)
    return {
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + (tokens.expires_in ?? 3600) * 1000,
      accountId
    }
  })

  ipcMain.handle('ai:anthropicOauthStart', async (_event, mode: 'max' | 'console') => {
    const { url, verifier } = await buildAnthropicAuthorize(mode)
    const requestId = generateState()
    anthropicPending.set(requestId, { verifier, mode })
    return { requestId, authUrl: url }
  })

  ipcMain.handle('ai:anthropicOauthExchange', async (_event, requestId: string, code: string, intent: 'oauth' | 'api') => {
    const pending = anthropicPending.get(requestId)
    if (!pending) {
      throw new Error('Anthropic OAuth not pending')
    }
    anthropicPending.delete(requestId)
    const tokens = await exchangeAnthropic(code, pending.verifier)
    if (intent === 'api') {
      const apiResponse = await fetch('https://api.anthropic.com/api/oauth/claude_cli/create_api_key', {
        method: 'POST',
        headers: {
          'Content-Type': 'application/json',
          authorization: `Bearer ${tokens.access_token}`
        }
      })
      if (!apiResponse.ok) {
        throw new Error(`Anthropic API key creation failed: ${apiResponse.status}`)
      }
      const apiJson = await apiResponse.json()
      return { type: 'api', apiKey: apiJson.raw_key }
    }
    return {
      type: 'oauth',
      accessToken: tokens.access_token,
      refreshToken: tokens.refresh_token,
      expiresAt: Date.now() + tokens.expires_in * 1000
    }
  })

  ipcMain.handle('ai:chat', async (_event, request: {
    provider: 'openai' | 'anthropic'
    model: string
    messages: Array<{ role: string; content: string; toolCallId?: string }>
    tools?: Array<{ name: string; description?: string; parameters?: any }>
    auth: OpenAIAuth | AnthropicAuth
  }) => {
    if (request.provider === 'openai') {
      return await runOpenAIChat({
        model: request.model,
        messages: request.messages,
        tools: request.tools,
        auth: request.auth as OpenAIAuth
      })
    }
    return await runAnthropicChat({
      model: request.model,
      messages: request.messages,
      tools: request.tools,
      auth: request.auth as AnthropicAuth
    })
  })

  ipcMain.handle('ai:runCommand', async (_event, repoPath: string, command: string) => {
    return await runCommand(repoPath, command)
  })
}

interface AnthropicPending {
  verifier: string
  mode: 'max' | 'console'
}

const anthropicPending = new Map<string, AnthropicPending>()
