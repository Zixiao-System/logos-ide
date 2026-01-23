/**
 * AI Agents 状态管理
 */

import { defineStore } from 'pinia'
import { useSettingsStore } from '@/stores/settings'
import { useFileExplorerStore } from '@/stores/fileExplorer'
import type { Agent, AgentMessage, AgentTask, AgentTaskStep } from '@/types/agents'

const AGENTS_STORAGE_KEY = 'logos-ai-agents'

const DEFAULT_AGENT: Agent = {
  id: 'agent-1',
  name: 'Scout',
  role: 'Planner',
  instructions: 'Focus on plans, break tasks into steps, and ask for confirmation when needed.',
  provider: 'openai',
  model: 'gpt-4.1',
  status: 'idle',
  messages: [],
  tasks: []
}

function createId(prefix: string) {
  return `${prefix}-${Math.random().toString(36).slice(2, 10)}`
}

function safeParseJSON(value: string): any {
  try {
    return JSON.parse(value)
  } catch {
    return null
  }
}

function normalizePath(input: string): string {
  return input.replace(/\\/g, '/')
}

function isWithinRoot(root: string, target: string): boolean {
  const normalizedRoot = normalizePath(root).replace(/\/+$/g, '')
  const normalizedTarget = normalizePath(target)
  return normalizedTarget === normalizedRoot || normalizedTarget.startsWith(`${normalizedRoot}/`)
}

