/**
 * DevOps 状态管理
 * 管理流水线和监控指标，支持 GitHub Actions 和 GitLab CI
 * TODO: 未来可扩展支持更多 CI/CD 平台, 如 Jenkins、CircleCI 等，以及正在研发中的本地 CI/CD 功能和Priestess CI/CD 云服务
 */

import { defineStore } from 'pinia'
import type {
  DevOpsState,
  Pipeline,
  PipelineStatus,
  PipelineStage,
  PipelineJob,
  Metric,
  WSMessage,
  PipelineUpdateMessage,
  MetricUpdateMessage,
  LogStreamMessage,
  CICDProvider
} from '@/types'
import { useSettingsStore } from './settings'
import { useFileExplorerStore } from './fileExplorer'

/** 扩展的 DevOps 状态 */
interface ExtendedDevOpsState extends DevOpsState {
  /** 当前 CI/CD 提供者 */
  provider: CICDProvider
  /** 仓库信息 */
  repoInfo: { owner: string; repo: string } | null
}

/**
 * 将 GitHub 状态映射到统一的 Pipeline 状态
 */
function mapGitHubStatus(status: string, conclusion: string | null): PipelineStatus {
  if (status === 'queued' || status === 'pending' || status === 'waiting') {
    return 'pending'
  }
  if (status === 'in_progress') {
    return 'running'
  }
  if (status === 'completed') {
    switch (conclusion) {
      case 'success':
        return 'success'
      case 'failure':
      case 'timed_out':
        return 'failed'
      case 'cancelled':
        return 'cancelled'
      default:
        return 'pending'
    }
  }
  return 'pending'
}

/**
 * 将 GitLab 状态映射到统一的 Pipeline 状态
 */
function mapGitLabStatus(status: string): PipelineStatus {
  switch (status) {
    case 'success':
      return 'success'
    case 'failed':
      return 'failed'
    case 'canceled':
      return 'cancelled'
    case 'running':
      return 'running'
    case 'pending':
    case 'created':
    case 'waiting_for_resource':
    case 'preparing':
    case 'scheduled':
    case 'manual':
    default:
      return 'pending'
  }
}

/**
 * 将 GitHub Workflow Run 转换为 Pipeline
 */
function mapGitHubRunToPipeline(run: any): Pipeline {
  return {
    id: String(run.id),
    name: run.name || run.display_title,
    status: mapGitHubStatus(run.status, run.conclusion),
    branch: run.head_branch,
    commit: run.head_sha?.substring(0, 7) || '',
    commitMessage: run.display_title,
    triggeredBy: run.actor?.login || run.triggering_actor?.login || 'unknown',
    triggeredAt: run.created_at,
    duration: run.run_started_at
      ? Math.floor((new Date(run.updated_at).getTime() - new Date(run.run_started_at).getTime()) / 1000)
      : null,
    stages: []  // Jobs 需要额外请求
  }
}

/**
 * 将 GitHub Jobs 转换为 Pipeline Stages
 */
function mapGitHubJobsToStages(jobs: any[]): PipelineStage[] {
  // GitHub Actions 没有显式的 stage 概念，每个 job 作为一个 stage
  return jobs.map(job => ({
    id: String(job.id),
    name: job.name,
    status: mapGitHubStatus(job.status, job.conclusion) as any,
    jobs: [{
      id: String(job.id),
      name: job.name,
      status: mapGitHubStatus(job.status, job.conclusion) as any,
      duration: job.started_at && job.completed_at
        ? Math.floor((new Date(job.completed_at).getTime() - new Date(job.started_at).getTime()) / 1000)
        : undefined,
      logs: undefined
    }]
  }))
}

/**
 * 将 GitLab Pipeline 转换为 Pipeline
 */
function mapGitLabPipelineToPipeline(pipeline: any): Pipeline {
  return {
    id: String(pipeline.id),
    name: `Pipeline #${pipeline.iid || pipeline.id}`,
    status: mapGitLabStatus(pipeline.status),
    branch: pipeline.ref,
    commit: pipeline.sha?.substring(0, 7) || '',
    commitMessage: '',
    triggeredBy: pipeline.user?.name || pipeline.user?.username || 'unknown',
    triggeredAt: pipeline.created_at,
    duration: pipeline.duration,
    stages: []
  }
}

