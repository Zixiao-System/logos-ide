/**
 * CI/CD 相关类型定义
 * 支持 GitHub Actions 和 GitLab CI
 * TODO: 未来可扩展支持更多 CI/CD 平台, 如 Jenkins、CircleCI 等，以及正在研发中的本地 CI/CD 功能和Priestess CI/CD 云服务
 */

/** CI/CD 平台类型 */
export type CICDPlatform = 'github' | 'gitlab'

/** 仓库信息 */
export interface RepoInfo {
  owner: string
  repo: string
  platform: CICDPlatform
}

// ==================== GitHub Actions ====================

/** GitHub Workflow */
export interface GitHubWorkflow {
  id: number
  node_id: string
  name: string
  path: string
  state: 'active' | 'disabled_manually' | 'disabled_inactivity' | 'deleted' | 'disabled_fork'
  created_at: string
  updated_at: string
  url: string
  html_url: string
}

/** GitHub Workflow Run 状态 */
export type GitHubRunStatus = 'queued' | 'in_progress' | 'completed' | 'waiting' | 'requested' | 'pending'

/** GitHub Workflow Run 结论 */
export type GitHubRunConclusion = 'success' | 'failure' | 'neutral' | 'cancelled' | 'skipped' | 'timed_out' | 'action_required' | null

/** GitHub Workflow Run */
export interface GitHubWorkflowRun {
  id: number
  name: string
  node_id: string
  head_branch: string
  head_sha: string
  path: string
  display_title: string
  run_number: number
  event: string
  status: GitHubRunStatus
  conclusion: GitHubRunConclusion
  workflow_id: number
  check_suite_id: number
  url: string
  html_url: string
  created_at: string
  updated_at: string
  run_started_at: string
  jobs_url: string
  logs_url: string
  actor: {
    login: string
    id: number
    avatar_url: string
  }
  triggering_actor: {
    login: string
    id: number
    avatar_url: string
  }
}

/** GitHub Workflow Job */
export interface GitHubWorkflowJob {
  id: number
  run_id: number
  name: string
  status: 'queued' | 'in_progress' | 'completed' | 'waiting'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null
  started_at: string | null
  completed_at: string | null
  steps: GitHubJobStep[]
}

/** GitHub Job Step */
export interface GitHubJobStep {
  name: string
  status: 'queued' | 'in_progress' | 'completed'
  conclusion: 'success' | 'failure' | 'cancelled' | 'skipped' | null
  number: number
  started_at: string | null
  completed_at: string | null
}

// ==================== GitLab CI ====================

/** GitLab Pipeline 状态 */
export type GitLabPipelineStatus =
  | 'created'
  | 'waiting_for_resource'
  | 'preparing'
  | 'pending'
  | 'running'
  | 'success'
  | 'failed'
  | 'canceled'
  | 'skipped'
  | 'manual'
  | 'scheduled'

/** GitLab Pipeline */
export interface GitLabPipeline {
  id: number
  iid: number
  project_id: number
  sha: string
  ref: string
  status: GitLabPipelineStatus
  source: string
  created_at: string
  updated_at: string
  web_url: string
  user: {
    id: number
    username: string
    name: string
    avatar_url: string
  }
  duration: number | null
  queued_duration: number | null
}

/** GitLab Job 状态 */
export type GitLabJobStatus =
  | 'created'
  | 'pending'
  | 'running'
  | 'failed'
  | 'success'
  | 'canceled'
  | 'skipped'
  | 'manual'

/** GitLab Job */
export interface GitLabJob {
  id: number
  name: string
  stage: string
  status: GitLabJobStatus
  created_at: string
  started_at: string | null
  finished_at: string | null
  duration: number | null
  queued_duration: number | null
  user: {
    id: number
    username: string
    name: string
    avatar_url: string
  }
  pipeline: {
    id: number
    project_id: number
    ref: string
    sha: string
    status: GitLabPipelineStatus
  }
  web_url: string
}

// ==================== Config ====================

/** GitHub 配置 */
export interface GitHubConfig {
  token: string
  owner: string
  repo: string
}

/** GitLab 配置 */
export interface GitLabConfig {
  token: string
  baseUrl: string
  projectId: string | number
}
