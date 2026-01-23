/**
 * GitHub App 服务
 * 用于生成安装令牌并一键创建 PR
 */

import { ipcMain } from 'electron'
import { exec } from 'child_process'
import { promisify } from 'util'
import * as fs from 'fs/promises'
import { createSign } from 'crypto'

const execAsync = promisify(exec)
const GITHUB_API_BASE = 'https://api.github.com'

function base64UrlEncode(value: string | Buffer): string {
  const buffer = typeof value === 'string' ? Buffer.from(value) : value
  return buffer.toString('base64').replace(/\+/g, '-').replace(/\//g, '_').replace(/=+$/g, '')
}

async function getRepoInfo(repoPath: string): Promise<{ owner: string; repo: string } | null> {
  try {
    const { stdout } = await execAsync('git remote get-url origin', { cwd: repoPath })
    const url = stdout.trim()
    const match = url.match(/github\.com[/:]([^/]+)\/([^/.]+)(\.git)?$/)
    if (match) {
      return { owner: match[1], repo: match[2] }
    }
    return null
  } catch {
    return null
  }
}

async function githubAppRequest<T>(
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
    throw new Error(`GitHub App API error: ${response.status} - ${error}`)
  }

  return response.json()
}

async function createAppJwt(appId: string, privateKeyPath: string): Promise<string> {
  const privateKey = await fs.readFile(privateKeyPath, 'utf8')
  const now = Math.floor(Date.now() / 1000)
  const header = base64UrlEncode(JSON.stringify({ alg: 'RS256', typ: 'JWT' }))
  const payload = base64UrlEncode(JSON.stringify({
    iat: now - 30,
    exp: now + 9 * 60,
    iss: appId
  }))
  const data = `${header}.${payload}`
  const signer = createSign('RSA-SHA256')
  signer.update(data)
  signer.end()
  const signature = base64UrlEncode(signer.sign(privateKey))
  return `${data}.${signature}`
}

async function getInstallationToken(appId: string, privateKeyPath: string, owner: string, repo: string) {
  const jwt = await createAppJwt(appId, privateKeyPath)
  const installation = await githubAppRequest<{ id: number }>(
    `/repos/${owner}/${repo}/installation`,
    jwt
  )
  const tokenResponse = await githubAppRequest<{ token: string }>(
    `/app/installations/${installation.id}/access_tokens`,
    jwt,
    'POST'
  )
  return tokenResponse.token
}

export function registerGitHubAppHandlers() {
  ipcMain.handle('githubApp:createPR', async (_event, params: {
    repoPath: string
    title: string
    body: string
    head: string
    base: string
    appId: string
    privateKeyPath: string
  }) => {
    const repoInfo = await getRepoInfo(params.repoPath)
    if (!repoInfo) {
      throw new Error('Unable to resolve GitHub repo info from git remote')
    }

    const token = await getInstallationToken(
      params.appId,
      params.privateKeyPath,
      repoInfo.owner,
      repoInfo.repo
    )

    return await githubAppRequest(
      `/repos/${repoInfo.owner}/${repoInfo.repo}/pulls`,
      token,
      'POST',
      {
        title: params.title,
        body: params.body,
        head: params.head,
        base: params.base
      }
    )
  })
}
