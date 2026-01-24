/**
 * GitHub Actions 服务
 * 提供与 GitHub Actions API 的交互
 */

import { ipcMain, net } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'

const execAsync = promisify(exec)

/** GitHub API 基础 URL */
const GITHUB_API_BASE = 'https://api.github.com'
const GITHUB_OAUTH_BASE = 'https://github.com/login/oauth'
const GITHUB_DEVICE_CODE_ENDPOINT = 'https://github.com/login/device/code'
const GITHUB_ACCESS_TOKEN_ENDPOINT = `${GITHUB_OAUTH_BASE}/access_token`

const GITHUB_REPO_ERROR = 'Cannot determine GitHub repository from remote URL'
const GITHUB_TOKEN_ERROR = 'GitHub token not found. Please configure it in settings.'
const GITHUB_OAUTH_CLIENT_ERROR = 'GitHub OAuth Client ID is required.'

type GitHubRepoInfo = { owner: string; repo: string }

const DEFAULT_GITHUB_OAUTH_SCOPES = ['repo', 'workflow']

/** GitHub Workflow Run */
interface GitHubWorkflowRun {
  id: number
  name: string
  head_branch: string
  head_sha: string
  status: string
  conclusion: string | null
  workflow_id: number
  html_url: string
  created_at: string
  updated_at: string
  run_started_at: string
  jobs_url: string
  actor: {
    login: string
    avatar_url: string
  }
}

/** GitHub Workflow */
interface GitHubWorkflow {
  id: number
  name: string
  path: string
  state: string
}

/** GitHub Workflow Job */
interface GitHubWorkflowJob {
  id: number
  run_id: number
  name: string
  status: string
  conclusion: string | null
  started_at: string | null
  completed_at: string | null
  steps: Array<{
    name: string
    status: string
    conclusion: string | null
    number: number
  }>
}

interface GitHubDeviceCodeResponse {
  device_code: string
  user_code: string
  verification_uri: string
  verification_uri_complete?: string
  expires_in: number
  interval?: number
}

interface GitHubDeviceTokenResponse {
  access_token?: string
  token_type?: string
  scope?: string
  error?: string
  error_description?: string
  error_uri?: string
}

type GitHubDevicePollResult =
  | {
    status: 'authorized'
    accessToken: string
    tokenType: string
    scope: string
  }
  | { status: 'pending' }
  | { status: 'slow_down' }
  | { status: 'expired' }
  | { status: 'denied' }
  | {
    status: 'error'
    error: string
    errorDescription?: string
    errorUri?: string
  }

/**
 * 从 git remote 获取仓库信息
 */
async function getRepoInfo(repoPath: string): Promise<GitHubRepoInfo | null> {
  try {
    const { stdout } = await execAsync('git remote get-url origin', { cwd: repoPath })
    const url = stdout.trim()

    // 支持 HTTPS 和 SSH 格式
    // https://github.com/owner/repo.git
    // git@github.com:owner/repo.git
    let match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/)
    if (match) {
      return { owner: match[1], repo: match[2] }
    }

    return null
  } catch {
    return null
  }
}

async function requireRepoInfo(repoPath: string): Promise<GitHubRepoInfo> {
  const repoInfo = await getRepoInfo(repoPath)
  if (!repoInfo) {
    throw new Error(GITHUB_REPO_ERROR)
  }
  return repoInfo
}

async function requireToken(providedToken?: string, repoPath?: string): Promise<string> {
  const resolvedToken = await getToken(providedToken, repoPath)
  if (!resolvedToken) {
    throw new Error(GITHUB_TOKEN_ERROR)
  }
  return resolvedToken
}

function getRepoBase(repoInfo: GitHubRepoInfo): string {
  return `/repos/${repoInfo.owner}/${repoInfo.repo}`
}

function normalizeScopes(scopes?: string[]): string | undefined {
  if (!scopes || scopes.length === 0) {
    return DEFAULT_GITHUB_OAUTH_SCOPES.join(' ')
  }
  return scopes.join(' ')
}

/**
 * 获取 Token (优先级: 传入参数 > 环境变量 > git credential)
 */
async function getToken(providedToken?: string, repoPath?: string): Promise<string | null> {
  // 1. 使用传入的 token
  if (providedToken) {
    return providedToken
  }

  // 2. 检查环境变量
  if (process.env.GITHUB_TOKEN) {
    return process.env.GITHUB_TOKEN
  }
  if (process.env.GH_TOKEN) {
    return process.env.GH_TOKEN
  }

  // 3. 尝试从 git credential 获取
  if (repoPath) {
    try {
      const { stdout } = await execAsync(
        'git credential fill <<< "protocol=https\nhost=github.com"',
        { cwd: repoPath, shell: '/bin/bash' }
      )
      const match = stdout.match(/password=(.+)/)
      if (match) {
        return match[1].trim()
      }
    } catch {
      // 忽略错误
    }
  }

  return null
}