export const useDevOpsStore = defineStore('devops', {
  state: (): ExtendedDevOpsState => ({
    pipelines: [],
    selectedPipelineId: null,
    metrics: [],
    loading: false,
    wsConnected: false,
    apiBaseUrl: 'http://localhost:3000/api',
    error: null,
    provider: 'none',
    repoInfo: null
  }),

  getters: {
    /** 选中的流水线 */
    selectedPipeline: (state) => {
      if (!state.selectedPipelineId) return null
      return state.pipelines.find(p => p.id === state.selectedPipelineId) || null
    },

    /** 按状态分组的流水线 */
    pipelinesByStatus: (state) => {
      const groups: Record<string, Pipeline[]> = {
        running: [],
        pending: [],
        failed: [],
        success: [],
        cancelled: []
      }
      for (const pipeline of state.pipelines) {
        if (groups[pipeline.status]) {
          groups[pipeline.status].push(pipeline)
        }
      }
      return groups
    },

    /** 运行中的流水线数量 */
    runningCount: (state) => state.pipelines.filter(p => p.status === 'running').length,

    /** 失败的流水线数量 */
    failedCount: (state) => state.pipelines.filter(p => p.status === 'failed').length,

    /** 最近的流水线 (按触发时间排序) */
    recentPipelines: (state) => {
      return [...state.pipelines]
        .sort((a, b) => new Date(b.triggeredAt).getTime() - new Date(a.triggeredAt).getTime())
        .slice(0, 10)
    },

    /** 成功的流水线数量 */
    successCount: (state) => state.pipelines.filter(p => p.status === 'success').length
  },

  actions: {
    /**
     * 设置 API 基础地址
     */
    setApiBaseUrl(url: string) {
      this.apiBaseUrl = url
    },

    /**
     * 设置 CI/CD 提供者
     */
    setProvider(provider: CICDProvider) {
      this.provider = provider
      this.pipelines = []
      this.repoInfo = null
    },

    /**
     * 获取仓库信息
     */
    async fetchRepoInfo() {
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      if (!repoPath) {
        this.repoInfo = null
        return
      }

      try {
        const info = await window.electronAPI.github.getRepoInfo(repoPath)
        this.repoInfo = info
      } catch (error) {
        console.error('Failed to get repo info:', error)
        this.repoInfo = null
      }
    },

    /**
     * 获取 GitHub Actions 流水线
     */
    async fetchGitHubPipelines() {
      const settingsStore = useSettingsStore()
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      if (!repoPath) {
        this.error = '请先打开一个项目文件夹'
        return
      }

      this.loading = true
      this.error = null

      try {
        const token = settingsStore.devops.githubToken || undefined
        const runs = await window.electronAPI.github.getWorkflowRuns(repoPath, token, undefined, 20)
        this.pipelines = runs.map(mapGitHubRunToPipeline)
      } catch (error) {
        this.error = (error as Error).message
        // 如果 API 失败，加载模拟数据
        this.loadMockData()
      } finally {
        this.loading = false
      }
    },

    /**
     * 获取 GitHub Workflow 的 Jobs
     */
    async fetchGitHubJobs(pipelineId: string) {
      const settingsStore = useSettingsStore()
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      if (!repoPath) return

      try {
        const token = settingsStore.devops.githubToken || undefined
        const jobs = await window.electronAPI.github.getWorkflowJobs(repoPath, Number(pipelineId), token)

        // 更新 pipeline 的 stages
        const pipeline = this.pipelines.find(p => p.id === pipelineId)
        if (pipeline) {
          pipeline.stages = mapGitHubJobsToStages(jobs)
        }
      } catch (error) {
        console.error('Failed to fetch jobs:', error)
      }
    },

    /**
     * 触发 GitHub Workflow
     */
    async triggerGitHubWorkflow(workflowId: string | number, ref: string = 'main') {
      const settingsStore = useSettingsStore()
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      if (!repoPath) {
        throw new Error('请先打开一个项目文件夹')
      }

      const token = settingsStore.devops.githubToken || undefined
      await window.electronAPI.github.triggerWorkflow(repoPath, workflowId, ref, undefined, token)

      // 刷新列表
      await this.fetchGitHubPipelines()
    },

    /**
     * 取消 GitHub Workflow Run
     */
    async cancelGitHubRun(runId: string) {
      const settingsStore = useSettingsStore()
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      if (!repoPath) return

      try {
        const token = settingsStore.devops.githubToken || undefined
        await window.electronAPI.github.cancelWorkflowRun(repoPath, Number(runId), token)

        // 更新本地状态
        const pipeline = this.pipelines.find(p => p.id === runId)
        if (pipeline) {
          pipeline.status = 'cancelled'
        }
      } catch (error) {
        this.error = (error as Error).message
      }
    },

    /**
     * 重新运行 GitHub Workflow
     */
    async rerunGitHubWorkflow(runId: string) {
      const settingsStore = useSettingsStore()
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      if (!repoPath) return

      try {
        const token = settingsStore.devops.githubToken || undefined
        await window.electronAPI.github.rerunWorkflow(repoPath, Number(runId), token)

        // 刷新列表
        await this.fetchGitHubPipelines()
      } catch (error) {
        this.error = (error as Error).message
      }
    },

    /**
     * 获取流水线列表 (根据 provider 选择)
     */
    async fetchPipelines() {
      const settingsStore = useSettingsStore()
      this.provider = settingsStore.devops.provider

      if (this.provider === 'github') {
        await this.fetchGitHubPipelines()
      } else if (this.provider === 'gitlab') {
        await this.fetchGitLabPipelines()
      } else {
        // 无 provider，使用通用 API 或加载模拟数据
        this.loading = true
        this.error = null

        try {
          const response = await fetch(`${this.apiBaseUrl}/pipelines`)
          if (!response.ok) {
            throw new Error(`HTTP error! status: ${response.status}`)
          }
          const data = await response.json()
          this.pipelines = data
        } catch (error) {
          this.error = (error as Error).message
          this.loadMockData()
        } finally {
          this.loading = false
        }
      }
    },

    /**
     * 获取 GitLab CI 流水线
     */
    async fetchGitLabPipelines() {
      const settingsStore = useSettingsStore()
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      if (!repoPath) {
        this.error = '请先打开一个项目文件夹'
        return
      }

      this.loading = true
      this.error = null

      try {
        const token = settingsStore.devops.gitlabToken || undefined
        const baseUrl = settingsStore.devops.gitlabUrl || 'https://gitlab.com'
        const pipelines = await window.electronAPI.gitlab.getPipelines(repoPath, baseUrl, token, 20)
        this.pipelines = pipelines.map(mapGitLabPipelineToPipeline)
      } catch (error) {
        this.error = (error as Error).message
        // 如果 API 失败，加载模拟数据
        this.loadMockData()
      } finally {
        this.loading = false
      }
    },

    /**
     * 获取 GitLab Pipeline 的 Jobs
     */
    async fetchGitLabJobs(pipelineId: string) {
      const settingsStore = useSettingsStore()
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      if (!repoPath) return

      try {
        const token = settingsStore.devops.gitlabToken || undefined
        const baseUrl = settingsStore.devops.gitlabUrl || 'https://gitlab.com'
        const jobs = await window.electronAPI.gitlab.getPipelineJobs(repoPath, baseUrl, Number(pipelineId), token)

        // 将 jobs 按 stage 分组
        const stageMap = new Map<string, PipelineJob[]>()
        for (const job of jobs) {
          if (!stageMap.has(job.stage)) {
            stageMap.set(job.stage, [])
          }
          stageMap.get(job.stage)!.push({
            id: String(job.id),
            name: job.name,
            status: mapGitLabStatus(job.status) as any,
            duration: job.duration || undefined,
            logs: undefined
          })
        }

        // 更新 pipeline 的 stages
        const pipeline = this.pipelines.find(p => p.id === pipelineId)
        if (pipeline) {
          pipeline.stages = Array.from(stageMap.entries()).map(([stageName, jobs], index) => ({
            id: `s${index}`,
            name: stageName,
            status: jobs.some(j => j.status === 'failed') ? 'failed' :
                    jobs.some(j => j.status === 'running') ? 'running' :
                    jobs.every(j => j.status === 'success') ? 'success' : 'pending',
            jobs
          })) as PipelineStage[]
        }
      } catch (error) {
        console.error('Failed to fetch GitLab jobs:', error)
      }
    },

    /**
     * 取消 GitLab Pipeline
     */
    async cancelGitLabPipeline(pipelineId: string) {
      const settingsStore = useSettingsStore()
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      if (!repoPath) return

      try {
        const token = settingsStore.devops.gitlabToken || undefined
        const baseUrl = settingsStore.devops.gitlabUrl || 'https://gitlab.com'
        await window.electronAPI.gitlab.cancelPipeline(repoPath, baseUrl, Number(pipelineId), token)

        // 更新本地状态
        const pipeline = this.pipelines.find(p => p.id === pipelineId)
        if (pipeline) {
          pipeline.status = 'cancelled'
        }
      } catch (error) {
        this.error = (error as Error).message
      }
    },

    /**
     * 重试 GitLab Pipeline
     */
    async retryGitLabPipeline(pipelineId: string) {
      const settingsStore = useSettingsStore()
      const fileExplorerStore = useFileExplorerStore()
      const repoPath = fileExplorerStore.rootPath

      if (!repoPath) return

      try {
        const token = settingsStore.devops.gitlabToken || undefined
        const baseUrl = settingsStore.devops.gitlabUrl || 'https://gitlab.com'
        await window.electronAPI.gitlab.retryPipeline(repoPath, baseUrl, Number(pipelineId), token)

        // 刷新列表
        await this.fetchGitLabPipelines()
      } catch (error) {
        this.error = (error as Error).message
      }
    },

    /**
     * 获取监控指标
     */
    async fetchMetrics() {
      try {
        const response = await fetch(`${this.apiBaseUrl}/metrics`)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        this.metrics = data
      } catch (error) {
        this.error = (error as Error).message
        this.loadMockMetrics()
      }
    },

    /**
     * 触发流水线
     */
    async triggerPipeline(pipelineId: string) {
      if (this.provider === 'github') {
        await this.rerunGitHubWorkflow(pipelineId)
        return
      }

      try {
        const response = await fetch(`${this.apiBaseUrl}/pipelines/${pipelineId}/trigger`, {
          method: 'POST'
        })
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        this.updatePipeline(data)
      } catch (error) {
        this.error = (error as Error).message
        this.mockTriggerPipeline(pipelineId)
      }
    },

    /**
     * 取消流水线
     */
    async cancelPipeline(pipelineId: string) {
      if (this.provider === 'github') {
        await this.cancelGitHubRun(pipelineId)
        return
      }

      if (this.provider === 'gitlab') {
        await this.cancelGitLabPipeline(pipelineId)
        return
      }

      try {
        const response = await fetch(`${this.apiBaseUrl}/pipelines/${pipelineId}/cancel`, {
          method: 'POST'
        })
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        this.updatePipeline(data)
      } catch (error) {
        this.error = (error as Error).message
        this.mockCancelPipeline(pipelineId)
      }
    },

    /**
     * 重试流水线
     */
    async retryPipeline(pipelineId: string) {
      if (this.provider === 'github') {
        await this.rerunGitHubWorkflow(pipelineId)
        return
      }

      if (this.provider === 'gitlab') {
        await this.retryGitLabPipeline(pipelineId)
        return
      }

      try {
        const response = await fetch(`${this.apiBaseUrl}/pipelines/${pipelineId}/retry`, {
          method: 'POST'
        })
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        this.updatePipeline(data)
      } catch (error) {
        this.error = (error as Error).message
        this.mockTriggerPipeline(pipelineId)
      }
    },

    /**
     * 获取流水线详情
     */
    async fetchPipelineDetail(pipelineId: string) {
      if (this.provider === 'github') {
        await this.fetchGitHubJobs(pipelineId)
        return this.pipelines.find(p => p.id === pipelineId)
      }

      if (this.provider === 'gitlab') {
        await this.fetchGitLabJobs(pipelineId)
        return this.pipelines.find(p => p.id === pipelineId)
      }

      try {
        const response = await fetch(`${this.apiBaseUrl}/pipelines/${pipelineId}`)
        if (!response.ok) {
          throw new Error(`HTTP error! status: ${response.status}`)
        }
        const data = await response.json()
        this.updatePipeline(data)
        return data
      } catch (error) {
        this.error = (error as Error).message
        return null
      }
    },

    /**
     * 选择流水线
     */
    selectPipeline(pipelineId: string | null) {
      this.selectedPipelineId = pipelineId
    },

    /**
     * 更新单个流水线
     */
    updatePipeline(pipeline: Pipeline) {
      const index = this.pipelines.findIndex(p => p.id === pipeline.id)
      if (index >= 0) {
        this.pipelines[index] = pipeline
      } else {
        this.pipelines.unshift(pipeline)
      }
    },

    /**
     * 更新单个指标
     */
    updateMetric(metric: Metric) {
      const index = this.metrics.findIndex(m => m.id === metric.id)
      if (index >= 0) {
        this.metrics[index] = metric
      } else {
        this.metrics.push(metric)
      }
    },

    /**
     * 处理 WebSocket 消息
     */
    handleWSMessage(message: WSMessage) {
      switch (message.type) {
        case 'pipeline_update':
          this.updatePipeline((message as PipelineUpdateMessage).data)
          break
        case 'metric_update':
          this.updateMetric((message as MetricUpdateMessage).data)
          break
        case 'log_stream':
          const logData = (message as LogStreamMessage).data
          console.log(`Job ${logData.jobId}: ${logData.log}`)
          break
        case 'connected':
          this.wsConnected = true
          break
        case 'error':
          this.error = String(message.data)
          break
      }
    },

    /**
     * 设置 WebSocket 连接状态
     */
    setWSConnected(connected: boolean) {
      this.wsConnected = connected
    },

    /**
     * 加载模拟数据
     */
    loadMockData() {
      const now = new Date()
      this.pipelines = [
        {
          id: '1',
          name: 'frontend-deploy',
          status: 'success',
          branch: 'main',
          commit: 'a1b2c3d',
          commitMessage: 'feat: add new dashboard',
          triggeredBy: 'Logos',
          triggeredAt: new Date(now.getTime() - 3600000).toISOString(),
          duration: 222,
          stages: [
            {
              id: 's1',
              name: 'Build',
              status: 'success',
              jobs: [
                { id: 'j1', name: 'install', status: 'success', duration: 45 },
                { id: 'j2', name: 'build', status: 'success', duration: 120 }
              ]
            },
            {
              id: 's2',
              name: 'Test',
              status: 'success',
              jobs: [
                { id: 'j3', name: 'unit-test', status: 'success', duration: 30 },
                { id: 'j4', name: 'e2e-test', status: 'success', duration: 60 }
              ]
            },
            {
              id: 's3',
              name: 'Deploy',
              status: 'success',
              jobs: [
                { id: 'j5', name: 'deploy-prod', status: 'success', duration: 27 }
              ]
            }
          ]
        },
        {
          id: '2',
          name: 'backend-build',
          status: 'running',
          branch: 'develop',
          commit: 'e4f5g6h',
          commitMessage: 'fix: resolve memory leak',
          triggeredBy: 'Auto',
          triggeredAt: new Date(now.getTime() - 80000).toISOString(),
          duration: null,
          stages: [
            {
              id: 's1',
              name: 'Build',
              status: 'success',
              jobs: [
                { id: 'j1', name: 'compile', status: 'success', duration: 60 }
              ]
            },
            {
              id: 's2',
              name: 'Test',
              status: 'running',
              jobs: [
                { id: 'j2', name: 'unit-test', status: 'running' }
              ]
            },
            {
              id: 's3',
              name: 'Deploy',
              status: 'pending',
              jobs: [
                { id: 'j3', name: 'deploy-staging', status: 'pending' }
              ]
            }
          ]
        },
        {
          id: '3',
          name: 'integration-test',
          status: 'failed',
          branch: 'feature/auth',
          commit: 'i7j8k9l',
          commitMessage: 'feat: implement OAuth',
          triggeredBy: 'PR #123',
          triggeredAt: new Date(now.getTime() - 7200000).toISOString(),
          duration: 310,
          stages: [
            {
              id: 's1',
              name: 'Build',
              status: 'success',
              jobs: [
                { id: 'j1', name: 'build', status: 'success', duration: 90 }
              ]
            },
            {
              id: 's2',
              name: 'Test',
              status: 'failed',
              jobs: [
                { id: 'j2', name: 'integration-test', status: 'failed', duration: 220 }
              ]
            }
          ]
        },
        {
          id: '4',
          name: 'staging-deploy',
          status: 'pending',
          branch: 'main',
          commit: 'a1b2c3d',
          commitMessage: 'chore: update dependencies',
          triggeredBy: 'Manual',
          triggeredAt: new Date(now.getTime() - 300000).toISOString(),
          duration: null,
          stages: [
            {
              id: 's1',
              name: 'Build',
              status: 'pending',
              jobs: [
                { id: 'j1', name: 'build', status: 'pending' }
              ]
            },
            {
              id: 's2',
              name: 'Deploy',
              status: 'pending',
              jobs: [
                { id: 'j2', name: 'deploy-staging', status: 'pending' }
              ]
            }
          ]
        }
      ]
    },

    /**
     * 加载模拟指标
     */
    loadMockMetrics() {
      this.metrics = [
        {
          id: 'm1',
          label: 'CPU 使用率',
          value: '42%',
          change: '+5%',
          trend: 'up',
          updatedAt: new Date().toISOString()
        },
        {
          id: 'm2',
          label: '内存使用',
          value: '6.2 GB',
          change: '-0.3 GB',
          trend: 'down',
          updatedAt: new Date().toISOString()
        },
        {
          id: 'm3',
          label: '构建成功率',
          value: '94%',
          change: '+2%',
          trend: 'up',
          updatedAt: new Date().toISOString()
        },
        {
          id: 'm4',
          label: '平均部署时间',
          value: '4m 32s',
          change: '-30s',
          trend: 'down',
          updatedAt: new Date().toISOString()
        }
      ]
    },

    /**
     * 模拟触发流水线
     */
    mockTriggerPipeline(pipelineId: string) {
      const pipeline = this.pipelines.find(p => p.id === pipelineId)
      if (pipeline) {
        pipeline.status = 'running'
        pipeline.triggeredAt = new Date().toISOString()
        pipeline.duration = null
        for (const stage of pipeline.stages) {
          stage.status = 'pending'
          for (const job of stage.jobs) {
            job.status = 'pending'
          }
        }
        if (pipeline.stages.length > 0) {
          pipeline.stages[0].status = 'running'
          if (pipeline.stages[0].jobs.length > 0) {
            pipeline.stages[0].jobs[0].status = 'running'
          }
        }
      }
    },

    /**
     * 模拟取消流水线
     */
    mockCancelPipeline(pipelineId: string) {
      const pipeline = this.pipelines.find(p => p.id === pipelineId)
      if (pipeline) {
        pipeline.status = 'cancelled'
        for (const stage of pipeline.stages) {
          if (stage.status === 'running' || stage.status === 'pending') {
            stage.status = 'skipped'
          }
          for (const job of stage.jobs) {
            if (job.status === 'running' || job.status === 'pending') {
              job.status = 'failed'
            }
          }
        }
      }
    },

    /**
     * 初始化
     */
    async init() {
      const settingsStore = useSettingsStore()
      this.provider = settingsStore.devops.provider

      // 获取仓库信息
      await this.fetchRepoInfo()

      this.loading = true
      try {
        await Promise.all([
          this.fetchPipelines(),
          this.fetchMetrics()
        ])
      } catch {
        // 错误已在各个方法中处理
      } finally {
        this.loading = false
      }
    },

    /**
     * 清除错误
     */
    clearError() {
      this.error = null
    }
  }
})
