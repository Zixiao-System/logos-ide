export type AgentStatus = 'idle' | 'thinking' | 'running-tools' | 'error'

export interface AgentMessage {
  id: string
  role: 'system' | 'user' | 'assistant' | 'tool'
  content: string
  timestamp: number
  toolCallId?: string
}

export type AgentTaskStatus = 'pending' | 'running' | 'completed' | 'error'

export interface AgentTaskStep {
  id: string
  title: string
  status: AgentTaskStatus
  toolName?: string
  output?: string
}

export interface AgentTask {
  id: string
  title: string
  status: AgentTaskStatus
  createdAt: number
  steps: AgentTaskStep[]
}

export interface AgentConfig {
  id: string
  name: string
  role: string
  instructions: string
  provider: 'openai' | 'anthropic'
  model: string
}

export interface Agent extends AgentConfig {
  status: AgentStatus
  messages: AgentMessage[]
  tasks: AgentTask[]
  error?: string
}
