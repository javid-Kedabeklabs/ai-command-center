import fs from 'node:fs'
import path from 'node:path'

export function normalizeTriggerContext(raw) {
  if (!raw || typeof raw !== 'object' || !/^[a-z0-9_.-]+$/i.test(String(raw.deliveryId || '')) || !/^[a-f0-9]{64}$/.test(String(raw.deliveryKey || '')) || !/^trigger-[a-z0-9_-]{6,80}$/i.test(String(raw.triggerId || '')) || !/^[a-z0-9_-]+$/i.test(String(raw.workflowId || ''))) throw new Error('invalid trigger execution context')
  const workflowVersion = raw.workflowVersion ? String(raw.workflowVersion) : null
  if (workflowVersion && !/^[a-z0-9_.-]+$/i.test(workflowVersion)) throw new Error('invalid trigger workflow version')
  return { deliveryId: String(raw.deliveryId), deliveryKey: String(raw.deliveryKey), triggerId: String(raw.triggerId), workflowId: String(raw.workflowId), workflowVersion, source: String(raw.source || 'trigger').slice(0, 40) }
}

export function findTriggerRun({ activeRuns = [], runsDir, context, workflowId, workflowVersion = null }) {
  const persisted = []
  if (runsDir) {
    try {
      for (const file of fs.readdirSync(runsDir).filter(name => name.endsWith('.json'))) {
        try { persisted.push(JSON.parse(fs.readFileSync(path.join(runsDir, file), 'utf8'))) } catch {}
      }
    } catch {}
  }
  const existing = [...activeRuns, ...persisted].find(item => item?.triggerContext?.deliveryId === context.deliveryId)
  if (!existing) return null
  if (existing.workflowId !== workflowId || (existing.workflowVersion || null) !== (workflowVersion || null) || existing.triggerContext?.triggerId !== context.triggerId || existing.triggerContext?.deliveryKey !== context.deliveryKey) {
    const error = new Error('trigger delivery identity conflicts with an existing run')
    error.code = 'TRIGGER_RUN_IDENTITY_CONFLICT'
    throw error
  }
  return existing
}
