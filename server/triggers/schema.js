import crypto from 'node:crypto'
import { normalizeScheduleConfig } from './schedule.js'

export const TRIGGER_STORE_VERSION = 1
export const TRIGGER_TYPES = new Set(['interval', 'cron', 'webhook', 'folder'])
export const DELIVERY_STATES = new Set(['reserved', 'starting', 'started', 'failed', 'suppressed', 'recovering'])
export const SAFE_TRIGGER_ID = /^trigger-[a-z0-9_-]{6,80}$/i
export const SAFE_DELIVERY_ID = /^delivery-[a-f0-9]{24}$/

const plain = value => value && typeof value === 'object' && !Array.isArray(value)
const boundedText = (value, length = 240) => String(value ?? '').replace(/[\r\n\t]+/g, ' ').trim().slice(0, length)

export function stableDeliveryId(triggerId, deliveryKey) {
  return `delivery-${crypto.createHash('sha256').update(`${triggerId}\0${deliveryKey}`).digest('hex').slice(0, 24)}`
}

export function redactedDeliveryKey(value) {
  return crypto.createHash('sha256').update(String(value || '')).digest('hex')
}

export function normalizeTriggerDefinition(input, { workflowId } = {}) {
  if (!plain(input)) throw new Error('trigger definition must be an object')
  const id = String(input.id || '')
  const owner = String(workflowId || input.workflowId || '')
  const type = String(input.type || '')
  if (!SAFE_TRIGGER_ID.test(id)) throw new Error('trigger has an invalid id')
  if (!/^[a-z0-9_-]+$/i.test(owner)) throw new Error('trigger has an invalid workflow id')
  if (!TRIGGER_TYPES.has(type)) throw new Error('trigger type must be interval, cron, webhook, or folder')
  if (input.config != null && !plain(input.config)) throw new Error('trigger config must be an object')
  const config = { ...(input.config || {}) }
  delete config.tokenHash
  delete config.webhookToken
  let enabled = input.enabled !== false, scheduleStatus = input.scheduleStatus, scheduleValidationReason = input.scheduleValidationReason
  if (['interval', 'cron'].includes(type)) {
    try {
      Object.assign(config, normalizeScheduleConfig({ ...input, type, config }))
      scheduleStatus = 'ready'; scheduleValidationReason = null
    } catch (error) {
      enabled = false; scheduleStatus = 'needs-review'; scheduleValidationReason = boundedText(error.message, 160)
    }
  }
  return {
    ...input,
    id,
    workflowId: owner,
    type,
    enabled,
    config,
    ...(type === 'webhook' ? { secretRevision: Math.max(1, Math.floor(Number(input.secretRevision) || 1)) } : {}),
    ...(scheduleStatus ? { scheduleStatus } : {}),
    ...(scheduleValidationReason ? { scheduleValidationReason } : {}),
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Number(input.createdAt) || Date.now(),
  }
}

export function normalizeWorkflowTriggers(value, workflowId) {
  if (value == null) return []
  if (!Array.isArray(value)) throw new Error('workflow triggers must be an array')
  const seen = new Set()
  return value.map(item => normalizeTriggerDefinition(item, { workflowId })).map(item => {
    if (seen.has(item.id)) throw new Error(`duplicate trigger id: ${item.id}`)
    seen.add(item.id)
    return item
  })
}

export function publicTrigger(trigger) {
  const { tokenHash, webhookToken, ...safe } = trigger || {}
  if (safe.config) {
    safe.config = { ...safe.config }
    delete safe.config.tokenHash
    delete safe.config.webhookToken
  }
  return safe
}

export function normalizeError(error) {
  let message = boundedText(error?.message || error || 'trigger delivery failed', 240)
  message = message
    .replace(/\b(bearer|token|password|secret|authorization|api[_-]?key)\s*[:=]\s*[^\s,;]+/gi, '$1=[redacted]')
    .replace(/https?:\/\/[^\s/]+\/[^\s]*/gi, '[redacted-url]')
    .replace(/\/(?:Users|home|private|tmp)\/[^\s]+/g, '[redacted-path]')
  return { code: boundedText(error?.code || 'TRIGGER_DELIVERY_FAILED', 64), message }
}

export function normalizeEvidence(value = {}) {
  if (!plain(value)) throw new Error('delivery evidence must be an object')
  const allowed = ['runStatus', 'duplicate', 'manual', 'recovered', 'recoveredFrom', 'reason', 'error', 'intendedAt', 'policyResult', 'scheduleHash', 'event', 'relativePathHash', 'previousRelativePathHash', 'fingerprintHash']
  const evidence = {}
  for (const key of allowed) {
    if (!(key in value)) continue
    if (key === 'error') evidence.error = normalizeError(value.error)
    else if (['duplicate', 'manual', 'recovered'].includes(key)) evidence[key] = !!value[key]
    else if (key === 'intendedAt') evidence[key] = Number(value[key]) || 0
    else if (['scheduleHash', 'relativePathHash', 'previousRelativePathHash', 'fingerprintHash'].includes(key)) {
      const hash = boundedText(value[key], 64)
      if (/^[a-f0-9]{64}$/.test(hash)) evidence[key] = hash
    } else evidence[key] = boundedText(value[key], 120)
  }
  return evidence
}

export function normalizeDelivery(input) {
  if (!plain(input)) throw new Error('delivery must be an object')
  const id = String(input.id || '')
  const triggerId = String(input.triggerId || '')
  const workflowId = String(input.workflowId || '')
  const deliveryKey = String(input.deliveryKey || '')
  const state = String(input.state || input.status || '')
  if (!SAFE_DELIVERY_ID.test(id)) throw new Error('delivery has an invalid id')
  if (!SAFE_TRIGGER_ID.test(triggerId)) throw new Error('delivery has an invalid trigger id')
  if (!/^[a-z0-9_-]+$/i.test(workflowId)) throw new Error('delivery has an invalid workflow id')
  if (!/^[a-f0-9]{64}$/.test(deliveryKey)) throw new Error('delivery has an invalid redacted key')
  if (!DELIVERY_STATES.has(state)) throw new Error('delivery has an invalid state')
  const workflowVersion = input.workflowVersion == null ? null : String(input.workflowVersion)
  if (workflowVersion && !/^[a-z0-9_.-]+$/i.test(workflowVersion)) throw new Error('delivery has an invalid workflow version')
  const runId = input.runId == null ? null : String(input.runId)
  if (runId && !/^[a-z0-9_.-]+$/i.test(runId)) throw new Error('delivery has an invalid run id')
  return {
    ...input,
    id,
    triggerId,
    workflowId,
    workflowVersion,
    deliveryKey,
    source: boundedText(input.source || 'unknown', 40),
    scheduledAt: Number(input.scheduledAt) || Number(input.createdAt) || Date.now(),
    state,
    runId,
    attempt: Math.max(1, Number(input.attempt) || 1),
    evidence: normalizeEvidence(input.evidence),
    createdAt: Number(input.createdAt) || Date.now(),
    updatedAt: Number(input.updatedAt) || Number(input.createdAt) || Date.now(),
  }
}
