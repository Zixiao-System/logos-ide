/**
 * Slack 集成服务
 * 通过 Incoming Webhook 发送消息到 Slack
 */

export interface SlackMessage {
  text: string
  username?: string
  icon_emoji?: string
  icon_url?: string
  channel?: string
  attachments?: Array<{
    color?: string
    title?: string
    text?: string
    fields?: Array<{ title: string; value: string; short?: boolean }>
    footer?: string
    ts?: number
  }>
}

/**
 * 发送消息到 Slack
 * @param webhookUrl - Slack Incoming Webhook URL
 * @param message - 消息内容
 */
export async function sendSlackMessage(
  webhookUrl: string,
  message: SlackMessage
): Promise<{ success: boolean; error?: string }> {
  if (!webhookUrl) {
    return { success: false, error: 'Slack webhook URL is not configured' }
  }

  try {
    const response = await fetch(webhookUrl, {
      method: 'POST',
      headers: {
        'Content-Type': 'application/json'
      },
      body: JSON.stringify(message)
    })

    if (!response.ok) {
      const errorText = await response.text()
      return {
        success: false,
        error: `Slack API error: ${response.status} ${errorText}`
      }
    }

    return { success: true }
  } catch (error) {
    return {
      success: false,
      error: error instanceof Error ? error.message : 'Unknown error'
    }
  }
}

/**
 * 发送简单的文本消息
 */
export async function sendSlackText(
  webhookUrl: string,
  text: string,
  options?: { username?: string; channel?: string }
): Promise<{ success: boolean; error?: string }> {
  return sendSlackMessage(webhookUrl, {
    text,
    username: options?.username,
    channel: options?.channel
  })
}

/**
 * 发送构建通知消息
 */
export async function sendBuildNotification(
  webhookUrl: string,
  pipeline: {
    name: string
    status: 'success' | 'failed' | 'cancelled' | 'running'
    branch: string
    commit?: string
    url?: string
  }
): Promise<{ success: boolean; error?: string }> {
  const statusEmoji = {
    success: '✅',
    failed: '❌',
    cancelled: '⚠️',
    running: '🔄'
  }[pipeline.status]

  const statusColor = {
    success: 'good',
    failed: 'danger',
    cancelled: 'warning',
    running: '#36a64f'
  }[pipeline.status]

  return sendSlackMessage(webhookUrl, {
    text: `${statusEmoji} Pipeline: ${pipeline.name}`,
    username: 'Logos IDE',
    attachments: [
      {
        color: statusColor,
        fields: [
          { title: 'Status', value: pipeline.status, short: true },
          { title: 'Branch', value: pipeline.branch, short: true },
          ...(pipeline.commit ? [{ title: 'Commit', value: pipeline.commit, short: true }] : [])
        ],
        ...(pipeline.url ? { title: 'View Pipeline', title_link: pipeline.url } : {}),
        ts: Math.floor(Date.now() / 1000)
      }
    ]
  })
}