export const useAgentsStore = defineStore('agents', {
  state: () => ({
    agents: [DEFAULT_AGENT] as Agent[],
    activeAgentId: DEFAULT_AGENT.id,
    loading: false
  }),

  getters: {
    activeAgent(state) {
      return state.agents.find(agent => agent.id === state.activeAgentId) || state.agents[0]
    }
  },

  actions: {
    init() {
      try {
        const saved = localStorage.getItem(AGENTS_STORAGE_KEY)
        if (saved) {
          const parsed = JSON.parse(saved) as Agent[]
          if (Array.isArray(parsed) && parsed.length > 0) {
            this.agents = parsed
            this.activeAgentId = parsed[0].id
          }
        }
      } catch (error) {
        console.error('Failed to load agents:', error)
      }
    },

    persist() {
      try {
        localStorage.setItem(AGENTS_STORAGE_KEY, JSON.stringify(this.agents))
      } catch (error) {
        console.error('Failed to save agents:', error)
      }
    },

    setActiveAgent(id: string) {
      this.activeAgentId = id
    },

    addAgent(partial?: Partial<Agent>) {
      const agent: Agent = {
        ...DEFAULT_AGENT,
        id: createId('agent'),
        name: `Agent ${this.agents.length + 1}`,
        status: 'idle',
        messages: [],
        tasks: [],
        ...partial
      }
      this.agents.push(agent)
      this.activeAgentId = agent.id
      this.persist()
    },

    removeAgent(id: string) {
      if (this.agents.length === 1) return
      this.agents = this.agents.filter(agent => agent.id !== id)
      if (this.activeAgentId === id) {
        this.activeAgentId = this.agents[0].id
      }
      this.persist()
    },

    updateAgent(id: string, partial: Partial<Agent>) {
      const index = this.agents.findIndex(agent => agent.id === id)
      if (index === -1) return
      this.agents[index] = { ...this.agents[index], ...partial }
      this.persist()
    },

    async sendMessage(agentId: string, content: string) {
      const agent = this.agents.find(a => a.id === agentId)
      if (!agent) return

      const settingsStore = useSettingsStore()
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      const userMessage: AgentMessage = {
        id: createId('msg'),
        role: 'user',
        content,
        timestamp: Date.now()
      }
      agent.messages.push(userMessage)

      const task: AgentTask = {
        id: createId('task'),
        title: content.slice(0, 40),
        status: 'running',
        createdAt: Date.now(),
        steps: []
      }
      agent.tasks.unshift(task)
      agent.status = 'thinking'
      agent.error = undefined
      this.persist()

      const tools = [
        {
          name: 'read_file',
          description: 'Read a file from the workspace by absolute path.',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path']
          }
        },
        {
          name: 'write_file',
          description: 'Write a file to the workspace by absolute path.',
          parameters: {
            type: 'object',
            properties: {
              path: { type: 'string' },
              content: { type: 'string' }
            },
            required: ['path', 'content']
          }
        },
        {
          name: 'list_files',
          description: 'List files under a directory by absolute path.',
          parameters: {
            type: 'object',
            properties: { path: { type: 'string' } },
            required: ['path']
          }
        },
        {
          name: 'run_command',
          description: 'Run a shell command inside the workspace.',
          parameters: {
            type: 'object',
            properties: {
              command: { type: 'string' },
              cwd: { type: 'string' }
            },
            required: ['command']
          }
        }
      ]

      const getAuth = () => {
        const providerSettings = agent.provider === 'openai'
          ? settingsStore.ai.openai
          : settingsStore.ai.anthropic

        if (providerSettings.authType === 'api' && providerSettings.apiKey) {
          return { type: 'api', apiKey: providerSettings.apiKey }
        }
        if (providerSettings.authType === 'oauth' && providerSettings.oauth) {
          return {
            type: 'oauth',
            accessToken: providerSettings.oauth.accessToken,
            refreshToken: providerSettings.oauth.refreshToken,
            expiresAt: providerSettings.oauth.expiresAt,
            accountId: providerSettings.oauth.accountId
          }
        }
        return null
      }

      const updateAuth = (updated: any) => {
        if (!updated) return
        if (agent.provider === 'openai') {
          settingsStore.updateAI({
            openai: {
              ...settingsStore.ai.openai,
              authType: updated.type,
              apiKey: updated.type === 'api' ? updated.apiKey : settingsStore.ai.openai.apiKey,
              oauth: updated.type === 'oauth' ? {
                accessToken: updated.accessToken,
                refreshToken: updated.refreshToken,
                expiresAt: updated.expiresAt,
                accountId: updated.accountId
              } : null
            }
          })
        } else {
          settingsStore.updateAI({
            anthropic: {
              ...settingsStore.ai.anthropic,
              authType: updated.type,
              apiKey: updated.type === 'api' ? updated.apiKey : settingsStore.ai.anthropic.apiKey,
              oauth: updated.type === 'oauth' ? {
                accessToken: updated.accessToken,
                refreshToken: updated.refreshToken,
                expiresAt: updated.expiresAt
              } : null
            }
          })
        }
      }

      const runTool = async (toolName: string, args: any): Promise<string> => {
        if (!repoPath) {
          return 'No workspace is open.'
        }
        if (toolName === 'read_file') {
          const path = args?.path
          if (!path || !isWithinRoot(repoPath, path)) {
            return 'Invalid path.'
          }
          return await window.electronAPI.fileSystem.readFile(path)
        }
        if (toolName === 'write_file') {
          const path = args?.path
          if (!path || !isWithinRoot(repoPath, path)) {
            return 'Invalid path.'
          }
          await window.electronAPI.fileSystem.writeFile(path, args?.content ?? '')
          return `Wrote ${path}`
        }
        if (toolName === 'list_files') {
          const path = args?.path
          if (!path || !isWithinRoot(repoPath, path)) {
            return 'Invalid path.'
          }
          const entries = await window.electronAPI.fileSystem.readDirectory(path, false)
          return JSON.stringify(entries, null, 2)
        }
        if (toolName === 'run_command') {
          const command = args?.command
          const cwd = args?.cwd && isWithinRoot(repoPath, args.cwd) ? args.cwd : repoPath
          if (!command) return 'Missing command.'
          return await window.electronAPI.ai.runCommand(cwd, command)
        }
        return 'Unknown tool.'
      }

      const maxSteps = 8
      try {
        for (let step = 0; step < maxSteps; step += 1) {
          const auth = getAuth()
          if (!auth) {
            agent.status = 'error'
            agent.error = 'AI provider not configured.'
            task.status = 'error'
            this.persist()
            return
          }

          agent.status = step === 0 ? 'thinking' : 'running-tools'

          const response = await window.electronAPI.ai.chat({
            provider: agent.provider,
            model: agent.model,
            messages: agent.messages.map(msg => ({
              role: msg.role,
              content: msg.content,
              toolCallId: msg.toolCallId
            })),
            tools,
            auth
          })

          updateAuth(response.updatedAuth)

          if (response.text) {
            agent.messages.push({
              id: createId('msg'),
              role: 'assistant',
              content: response.text,
              timestamp: Date.now()
            })
          }

          if (!response.toolCalls || response.toolCalls.length === 0) {
            task.status = 'completed'
            agent.status = 'idle'
            this.persist()
            return
          }

          for (const toolCall of response.toolCalls) {
            const stepItem: AgentTaskStep = {
              id: createId('step'),
              title: toolCall.name,
              status: 'running',
              toolName: toolCall.name
            }
            task.steps.push(stepItem)

            const args = safeParseJSON(toolCall.arguments) ?? {}
            const output = await runTool(toolCall.name, args)
            stepItem.status = 'completed'
            stepItem.output = output

            agent.messages.push({
              id: createId('msg'),
              role: 'tool',
              content: output,
              toolCallId: toolCall.id,
              timestamp: Date.now()
            })
          }

          this.persist()
        }

        agent.status = 'error'
        agent.error = 'Tool loop exceeded limit.'
        task.status = 'error'
      } catch (error) {
        agent.status = 'error'
        agent.error = (error as Error).message
        task.status = 'error'
      } finally {
        this.persist()
      }
    },

    async generateCommitMessage(repoPath: string): Promise<string | null> {
      const settingsStore = useSettingsStore()
      const diff = await window.electronAPI.git.diffStaged(repoPath)
      if (!diff.trim()) return null

      const auth = settingsStore.ai.provider === 'openai'
        ? settingsStore.ai.openai
        : settingsStore.ai.anthropic

      const provider = settingsStore.ai.provider
      const model = provider === 'openai' ? settingsStore.ai.openai.model : settingsStore.ai.anthropic.model

      const authPayload = auth.authType === 'api'
        ? { type: 'api', apiKey: auth.apiKey }
        : auth.authType === 'oauth' && auth.oauth
          ? {
            type: 'oauth',
            accessToken: auth.oauth.accessToken,
            refreshToken: auth.oauth.refreshToken,
            expiresAt: auth.oauth.expiresAt,
            accountId: auth.oauth.accountId
          }
          : null

      if (!authPayload) return null

      const response = await window.electronAPI.ai.chat({
        provider,
        model,
        auth: authPayload,
        messages: [
          {
            role: 'system',
            content: 'You are a senior engineer. Write a concise Conventional Commit message (single line). Output only the message.'
          },
          {
            role: 'user',
            content: `Staged diff:\n${diff}`
          }
        ]
      })

      return response.text?.split('\n')[0].trim() || null
    },

    async generatePullRequest(repoPath: string): Promise<{ title: string; body: string } | null> {
      const settingsStore = useSettingsStore()
      const base = await window.electronAPI.git.defaultBranch(repoPath)
      const head = await window.electronAPI.git.currentBranch(repoPath)
      const diff = await window.electronAPI.git.diffRange(repoPath, base, head)

      if (!diff.trim()) return null

      const provider = settingsStore.ai.provider
      const model = provider === 'openai' ? settingsStore.ai.openai.model : settingsStore.ai.anthropic.model
      const auth = provider === 'openai' ? settingsStore.ai.openai : settingsStore.ai.anthropic

      const authPayload = auth.authType === 'api'
        ? { type: 'api', apiKey: auth.apiKey }
        : auth.authType === 'oauth' && auth.oauth
          ? {
            type: 'oauth',
            accessToken: auth.oauth.accessToken,
            refreshToken: auth.oauth.refreshToken,
            expiresAt: auth.oauth.expiresAt,
            accountId: auth.oauth.accountId
          }
          : null

      if (!authPayload) return null

      const response = await window.electronAPI.ai.chat({
        provider,
        model,
        auth: authPayload,
        messages: [
          {
            role: 'system',
            content: 'You write GitHub pull request summaries. Return JSON with keys: title, body.'
          },
          {
            role: 'user',
            content: `Diff between ${base} and ${head}:\n${diff}`
          }
        ]
      })

      const json = safeParseJSON(response.text)
      if (!json || !json.title || !json.body) {
        return null
      }
      return { title: String(json.title), body: String(json.body) }
    }
  }
})
