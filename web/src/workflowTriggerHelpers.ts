export type WorkflowTrigger = {
  id: string
  workflowId: string
  type: 'interval' | 'cron' | 'webhook' | 'folder'
  enabled: boolean
  config?: Record<string, any>
  webhookCredentialStatus?: 'active' | 'revoked'
  secretRevision?: number
  folderStatus?: 'ready' | 'needs-review'
  folderValidationReason?: string | null
}

export type TriggerHistoryItem = {
  id: string
  triggerId: string
  state?: string
  status?: string
  runId?: string | null
  source?: string
  scheduledAt?: number | null
  createdAt?: number
  updatedAt?: number
}

const duration = (value: unknown) => {
  const ms = Number(value)
  if (!Number.isFinite(ms) || ms < 1) return 'invalid interval'
  if (ms % 86_400_000 === 0) return `${ms / 86_400_000} day${ms === 86_400_000 ? '' : 's'}`
  if (ms % 3_600_000 === 0) return `${ms / 3_600_000} hour${ms === 3_600_000 ? '' : 's'}`
  if (ms % 60_000 === 0) return `${ms / 60_000} minute${ms === 60_000 ? '' : 's'}`
  if (ms % 1_000 === 0) return `${ms / 1_000} second${ms === 1_000 ? '' : 's'}`
  return `${ms} ms`
}

export const triggerTypeLabel = (type: WorkflowTrigger['type']) => ({ interval: 'Interval', cron: 'Cron schedule', webhook: 'Secure webhook', folder: 'Watched folder' })[type] || 'Trigger'

export function triggerSummary(trigger: WorkflowTrigger) {
  const config = trigger.config || {}
  if (trigger.type === 'interval') return `Every ${duration(config.intervalMs)} · ${config.timezone || 'UTC'} · ${config.overlapPolicy || 'skip'} overlap`
  if (trigger.type === 'cron') return `${String(config.cron || 'No cron expression')} · ${config.timezone || 'UTC'} · ${config.overlapPolicy || 'skip'} overlap`
  if (trigger.type === 'webhook') return `Bearer endpoint · credential revision ${Math.max(1, Number(trigger.secretRevision) || 1)}`
  const extensions = Array.isArray(config.extensions) && config.extensions.length ? ` · ${config.extensions.join(', ')}` : ''
  return `${String(config.path || 'No folder selected')}${extensions}`
}

export function triggerAvailability(trigger: WorkflowTrigger) {
  if (trigger.folderStatus === 'needs-review') return { available: false, label: 'Needs review', reason: trigger.folderValidationReason || 'The watched folder is unavailable.' }
  if (trigger.type === 'webhook' && trigger.webhookCredentialStatus !== 'active') return { available: false, label: 'Credential revoked', reason: 'Rotate the webhook credential before accepting deliveries.' }
  if (!trigger.enabled) return { available: false, label: 'Disabled', reason: 'This trigger will not launch new runs.' }
  return { available: true, label: 'Enabled', reason: 'Ready to launch new runs.' }
}

export function historyStatus(item: TriggerHistoryItem) {
  const status = String(item.status || item.state || 'unknown').toLowerCase()
  return { status, label: status.replace(/-/g, ' ').replace(/^./, value => value.toUpperCase()) }
}

export function triggerDeletePrompt(trigger: WorkflowTrigger) {
  return `Delete this ${triggerTypeLabel(trigger.type).toLowerCase()}? Its configuration and future launches will stop. Persisted delivery history and already-running workflows will remain.`
}