interface GitHubClient {
  repoBase: string
  token: string
  request: <T>(endpoint: string, method?: string, body?: unknown) => Promise<T>
}

async function createGitHubClient(repoPath: string, providedToken?: string): Promise<GitHubClient> {
  const repoInfo = await requireRepoInfo(repoPath)
  const token = await requireToken(providedToken, repoPath)
  const repoBase = getRepoBase(repoInfo)

  return {
    repoBase,
    token,
    request: <T>(endpoint: string, method: string = 'GET', body?: unknown) =>
      githubRequest<T>(endpoint, token, method, body)
  }
}

/**
 * 发送 GitHub API 请求
 */
async function githubRequest<T>(
  endpoint: string,
  token: string,
  method: string = 'GET',
  body?: unknown
): Promise<T> {
  const url = endpoint.startsWith('http') ? endpoint : `${GITHUB_API_BASE}${endpoint}`

  const response = await fetch(url, {
    method,
    headers: {
      'Accept': 'application/vnd.github+json',
      'Authorization': `Bearer ${token}`,
      'X-GitHub-Api-Version': '2022-11-28',
      ...(body ? { 'Content-Type': 'application/json' } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`GitHub API error: ${response.status} - ${error}`)
  }

  if (response.status === 204 || response.status === 205) {
    return undefined as T
  }

  const contentType = response.headers.get('content-type') || ''
  if (!contentType.includes('application/json')) {
    return (await response.text()) as unknown as T
  }

  return response.json()
}

async function githubOAuthRequest<T>(
  endpoint: string,
  body: Record<string, string | undefined>
): Promise<T> {
  if (!endpoint) {
    throw new Error('GitHub OAuth error: missing endpoint')
  }

  let url: URL
  try {
    url = new URL(endpoint)
  } catch (error) {
    throw new Error(`GitHub OAuth error: invalid endpoint ${String(endpoint)}`)
  }

  const payload = new URLSearchParams()
  for (const [key, value] of Object.entries(body)) {
    if (value) {
      payload.set(key, value)
    }
  }

  const payloadText = payload.toString()
  const response = await net.fetch(url.toString(), {
    method: 'POST',
    headers: {
      'Accept': 'application/json',
      'Content-Type': 'application/x-www-form-urlencoded',
      'User-Agent': 'Logos-Electron'
    },
    body: payloadText
  })

  if (!response.ok) {
    const error = await response.text()
    throw new Error(`GitHub OAuth error: ${response.status} - ${error}`)
  }

  return response.json() as Promise<T>
}

function mapDeviceFlowResult(response: GitHubDeviceTokenResponse): GitHubDevicePollResult {
  if (response.access_token) {
    return {
      status: 'authorized',
      accessToken: response.access_token,
      tokenType: response.token_type || 'bearer',
      scope: response.scope || ''
    }
  }

  switch (response.error) {
    case 'authorization_pending':
      return { status: 'pending' }
    case 'slow_down':
      return { status: 'slow_down' }
    case 'expired_token':
      return { status: 'expired' }
    case 'access_denied':
      return { status: 'denied' }
    default:
      return {
        status: 'error',
        error: response.error || 'unknown_error',
        errorDescription: response.error_description,
        errorUri: response.error_uri
      }
  }
}

/**
 * 注册 GitHub Actions IPC handlers
 */
export function registerGitHubHandlers() {
  // ============ OAuth Device Flow ============
  ipcMain.handle('github:deviceFlowStart', async (_event, clientId: string, scopes?: string[]) => {
    if (!clientId) {
      throw new Error(GITHUB_OAUTH_CLIENT_ERROR)
    }

    const scope = normalizeScopes(scopes)
    const response = await githubOAuthRequest<GitHubDeviceCodeResponse>(
      GITHUB_DEVICE_CODE_ENDPOINT,
      {
        client_id: clientId,
        scope
      }
    )

    return {
      deviceCode: response.device_code,
      userCode: response.user_code,
      verificationUri: response.verification_uri,
      verificationUriComplete: response.verification_uri_complete,
      expiresIn: response.expires_in,
      interval: response.interval ?? 5
    }
  })

  ipcMain.handle('github:deviceFlowPoll', async (_event, clientId: string, deviceCode: string) => {
    if (!clientId) {
      throw new Error(GITHUB_OAUTH_CLIENT_ERROR)
    }
    if (!deviceCode) {
      throw new Error('GitHub device code is required.')
    }

    const response = await githubOAuthRequest<GitHubDeviceTokenResponse>(
      GITHUB_ACCESS_TOKEN_ENDPOINT,
      {
        client_id: clientId,
        device_code: deviceCode,
        grant_type: 'urn:ietf:params:oauth:grant-type:device_code'
      }
    )

    return mapDeviceFlowResult(response)
  })

  // 获取仓库信息
  ipcMain.handle('github:getRepoInfo', async (_event, repoPath: string) => {
    return await getRepoInfo(repoPath)
  })

  // 获取 workflows
  ipcMain.handle('github:getWorkflows', async (
    _event,
    repoPath: string,
    token?: string
  ) => {
    const { repoBase, request } = await createGitHubClient(repoPath, token)
    const response = await request<{ workflows: GitHubWorkflow[] }>(
      `${repoBase}/actions/workflows`
    )

    return response.workflows
  })

  // 获取 workflow runs
  ipcMain.handle('github:getWorkflowRuns', async (
    _event,
    repoPath: string,
    token?: string,
    workflowId?: number,
    perPage: number = 20
  ) => {
    const { repoBase, request } = await createGitHubClient(repoPath, token)

    let endpoint = `${repoBase}/actions/runs?per_page=${perPage}`
    if (workflowId) {
      endpoint = `${repoBase}/actions/workflows/${workflowId}/runs?per_page=${perPage}`
    }

    const response = await request<{ workflow_runs: GitHubWorkflowRun[] }>(endpoint)

    return response.workflow_runs
  })

  // 获取 workflow jobs
  ipcMain.handle('github:getWorkflowJobs', async (
    _event,
    repoPath: string,
    runId: number,
    token?: string
  ) => {
    const { repoBase, request } = await createGitHubClient(repoPath, token)
    const response = await request<{ jobs: GitHubWorkflowJob[] }>(
      `${repoBase}/actions/runs/${runId}/jobs`
    )

    return response.jobs
  })

  // 触发 workflow
  ipcMain.handle('github:triggerWorkflow', async (
    _event,
    repoPath: string,
    workflowId: number | string,
    ref: string = 'main',
    inputs?: Record<string, string>,
    token?: string
  ) => {
    const { repoBase, request } = await createGitHubClient(repoPath, token)

    await request<void>(
      `${repoBase}/actions/workflows/${workflowId}/dispatches`,
      'POST',
      { ref, inputs }
    )

    return { success: true }
  })

  // 取消 workflow run
  ipcMain.handle('github:cancelWorkflowRun', async (
    _event,
    repoPath: string,
    runId: number,
    token?: string
  ) => {
    const { repoBase, request } = await createGitHubClient(repoPath, token)

    await request<void>(
      `${repoBase}/actions/runs/${runId}/cancel`,
      'POST'
    )

    return { success: true }
  })

  // 重新运行 workflow
  ipcMain.handle('github:rerunWorkflow', async (
    _event,
    repoPath: string,
    runId: number,
    token?: string
  ) => {
    const { repoBase, request } = await createGitHubClient(repoPath, token)

    await request<void>(
      `${repoBase}/actions/runs/${runId}/rerun`,
      'POST'
    )

    return { success: true }
  })

  // 获取 workflow run 日志 URL
  ipcMain.handle('github:getWorkflowRunLogsUrl', async (
    _event,
    repoPath: string,
    runId: number,
    token?: string
  ) => {
    const { repoBase, token: resolvedToken } = await createGitHubClient(repoPath, token)

    // 获取日志下载 URL (会重定向)
    const url = `${GITHUB_API_BASE}${repoBase}/actions/runs/${runId}/logs`

    return { url, token: resolvedToken }
  })

  // ============ Pull Requests ============

  // 列出 PRs
  ipcMain.handle('github:listPRs', async (
    _event,
    repoPath: string,
    token?: string,
    state: 'open' | 'closed' | 'all' = 'open',
    perPage: number = 30
  ) => {
    const { repoBase, request } = await createGitHubClient(repoPath, token)
    const response = await request<any[]>(
      `${repoBase}/pulls?state=${state}&per_page=${perPage}`
    )

    return response
  })

  // 创建 PR
  ipcMain.handle('github:createPR', async (
    _event,
    repoPath: string,
    title: string,
    body: string,
    head: string,
    base: string,
    token?: string
  ) => {
    const { repoBase, request } = await createGitHubClient(repoPath, token)
    const response = await request<any>(
      `${repoBase}/pulls`,
      'POST',
      { title, body, head, base }
    )

    return response
  })

  // ============ Issues ============

  // 列出 Issues
  ipcMain.handle('github:listIssues', async (
    _event,
    repoPath: string,
    token?: string,
    state: 'open' | 'closed' | 'all' = 'open',
    perPage: number = 30
  ) => {
    const { repoBase, request } = await createGitHubClient(repoPath, token)
    const response = await request<any[]>(
      `${repoBase}/issues?state=${state}&per_page=${perPage}`
    )

    return response
  })

  // 创建 Issue
  ipcMain.handle('github:createIssue', async (
    _event,
    repoPath: string,
    title: string,
    body: string,
    labels?: string[],
    token?: string
  ) => {
    const { repoBase, request } = await createGitHubClient(repoPath, token)
    const response = await request<any>(
      `${repoBase}/issues`,
      'POST',
      { title, body, ...(labels ? { labels } : {}) }
    )

    return response
  })
}
